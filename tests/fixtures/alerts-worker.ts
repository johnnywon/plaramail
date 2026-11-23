// Test-only worker: the health check and the hourly alert mail on D1 and R2, with a fake email binding.
import { recordError, sendAlerts } from "../../workers/lib/alerts";
import { checkHealth, healthResponse } from "../../workers/lib/health";
import type { Env } from "../../workers/types";

const sent: unknown[] = [];
const EMAIL = { async send(message: unknown) { sent.push(message); } };
const BROKEN_BUCKET = { async head() { throw new Error("R2 unreachable"); } };

export default {
	async fetch(request: Request, base: Env & { DB: D1Database }) {
		const { op, args = [], vars = {} } = (await request.json()) as { op: string; args?: unknown[]; vars?: Record<string, unknown> };
		const env = { ...base, EMAIL, ...vars, ...(vars.brokenBucket ? { BUCKET: BROKEN_BUCKET } : {}) } as unknown as Env;
		try {
			switch (op) {
				case "_sql":
					return Response.json({ ok: (await base.DB.prepare(String(args[0])).run()).success });
				case "rows":
					return Response.json({ ok: (await base.DB.prepare(String(args[0])).all()).results });
				case "health": {
					const res = healthResponse(await checkHealth(env));
					return Response.json({ ok: { status: res.status, body: await res.json() } });
				}
				case "record":
					await recordError(env, String(args[0]), String(args[1]), Number(args[2] ?? Date.now()));
					return Response.json({ ok: true });
				case "alert":
					return Response.json({ ok: await sendAlerts(env, Number(args[0])) });
				case "sent":
					return Response.json({ ok: sent.splice(0) });
				default:
					return Response.json({ error: `unknown op ${op}` });
			}
		} catch (e) {
			return Response.json({ error: (e as Error).message });
		}
	},
};
