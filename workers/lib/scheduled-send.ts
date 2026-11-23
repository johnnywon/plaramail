// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

/**
 * Scheduled sends, stored in the scheduled_sends table. The row's email_id
 * is the draft that holds the message; the cron sends due rows through the
 * shared send path (workers/store/d1/scheduled.ts).
 */
import { z } from "zod";
import { SendEmailRequestSchema } from "./schemas";
import type { SendMode, SendEmailRequest } from "./send";

export const SCHEDULE_MIN_LEAD_MS = 30_000;
export const SCHEDULE_MAX_LEAD_MS = 366 * 24 * 60 * 60_000;
export const SCHEDULE_MAX_PAYLOAD_BYTES = 1_500_000;
export const SCHEDULE_RETRY_MS = 15 * 60_000;
export const SCHEDULE_MAX_ATTEMPTS = 3;

export const ScheduleModeSchema = z.enum(["new", "reply", "reply-all", "forward"]);
export type ScheduleMode = z.infer<typeof ScheduleModeSchema>;

export const ScheduleBody = z
	.object({
		sendAt: z.string().datetime({ offset: true }),
		draft_id: z.string().min(1).optional(),
		mode: ScheduleModeSchema,
		original_id: z.string().min(1).optional(),
		email: SendEmailRequestSchema,
	})
	.refine((b) => b.mode === "new" || !!b.original_id, {
		message: "original_id is required for reply, reply-all and forward",
	});

export interface ScheduledPayload {
	mode: ScheduleMode;
	original_id?: string;
	email: SendEmailRequest;
}

export interface ScheduledRow {
	emailId: string;
	sendAt: string;
	attempts: number;
	error: string | null;
}

/** Null when sendAt is acceptable, else the error to show. */
export function checkSendAt(sendAt: string, now = Date.now()): string | null {
	const at = Date.parse(sendAt);
	if (Number.isNaN(at)) return "sendAt must be an ISO date and time";
	if (at < now + SCHEDULE_MIN_LEAD_MS) return "sendAt must be at least 30 seconds from now";
	if (at >= now + SCHEDULE_MAX_LEAD_MS) return "sendAt must be less than 366 days from now";
	return null;
}

export function sendModeOf(payload: ScheduledPayload): SendMode {
	if (!payload.original_id || payload.mode === "new") return { kind: "new" };
	if (payload.mode === "forward") return { kind: "forward", originalId: payload.original_id };
	return { kind: "reply", originalId: payload.original_id };
}
