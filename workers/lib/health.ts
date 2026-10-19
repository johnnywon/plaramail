// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

/**
 * GET /health: one D1 query and one R2 read. The Worker answers it before the
 * Access check, so `npm run smoke` and an uptime monitor can reach it once the
 * deployment's Access bypass includes /health (docs/setup.md). The response
 * says which store failed, never why; the reason goes to the log and the alert mail.
 */
import { recordsSql } from "../store";
import type { Env } from "../types";

export interface StoreCheck {
	ok: boolean;
	ms: number;
	error?: string;
}

export interface Health {
	ok: boolean;
	d1: StoreCheck;
	r2: StoreCheck;
}

async function timed(run: () => Promise<unknown>): Promise<StoreCheck> {
	const start = Date.now();
	try {
		await run();
		return { ok: true, ms: Date.now() - start };
	} catch (e) {
		return { ok: false, ms: Date.now() - start, error: (e as Error).message || String(e) };
	}
}

export async function checkHealth(env: Pick<Env, "DB" | "BUCKET">): Promise<Health> {
	const [d1, r2] = await Promise.all([
		timed(() => recordsSql(env as Env).first("SELECT 1")),
		// A key that never exists: head answers null without reading any mail.
		timed(() => env.BUCKET.head("health-check")),
	]);
	return { ok: d1.ok && r2.ok, d1, r2 };
}

export function healthResponse(health: Health): Response {
	const state = (check: StoreCheck) => (check.ok ? "ok" : "failed");
	return Response.json(
		{ ok: health.ok, d1: state(health.d1), r2: state(health.r2) },
		{ status: health.ok ? 200 : 503, headers: { "cache-control": "no-store" } },
	);
}
