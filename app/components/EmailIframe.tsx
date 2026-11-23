// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import DOMPurify from "dompurify";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { layoutMoving, onLayoutSettled } from "~/lib/layout-motion";

interface EmailIframeProps {
	body: string;
	/** When true, iframe auto-sizes to content height instead of filling parent */
	autoSize?: boolean;
	/** False blocks images from remote servers (they can track opens). Defaults to true. */
	remoteImages?: boolean;
	/** Body padding inside the frame, in px. Defaults to 0 when auto-sizing, else 24. */
	padding?: number;
	/** Render on the page's own surface with these colors instead of a white page. For plain mail. */
	palette?: EmailPalette;
}

export interface EmailPalette {
	scheme: "dark" | "light";
	text: string;
	muted: string;
	link: string;
	quote: string;
	line: string;
}

/**
 * Mail that is just text and simple formatting: no tables, images, colors
 * or backgrounds of its own. It can take the reader's colors; designed
 * HTML mail keeps its white page.
 */
export function isPlainHtml(html: string): boolean {
	return !/<(table|img|center|font|svg|video|iframe)\b|\bbgcolor\s*=|\bbackground(-color|-image)?\s*:|\bcolor\s*:|\bbackground\s*=/i.test(html);
}

/** Whether HTML loads anything from a remote server: images, backgrounds or CSS urls. */
export function hasRemoteImages(html: string): boolean {
	return /<img\b[^>]*\ssrc\s*=\s*["']?\s*(?:https?:)?\/\/|\bbackground\s*=\s*["']?\s*(?:https?:)?\/\/|url\(\s*["']?\s*(?:https?:)?\/\//i.test(html);
}

/**
 * Renders email HTML inside a sandboxed iframe.
 *
 * Security model:
 * - DOMPurify sanitises the HTML before injection.
 * - The iframe sandbox does NOT include `allow-same-origin`, so even if
 *   DOMPurify has a bypass the attacker's code runs in an opaque origin
 *   with no access to the parent page's cookies, DOM, or API.
 * - Because the iframe is cross-origin we cannot read `contentDocument`
 *   for auto-sizing. Instead, the injected HTML includes a tiny inline
 *   script that posts its body height to the parent via `postMessage`.
 *   The `allow-scripts` flag is required for this, but scripts inside
 *   the opaque-origin sandbox cannot access anything useful.
 * - A strict CSP meta tag blocks external resource loads inside the
 *   iframe as a defense-in-depth layer.
 */
/** Quoted earlier messages as mail clients mark them: Gmail, Apple Mail, Yahoo, Proton. */
const QUOTE = ".gmail_quote, .gmail_quote_container, blockquote[type='cite'], .yahoo_quoted, .protonmail_quote";

/** The "On … wrote:" line heading each folded earlier message. */
const ATTRIBUTION = ".pm-quote .pm-attr, .pm-quote .gmail_attr, .pm-quote .gmail_quote > p:first-child";

/**
 * The mail body, sanitised and ready to show: links open in a new tab, blocked remote images become
 * their alt text, quoted history folds and each "On … wrote:" line is tidied. Needs a DOM.
 */
export function prepareMailBody(body: string, { remoteImages, frame }: { remoteImages: boolean; frame: boolean }): HTMLDivElement {
	const cleanBody = document.createElement("div");
	cleanBody.appendChild(
		DOMPurify.sanitize(body, {
			USE_PROFILES: { html: true },
			FORBID_TAGS: ["style"],
			ADD_ATTR: ["target"],
			FORCE_BODY: true,
			RETURN_DOM_FRAGMENT: true,
		}),
	);

	// Never let a destination replace the message or the inbox. Normalize
	// explicit targets too; a default <base target> would not override them.
	for (const link of cleanBody.querySelectorAll("a[href], area[href]")) {
		const href = link.getAttribute("href")!.trim();
		const isFragment = frame && href.startsWith("#");
		// srcdoc inherits the inbox's base URL, so bare fragments would
		// otherwise load the inbox inside the message frame.
		if (isFragment) link.setAttribute("href", `about:srcdoc${href}`);
		link.setAttribute("target", isFragment ? "_self" : "_blank");
		link.setAttribute("rel", "noopener noreferrer");
	}

	// A blocked remote image would draw the browser's broken-image icon. Show
	// its alt text in a quiet box instead, and drop tracking pixels outright.
	if (!remoteImages) {
		for (const img of cleanBody.querySelectorAll("img")) {
			if (!/^\s*(?:https?:)?\/\//i.test(img.getAttribute("src") ?? "")) continue;
			const w = Number.parseInt(img.getAttribute("width") ?? "", 10);
			const h = Number.parseInt(img.getAttribute("height") ?? "", 10);
			const alt = (img.getAttribute("alt") ?? "").trim();
			if ((w <= 2 || h <= 2) || (!alt && !(w > 0 && h > 0))) {
				img.remove();
				continue;
			}
			const box = document.createElement("span");
			box.className = "pm-img-off";
			box.textContent = alt;
			if (w > 0) box.style.width = `${w}px`;
			if (h > 0) box.style.minHeight = `${Math.min(h, 160)}px`;
			img.replaceWith(box);
		}
	}

	// Earlier messages in a reply fold behind the same toggle as text-only mail.
	// Only the outermost quote folds; the ones inside it open with it.
	for (const quote of cleanBody.querySelectorAll<HTMLElement>(QUOTE)) {
		if (quote.parentElement?.closest(`${QUOTE}, .pm-quote`)) continue;
		const fold = document.createElement("details");
		fold.className = "pm-quote";
		const toggle = document.createElement("summary");
		toggle.setAttribute("aria-label", "Show quoted text");
		toggle.textContent = "···";
		quote.replaceWith(fold);
		fold.appendChild(toggle);
		fold.appendChild(quote);
	}

	// Each earlier message's "On <date>, <name> <address> wrote:" line becomes the name, then the date.
	for (const line of cleanBody.querySelectorAll<HTMLElement>(ATTRIBUTION)) {
		const m = line.textContent?.replace(/\s+/g, " ").match(/^\s*On (.+?\d(?: ?[AP]M)?),? (?:at )?([^,<]+?) ?<([^>]+)> wrote:\s*$/i);
		if (!m) continue;
		const name = document.createElement("b");
		name.textContent = m[2];
		name.title = m[3];
		const when = document.createElement("span");
		when.textContent = m[1];
		line.replaceChildren(name, " ", when);
	}

	return cleanBody;
}

export default function EmailIframe({ body, autoSize, remoteImages = true, padding: paddingProp, palette }: EmailIframeProps) {
	const iframeRef = useRef<HTMLIFrameElement>(null);
	const [height, setHeight] = useState(autoSize ? 100 : 0);
	const pendingHeight = useRef<number | null>(null);
	// Only the frame's own scripts run: a sanitiser bypass in the mail can't add one that carries this nonce.
	const scriptNonce = useRef("");

	// Listen for height reports from the sandboxed iframe
	const handleMessage = useCallback(
		(event: MessageEvent) => {
			if (!autoSize) return;
			// Only accept messages from our own iframe
			if (event.source !== iframeRef.current?.contentWindow) return;
			if (
				event.data &&
				typeof event.data === "object" &&
				event.data.__emailIframeHeight &&
				typeof event.data.height === "number" &&
				event.data.height > 0
			) {
				// While a side column opens or closes the text rewraps every frame. Taking each
				// height would relayout the reader twice a frame, so the last one waits for the end.
				if (layoutMoving()) pendingHeight.current = event.data.height;
				else setHeight(event.data.height);
			}
		},
		[autoSize],
	);

	useEffect(() => {
		window.addEventListener("message", handleMessage);
		const off = onLayoutSettled(() => {
			if (pendingHeight.current !== null) setHeight(pendingHeight.current);
			pendingHeight.current = null;
		});
		return () => {
			window.removeEventListener("message", handleMessage);
			off();
		};
	}, [handleMessage]);

	useEffect(() => {
		// A height held during a layout motion belongs to the frame being replaced.
		pendingHeight.current = null;
		const iframe = iframeRef.current;
		if (!iframe) return;

		const cleanBody = prepareMailBody(body, { remoteImages, frame: true });
		// One nonce per frame, so writing the same mail again leaves srcdoc unchanged.
		if (!scriptNonce.current) scriptNonce.current = crypto.randomUUID().replaceAll("-", "");
		const nonce = scriptNonce.current;

		const padding = `${paddingProp ?? (autoSize ? 0 : 24)}px`;

		// Height-reporting script: sends body.scrollHeight to the parent.
		// Runs inside the opaque-origin sandbox so it has zero access to
		// the parent page — it can only postMessage.
		const heightScript = autoSize
			? `<script nonce="${nonce}">
				function reportHeight() {
					var h = document.body.scrollHeight;
					if (h > 0) parent.postMessage({ __emailIframeHeight: true, height: h }, "*");
				}
				reportHeight();
				setTimeout(reportHeight, 50);
				setTimeout(reportHeight, 150);
				setTimeout(reportHeight, 400);
				new ResizeObserver(reportHeight).observe(document.body);
				window.addEventListener("load", reportHeight);
			<\/script>`
			: "";

		// Mail shortcuts keep working while focus is inside the message. The
		// frame passes every key up; the parent matches it against the
		// shortcuts and accepts it only from its own frames.
		const keyScript = `<script nonce="${nonce}">
			document.addEventListener("keydown", function (e) {
				if (e.isComposing) return;
				var t = e.target;
				if (t && t.closest && t.closest("input, textarea, select, [contenteditable]")) return;
				parent.postMessage({ __emailIframeKey: true, key: e.key, shiftKey: e.shiftKey, metaKey: e.metaKey, ctrlKey: e.ctrlKey, altKey: e.altKey }, "*");
			});
		<\/script>`;

		// Use srcdoc so the iframe is truly sandboxed (no same-origin access).
		// We can't use doc.write() because that requires allow-same-origin.
		const doc = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data: cid: ${remoteImages ? "https:" : ""} ${typeof window === "undefined" ? "" : window.location.origin}; script-src 'nonce-${nonce}';">
<style>
* { box-sizing: border-box; }
html {
	background: #ffffff;
	color-scheme: light;
}
body {
	font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
	font-size: 15px;
	line-height: 1.75;
	color: #1a1a1a;
	background: #ffffff;
	padding: ${padding};
	margin: 0;
	/* Keeps the first and last children's margins inside body, so scrollHeight counts them. */
	display: flow-root;
	word-wrap: break-word;
	overflow-wrap: break-word;
	${autoSize ? "overflow: hidden;" : ""}
}
[style*="position: fixed"], [style*="position:fixed"], [style*="position: absolute"], [style*="position:absolute"] {
	position: relative !important;
}
a { color: #2563eb; }
img { max-width: 100%; height: auto; }
blockquote { margin: 1em 0; padding: 0 0 0 16px; color: #5f6673; }
/* Folded history: the toggle, then each earlier message under a hairline with its "On … wrote:" line in small sans. Flat, no fills or indents. */
.pm-quote { margin: 1em 0 0; }
.pm-quote > summary {
	display: inline-block; list-style: none; cursor: pointer; padding: 0 8px; border: 1px solid #dcdcd8; border-radius: 6px;
	color: #74767c; font: 12px/18px -apple-system, BlinkMacSystemFont, sans-serif; letter-spacing: .1em; user-select: none;
}
.pm-quote > summary::-webkit-details-marker { display: none; }
.pm-quote blockquote { margin: 0; padding: 0; }
.pm-quote .pm-attr, .pm-quote .gmail_attr, .pm-quote .gmail_quote > p:first-child {
	margin: 16px 0 10px; padding-top: 12px; border-top: 1px solid #e4e4e0;
	font: 13px/1.45 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; color: #74767c;
}
.pm-quote .pm-attr b, .pm-quote .gmail_attr b, .pm-quote .gmail_quote > p:first-child b { font-weight: 600; color: #3a3c40; margin-right: 4px; }
.pm-quote > .pm-attr:first-of-type, .pm-quote > .gmail_quote > p:first-child, .pm-quote > .gmail_quote > .gmail_attr { margin-top: 12px; }
pre {
	background: #f3f4f6;
	padding: 12px;
	border-radius: 6px;
	overflow-x: auto;
	font-size: 13px;
}
table { border-collapse: collapse; max-width: 100%; }
td, th { padding: 4px 8px; }
p { margin: 4px 0; }
h1, h2, h3 { margin: 8px 0 4px; }
ul, ol { padding-left: 20px; margin: 4px 0; }
.pm-img-off {
	display: inline-flex; align-items: center; justify-content: center; max-width: 100%;
	padding: 4px 8px; border: 1px dashed #c9c9c4; color: #74767c;
	font: 12px/1.3 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; vertical-align: middle; text-align: center;
}
</style>
${palette ? `<style>
html, body { background: transparent; color-scheme: ${palette.scheme}; }
body {
	color: ${palette.text};
	font-family: "Iowan Old Style", Charter, "Bitstream Charter", "Source Serif 4", Cambria, Georgia, serif;
	font-size: 16px;
	line-height: 1.65;
	max-width: 66ch;
	-webkit-font-smoothing: antialiased;
}
a { color: ${palette.link}; text-underline-offset: 2px; }
p { margin: 0 0 1em; }
.pm-plain > :last-child, .pm-sig > :last-child, blockquote > :last-child { margin-bottom: 0; }
blockquote { color: ${palette.muted}; }
pre { background: ${palette.quote}; }
hr { border: 0; border-top: 1px solid ${palette.line}; }
.pm-sig { margin-top: 1.25em; padding-top: 1em; border-top: 1px solid ${palette.line}; color: ${palette.muted}; font-size: 14px; }
.pm-sig p { margin-bottom: .5em; }
.pm-quote { margin: 1em 0 0; }
.pm-quote > summary { border-color: ${palette.line}; color: ${palette.muted}; }
.pm-quote .pm-attr, .pm-quote .gmail_attr, .pm-quote .gmail_quote > p:first-child { border-top-color: ${palette.line}; color: ${palette.muted}; }
.pm-quote .pm-attr b, .pm-quote .gmail_attr b, .pm-quote .gmail_quote > p:first-child b { color: ${palette.text}; }
.pm-quote blockquote { font-size: 15px; }
</style>` : ""}
</head>
<body>${cleanBody.innerHTML}${heightScript}${keyScript}</body>
</html>`;
		// Writing the same document twice in a row (React's dev double effects, or a palette read
		// that didn't change anything) can leave the frame blank in some Chromium browsers.
		if (iframe.srcdoc !== doc) iframe.srcdoc = doc;
	}, [body, autoSize, remoteImages, paddingProp, palette?.scheme, palette?.text, palette?.muted, palette?.link, palette?.quote, palette?.line]);

	return (
		<iframe
			ref={iframeRef}
			className="block w-full border-0"
			style={{ ...(autoSize ? { height: `${height}px` } : { height: "100%" }), ...(palette ? { colorScheme: palette.scheme, background: "transparent" } : {}) }}
			// Destinations need normal browser capabilities (e.g. sign-in storage),
			// while the email itself must remain isolated in the sandbox.
			sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox"
			title="Email content"
		/>
	);
}

/**
 * Text-only mail on the page instead of in a frame. Its HTML comes from plainTextToHtml, which escapes
 * the sender's text, and is sanitised again here. Agents and screen readers read it with the rest of the
 * page; mail that arrives as HTML always stays in the sandboxed frame.
 */
export function MailText({ body }: { body: string }) {
	const ref = useRef<HTMLDivElement>(null);
	useLayoutEffect(() => {
		ref.current?.replaceChildren(...prepareMailBody(body, { remoteImages: false, frame: false }).childNodes);
	}, [body]);
	return <div ref={ref} className="pg-mail-text" />;
}
