// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

/** How long a confirm step ignores clicks after it opens, so a double-click can't confirm. */
export const CONFIRM_GUARD_MS = 400;

/** Whether a confirm step opened at `openedAt` (ms, or null when closed) takes a click at `now`. */
export function confirmReady(openedAt: number | null, now: number): boolean {
	return openedAt !== null && now - openedAt >= CONFIRM_GUARD_MS;
}
