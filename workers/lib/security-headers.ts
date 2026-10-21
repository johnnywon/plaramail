// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

export function withSecurityHeaders(res: Response): Response {
	if (res.status === 101 || (res as Response & { webSocket?: unknown }).webSocket) return res;

	const applyHeaders = (response: Response) => {
		response.headers.set("X-Frame-Options", "DENY");
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
