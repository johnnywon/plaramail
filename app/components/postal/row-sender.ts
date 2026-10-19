// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

export interface RowSender {
	/** Sent mail: the text names who it went to. */
	to?: true;
	text: string;
	/** Recipients after the first. */
	more?: number;
}

/** "Bob <bob@example.org>, cy@example.net" as names or addresses, in order. */
function recipientNames(list: string): string[] {
	return list
		.split(/,(?=(?:[^"]*"[^"]*")*[^"]*$)/)
		.map((part) => {
			const m = part.trim().match(/^"?([^"<]*?)"?\s*<([^>]+)>$/);
			return m ? m[1].trim() || m[2].trim() : part.trim();
		})
		.filter(Boolean);
}

/** The name line of a list row: the sender, or for sent mail the first recipient. */
export function rowSender(row: { state: string; sender_name: string; sender_addr: string; recipient?: string }): RowSender {
	if (row.state === "draft") return { text: "Draft" };
	if (row.state !== "sent") return { text: row.sender_name || row.sender_addr };
	const [first, ...rest] = recipientNames(row.recipient ?? "");
	return { to: true, text: first ?? "(no recipient)", ...(rest.length ? { more: rest.length } : {}) };
}
