// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

/**
 * Errors the Worker answers before the app loads (Access checks). Browsers get a
 * page in the postal look (app/components/ErrorPage.tsx); everything else gets
 * the message as plain text. The message is kept word for word in both, since
 * docs/setup.md quotes it for troubleshooting.
 */
export function errorResponse(request: Request, status: number, title: string, message: string): Response {
	const accept = request.headers.get("accept") ?? "";
	if (!accept.includes("text/html")) {
		return new Response(message, { status, headers: { "content-type": "text/plain; charset=utf-8" } });
	}
	return new Response(errorHtml(status, title, message), {
		status,
		headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
	});
}

const escape = (text: string) =>
	text.replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch] as string);

/** The ErrorPage layout as static HTML, with the postal tokens it reads. No script. */
export function errorHtml(status: number, title: string, message: string): string {
	return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escape(title)}</title>
<style>
:root { color-scheme: dark; --base: #141518; --t1: #f0f0ed; --t4: #c9c9c5; --t6: #8b8d93; --t7: #7f8187; --primary: #e4e4e1; --on-primary: #141518; }
@media (prefers-color-scheme: light) { :root { color-scheme: light; --base: #f6f6f4; --t1: #111214; --t4: #383a40; --t6: #5c5e64; --t7: #63656b; --primary: #1b1c20; --on-primary: #f6f6f4; } }
* { box-sizing: border-box; }
html, body { margin: 0; min-height: 100%; background: var(--base); }
body { min-height: 100vh; min-height: 100dvh; display: flex; font: 13px/1.5 "Space Grotesk Variable", "Space Grotesk", system-ui, sans-serif; color: var(--t4); }
main { margin: auto; width: 100%; max-width: 440px; padding: 48px 24px; display: flex; flex-direction: column; align-items: center; text-align: center; gap: 10px; }
.code { margin: 0; font: 500 11px "JetBrains Mono Variable", "JetBrains Mono", ui-monospace, monospace; letter-spacing: .08em; color: var(--t7); }
h1 { margin: 0; font-size: 22px; font-weight: 600; color: var(--t1); }
p.text { margin: 0; color: var(--t6); overflow-wrap: anywhere; }
a { display: inline-flex; align-items: center; height: 26px; margin-top: 8px; padding: 0 10px; border-radius: 6px; background: var(--primary); color: var(--on-primary); font-size: 12px; font-weight: 600; text-decoration: none; }
</style>
</head>
<body>
<main>
<p class="code">${status}</p>
<h1>${escape(title)}</h1>
<p class="text">${escape(message)}</p>
<a href="/">Try again</a>
</main>
</body>
</html>`;
}
