// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

/**
 * Shared tool business logic for the Agent and MCP server.
 *
 * Each function takes an `env: Env` (or a mailbox store) and tool-specific params,
 * performs the business logic (store calls, data fetching, formatting), and
 * returns a plain object. The Agent and MCP server wrap these results in
 * their own response formats.
 *
 * Functions that already exist in email-helpers.ts (getFullEmail, getFullThread)
 * are reused directly — this module covers the remaining shared operations.
 */

import { mailStore } from "../store";
import { DATE_TOKENS, emptyFilter, InvalidFilterError, type MailFilter, searchOf, VIEWS } from "./mail-index-sql";
import type { EmailFull } from "./schemas";
import { snippetText } from "./snippets";
import {
	getFullEmail,
	getFullThread,
	buildQuotedReplyBlock,
	textToHtml,
} from "./email-helpers";
import { verifyDraft } from "./ai";
import { sendMail } from "./send";
import type { SendActor } from "./send-budget";
import type { DraftNotes } from "../../shared/draft-notes";
import { deleteAttachmentFiles } from "./attachments";
import { Folders, isSystemFolder } from "../../shared/folders";
import { LABEL_COLORS } from "../../shared/label-colors";
import { describeShortcuts, findShortcut, isRebindable, setShortcut, type ShortcutOverrides } from "../../shared/shortcuts";
import { readPrefs, writePrefs } from "./prefs";
import type { Env } from "../types";

const splitList = (value: string | null | undefined) =>
	(value ?? "").split(",").map((a) => a.trim()).filter(Boolean);

// ── list_mailboxes ─────────────────────────────────────────────────

export async function toolListMailboxes(env: Env) {
	return mailStore(env).mailboxes.list();
}

// ── list_emails ────────────────────────────────────────────────────

export async function toolListEmails(
	env: Env,
	mailboxId: string,
	params: { folder: string; limit: number; page: number },
) {
	const stub = mailStore(env).mailbox(mailboxId);
	return stub.getEmails({
		folder: params.folder,
		limit: params.limit,
		page: params.page,
		sortColumn: "date",
		sortDirection: "DESC",
	});
}

// ── get_email ──────────────────────────────────────────────────────

export async function toolGetEmail(
	env: Env,
	mailboxId: string,
	emailId: string,
) {
	const stub = mailStore(env).mailbox(mailboxId);
	const email = await getFullEmail(stub, emailId);
	if (!email) return { error: "Email not found" };
	return email;
}

// ── get_thread ─────────────────────────────────────────────────────

export async function toolGetThread(
	env: Env,
	mailboxId: string,
	threadId: string,
) {
	const stub = mailStore(env).mailbox(mailboxId);
	return getFullThread(stub, threadId);
}

// ── search_emails ──────────────────────────────────────────────────

/**
 * search_all_mail scoped to one address. A folder that isn't a view is
 * searched by name with `in:`.
 */
export async function toolSearchEmails(
	env: Env,
	mailboxId: string,
	params: { query: string; folder?: string; limit?: number },
) {
	const folder = (params.folder ?? "").trim();
	const lower = folder.toLowerCase() === "draft" ? "drafts" : folder.toLowerCase();
	const isView = (VIEWS as readonly string[]).includes(lower);
	const query = !folder || isView ? params.query : `${params.query} in:"${folder.replace(/"/g, "")}"`;
	return toolSearchAllMail(env, { query, folder: !folder ? undefined : isView ? lower : "anywhere", to: [mailboxId], limit: params.limit });
}

// ── draft_reply ────────────────────────────────────────────────────

/**
 * Shared draft-reply logic.
 *
 * @param bodyInput - The reply body text. Can be plain text or HTML.
 * @param options.isPlainText - If true, body is treated as plain text and
 *   converted to HTML. If false, body is treated as HTML.
 * @param options.runVerifyDraft - If true, runs AI verifyDraft on the body.
 *   The agent and MCP both do this, but the agent does it on plain text
 *   while MCP does it on HTML.
 */
export async function toolDraftReply(
	env: Env,
	mailboxId: string,
	params: {
		originalEmailId: string;
		to: string;
		subject: string;
		body: string;
		isPlainText?: boolean;
		runVerifyDraft?: boolean;
		/** Set for agent drafts: who made it and how it was redrafted. */
		notes?: DraftNotes;
	},
): Promise<
	| { status: "draft_saved"; draftId: string; message: string; draft: Record<string, string> }
	| { error: string }
> {
	const stub = mailStore(env).mailbox(mailboxId);

	// Verify/sanitize if requested
	let processedBody = params.body.trim();
	if (params.runVerifyDraft) {
		const sanitized = await verifyDraft(env.AI, processedBody);
		if (!sanitized) {
			return { error: "Draft verification failed — body could not be verified. Please try again." };
		}
		processedBody = sanitized;
	}

	// Convert plain text to HTML if needed
	if (params.isPlainText) {
		processedBody = textToHtml(processedBody);
	}

	const draftId = crypto.randomUUID();

	// Get the original email for thread_id and quoted text
	const original = (await stub.getEmail(params.originalEmailId)) as EmailFull | null;
	const threadId = original?.thread_id || params.originalEmailId;

	// Append quoted original message, its time in the reader's zone.
	const quotedBlock = original
		? buildQuotedReplyBlock({
				date: original.date,
				sender: original.sender || params.to,
				body: original.body ?? undefined,
			}, (await readPrefs(env)).prefs.timeZone)
		: "";
	const bodyHtml = processedBody + quotedBlock;

	await stub.createEmail(
		Folders.DRAFT,
		{
			id: draftId,
			subject: params.subject,
			sender: mailboxId.toLowerCase(),
			recipient: params.to.toLowerCase(),
			date: new Date().toISOString(),
			body: bodyHtml,
			in_reply_to: params.originalEmailId,
			email_references: null,
			thread_id: threadId,
		},
		[],
	);
	if (params.notes) await stub.setDraftNotes(draftId, params.notes);

	return {
		status: "draft_saved",
		draftId,
		message: "Draft saved to Drafts folder. Review it and confirm to send.",
		draft: {
			originalEmailId: params.originalEmailId,
			to: params.to,
			subject: params.subject,
			body: params.isPlainText ? params.body.trim() : bodyHtml,
		},
	};
}

// ── draft_email (new email, not a reply) ───────────────────────────

export async function toolDraftEmail(
	env: Env,
	mailboxId: string,
	params: {
		to: string;
		subject: string;
		body: string;
		isPlainText?: boolean;
		runVerifyDraft?: boolean;
		/** Optional in_reply_to for create_draft style */
		in_reply_to?: string;
		/** Optional thread_id for create_draft style */
		thread_id?: string;
		notes?: DraftNotes;
	},
): Promise<
	| { status: string; draftId: string; threadId?: string; message: string; draft?: Record<string, string> }
	| { error: string }
> {
	const stub = mailStore(env).mailbox(mailboxId);

	let processedBody = params.body.trim();
	if (params.runVerifyDraft) {
		const sanitized = await verifyDraft(env.AI, processedBody);
		if (!sanitized) {
			return { error: "Draft verification failed — body could not be verified. Please try again." };
		}
		processedBody = sanitized;
	}

	if (params.isPlainText) {
		processedBody = textToHtml(processedBody);
	}

	const draftId = crypto.randomUUID();

	// Resolve thread ID
	let resolvedThreadId = params.thread_id;
	if (!resolvedThreadId && params.in_reply_to) {
		const original = (await stub.getEmail(params.in_reply_to)) as EmailFull | null;
		resolvedThreadId = original?.thread_id || params.in_reply_to;
	}
	if (!resolvedThreadId) {
		resolvedThreadId = draftId;
	}

	await stub.createEmail(
		Folders.DRAFT,
		{
			id: draftId,
			subject: params.subject,
			sender: mailboxId.toLowerCase(),
			recipient: (params.to || "").toLowerCase(),
			date: new Date().toISOString(),
			body: processedBody,
			in_reply_to: params.in_reply_to || null,
			email_references: null,
			thread_id: resolvedThreadId,
		},
		[],
	);
	if (params.notes) await stub.setDraftNotes(draftId, params.notes);

	return {
		status: "draft_saved",
		draftId,
		threadId: resolvedThreadId,
		message: "Draft saved to Drafts folder. Review it and confirm to send.",
		draft: {
			to: params.to,
			subject: params.subject,
			body: params.isPlainText ? params.body.trim() : processedBody,
		},
	};
}

// ── update_draft ───────────────────────────────────────────────────

export async function toolUpdateDraft(
	env: Env,
	mailboxId: string,
	params: {
		draftId: string;
		to?: string;
		subject?: string;
		bodyHtml?: string;
	},
): Promise<
	| { status: string; newDraftId: string; oldDraftId: string; message: string }
	| { error: string }
> {
	const stub = mailStore(env).mailbox(mailboxId);

	const oldDraft = (await stub.getEmail(params.draftId)) as EmailFull | null;
	if (!oldDraft) {
		return { error: "Draft not found" };
	}

	// Verify the body BEFORE deleting the old draft to prevent data loss
	const newDraftId = crypto.randomUUID();
	const rawBody = params.bodyHtml ?? oldDraft.body ?? "";
	const verifiedBody = await verifyDraft(env.AI, rawBody);

	if (!verifiedBody) {
		return { error: "Draft verification failed — keeping existing draft unchanged. Please try again." };
	}

	const notes = await stub.getDraftNotes(params.draftId);
	const attachments = await stub.deleteEmail(params.draftId);
	if (attachments) await deleteAttachmentFiles(env.BUCKET, params.draftId, attachments);
	await stub.createEmail(
		Folders.DRAFT,
		{
			id: newDraftId,
			subject: params.subject ?? oldDraft.subject,
			sender: mailboxId.toLowerCase(),
			recipient: (params.to ?? oldDraft.recipient).toLowerCase(),
			date: new Date().toISOString(),
			body: verifiedBody,
			in_reply_to: oldDraft.in_reply_to || null,
			email_references: oldDraft.email_references || null,
			thread_id: oldDraft.thread_id || newDraftId,
		},
		[],
	);
	if (notes) await stub.setDraftNotes(newDraftId, notes);

	return {
		status: "draft_updated",
		newDraftId,
		oldDraftId: params.draftId,
		message: "Draft updated in Drafts folder.",
	};
}

// ── mark_email_read ────────────────────────────────────────────────

export async function toolMarkEmailRead(
	env: Env,
	mailboxId: string,
	emailId: string,
	read: boolean,
) {
	const stub = mailStore(env).mailbox(mailboxId);
	await stub.updateEmail(emailId, { read });
	return { status: "updated", emailId, read };
}

// ── move_email ─────────────────────────────────────────────────────

export async function toolMoveEmail(
	env: Env,
	mailboxId: string,
	emailId: string,
	folderId: string,
) {
	const stub = mailStore(env).mailbox(mailboxId);
	const success = await stub.moveEmail(emailId, folderId);
	if (success) {
		return { status: "moved", emailId, folder: folderId };
	}
	if (!isSystemFolder(folderId)) {
		return { error: "Custom folders are labels now. Use label_conversation." };
	}
	return { error: "Failed to move email" };
}

// ── list_labels ────────────────────────────────────────────────────

export async function toolListLabels(env: Env) {
	const labels = await mailStore(env).all().listLabels();
	return { labels: labels.map(({ id, name, color, count }) => ({ id, name, color, conversations: count })) };
}

// ── Keyboard shortcuts ─────────────────────────────────────────────

const KEY_FORMAT = 'Keys are written like "e", "shift+x", "cmd+k" (Ctrl off a Mac), "down" or "g i" for a sequence.';

/** Every shortcut, with the keys it answers to now and its defaults. */
export async function toolListShortcuts(env: Env) {
	const { prefs } = await readPrefs(env);
	return { shortcuts: describeShortcuts(prefs.shortcuts), note: `Only rebindable shortcuts can change. ${KEY_FORMAT}` };
}

/** Give a shortcut new keys, saved for the deployment. A key another shortcut had moves over. */
export async function toolSetShortcut(env: Env, params: { shortcut: string; keys: string[] }) {
	const { prefs } = await readPrefs(env);
	const result = setShortcut(prefs.shortcuts, params.shortcut, params.keys);
	if (!result.ok) return { error: result.error };
	await writePrefs(env, { shortcuts: result.overrides });
	return { status: "saved", shortcut: result.id, keys: result.keys, takenFrom: result.takenFrom };
}

/** Restore one shortcut's default keys, or every shortcut's when none is named. */
export async function toolResetShortcuts(env: Env, params: { shortcut?: string }) {
	const { prefs } = await readPrefs(env);
	let overrides: ShortcutOverrides = {};
	if (params.shortcut) {
		const def = findShortcut(params.shortcut);
		if (!def || !isRebindable(def.id)) return { error: `Unknown or fixed shortcut: ${params.shortcut}. Use list_shortcuts to see them.` };
		const result = setShortcut(prefs.shortcuts, def.id, null);
		if (!result.ok) return { error: result.error };
		overrides = result.overrides;
	}
	await writePrefs(env, { shortcuts: overrides });
	return { status: "reset", shortcut: params.shortcut ?? "all", shortcuts: describeShortcuts(overrides).filter((s) => s.rebindable).map(({ id, keys }) => ({ id, keys })) };
}

export const SHORTCUT_TOOL_DESCRIPTIONS = {
	list: "List the app's keyboard shortcuts: id, label, where each works, its keys now and its default keys, and whether it can be rebound.",
	set: `Rebind a keyboard shortcut for everyone on this deployment. ${KEY_FORMAT} A key another shortcut had moves to this one; the result says which. An empty list turns the shortcut off. Esc, g, ?, Tab, Enter, Space and Alt keys are kept for the app.`,
	reset: "Restore a keyboard shortcut's default keys, or every shortcut's when no shortcut is named.",
	shortcut: "The shortcut's id or label, e.g. archive or Reply all",
	keys: "One or two keys, e.g. [\"y\"] or [\"j\", \"down\"]",
};

// ── create_label ───────────────────────────────────────────────────

/**
 * Create a label shared by every mailbox. A label with the same name (any
 * case) is returned as it is, so the call is safe to repeat.
 */
export async function toolCreateLabel(env: Env, params: { name: string; color?: string }) {
	const index = mailStore(env).all();
	const labels = await index.listLabels();
	const name = params.name.trim();
	const existing = labels.find((l) => l.name.toLowerCase() === name.toLowerCase());
	if (existing) return { status: "exists", label: { id: existing.id, name: existing.name, color: existing.color } };
	const color = params.color ?? LABEL_COLORS[labels.length % LABEL_COLORS.length].bg;
	const result = await index.createLabel({ name, color });
	if ("error" in result && result.error) return { error: result.error };
	const label = (result as { label: { id: string; name: string; color: string } }).label;
	return { status: "created", label: { id: label.id, name: label.name, color: label.color } };
}

function findLabel<T extends { id: string; name: string }>(labels: T[], ref: string): T | undefined {
	const r = ref.trim().toLowerCase();
	return labels.find((l) => l.id === ref.trim() || l.name.toLowerCase() === r);
}

// ── rename_label ───────────────────────────────────────────────────

/** Rename a label, named by id or name. Conversations keep it. */
export async function toolRenameLabel(env: Env, params: { label: string; name: string }) {
	const index = mailStore(env).all();
	const label = findLabel(await index.listLabels(), params.label);
	if (!label) return { error: `Unknown label: ${params.label}. Use list_labels to see labels.` };
	const result = await index.updateLabel(label.id, { name: params.name.trim() });
	if ("error" in result && result.error) return { error: result.error };
	const updated = (result as { label: { id: string; name: string } | null }).label;
	if (!updated) return { error: `Unknown label: ${params.label}.` };
	return { status: "renamed", from: label.name, label: { id: updated.id, name: updated.name } };
}

// ── delete_label ───────────────────────────────────────────────────

/** Delete a label, named by id or name: it comes off every conversation, then the label goes. */
export async function toolDeleteLabel(env: Env, params: { label: string }) {
	const index = mailStore(env).all();
	const label = findLabel(await index.listLabels(), params.label);
	if (!label) return { error: `Unknown label: ${params.label}. Use list_labels to see labels.` };
	const result = await index.deleteLabel(label.id);
	if (!result) return { error: `Unknown label: ${params.label}.` };
	if (!result.deleted) return { error: `Could not remove ${label.name} from every conversation; it was kept.`, failed: result.failed };
	return { status: "deleted", label: label.name, conversations: label.count };
}

// ── label_conversation ─────────────────────────────────────────────

/**
 * Add or remove labels on the whole conversation that holds an email, and
 * optionally archive it. Labels are named by id or name; unknown ones are refused.
 */
export async function toolLabelConversation(
	env: Env,
	mailboxId: string,
	emailId: string,
	params: { add?: string[]; remove?: string[]; archive?: boolean },
) {
	const index = mailStore(env).all();
	const labels = await index.listLabels();
	const resolve = (ref: string) =>
		labels.find((l) => l.id === ref || l.name.toLowerCase() === ref.trim().toLowerCase());
	const unknown = [...(params.add ?? []), ...(params.remove ?? [])].filter((ref) => !resolve(ref));
	if (unknown.length > 0) {
		return { error: `Unknown label: ${unknown.join(", ")}. Use list_labels to see labels, or create_label to make one.` };
	}
	const threadKey = await index.threadKeyOf(mailboxId, emailId);
	if (!threadKey) return { error: "Email not found", emailId };

	const target = { threadKeys: [threadKey], view: "all" };
	const done: string[] = [];
	for (const [refs, type] of [[params.add ?? [], "label_add"], [params.remove ?? [], "label_remove"]] as const) {
		for (const ref of refs) {
			const label = resolve(ref)!;
			const result = await index.bulk(target, { type, labelId: label.id });
			const failure = "failed" in result ? result.failed?.[0] : undefined;
			if (failure) return { error: failure.error };
			done.push(`${type === "label_add" ? "added" : "removed"} ${label.name}`);
		}
	}
	const added = (params.add ?? []).map((ref) => resolve(ref)!.id);
	if (added.length > 0) await index.markLabelsAuto(added);
	if (params.archive) {
		await index.bulk({ threadKeys: [threadKey], view: "inbox" }, { type: "archive" });
		done.push("archived");
	}
	return { status: "updated", emailId, changes: done };
}

// ── star_conversation ──────────────────────────────────────────────

/**
 * Star or unstar the conversation that holds an email, the way the app's star
 * does: starring marks its latest message, unstarring clears every message.
 */
export async function toolStarConversation(env: Env, mailboxId: string, emailId: string, starred: boolean) {
	const index = mailStore(env).all();
	const threadKey = await index.threadKeyOf(mailboxId, emailId);
	if (!threadKey) return { error: "Email not found", emailId };
	const result = await index.bulk({ threadKeys: [threadKey], view: "all" }, { type: starred ? "star" : "unstar" });
	const failure = "failed" in result ? result.failed?.[0] : undefined;
	if (failure) return { error: failure.error };
	return { status: starred ? "starred" : "unstarred", emailId };
}

// ── search_all_mail / label_matching ───────────────────────────────

/** A search across every address, as the agent tools describe it. */
export interface MailSearch {
	query?: string;
	from?: string[];
	to?: string[];
	label?: string[];
	folder?: string;
	unread?: boolean;
	starred?: boolean;
	hasAttachment?: boolean;
	date?: string;
}

export const LABEL_MATCHING_MAX = 500;

/** How the `query` argument reads, for the agent's and MCP's tool descriptions. */
export const SEARCH_HELP =
	`The query uses the mail search language: words match any field by prefix, "exact phrase", -word or -from:x to exclude, a OR b. ` +
	`Operators: from: to: cc: subject: label: in: (inbox, sent, trash, anywhere or a folder name) is: (unread, read, starred, scheduled, replied) ` +
	`has: (attachment, pdf, image, link, draft, unsubscribe) filename: before: after: (2026-01-31 or 30d) newer: older: (7d, 3w, 2m, 1y) larger: smaller: (500k, 5mb) list:. ` +
	`Results with words come best match first where the store ranks them (order: "relevance"); add sort:date for newest first.`;

/**
 * Build a mail filter. Labels are named by id or name; unknown ones are an
 * error. The query text is checked too.
 */
export function mailSearchFilter(
	search: MailSearch,
	labels: { id: string; name: string }[],
): { filter: MailFilter } | { error: string } {
	const folder = (search.folder ?? "all").trim().toLowerCase();
	if (!(VIEWS as readonly string[]).includes(folder)) return { error: `Unknown folder: ${search.folder}. Use one of ${VIEWS.join(", ")}.` };
	if (search.date && !(DATE_TOKENS as readonly string[]).includes(search.date)) {
		return { error: `Unknown date: ${search.date}. Use one of ${DATE_TOKENS.join(", ")}.` };
	}
	const labelIds: string[] = [];
	for (const ref of search.label ?? []) {
		const label = findLabel(labels, ref);
		if (!label) return { error: `Unknown label: ${ref}. Use list_labels to see labels.` };
		labelIds.push(label.id);
	}
	const is: MailFilter["is"] = [];
	if (search.unread === true) is.push("unread");
	if (search.unread === false) is.push("read");
	if (search.starred) is.push("starred");
	const clean = (list?: string[]) => (list ?? []).map((v) => v.trim()).filter(Boolean).slice(0, 20);
	const filter = emptyFilter({
		view: folder,
		q: (search.query ?? "").trim(),
		from: clean(search.from),
		address: clean(search.to),
		label: labelIds,
		is,
		has: search.hasAttachment ? ["attachment"] : [],
		date: search.date as MailFilter["date"],
	});
	try {
		searchOf(filter);
	} catch (e) {
		if (e instanceof InvalidFilterError) return { error: `${e.message}. ${SEARCH_HELP}` };
		throw e;
	}
	const empty = !filter.q && !filter.from.length && !filter.address.length && !filter.label.length && !filter.is.length && !filter.has.length && !filter.date;
	if (empty && folder === "all") return { error: "Give at least one search term, sender, address, label, folder or date." };
	return { filter };
}

/** Search every address at once. Each result names the address it is in. */
export async function toolSearchAllMail(env: Env, search: MailSearch & { limit?: number }) {
	const index = mailStore(env).all();
	const built = mailSearchFilter(search, await index.listLabels());
	if ("error" in built) return built;
	const limit = Math.min(Math.max(search.limit ?? 25, 1), 50);
	const result = await index.queryMail(built.filter, { limit });
	return {
		total: result.total,
		more: !!result.nextCursor,
		conversations: result.conversations.map((c) => ({
			mailboxId: c.mailbox_id,
			emailId: c.email_id,
			date: c.date,
			from: c.sender_name ? `${c.sender_name} <${c.sender_addr}>` : c.sender_addr,
			subject: c.subject,
			// The text around the matched words, or the opening lines.
			snippet: c.snippet_html ? snippetText(c.snippet_html) : c.snippet,
			unread: c.unread,
			labels: c.labels,
			messages: c.thread_count,
			...(c.match_count !== undefined ? { matched: c.match_count } : {}),
		})),
		...(result.order ? { order: result.order } : {}),
	};
}

/**
 * Add or remove labels on every conversation matching a search, across all
 * addresses, in one call. Refuses more than LABEL_MATCHING_MAX conversations.
 */
export async function toolLabelMatching(
	env: Env,
	search: MailSearch,
	params: { add?: string[]; remove?: string[]; archive?: boolean },
) {
	const index = mailStore(env).all();
	const labels = await index.listLabels();
	const unknown = [...(params.add ?? []), ...(params.remove ?? [])].filter((ref) => !findLabel(labels, ref));
	if (unknown.length > 0) {
		return { error: `Unknown label: ${unknown.join(", ")}. Use list_labels to see labels, or create_label to make one.` };
	}
	if (!params.add?.length && !params.remove?.length && !params.archive) return { error: "Say which labels to add or remove." };
	const built = mailSearchFilter(search, labels);
	if ("error" in built) return built;
	const threadKeys = await index.threadKeysMatching(built.filter, LABEL_MATCHING_MAX + 1);
	if (threadKeys.length === 0) return { status: "no matches", conversations: 0 };
	if (threadKeys.length > LABEL_MATCHING_MAX) {
		return { error: `More than ${LABEL_MATCHING_MAX} conversations match. Narrow the search (sender, address, date or folder) and run it in parts.` };
	}
	const done: string[] = [];
	for (const [refs, type] of [[params.add ?? [], "label_add"], [params.remove ?? [], "label_remove"]] as const) {
		for (const ref of refs) {
			const label = findLabel(labels, ref)!;
			const result = await index.bulk({ threadKeys, view: "all" }, { type, labelId: label.id });
			if ("conflict" in result) return { error: "The mail changed while labelling. Try again." };
			const failure = "failed" in result ? result.failed?.[0] : undefined;
			if (failure) return { error: failure.error, done };
			done.push(`${type === "label_add" ? "added" : "removed"} ${label.name}`);
		}
	}
	const added = (params.add ?? []).map((ref) => findLabel(labels, ref)!.id);
	if (added.length > 0) await index.markLabelsAuto(added);
	if (params.archive) {
		await index.bulk({ threadKeys, view: "inbox" }, { type: "archive" });
		done.push("archived");
	}
	return { status: "updated", conversations: threadKeys.length, changes: done };
}

// ── discard_draft ──────────────────────────────────────────────────

export async function toolDiscardDraft(
	env: Env,
	mailboxId: string,
	draftId: string,
) {
	const stub = mailStore(env).mailbox(mailboxId);
	const email = (await stub.getEmail(draftId)) as { folder_id?: string } | null;
	if (!email) {
		return { error: "Draft not found" };
	}
	if (email.folder_id !== Folders.DRAFT) {
		return { error: "Cannot discard: email is not a draft" };
	}
	const attachments = await stub.deleteEmail(draftId);
	if (attachments) await deleteAttachmentFiles(env.BUCKET, draftId, attachments);
	return { status: "discarded", draftId };
}

// ── delete_email ───────────────────────────────────────────────────

/** Moves an email to Trash. Tools never delete permanently. */
export async function toolDeleteEmail(
	env: Env,
	mailboxId: string,
	emailId: string,
) {
	const stub = mailStore(env).mailbox(mailboxId);
	const email = (await stub.getEmail(emailId)) as { folder_id?: string } | null;
	if (!email) {
		return { error: "Email not found", emailId };
	}
	if (email.folder_id === Folders.TRASH) {
		return { status: "already_in_trash", emailId };
	}
	await stub.moveEmail(emailId, Folders.TRASH);
	return { status: "moved_to_trash", emailId };
}

// ── send_draft ─────────────────────────────────────────────────────

/**
 * Send a saved draft and remove it from Drafts. A draft with in_reply_to is
 * sent as a reply in that thread. The key is `draft:<id>`, the same one the
 * UI uses, so a draft goes out once however many times it is sent.
 */
export async function toolSendDraft(env: Env, mailboxId: string, draftId: string, actor: SendActor = "agent") {
	const stub = mailStore(env).mailbox(mailboxId);
	const draft = (await stub.getEmail(draftId)) as EmailFull | null;
	if (!draft) return { error: "Draft not found" };
	if (draft.folder_id !== Folders.DRAFT) return { error: "Cannot send: email is not a draft" };
	const to = splitList(draft.recipient);
	if (to.length === 0) return { error: "Cannot send: the draft has no recipient" };

	const settings = (await mailStore(env).mailboxes.get(mailboxId)) ?? {};
	const name = typeof settings.fromName === "string" ? settings.fromName.trim() : "";
	const cc = splitList(draft.cc);
	const bcc = splitList(draft.bcc);
	const html = draft.body || "";
	const original = draft.in_reply_to ? await stub.getEmail(draft.in_reply_to) : null;
	const result = await sendMail(env, mailboxId, stub, {
		to,
		...(cc.length ? { cc } : {}),
		...(bcc.length ? { bcc } : {}),
		from: name && name.toLowerCase() !== mailboxId.toLowerCase() ? { email: mailboxId, name } : mailboxId,
		subject: draft.subject || "(no subject)",
		html,
		text: html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim(),
	}, original ? { kind: "reply", originalId: original.id } : { kind: "new" }, { idempotencyKey: `draft:${draftId}`, actor });
	if (!result.ok) return { error: result.error, ...(result.attempt ? { attempt: result.attempt } : {}) };
	const attachments = await stub.deleteEmail(draftId);
	if (attachments) await deleteAttachmentFiles(env.BUCKET, draftId, attachments);
	return { status: result.duplicate ? "already_sent" : "sent", sentId: result.id, to: to.join(", "), subject: draft.subject || "" };
}
