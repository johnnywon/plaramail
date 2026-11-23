// Test-only worker: the cron's scheduled send on D1, with a fake email binding.
import { runCron } from "../../workers/cron";
import { ensureDevMail, RESET_MARKER } from "../../workers/lib/dev-seed";
import { mailStore } from "../../workers/store";
import type { Env } from "../../workers/types";

const sent: unknown[] = [];
// "rejected": the mail service refuses the message. "unknown": it takes the message, then the call throws with no code.
let failing: false | "rejected" | "unknown" = false;
const EMAIL = {
	async send(message: unknown) {
		await new Promise((r) => setTimeout(r, 5)); // let overlapping runs interleave
		if (failing === "rejected") throw Object.assign(new Error("binding down"), { code: "E_RATE_LIMIT_EXCEEDED" });
		sent.push(message);
		if (failing === "unknown") throw new Error("binding timed out");
	},
};

export default {
	async fetch(request: Request, base: Env & { DB: D1Database }) {
		const { op, args = [] } = (await request.json()) as { op: string; args?: unknown[] };
		const env = { ...base, EMAIL } as unknown as Env;
		try {
			switch (op) {
				case "_sql":
					return Response.json({ ok: (await base.DB.prepare(String(args[0])).run()).success });
				case "rows":
					return Response.json({ ok: (await base.DB.prepare(String(args[0])).all()).results });
				case "fail":
					failing = args[0] === true ? "rejected" : args[0] === "unknown" ? "unknown" : false;
					return Response.json({ ok: true });
				case "sent":
					return Response.json({ ok: sent.splice(0) });
				case "cron":
					return Response.json({ ok: await Promise.all(args.map((now) => runCron(env, Number(now)))) });
				case "ensure":
					await ensureDevMail(env);
					return Response.json({ ok: true });
				case "marker":
					if (args[0]) await env.BUCKET.put(RESET_MARKER, String(args[0]));
					else await env.BUCKET.delete(RESET_MARKER);
					return Response.json({ ok: true });
				case "r2":
					// ["list", prefix] or ["delete", key]
					if (args[0] === "delete") {
						await env.BUCKET.delete(String(args[1]));
						return Response.json({ ok: true });
					}
					return Response.json({ ok: (await env.BUCKET.list({ prefix: String(args[1] ?? "") })).objects.map((o) => o.key) });
				case "register":
					await mailStore(env).mailboxes.put(String(args[0]), {});
					return Response.json({ ok: true });
				default: {
					const mailbox = mailStore(env).mailbox(String(args[0])) as unknown as Record<string, (...a: unknown[]) => Promise<unknown>>;
					return Response.json({ ok: (await mailbox[op](...args.slice(1))) ?? null });
				}
			}
		} catch (e) {
			return Response.json({ error: (e as Error).message });
		}
	},
};
