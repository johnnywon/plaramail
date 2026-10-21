// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

// A demo build (PLARAMAIL_DEMO=1 npm run build) comes up filled with the sample
// inbox and lets anyone read, file and label it. It never sends mail, keeps
// settings read-only and needs no sign-in. The cron writes the sample inbox
// again every hour.
//
// Two AI actions stay on: turning plain words into a search, and redrafting
// an agent draft, on Workers AI models the Free plan allows. Together they
// stop for the day after DEMO_AI_DAILY actions (default 200; 0 turns them
// off). A redraft is one action but three model calls: the injection check,
// the rewrite and the draft check.
// The agent chat, auto-draft, MCP and the model test stay off.
//
// vite.config.ts defines __PLARAMAIL_DEMO__ as a literal, so in a normal build DEMO
// is false and every branch on it, with the sample inbox, is left out.

import type { Sql } from "../store/sql";

declare const __PLARAMAIL_DEMO__: boolean | undefined;

export const DEMO: boolean = typeof __PLARAMAIL_DEMO__ === "boolean" && __PLARAMAIL_DEMO__;

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/** Writes a demo visitor may make: filing, labels, saved searches, drafts. Everything else is refused. */
const ALLOWED: [method: string, path: RegExp][] = [
	["POST", /^\/api\/v1\/mail\/bulk(\/undo)?$/],
	["POST", /^\/api\/v1\/mail\/empty-trash$/],
	["POST", /^\/api\/v1\/saved-searches$/],
	["PUT", /^\/api\/v1\/saved-searches\/[^/]+$/],
	["DELETE", /^\/api\/v1\/saved-searches\/[^/]+$/],
	["POST", /^\/api\/v1\/labels(\/import-folders)?$/],
	["PUT", /^\/api\/v1\/labels\/[^/]+$/],
	["DELETE", /^\/api\/v1\/labels\/[^/]+$/],
	["POST", /^\/api\/v1\/mailboxes\/[^/]+\/drafts$/],
	["DELETE", /^\/api\/v1\/mailboxes\/[^/]+\/emails\/[^/]+$/],
	["DELETE", /^\/api\/v1\/mailboxes\/[^/]+\/scheduled\/[^/]+$/],
	["POST", /^\/api\/v1\/mailboxes\/[^/]+\/threads\/[^/]+\/read$/],
];

const SENDS = /^\/api\/v1\/mailboxes\/[^/]+\/(emails|scheduled|emails\/[^/]+\/(reply|forward))$/;
/** The sample mail's lists don't exist, so a demo never posts to them. */
const UNSUBSCRIBE = /^\/api\/v1\/mailboxes\/[^/]+\/emails\/[^/]+\/unsubscribe$/;
const AI = /^\/api\/v1\/(search\/interpret|agent-model\/test|mailboxes\/[^/]+\/drafts\/[^/]+\/redraft)$/;
/** The AI calls a demo visitor may make, within the daily cap. */
const AI_ALLOWED = /^\/api\/v1\/(search\/interpret|mailboxes\/[^/]+\/drafts\/[^/]+\/redraft)$/;

/** The model a demo writes with, whatever the settings say. It runs on the Workers Free plan; GLM 5.3 Flash does not. */
export const DEMO_AI_MODEL = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";
export const DEMO_AI_DAILY = 200;

/** Why a demo refuses this API request, or null when it may go ahead. */
export function demoRefusal(method: string, path: string): string | null {
	if (SAFE_METHODS.has(method)) return null;
	if (ALLOWED.some(([m, re]) => m === method && re.test(path))) return null;
	if (method === "POST" && AI_ALLOWED.test(path)) return null;
	if (SENDS.test(path)) return "Sending is off in the demo";
	if (UNSUBSCRIBE.test(path)) return "Unsubscribe is off in the demo";
	if (AI.test(path)) return "AI is off in the demo";
	return "Settings are read-only in the demo";
}

/** Paths outside the API that a demo refuses: the MCP server, its OAuth endpoints and the agent socket. */
export function demoBlocksPath(path: string): boolean {
	return path === "/mcp" || path.startsWith("/mcp/") || path.startsWith("/agents/") || path === "/authorize" || path.startsWith("/.well-known/oauth-");
}

/** A model call the demo allows, counted against its daily cap. */
export function demoAiCall(method: string, path: string): boolean {
	return method === "POST" && AI_ALLOWED.test(path);
}

/** The daily cap from DEMO_AI_DAILY: a whole number, 0 for none. */
export function demoAiCap(setting: string | undefined): number {
	const n = Number(setting ?? "");
	return setting !== undefined && setting.trim() !== "" && Number.isInteger(n) && n >= 0 ? n : DEMO_AI_DAILY;
}

/**
 * Take one call from today's allowance (UTC day). A single conditional insert,
 * so two visitors can't both take the last one. False when the day's calls are used.
 */
export async function claimDemoAiCall(sql: Sql, cap: number, now = new Date()): Promise<boolean> {
	if (cap <= 0) return false;
	const day = now.toISOString().slice(0, 10);
	await sql.run("DELETE FROM ai_budget WHERE at < ?", day);
	const { changes } = await sql.run(
		"INSERT INTO ai_budget (at) SELECT ?1 WHERE (SELECT COUNT(*) FROM ai_budget WHERE at >= ?2) < ?3",
		now.toISOString(), day, cap,
	);
	return changes > 0;
}
