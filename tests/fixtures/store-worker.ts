// Test-only worker: store calls on D1 over a JSON shim, for Miniflare tests.
import { mailStore } from "../../workers/store";
import type { Env } from "../../workers/types";

export default {
	async fetch(request: Request, env: Env) {
		const { target, op, args = [] } = (await request.json()) as { target: string; op: string; args?: unknown[] };
		try {
			if (op === "_sql") return Response.json({ ok: (await env.DB.prepare(String(args[0])).run()).success });
			if (op === "_rows") return Response.json({ ok: (await env.DB.prepare(String(args[0])).all()).results });
			const store = mailStore(env);
			if (target === "registry") {
				const registry = store.mailboxes as unknown as Record<string, (...a: unknown[]) => Promise<unknown>>;
				return Response.json({ ok: (await registry[op](...args)) ?? null });
			}
			const obj = (target === "all" ? store.all() : store.mailbox(target)) as unknown as Record<string, (...a: unknown[]) => Promise<unknown>>;
			return Response.json({ ok: (await obj[op](...args)) ?? null });
		} catch (e) {
			return Response.json({ error: (e as Error).message });
		}
	},
};
