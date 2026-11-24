// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

/** Send mode's dependencies on a real deployment (workers/lib/agent-send.ts). */
import { mailStore, recordsSql } from "../store";
import type { Env } from "../types";
import type { AgentSendDeps } from "./agent-send";
import { toolSendDraft } from "./tools";

export { sendAsAgent } from "./agent-send";

export function agentSendDeps(env: Env): AgentSendDeps {
	return {
		sql: recordsSql(env),
		getDraft: async (mailboxId, draftId) => {
			const draft = await mailStore(env).mailbox(mailboxId).getEmail(draftId);
			return draft ? (draft as { recipient: string | null; cc?: string | null; bcc?: string | null; subject?: string | null }) : null;
		},
		sendDraft: (mailboxId, draftId) => toolSendDraft(env, mailboxId, draftId, "agent"),
	};
}
