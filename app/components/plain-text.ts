// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

// Text-only mail as reading HTML: paragraphs instead of raw line breaks, links,
// the signature set apart and quoted replies folded.

/** Whether a body is HTML. An address in angle brackets ("<jane@example.com>") is not a tag. */
export function isHtmlBody(body: string): boolean {
	return /<!doctype html|<(?:html|head|body|div|p|br|span|a|b|i|u|strong|em|font|center|table|tr|td|ul|ol|li|h[1-6]|img|blockquote|pre|hr|meta|style)\b[^>]*>|<\/[a-z][a-z0-9]*\s*>/i.test(body);
}

function escape(text: string): string {
	return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

const LINK = /\b(?:https?:\/\/|www\.)[^\s<>"]+|\b[\w.+-]+@[\w-]+(?:\.[\w-]+)+/gi;

/** Escapes text and turns bare URLs and addresses into links. Trailing punctuation stays outside. */
export function linkify(text: string): string {
	let out = "";
	let last = 0;
	for (const m of text.matchAll(LINK)) {
		let url = m[0];
		const trail = url.match(/[.,;:!?)\]'"]+$/)?.[0] ?? "";
		// Keep a closing paren that has its opener inside the URL.
		const keep = trail.startsWith(")") && url.slice(0, -trail.length).includes("(") ? 1 : 0;
		url = url.slice(0, url.length - trail.length + keep);
		const start = m.index;
		const href = url.includes("@") && !/^(?:https?:|www\.)/i.test(url) ? `mailto:${url}` : /^www\./i.test(url) ? `https://${url}` : url;
		out += escape(text.slice(last, start)) + `<a href="${escape(href)}">${escape(url)}</a>`;
		last = start + url.length;
	}
	return out + escape(text.slice(last));
}

/** Lines into paragraphs: blank lines split them, any run of blank lines counts as one. */
function paragraphs(lines: string[]): string {
	const out: string[] = [];
	let para: string[] = [];
	const flush = () => {
		if (para.length) out.push(`<p>${para.map(linkify).join("<br>")}</p>`);
		para = [];
	};
	for (const line of lines) {
		if (line.trim() === "") flush();
		else para.push(line);
	}
	flush();
	return out.join("");
}

const ATTRIBUTION = /^(?:On\b.*\bwrote:|.*\b(?:wrote|schrieb|a écrit|escribió):|-{2,}\s*(?:Original Message|Forwarded message)\s*-{2,})$/i;

/** Body lines with quoted text grouped: `>` runs, and everything after an attribution line. */
function body(lines: string[]): string {
	let html = "";
	let run: string[] = [];
	const flush = () => {
		html += paragraphs(run);
		run = [];
	};
	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];
		const next = lines.slice(i + 1).find((l) => l.trim() !== "");
		const attribution = ATTRIBUTION.test(line.trim()) && (next === undefined || next.startsWith(">") || /original|forwarded/i.test(line));
		if (attribution || line.startsWith(">")) {
			flush();
			const quoted: string[] = [];
			let j = attribution ? i + 1 : i;
			if (attribution && /original|forwarded/i.test(line)) {
				// A forwarded or "Original Message" block runs to the end.
				quoted.push(...lines.slice(j));
				j = lines.length;
			} else {
				for (; j < lines.length && (lines[j].startsWith(">") || lines[j].trim() === ""); j++) {
					quoted.push(lines[j].replace(/^> ?/, ""));
				}
			}
			while (quoted.length && quoted[quoted.length - 1].trim() === "") quoted.pop();
			const head = attribution ? `<div class="pm-attr">${linkify(line.trim())}</div>` : "";
			html += `<details class="pm-quote"><summary aria-label="Show quoted text">···</summary>${head}<blockquote>${body(quoted)}</blockquote></details>`;
			i = j - 1;
		} else {
			run.push(line);
		}
	}
	flush();
	return html;
}

/** Text-only mail as HTML for the plain reader. */
export function plainTextToHtml(text: string): string {
	const lines = text.replace(/\r\n?/g, "\n").split("\n").map((l) => l.replace(/\s+$/, ""));
	// The signature starts at the first "-- " line (its space trimmed above) and runs to any quoted reply below it.
	const sig = lines.indexOf("--");
	if (sig === -1) return `<div class="pm-plain">${body(lines)}</div>`;
	let end = lines.findIndex((l, i) => i > sig && (l.startsWith(">") || ATTRIBUTION.test(l.trim())));
	if (end === -1) end = lines.length;
	const signature = lines.slice(sig + 1, end);
	const sigHtml = signature.some((l) => l.trim() !== "") ? `<div class="pm-sig">${paragraphs(signature)}</div>` : "";
	return `<div class="pm-plain">${body(lines.slice(0, sig))}${sigHtml}${body(lines.slice(end))}</div>`;
}
