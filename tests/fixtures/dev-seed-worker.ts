// Test-only worker: runs the dev sample inbox against D1 and R2, for Miniflare tests.
import { ensureDevMail, resetDemo, seedMail } from "../../workers/lib/dev-seed";
import { mailStore } from "../../workers/store";
import type { Env } from "../../workers/types";

export default {
	async fetch(request: Request, env: Env) {
		const { op, args = {} } = (await request.json()) as { op: string; args?: Record<string, unknown> };
		try {
			if (op === "exec") return Response.json({ ok: (await env.DB.prepare(String(args.sql)).run()).success });
			if (op === "rows") return Response.json({ ok: (await env.DB.prepare(String(args.sql)).bind(...((args.params as unknown[]) ?? [])).all()).results });
			if (op === "seed") return Response.json({ ok: await seedMail(env, args as Parameters<typeof seedMail>[1]) });
			if (op === "reset") return Response.json({ ok: await resetDemo(env, (args as { now?: number }).now) });
			if (op === "ensure") return Response.json({ ok: (await ensureDevMail(env), true) });
			if (op === "store") {
				const { mailbox, method, params } = args as { mailbox: string; method: string; params: unknown[] };
				const target = (mailbox === "all" ? mailStore(env).all() : mailStore(env).mailbox(mailbox)) as unknown as Record<string, (...a: unknown[]) => Promise<unknown>>;
				return Response.json({ ok: (await target[method](...params)) ?? null });
			}
			if (op === "r2") {
				const keys: string[] = [];
				let cursor: string | undefined;
				do {
					const page = await env.BUCKET.list({ prefix: String(args.prefix ?? ""), cursor });
					for (const o of page.objects) keys.push(`${o.key}\t${o.size}`);
					cursor = page.truncated ? page.cursor : undefined;
				} while (cursor);
				return Response.json({ ok: keys });
			}
			return Response.json({ error: `unknown op ${op}` });
		} catch (e) {
			return Response.json({ error: (e as Error).message });
		}
	},
};
