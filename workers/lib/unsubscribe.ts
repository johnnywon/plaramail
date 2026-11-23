// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

/**
 * Unsubscribe from a mailing list (WON-217). One-click (RFC 8058) is a POST
 * from the Worker, never from the browser, to a public https URL. Link and
 * mailto unsubscribes happen in the browser; the Worker only records them.
 */
import { isPublicHttpsUrl, unsubscribeMethod, unsubscribeTargets, type MailtoTarget } from "../../shared/unsubscribe";

const TIMEOUT_MS = 10_000;

export type UnsubscribeResult =
	| { method: "one-click"; ok: true; status: number; host: string }
	| { method: "one-click"; ok: false; status: number | null; host: string; error: string; refused: boolean }
	| { method: "link"; ok: true; url: string }
	| { method: "mailto"; ok: true; mailto: MailtoTarget }
	| { method: null; ok: false; error: string };

/** POST `List-Unsubscribe=One-Click`. Redirects are not followed; only a 2xx answer counts. */
export async function postOneClick(url: string, fetcher: typeof fetch = fetch): Promise<{ ok: boolean; status: number | null; error?: string; refused?: boolean }> {
	if (!isPublicHttpsUrl(url)) return { ok: false, status: null, error: "The unsubscribe address isn't a public https URL", refused: true };
	try {
		const response = await fetcher(url, {
			method: "POST",
			headers: { "Content-Type": "application/x-www-form-urlencoded" },
			body: "List-Unsubscribe=One-Click",
			redirect: "manual",
			signal: AbortSignal.timeout(TIMEOUT_MS),
		});
		await response.body?.cancel().catch(() => {});
		if (response.status >= 200 && response.status < 300) return { ok: true, status: response.status };
		return { ok: false, status: response.status, error: `The list answered ${response.status}` };
	} catch (e) {
		const timedOut = (e as Error).name === "TimeoutError";
		return { ok: false, status: null, error: timedOut ? "The list didn't answer" : "Could not reach the list" };
	}
}

/** Unsubscribe from the list that sent a stored message, by what its headers offer. */
export async function unsubscribe(rawHeaders: string | null | undefined, fetcher: typeof fetch = fetch): Promise<UnsubscribeResult> {
	const targets = unsubscribeTargets(rawHeaders);
	const method = unsubscribeMethod(targets);
	if (!targets || !method) return { method: null, ok: false, error: "This message has no unsubscribe link" };
	if (method === "link") return { method, ok: true, url: targets.url! };
	if (method === "mailto") return { method, ok: true, mailto: targets.mailto! };
	const url = targets.url!;
	const host = new URL(url).hostname;
	const sent = await postOneClick(url, fetcher);
	return sent.ok
		? { method, ok: true, status: sent.status!, host }
		: { method, ok: false, status: sent.status, host, error: sent.error!, refused: !!sent.refused };
}

/** The Activity log line for an unsubscribe. */
export function unsubscribeSummary(from: string, result: UnsubscribeResult): string {
	switch (result.method) {
		case "one-click": return result.ok ? `${from} · one-click to ${result.host} · ${result.status}` : `${from} · one-click to ${result.host} · ${result.error}`;
		case "link": return `${from} · opened ${new URL(result.url).hostname}`;
		case "mailto": return `${from} · opened a mail to ${result.mailto.to}`;
		default: return `${from} · ${result.error}`;
	}
}
