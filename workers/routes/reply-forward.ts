// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import type { Context } from "hono";
import { SendEmailRequestSchema } from "../lib/schemas";
import { sendMail, type SendMode } from "../lib/send";
import { checkSendKey } from "../lib/send-keys";
import type { MailboxContext } from "../lib/mailbox";

type AppContext = Context<MailboxContext>;

async function handleSend(c: AppContext, kind: SendMode["kind"]) {
	const mailboxId = c.req.param("mailboxId") ?? "";
	const id = c.req.param("id") ?? "";
	const parsed = SendEmailRequestSchema.safeParse(await c.req.json().catch(() => null));
	if (!parsed.success) return c.json({ error: parsed.error.issues[0]?.message ?? "Invalid request body" }, 400);
	const body = parsed.data;
	const mode: SendMode = kind === "new" ? { kind } : { kind, originalId: id };
	const idempotencyKey = c.req.header("idempotency-key") || undefined;
	const keyError = idempotencyKey ? checkSendKey(idempotencyKey) : null;
	if (keyError) return c.json({ error: keyError }, 400);
	const result = await sendMail(c.env, mailboxId, c.var.mailbox, body, mode, {
		defer: (delivery) => c.executionCtx.waitUntil(delivery),
		idempotencyKey,
	});
	if (!result.ok) return c.json({ error: result.error, ...(result.attempt ? { attempt: result.attempt } : {}) }, result.status);
	return c.json({ id: result.id, status: "sent" }, 202);
}

export const handleSendEmail = (c: AppContext) => handleSend(c, "new");
export const handleReplyEmail = (c: AppContext) => handleSend(c, "reply");
export const handleForwardEmail = (c: AppContext) => handleSend(c, "forward");
