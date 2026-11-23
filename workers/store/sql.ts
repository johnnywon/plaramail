// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

/**
 * The async SQL interface the D1 store is written against. `d1Sql` wraps a
 * D1 binding; tests use the node:sqlite version in tests/helpers/sql.mjs,
 * which enforces the same limits.
 */

export type Row = Record<string, unknown>;

export interface Statement {
	sql: string;
	params?: unknown[];
}

export interface Sql {
	all<T extends Row = Row>(sql: string, ...params: unknown[]): Promise<T[]>;
	first<T extends Row = Row>(sql: string, ...params: unknown[]): Promise<T | null>;
	run(sql: string, ...params: unknown[]): Promise<{ changes: number }>;
	/** Atomic: every statement commits or none do. Reads see earlier statements' writes. */
	batch(statements: Statement[]): Promise<Row[][]>;
}

/** D1 refuses bound parameters past this many. */
export const MAX_PARAMS = 100;
/** One `batch()` call is capped at 32 MiB serialized; stay well under it. */
export const MAX_BATCH_BYTES = 24 * 1024 * 1024;
/** D1 stored 8 MB in one value and refused 9 MB (SQLITE_TOOBIG). */
export const MAX_VALUE_BYTES = 8 * 1000 * 1000;

export function d1Sql(db: D1Database): Sql {
	const bind = (sql: string, params: unknown[] = []) => db.prepare(sql).bind(...params);
	return {
		async all<T extends Row = Row>(sql: string, ...params: unknown[]) {
			return (await bind(sql, params).all<T>()).results;
		},
		async first<T extends Row = Row>(sql: string, ...params: unknown[]) {
			return (await bind(sql, params).first<T>()) ?? null;
		},
		async run(sql: string, ...params: unknown[]) {
			const result = await bind(sql, params).run();
			return { changes: result.meta.changes ?? 0 };
		},
		async batch(statements: Statement[]) {
			if (statements.length === 0) return [];
			const results = await db.batch(statements.map((s) => bind(s.sql, s.params)));
			return results.map((r) => (r.results ?? []) as Row[]);
		},
	};
}

/**
 * Split statements into batches that each stay under MAX_BATCH_BYTES of
 * bound values. One statement larger than the cap still gets its own batch,
 * and D1 decides.
 */
export function chunkByBytes(statements: Statement[], maxBytes = MAX_BATCH_BYTES): Statement[][] {
	const chunks: Statement[][] = [];
	let current: Statement[] = [];
	let size = 0;
	for (const statement of statements) {
		const bytes = statementBytes(statement);
		if (current.length > 0 && size + bytes > maxBytes) {
			chunks.push(current);
			current = [];
			size = 0;
		}
		current.push(statement);
		size += bytes;
	}
	if (current.length > 0) chunks.push(current);
	return chunks;
}

const encoder = new TextEncoder();

function statementBytes(statement: Statement): number {
	let bytes = encoder.encode(statement.sql).length;
	for (const param of statement.params ?? []) {
		if (typeof param === "string") bytes += encoder.encode(param).length;
		else if (param instanceof ArrayBuffer) bytes += param.byteLength;
		else if (ArrayBuffer.isView(param)) bytes += param.byteLength;
		else bytes += 8;
	}
	return bytes;
}
