// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

/**
 * List-Unsubscribe (RFC 2369) and one-click unsubscribe (RFC 8058), read from
 * a message's stored headers. The reader uses it to show Unsubscribe; the
 * Worker uses it again on the stored message, so the browser never names
 * the URL the Worker posts to.
 */

export interface MailtoTarget {
	to: string;
	subject: string;
	body: string;
}

export interface UnsubscribeTargets {
	/** The first https URL, else the first http URL. */
	url: string | null;
	mailto: MailtoTarget | null;
	/** List-Unsubscribe-Post: List-Unsubscribe=One-Click with an https URL. */
	oneClick: boolean;
}

/**
 * How Unsubscribe works for a message: one-click is a POST from the Worker,
 * link opens the list's page in a new tab, mailto opens the composer with
 * the list's address filled in. A page comes before a mailto because it
 * sends nothing from your address.
 */
export type UnsubscribeMethod = "one-click" | "link" | "mailto";

type Header = { key?: unknown; value?: unknown };

function header(rawHeaders: string | null | undefined, key: string): string | null {
	if (!rawHeaders) return null;
	try {
		const parsed = JSON.parse(rawHeaders) as unknown;
		if (!Array.isArray(parsed)) return null;
		const found = (parsed as Header[]).find((h) => typeof h?.key === "string" && h.key.toLowerCase() === key);
		return typeof found?.value === "string" ? found.value : null;
	} catch {
		return null;
	}
}

const ADDRESS = /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/;

function mailtoTarget(uri: string): MailtoTarget | null {
	let url: URL;
	try {
		url = new URL(uri);
	} catch {
		return null;
	}
	if (url.protocol !== "mailto:") return null;
	let to: string;
	try {
		to = decodeURIComponent(url.pathname).split(",")[0].trim().toLowerCase();
	} catch {
		return null;
	}
	if (!ADDRESS.test(to)) return null;
	const param = (name: string) => [...url.searchParams].find(([k]) => k.toLowerCase() === name)?.[1] ?? "";
	return { to, subject: param("subject").slice(0, 200), body: param("body").slice(0, 2000) };
}

/** What a message's List-Unsubscribe offers, or null when it has none the app can use. */
export function unsubscribeTargets(rawHeaders: string | null | undefined): UnsubscribeTargets | null {
	const value = header(rawHeaders, "list-unsubscribe");
	if (!value) return null;
	const uris = [...value.matchAll(/<([^>]+)>/g)].map((m) => m[1].trim()).filter(Boolean);
	const web = (protocol: string) => uris.find((u) => {
		try {
			return new URL(u).protocol === protocol;
		} catch {
			return false;
		}
	}) ?? null;
	const url = web("https:") ?? web("http:");
	const mailto = uris.map(mailtoTarget).find((t) => t !== null) ?? null;
	if (!url && !mailto) return null;
	const post = header(rawHeaders, "list-unsubscribe-post");
	const oneClick = !!url && url.startsWith("https:") && !!post && /^\s*list-unsubscribe\s*=\s*one-click\s*$/i.test(post);
	return { url, mailto, oneClick };
}

export function unsubscribeMethod(targets: UnsubscribeTargets | null): UnsubscribeMethod | null {
	if (!targets) return null;
	if (targets.oneClick) return "one-click";
	if (targets.url) return "link";
	return targets.mailto ? "mailto" : null;
}

function privateIPv4(host: string): boolean {
	const parts = host.split(".").map(Number);
	if (parts.length !== 4 || parts.some((p) => !Number.isInteger(p) || p < 0 || p > 255)) return true;
	const [a, b, c] = parts;
	return a === 0 || a === 10 || a === 127 || a >= 224
		|| (a === 100 && b >= 64 && b <= 127)
		|| (a === 169 && b === 254)
		|| (a === 172 && b >= 16 && b <= 31)
		|| (a === 192 && b === 168)
		|| (a === 192 && b === 0 && (c === 0 || c === 2))
		|| (a === 198 && (b === 18 || b === 19))
		|| (a === 198 && b === 51 && c === 100)
		|| (a === 203 && b === 0 && c === 113);
}

const PRIVATE_SUFFIXES = [".localhost", ".local", ".internal", ".lan", ".arpa"];

/**
 * True for an https URL on a public host name or public IPv4 address, on the
 * default port, without credentials. IPv6 literals are refused: a list has no
 * reason to use one, and telling public from private ones is not worth the
 * code. The Worker also runs with global_fetch_strictly_public.
 */
export function isPublicHttpsUrl(raw: string): boolean {
	let url: URL;
	try {
		url = new URL(raw);
	} catch {
		return false;
	}
	if (url.protocol !== "https:" || url.username || url.password) return false;
	if (url.port && url.port !== "443") return false;
	const host = url.hostname.toLowerCase().replace(/\.$/, "");
	if (!host || host.startsWith("[") || host.includes(":")) return false;
	if (/^[\d.]+$/.test(host)) return !privateIPv4(host);
	if (!host.includes(".") || host === "localhost") return false;
	return !PRIVATE_SUFFIXES.some((s) => host.endsWith(s));
}
