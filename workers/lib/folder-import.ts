// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

/**
 * One-time conversion of custom folders to labels of the same name.
 * 1. Dry run: counts per mailbox and folder.
 * 2. Back up the plan and every email id per folder to R2.
 * 3. Create the labels, then label each folder's mail.
 * 4. Move labeled mail still in each folder to Archive.
 * Folders are never deleted, and every step is safe to run again.
 */

import { LABEL_COLORS } from "../../shared/label-colors";
import { labelSlug, type Label } from "./mail-bulk-sql";
import { mailboxIds, mailStore } from "../store";
import type { Env } from "../types";

export interface MailboxFolders {
	mailboxId: string;
	imported: boolean;
	folders: { folderId: string; name: string; count: number }[];
}

export interface FolderImportPlan {
	labels: { id: string; name: string; exists: boolean; folders: number; messages: number }[];
	mailboxes: { mailboxId: string; imported: boolean; folders: { folderId: string; name: string; count: number; labelId: string }[] }[];
	totals: { mailboxes: number; folders: number; messages: number };
}

/** Folders with the same name in several mailboxes become one label; an existing label of that name is reused. */
export function planFolderImport(mailboxes: MailboxFolders[], existing: Pick<Label, "id" | "name">[]): FolderImportPlan {
	const taken = new Set(existing.map((l) => l.id));
	const byName = new Map<string, FolderImportPlan["labels"][number]>();
	for (const label of existing) {
		byName.set(label.name.toLowerCase(), { id: label.id, name: label.name, exists: true, folders: 0, messages: 0 });
	}
	const out: FolderImportPlan["mailboxes"] = [];
	let folders = 0;
	let messages = 0;
	for (const mailbox of [...mailboxes].sort((a, b) => a.mailboxId.localeCompare(b.mailboxId))) {
		if (mailbox.folders.length === 0) continue;
		const rows: FolderImportPlan["mailboxes"][number]["folders"] = [];
		for (const folder of mailbox.folders) {
			const name = folder.name.trim() || folder.folderId;
			let label = byName.get(name.toLowerCase());
			if (!label) {
				const id = taken.has(folder.folderId) ? labelSlug(name, taken) : folder.folderId;
				taken.add(id);
				label = { id, name, exists: false, folders: 0, messages: 0 };
				byName.set(name.toLowerCase(), label);
			}
			label.folders++;
			label.messages += folder.count;
			folders++;
			messages += folder.count;
			rows.push({ ...folder, labelId: label.id });
		}
		out.push({ mailboxId: mailbox.mailboxId, imported: mailbox.imported, folders: rows });
	}
	return {
		labels: [...byName.values()].filter((l) => l.folders > 0),
		mailboxes: out,
		totals: { mailboxes: out.length, folders, messages },
	};
}

export interface ImportMailbox {
	folderImportCounts(): Promise<{ folders: MailboxFolders["folders"]; imported: boolean }>;
	folderEmailIds(folderId: string): Promise<string[]>;
	importFolder(folderId: string, labelId: string): Promise<{ labeled: number; archived: number }>;
	markFoldersImported(): Promise<unknown>;
}

export interface ImportDeps {
	mailboxIds(): Promise<string[]>;
	mailbox(id: string): ImportMailbox;
	listLabels(): Promise<Pick<Label, "id" | "name" | "color">[]>;
	createLabel(input: { id: string; name: string; color: string }): Promise<{ label?: unknown; error?: string }>;
	putBackup(key: string, body: string): Promise<void>;
	now(): number;
}

export function importDeps(env: Env): ImportDeps {
	const index = mailStore(env).all();
	return {
		mailboxIds: () => mailboxIds(env),
		mailbox: (id) => mailStore(env).mailbox(id) as unknown as ImportMailbox,
		listLabels: async () => (await index.listLabels()).map((l) => ({ id: l.id, name: l.name, color: l.color })),
		createLabel: async (input) => index.createLabel(input),
		putBackup: async (key, body) => {
			await env.BUCKET.put(key, body, { httpMetadata: { contentType: "application/json" } });
		},
		now: () => Date.now(),
	};
}

export async function dryRunFolderImport(deps: ImportDeps): Promise<FolderImportPlan> {
	const ids = await deps.mailboxIds();
	const mailboxes = await Promise.all(ids.map(async (mailboxId) => ({ mailboxId, ...(await deps.mailbox(mailboxId).folderImportCounts()) })));
	return planFolderImport(mailboxes, await deps.listLabels());
}

export interface FolderImportResult {
	backup: string;
	plan: FolderImportPlan;
	results: { mailboxId: string; folderId: string; labelId: string; labeled: number; archived: number; error?: string }[];
}

export async function runFolderImport(deps: ImportDeps): Promise<FolderImportResult> {
	const plan = await dryRunFolderImport(deps);

	// Back up every email id per folder before anything changes.
	const emails: Record<string, Record<string, string[]>> = {};
	for (const mailbox of plan.mailboxes) {
		emails[mailbox.mailboxId] = {};
		for (const folder of mailbox.folders) {
			emails[mailbox.mailboxId][folder.folderId] = await deps.mailbox(mailbox.mailboxId).folderEmailIds(folder.folderId);
		}
	}
	const createdAt = new Date(deps.now()).toISOString();
	const backup = `backups/folder-import-${createdAt.replace(/[:.]/g, "-")}.json`;
	await deps.putBackup(backup, JSON.stringify({ createdAt, plan, emails }, null, 1));

	// New labels take palette colours no existing label uses, then cycle.
	const used = new Set((await deps.listLabels()).map((l) => l.color));
	const palette = [...LABEL_COLORS.filter((c) => !used.has(c.bg)), ...LABEL_COLORS.filter((c) => used.has(c.bg))];
	const missing = plan.labels.filter((l) => !l.exists);
	for (const [i, label] of missing.entries()) {
		const color = palette[i % palette.length].bg;
		const created = await deps.createLabel({ id: label.id, name: label.name, color });
		if (created.error) throw new Error(`Could not create label ${label.name}: ${created.error}`);
	}

	const results: FolderImportResult["results"] = [];
	for (const mailbox of plan.mailboxes) {
		const stub = deps.mailbox(mailbox.mailboxId);
		let ok = true;
		for (const folder of mailbox.folders) {
			try {
				const done = await stub.importFolder(folder.folderId, folder.labelId);
				results.push({ mailboxId: mailbox.mailboxId, folderId: folder.folderId, labelId: folder.labelId, ...done });
			} catch (e) {
				ok = false;
				results.push({ mailboxId: mailbox.mailboxId, folderId: folder.folderId, labelId: folder.labelId, labeled: 0, archived: 0, error: (e as Error).message });
			}
		}
		if (ok) await stub.markFoldersImported();
	}
	return { backup, plan, results };
}
