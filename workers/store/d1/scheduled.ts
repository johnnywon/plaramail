// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

/**
 * Scheduled send, run by the one-minute cron. A message goes out up to a
 * minute after its time.
 *
 * Each run claims due rows before sending (claimed_at), so two overlapping
 * runs can't both send one; the `draft:<id>` send key is the second guard.
 * A claim older than CLAIM_STALE_MS is taken over, in case a run died.
 * Deleting or editing the draft drops its row by foreign key.
 */
import { Folders } from "../../../shared/folders";
import { deleteAttachmentFiles } from "../../lib/attachments";
import { SCHEDULE_MAX_ATTEMPTS, SCHEDULE_RETRY_MS, type ScheduledPayload, sendModeOf } from "../../lib/scheduled-send";
import { sendMail } from "../../lib/send";
import type { Env } from "../../types";
import type { Sql } from "../sql";
import { D1Mailbox } from "./mailbox";

export const CLAIM_STALE_MS = 10 * 60_000;
const BATCH = 25;

export async function sendDueScheduled(env: Env, sql: Sql, now = Date.now()) {
	const at = new Date(now).toISOString();
	const claimed = await sql.all(
		`UPDATE scheduled_sends SET claimed_at = ?
		WHERE email_id IN (
			SELECT email_id FROM scheduled_sends
			WHERE send_at <= ? AND attempts < ? AND (claimed_at IS NULL OR claimed_at < ?)
			ORDER BY send_at LIMIT ?
		)
		RETURNING email_id, mailbox_id, payload`,
		at, at, SCHEDULE_MAX_ATTEMPTS, new Date(now - CLAIM_STALE_MS).toISOString(), BATCH,
	);
	const sent: string[] = [];
	const failed: string[] = [];
	for (const row of claimed) {
		const emailId = String(row.email_id);
		const mailboxId = String(row.mailbox_id);
		const mailbox = new D1Mailbox(sql, env.BUCKET, mailboxId);
		let error: string | null;
		// A refusal by the hourly or daily limit is not a failed attempt: it waits for the limit.
		let limited = false;
		// An attempt left in sending may have gone out; retrying can't send it again, so stop.
		let stuck = false;
		try {
			const draft = await mailbox.getEmail(emailId);
			if (!draft || draft.folder_id !== Folders.DRAFT) {
				await sql.run(`DELETE FROM scheduled_sends WHERE email_id = ?`, emailId);
				continue;
			}
			const payload = JSON.parse(String(row.payload)) as ScheduledPayload;
			const result = await sendMail(env, mailboxId, mailbox, payload.email, sendModeOf(payload), { idempotencyKey: `draft:${emailId}` });
			error = result.ok ? null : result.error;
			limited = !result.ok && result.status === 429;
			stuck = !result.ok && result.attempt?.state === "sending";
		} catch (e) {
			error = (e as Error).message || "Delivery failed";
			const key = await sql.first(`SELECT state FROM send_keys WHERE mailbox_id = ? AND key = ?`, mailboxId, `draft:${emailId}`).catch(() => null);
			stuck = key?.state === "sending";
		}
		if (error && limited) {
			// Try again in 15 minutes without counting an attempt, until the limit frees up.
			await sql.run(
				`UPDATE scheduled_sends SET error = ?, claimed_at = NULL, send_at = ? WHERE email_id = ?`,
				error.slice(0, 1000), new Date(now + SCHEDULE_RETRY_MS).toISOString(), emailId,
			);
			failed.push(emailId);
			continue;
		}
		if (error) {
			// Count the attempt. With attempts left it retries in 15 minutes; after the last, or when stuck, it keeps its error.
			const attempts = stuck ? SCHEDULE_MAX_ATTEMPTS : null;
			await sql.run(
				`UPDATE scheduled_sends SET attempts = COALESCE(?, attempts + 1), error = ?, claimed_at = NULL,
					send_at = CASE WHEN ? IS NULL AND attempts + 1 < ? THEN ? ELSE send_at END
				WHERE email_id = ?`,
				attempts, error.slice(0, 1000), attempts, SCHEDULE_MAX_ATTEMPTS, new Date(now + SCHEDULE_RETRY_MS).toISOString(), emailId,
			);
			failed.push(emailId);
			continue;
		}
		const attachments = await mailbox.deleteEmail(emailId);
		if (attachments) await deleteAttachmentFiles(env.BUCKET, emailId, attachments);
		sent.push(emailId);
	}
	return { sent, failed };
}
