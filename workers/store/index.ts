// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

/**
 * `mailStore(env)` is the one way callers reach mail storage: the D1
 * database bound as `DB` (workers/store/d1/).
 */
import { configuredAddresses } from "../lib/addresses";
import type { Env } from "../types";
import { D1AllMail } from "./d1/all-mail";
import { D1Mailbox } from "./d1/mailbox";
import { d1Registry } from "./d1/registry";
import { extractAttachmentText, workersAiMarkdown } from "./d1/attachment-text";
import { sendDueScheduled } from "./d1/scheduled";
import { d1StorageStatus } from "./d1/status";
import { d1Sql, type Sql } from "./sql";
import type { MailStore } from "./types";

export type { AllMailStore, BulkFailure, BulkTarget, MailboxRegistry, MailboxStore, MailStore } from "./types";

export function mailStore(env: Env): MailStore {
	const sql = d1Sql(env.DB);
	return {
		mailbox: (mailboxId) => new D1Mailbox(sql, env.BUCKET, mailboxId),
		all: () => new D1AllMail(sql, env.BUCKET),
		mailboxes: d1Registry(sql),
	};
}

/** The same database, for agent records kept beside the mail: activity, auto-draft runs, draft notes. */
export function recordsSql(env: Env): Sql {
	return d1Sql(env.DB);
}

/** Mailboxes that exist and are configured in EMAIL_ADDRESSES, sorted. */
export async function mailboxIds(env: Env): Promise<string[]> {
	const configured = new Set(configuredAddresses(env).map((a) => a.toLowerCase()));
	return (await mailStore(env).mailboxes.list())
		.map((mailbox) => mailbox.id.toLowerCase())
		.filter((id) => configured.size === 0 || configured.has(id))
		.sort();
}

/** Message counts per address for the Storage page (see d1/status.ts). */
export function storageStatus(env: Env, mailboxIds: string[]) {
	return d1StorageStatus(d1Sql(env.DB), mailboxIds);
}

/** One batch of attachment text, run by the cron when ATTACHMENT_SEARCH is on (see d1/attachment-text.ts). */
export function extractAttachmentTextBatch(env: Env, now = Date.now()) {
	return extractAttachmentText(d1Sql(env.DB), { bucket: env.BUCKET, toMarkdown: workersAiMarkdown(env.AI) }, now);
}

/** Due scheduled mail, sent by the cron (see d1/scheduled.ts). */
export function sendDueScheduledMail(env: Env, now = Date.now()) {
	return sendDueScheduled(env, d1Sql(env.DB), now);
}
