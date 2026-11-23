import { DatabaseSync } from "node:sqlite";
import { build } from "esbuild";
import { NODE_REQUIRE } from "./node-require.mjs";

/** Bundle a TypeScript module and import it. */
export async function loadTs(entry) {
	const bundle = await build({ entryPoints: [entry], bundle: true, platform: "node", banner: NODE_REQUIRE, format: "esm", write: false });
	return import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`);
}

function statementCount(sql) {
	const stripped = sql.replace(/'(?:[^']|'')*'/g, "''").replace(/--[^\n]*/g, "").trim().replace(/;\s*$/, "");
	return stripped.split(";").filter((part) => part.trim()).length;
}

/**
 * node:sqlite database with an `exec` that enforces D1-like limits:
 * at most 100 bound parameters, no SQL-level transactions, and no bound
 * parameters on multi-statement SQL.
 */
export function openDb() {
	const db = new DatabaseSync(":memory:");
	db.exec("PRAGMA foreign_keys = ON");
	const exec = (sql, ...params) => {
		if (params.length > 100) throw new Error(`too many SQL variables: ${params.length}`);
		if (/^\s*(BEGIN|COMMIT|ROLLBACK|SAVEPOINT|RELEASE)\b/im.test(sql)) throw new Error("SQL transactions are not allowed");
		const count = statementCount(sql);
		if (count > 1) {
			if (params.length > 0) throw new Error("bound parameters on multi-statement SQL");
			db.exec(sql);
			return [];
		}
		const stmt = db.prepare(sql);
		return stmt.columns().length > 0 ? stmt.all(...params).map((row) => ({ ...row })) : (stmt.run(...params), []);
	};
	return { db, exec };
}
