// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

/**
 * Send attempts, keyed by idempotency key, stored per mailbox in the
 * send_keys table. An attempt is claimed as pending, moves to sending when
 * delivery starts (an atomic step, so only one caller delivers), records the
 * provider's message ID, then becomes sent once the Sent copy is stored.
 *
 * A retry with the same key and the same message returns the first send. The
 * same key with a different message is a conflict. An attempt that failed
 * before delivery is marked failed and the key can be used again, as can a
 * pending attempt whose caller died before delivery started. An attempt left
 * in sending may have been delivered: a retry gets its status instead of a
 * second copy.
 */

export const SEND_KEY_MAX_LENGTH = 200;
export const SEND_KEY_TTL_MS = 7 * 24 * 60 * 60_000;
/** A pending attempt this old never started delivery; startSendKey still lets only one caller deliver. */
export const SEND_KEY_PENDING_STALE_MS = 5 * 60_000;

export type SendAttemptState = "pending" | "sending" | "sent" | "failed";

export type SendKeyClaim =
	| { state: "new" }
	| { state: "sent"; id: string }
	| { state: "pending" | "sending"; providerId: string | null }
	| { state: "conflict" };

export const SEND_KEY_PENDING_ERROR =
	"A send with this idempotency key is in progress or did not finish. Check Sent before sending again.";
export const SEND_KEY_SENDING_ERROR =
	"This send was handed to the mail service but not saved to Sent. Check Sent before sending again.";
export const SEND_KEY_CONFLICT_ERROR =
	"This idempotency key was already used for a different message.";

/** Null when the key is usable, else the error to show. */
export function checkSendKey(key: string): string | null {
	if (!key.trim()) return "Idempotency key is empty";
	if (key.length > SEND_KEY_MAX_LENGTH) return `Idempotency key is longer than ${SEND_KEY_MAX_LENGTH} characters`;
	return null;
}

/** SHA-256 of what a send would deliver, so a reused key can be told apart from a retry. */
export async function sendContentHash(parts: unknown): Promise<string> {
	const bytes = new TextEncoder().encode(JSON.stringify(parts));
	const digest = await crypto.subtle.digest("SHA-256", bytes);
	return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
