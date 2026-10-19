// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

/** `ids` with `id` swapped one place up (-1) or down (1), or null when it can't move. */
export function moveInOrder(ids: readonly string[], id: string, by: -1 | 1): string[] | null {
	const at = ids.indexOf(id);
	const to = at + by;
	if (at < 0 || to < 0 || to >= ids.length) return null;
	const next = [...ids];
	[next[at], next[to]] = [next[to], next[at]];
	return next;
}

/**
 * Where focus goes after `id` moved by `by` into `ids`, and what to announce.
 * Focus stays on the arrow used, or goes to the other arrow when the used one
 * is now disabled at an end of the list. Null when `id` isn't in `ids`.
 */
export function afterMove(ids: readonly string[], id: string, by: -1 | 1, name: string): { focus: -1 | 1; message: string } | null {
	const at = ids.indexOf(id);
	if (at < 0) return null;
	const atEnd = by === -1 ? at === 0 : at === ids.length - 1;
	return { focus: atEnd ? (-by as -1 | 1) : by, message: `Moved ${name} to position ${at + 1} of ${ids.length}` };
}
