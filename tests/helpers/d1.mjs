import { D1_SCHEMA } from "./d1-schema.mjs";
import { openSql } from "./sql.mjs";

/**
 * A `D1Database` stand-in over node:sqlite with every migration applied, for
 * code that reads `env.DB`. It goes through tests/helpers/sql.mjs, so D1's
 * limits apply. `sql`, `exec` (synchronous, for tests/helpers/d1-mail.mjs)
 * and `db` reach the same database for setup and checks.
 */
export async function openD1() {
	const { db, sql } = openSql();
	await sql.schema(D1_SCHEMA);
	const statement = (text, params = []) => ({
		text,
		params,
		bind: (...values) => statement(text, values),
		all: async () => ({ results: await sql.all(text, ...params), success: true }),
		first: async () => sql.first(text, ...params),
		run: async () => ({ success: true, meta: { changes: (await sql.run(text, ...params)).changes } }),
	});
	const DB = {
		prepare: (text) => statement(text),
		batch: async (list) => (await sql.batch(list.map((s) => ({ sql: s.text, params: s.params })))).map((results) => ({ results, success: true })),
	};
	/** Create mailboxes with their system folders, as the registry does. */
	const addMailboxes = async (...ids) => {
		for (const id of ids) {
			await sql.run(`INSERT OR IGNORE INTO mailboxes (id, created_at) VALUES (?, ?)`, id, new Date().toISOString());
			for (const [f, name] of [["inbox", "Inbox"], ["sent", "Sent"], ["draft", "Drafts"], ["archive", "Archive"], ["trash", "Trash"], ["spam", "Spam"]]) {
				await sql.run(`INSERT OR IGNORE INTO folders (mailbox_id, id, name, is_deletable) VALUES (?, ?, ?, 0)`, id, f, name);
			}
		}
	};
	const exec = (text, ...params) => {
		const stmt = db.prepare(text);
		return stmt.columns().length > 0 ? stmt.all(...params).map((row) => ({ ...row })) : (stmt.run(...params), []);
	};
	return { DB, sql, exec, db, addMailboxes };
}
