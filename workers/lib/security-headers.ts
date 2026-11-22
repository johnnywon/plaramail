// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

export function withSecurityHeaders(res: Response): Response {
	if (res.status === 101 || (res as Response & { webSocket?: unknown }).webSocket) return res;

	const applyHeaders = (response: Response) => {
		response.headers.set("X-Frame-Options", "DENY");
		// The browser keeps to HTTPS, doesn't guess content types, and links out don't carry the mail's URL.
		response.headers.set("Strict-Transport-Security", "max-age=31536000");
		response.headers.set("X-Content-Type-Options", "nosniff");
		if (!response.headers.has("Referrer-Policy")) response.headers.set("Referrer-Policy", "same-origin");
		const policy = response.headers.get("Content-Security-Policy");
		if (policy) {
			const directive = /(^|;)\s*frame-ancestors\b[^;]*/i;
			response.headers.set(
				"Content-Security-Policy",
				directive.test(policy)
					? policy.replace(directive, "$1 frame-ancestors 'none'")
					: `${policy.replace(/;\s*$/, "")}; frame-ancestors 'none'`,
			);
		} else {
			response.headers.set("Content-Security-Policy", "frame-ancestors 'none'");
		}
	};

	try {
		applyHeaders(res);
		return res;
	} catch {
		const rebuilt = new Response(res.body, res);
		applyHeaders(rebuilt);
		return rebuilt;
	}
}
