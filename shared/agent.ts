// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

/**
 * The chat agent is one instance shared by every address. Per-address agent
 * instances (named by the address) still run auto-draft and "Draft reply".
 */
export const SHARED_AGENT = "all";

/** The release hired agents get Send in. The Console's badges and the API's refusal read it from here. */
export const SEND_VERSION = "0.10";

/** What the chat panel tells the agent about the conversation on screen. */
export type AgentContext = {
	open?: { mailboxId: string; emailId: string } | null;
};

/**
 * The address a tool call acts on: the one the call names, else the agent's
 * own. Unknown addresses are refused so a tool never opens a new mailbox.
 */
export function resolveMailbox(named: string | undefined, bound: string | null, known: string[]): { mailboxId: string } | { error: string } {
	const id = (named ?? bound ?? "").trim().toLowerCase();
	if (!id) return { error: "Say which address: pass mailboxId." };
	if (!known.includes(id)) return { error: `Unknown address ${id}. Use one of: ${known.join(", ")}.` };
	return { mailboxId: id };
}

/**
 * Whose prompt the agent runs with: its own address, else the address of the
 * mail open in the chat panel, else none (the default prompt). An open
 * address that isn't configured counts as none.
 */
export function promptAddress(bound: string | null, context: AgentContext | undefined, known: string[]): string | null {
	if (bound) return bound.toLowerCase();
	const open = context?.open?.mailboxId?.trim().toLowerCase();
	return open && known.includes(open) ? open : null;
}

/** The address's own prompt, or null when it has none and the default applies. */
export function customPrompt(settings: Record<string, unknown> | null | undefined): string | null {
	const prompt = settings?.agentSystemPrompt;
	return typeof prompt === "string" && prompt.trim() ? prompt : null;
}

/** System prompt lines that tell the shared agent which addresses exist and what is open. */
export function sharedAgentNote(addresses: string[], context: AgentContext | undefined): string {
	const lines = [
		"## Addresses",
		`You work across all of the operator's addresses: ${addresses.join(", ")}. Every mail tool takes mailboxId, the address the mail is in. search_all_mail results include it. For draft_email, mailboxId is the address to send from; ask if it is unclear.`,
	];
	const open = context?.open;
	if (open?.mailboxId && open.emailId) {
		lines.push(`The operator is reading email ${open.emailId} in ${open.mailboxId}. "This email", "this thread" or "the open conversation" means that one.`);
	}
	return lines.join("\n");
}

/**
 * A rule offered from the job's own words, for an action agent's setup:
 * "star emails from northwind" offers From contains "northwind".
 */
export function suggestRule(job: string): { field: "from"; op: "contains"; value: string } | null {
	const m = /\bfrom\s+@?([a-z0-9][\w.+-]*(?:@[\w-]+(?:\.[\w-]+)*)?)/i.exec(job);
	const value = m?.[1].replace(/[.+-]+$/, "").toLowerCase();
	return value ? { field: "from", op: "contains", value } : null;
}
