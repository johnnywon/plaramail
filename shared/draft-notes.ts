// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

/** How an agent draft was made, kept with the draft (draft_notes table). */
export interface DraftNotes {
	origin: DraftOrigin;
	/** The agent whose job the draft was for, by name. Null for the PlaraMail Agent, chat and MCP. */
	agent: string | null;
	/** One-off redraft instructions, oldest first. */
	instructions: string[];
}

export type DraftOrigin = "auto-draft" | "chat" | "mcp";

export const DRAFT_ORIGIN_LABELS: Record<DraftOrigin, string> = {
	"auto-draft": "Auto-draft",
	chat: "Agent",
	mcp: "MCP client",
};

/** Instructions longer than this are refused. */
export const REDRAFT_INSTRUCTION_MAX = 500;
