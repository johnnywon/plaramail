// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

/** Console > Limits, in R2 next to the prefs and the agent model config. No agent tool can change them. */

import { type AgentLimits, cleanAgentLimits, DEFAULT_AGENT_LIMITS } from "../../shared/send-limits";
import type { Env } from "../types";

const LIMITS_KEY = "config/agent-limits.json";

async function readSaved(env: Pick<Env, "BUCKET">): Promise<AgentLimits> {
	const obj = await env.BUCKET.get(LIMITS_KEY);
	return obj ? cleanAgentLimits(await obj.json()) : DEFAULT_AGENT_LIMITS;
}

/** The saved limits, or the defaults when nothing is saved or the file can't be read. */
export async function readAgentLimits(env: Pick<Env, "BUCKET">): Promise<AgentLimits> {
	try {
		return await readSaved(env);
	} catch {
		return DEFAULT_AGENT_LIMITS;
	}
}

/** Merge a patch over what is saved, keep only valid values, and save. Throws when the saved file can't be read, so a patch never lands on the defaults. */
export async function writeAgentLimits(env: Pick<Env, "BUCKET">, patch: unknown): Promise<AgentLimits> {
	const next = cleanAgentLimits(patch, await readSaved(env));
	await env.BUCKET.put(LIMITS_KEY, JSON.stringify(next), { httpMetadata: { contentType: "application/json" } });
	return next;
}
