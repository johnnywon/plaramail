// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

/**
 * EMAIL_ADDRESSES as a list. The config holds a JSON array; a deploy form
 * that saves it as text gives a comma-separated string, which reads the same.
 */
export function configuredAddresses(env: { EMAIL_ADDRESSES?: unknown }): string[] {
	const raw = env.EMAIL_ADDRESSES;
	const list = Array.isArray(raw) ? raw : typeof raw === "string" ? raw.split(",") : [];
	return list.map((a) => String(a).trim()).filter(Boolean);
}
