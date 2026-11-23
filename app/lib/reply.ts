// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

/**
 * Reply helpers that need no DOM, so tests can run them in Node.
 */

interface HeaderLike {
	key?: unknown;
	name?: unknown;
	originalKey?: unknown;
	value?: unknown;
}

const ADDRESS = /^[^@\s]+@[^@\s]+\.[^@\s.]+$/;

/**
 * Addresses in an address-list header value such as
 * `"Doe, Jo" <jo@example.com>, other@example.org`.
 */
export function parseAddressList(value: string): string[] {
	const withoutQuotedNames = value.replace(/"(?:[^"\\]|\\.)*"/g, " ");
	const addresses: string[] = [];
	const seen = new Set<string>();
	for (const match of withoutQuotedNames.matchAll(
		/<([^<>\s,;]+@[^<>\s,;]+)>|([^\s<>,;"'()]+@[^\s<>,;"'()]+)/g,
	)) {
		const address = (match[1] ?? match[2]).replace(/[.,;:]+$/, "");
		const key = address.toLowerCase();
		if (!ADDRESS.test(address) || seen.has(key)) continue;
		seen.add(key);
		addresses.push(address);
	}
	return addresses;
}

/**
 * Reply-To addresses from a stored `raw_headers` string: a JSON array of
 * `{ key, value }` headers, or an object of header names to values.
 */
export function getReplyToAddresses(rawHeaders?: string | null): string[] {
	if (!rawHeaders) return [];
	let parsed: unknown;
	try {
		parsed = JSON.parse(rawHeaders);
	} catch {
		return [];
	}
	let headers: HeaderLike[] = [];
	if (Array.isArray(parsed)) headers = parsed as HeaderLike[];
	else if (parsed && typeof parsed === "object") {
		headers = Object.entries(parsed).map(([key, value]) => ({ key, value }));
	}
	const addresses: string[] = [];
	const seen = new Set<string>();
	for (const header of headers) {
		const name = String(header?.key ?? header?.name ?? header?.originalKey ?? "").toLowerCase();
		if (name !== "reply-to") continue;
		for (const address of parseAddressList(String(header.value ?? ""))) {
			const key = address.toLowerCase();
			if (seen.has(key)) continue;
			seen.add(key);
			addresses.push(address);
		}
	}
	return addresses;
}

/** Where a reply goes: the message's Reply-To addresses, or its sender when it has none. */
export function getReplyAddresses(original: {
	sender: string;
	raw_headers?: string | null;
}): string[] {
	const replyTo = getReplyToAddresses(original.raw_headers);
	return replyTo.length > 0 ? replyTo : [original.sender];
}

const NAMED_ENTITIES: Record<string, string> = {
	amp: "&",
	lt: "<",
	gt: ">",
	quot: '"',
	apos: "'",
	nbsp: " ",
};

/** Decodes each entity once, so `&amp;lt;` becomes `&lt;` and not `<`. */
function decodeEntities(text: string): string {
	return text.replace(
		/&(?:#(\d+)|#x([0-9a-f]+)|(amp|lt|gt|quot|apos|nbsp));/gi,
		(match, decimal?: string, hex?: string, name?: string) => {
			if (name) return NAMED_ENTITIES[name.toLowerCase()];
			const code = decimal !== undefined ? Number(decimal) : Number.parseInt(hex ?? "", 16);
			const valid = Number.isInteger(code) && code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff);
			return valid ? String.fromCodePoint(code) : match;
		},
	);
}

/**
 * Text of the element marked `data-reply-quote`. A notification email uses it to
 * say which part a reply should quote (the visitor's message, not the wrapper).
 * The element holds text and `<br>` only. Returns null when nothing is marked.
 */
export function extractReplyQuote(html?: string | null): string | null {
	if (!html) return null;
	const match = html.match(
		/<([a-z][a-z0-9]*)\b[^>]*\sdata-reply-quote\b[^>]*>([\s\S]*?)<\/\1\s*>/i,
	);
	if (!match) return null;
	const text = decodeEntities(
		match[2].replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, ""),
	)
		.replace(/\r\n?/g, "\n")
		.trim();
	return text || null;
}
