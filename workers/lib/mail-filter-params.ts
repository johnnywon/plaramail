// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

/** Parse `/api/v1/mail` query params into a MailFilter. Throws InvalidFilterError on bad input. */

import {
	DATE_TOKENS,
	HAS_VALUES,
	InvalidFilterError,
	IS_VALUES,
	SORTS,
	VIEWS,
	emptyFilter,
	type MailFilter,
	searchOf,
} from "./mail-index-sql";

import { MAX_SEARCH_LENGTH } from "../../shared/search-query";

const MAX_VALUES = 20;
const MAX_LENGTH = 200;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}(T[\d:.]+Z)?$/;

function values(params: URLSearchParams, key: string): string[] {
	const list = params.getAll(key).map((v) => v.trim()).filter(Boolean);
	if (list.length > MAX_VALUES) throw new InvalidFilterError(`Too many ${key} values`);
	for (const v of list) if (v.length > MAX_LENGTH) throw new InvalidFilterError(`${key} value too long`);
	return [...new Set(list)];
}

function oneOf<T extends string>(value: string | null, allowed: readonly T[], key: string): T | undefined {
	if (value === null || value === "") return undefined;
	if (!(allowed as readonly string[]).includes(value)) throw new InvalidFilterError(`Invalid ${key}: ${value}`);
	return value as T;
}

/** The search text is compiled too, so a bad operator is refused here rather than inside the store. */
export function parseMailParams(params: URLSearchParams): { filter: MailFilter; cursor: string | null; limit: number } {
	const view = params.get("view") || "inbox";
	if (!(VIEWS as readonly string[]).includes(view) && !/^folder:[\w-]+$/.test(view)) {
		throw new InvalidFilterError(`Invalid view: ${view}`);
	}

	const is: MailFilter["is"] = [];
	for (const v of values(params, "is")) {
		const value = oneOf(v, IS_VALUES, "is")!;
		// Read and unread replace each other; the later one wins.
		if (value === "read" || value === "unread") {
			const other = value === "read" ? "unread" : "read";
			const at = is.indexOf(other);
			if (at >= 0) is.splice(at, 1);
		}
		if (!is.includes(value)) is.push(value);
	}
	const has = values(params, "has").map((v) => oneOf(v, HAS_VALUES, "has")!);

	for (const key of ["before", "after"] as const) {
		const v = params.get(key);
		if (v && !ISO_DATE.test(v)) throw new InvalidFilterError(`Invalid ${key}: ${v}`);
	}

	const q = (params.get("q") ?? "").trim();
	if (q.length > MAX_SEARCH_LENGTH) throw new InvalidFilterError("Search text too long");

	const tz = Number(params.get("tz") ?? 0);
	const limit = Number(params.get("limit") ?? 50);

	const overrides: Partial<MailFilter> = {
		view,
		address: values(params, "address").map((v) => v.toLowerCase()),
		from: values(params, "from").map((v) => v.toLowerCase()),
		label: values(params, "label"),
		is,
		has,
		subject: values(params, "subject"),
		q,
		date: oneOf(params.get("date"), DATE_TOKENS, "date"),
		before: params.get("before") || undefined,
		after: params.get("after") || undefined,
		sort: oneOf(params.get("sort"), SORTS, "sort") ?? "date",
		dir: oneOf(params.get("dir"), ["asc", "desc"] as const, "dir") ?? "desc",
		tzOffset: Number.isFinite(tz) && Math.abs(tz) <= 14 * 60 ? Math.trunc(tz) : 0,
	};
	for (const key of Object.keys(overrides) as (keyof MailFilter)[]) {
		if (overrides[key] === undefined) delete overrides[key];
	}
	const filter = emptyFilter(overrides);
	searchOf(filter);
	return {
		filter,
		cursor: params.get("cursor") || null,
		limit: Number.isFinite(limit) ? Math.min(Math.max(Math.trunc(limit), 1), 100) : 50,
	};
}
