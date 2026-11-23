// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

/**
 * Hono middleware: checks the mailbox exists, then attaches its
 * store to the Hono context (`c.var.mailbox`).
 */
import { createMiddleware } from "hono/factory";
import { mailStore, type MailboxStore } from "../store";
import type { Env } from "../types";

export type MailboxContext = {
	Bindings: Env;
	Variables: {
		mailbox: MailboxStore;
		/** Who is signed in through Access, set in workers/app.ts. "local" on the dev server. */
		viewer: string;
	};
};

export const requireMailbox = createMiddleware<MailboxContext>(async (c, next) => {
	const rawId = c.req.param("mailboxId");
	if (!rawId) return c.json({ error: "Mailbox ID required" }, 400);
	const mailboxId = decodeURIComponent(rawId);

	const store = mailStore(c.env);
	if (!(await store.mailboxes.exists(mailboxId))) return c.json({ error: "Not found" }, 404);

	c.set("mailbox", store.mailbox(mailboxId));
	
	await next();
});
