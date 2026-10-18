// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

export interface SignatureState {
	html: string;
	/** Add by default. */
	enabled: boolean;
}

/** Whether signature HTML has any text. */
export const hasText = (html: string) => !!html.replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").trim();

/** A signature after its text changes. Writing one leaves Add by default as it was (off for a new one); emptying it turns it off. */
export function withSignatureText(was: SignatureState, html: string): SignatureState {
	return { html, enabled: hasText(html) && was.enabled };
}
