// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

/**
 * How a saved draft reopens (WON-1198). A forward draft comes back from the
 * Worker with `forward`, the original's attachments it carries, so it opens
 * and sends as a forward with them. Any other draft with an original is a reply.
 */

interface DraftAttachment {
	id: string;
	filename: string;
	mimetype: string;
	size: number;
}

export interface SavedDraft {
	in_reply_to?: string | null;
	forward?: { attachments: DraftAttachment[] };
}

export type DraftMode = "new" | "reply" | "forward";

export interface DraftFile {
	name: string;
	size: number;
	type: string;
	content: string;
	attachmentId: string;
}

export function draftMode(draft: SavedDraft): DraftMode {
	if (!draft.in_reply_to) return "new";
	return draft.forward ? "forward" : "reply";
}

/** The forwarded original's files, as the composer lists them. Empty for any other draft. */
export function draftFiles(draft: SavedDraft): DraftFile[] {
	if (draftMode(draft) !== "forward") return [];
	return (draft.forward?.attachments ?? []).map((a) => ({ name: a.filename, size: a.size, type: a.mimetype, content: "", attachmentId: a.id }));
}

/** What a save sends so a forward stays a forward: its mode and the original's files it keeps. */
export function draftSaveFields(state: { mode: string; originalId?: string; files: { attachmentId?: string }[] }): {
	mode?: "forward";
	forward_attachments?: string[];
} {
	if (state.mode !== "forward" || !state.originalId) return {};
	return { mode: "forward", forward_attachments: state.files.flatMap((f) => (f.attachmentId ? [f.attachmentId] : [])) };
}
