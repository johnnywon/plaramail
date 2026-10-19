// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

/** A tool call in an agent turn, as far as drafts go. */
export interface ToolCall {
	name: string;
	input?: { mailboxId?: string; draftId?: string };
	output?: unknown;
}

/** The drafts a turn made that are still drafts: a later send_draft in the turn that sent one removes it. */
export function openableDrafts(calls: ToolCall[]): { mailboxId: string; draftId: string }[] {
	const sent = new Set(
		calls
			.filter((c) => c.name === "send_draft" && (c.output as { sentId?: string } | undefined)?.sentId && c.input?.draftId)
			.map((c) => c.input!.draftId!),
	);
	return calls.flatMap((c) => {
		const draftId = (c.output as { draftId?: string } | undefined)?.draftId;
		const mailboxId = c.input?.mailboxId;
		if ((c.name !== "draft_reply" && c.name !== "draft_email") || !draftId || !mailboxId || sent.has(draftId)) return [];
		return [{ mailboxId: mailboxId.toLowerCase(), draftId }];
	});
}
