import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { build } from "esbuild";
import { Miniflare } from "miniflare";
import { statements } from "./helpers/schema.mjs";
import { D1_SCHEMA } from "./helpers/d1-schema.mjs";

// The Alex profile (SEED_PROFILE=alex) written to local D1 and R2, read back the way the app reads it.

const NINE = { "hello@partwell.dev": 9, "support@partwell.dev": 10, "billing@partwell.dev": 10, "partners@partwell.dev": 11, "ops@partwell.dev": 22, "alex@alexrivera.me": 14, "league@alexrivera.me": 8, "booking@latecommits.band": 8, "alex@riverbendcode.org": 8 };
const SIX = ["hello@example.com", "billing@example.com", "support@example.org", "legal@example.org", "ops@example.net", "press@example.net"];
const NOW = Date.UTC(2026, 9, 13, 22, 0);
const instances = [];
let script;

before(async () => {
	const bundle = await build({
		entryPoints: ["tests/fixtures/dev-seed-worker.ts"], bundle: true, format: "esm", platform: "neutral",
		conditions: ["workerd", "worker", "browser"], mainFields: ["module", "main"], external: ["cloudflare:workers"],
		write: false, logLevel: "silent",
	});
	script = bundle.outputFiles[0].text;
});

after(async () => {
	await Promise.all(instances.map((mf) => mf.dispose()));
});

async function start(bindings = {}) {
	const mf = new Miniflare({
		modules: true, script, compatibilityDate: "2025-11-28", compatibilityFlags: ["nodejs_compat"],
		bindings: { EMAIL_ADDRESSES: SIX, ...bindings }, r2Buckets: ["BUCKET"], d1Databases: ["DB"],
	});
	instances.push(mf);
	const call = async (op, args) => {
		const response = await mf.dispatchFetch("http://worker/", { method: "POST", body: JSON.stringify({ op, args }) });
		const body = await response.json();
		if (body.error) throw new Error(body.error);
		return body.ok;
	};
	for (const s of statements(D1_SCHEMA)) await call("exec", { sql: s });
	return {
		call,
		rows: (sql, ...params) => call("rows", { sql, params }),
		one: async (sql, ...params) => Object.values((await call("rows", { sql, params }))[0] ?? {})[0],
	};
}

const perMailbox = async (db) => Object.fromEntries((await db.rows(`SELECT mailbox_id AS m, COUNT(*) AS n FROM messages WHERE email_id LIKE 'seed-alex-%' GROUP BY mailbox_id`)).map((r) => [r.m, r.n]));

test("the Alex profile writes nine mailboxes and 100 messages, whatever EMAIL_ADDRESSES holds", async () => {
	const db = await start();
	const summary = await db.call("seed", { profile: "alex", now: NOW });
	assert.equal(summary.profile, "alex");
	assert.equal(summary.messages, 100);
	assert.deepEqual(await perMailbox(db), NINE);
	for (const [addr] of Object.entries(NINE)) assert.equal(await db.one(`SELECT COUNT(*) FROM mailboxes WHERE id = ?`, addr), 1, addr);
	assert.equal(await db.one(`SELECT COUNT(*) FROM mailboxes WHERE id LIKE '%example%'`), 0, "no default addresses made up");

	const folders = Object.fromEntries((await db.rows(`SELECT folder_id AS f, COUNT(*) AS n FROM messages GROUP BY folder_id`)).map((r) => [r.f, r.n]));
	assert.deepEqual(folders, { inbox: 30, archive: 49, sent: 15, draft: 3, spam: 2, trash: 1 });
	assert.deepEqual((await db.rows(`SELECT email_id FROM messages WHERE read = 0 ORDER BY email_id`)).map((r) => r.email_id.replace("seed-alex-v2-", "")), ["A-06", "B-04", "BAND-06", "BAND-07", "BAND-08", "H-04", "H-05", "L-06", "O-08", "P-10", "P-11", "RCC-07"]);
	assert.deepEqual((await db.rows(`SELECT email_id FROM messages WHERE starred = 1 ORDER BY email_id`)).map((r) => r.email_id.replace("seed-alex-v2-", "")), ["A-07", "B-04", "BAND-01", "H-01", "L-01", "O-08", "P-04", "RCC-02", "RCC-07"]);

	// Labels as the list shows them
	const label = async (name) => (await db.rows(`SELECT m.email_id FROM message_labels ml JOIN labels l ON l.id = ml.label_id JOIN messages m ON m.id = ml.message WHERE l.name = ? ORDER BY m.email_id`, name)).map((r) => r.email_id.replace("seed-alex-v2-", ""));
	assert.deepEqual(await label("Incident"), ["O-03", "O-05", "O-06", "O-19", "O-20", "SUP-06"]);
	assert.deepEqual(await label("Cedar"), ["B-04", "H-01", "H-02", "O-08", "O-21", "O-22"]);
	assert.deepEqual(await label("Fantasy"), ["L-01", "L-02", "L-03", "L-04", "L-05", "L-06", "L-07", "L-08"]);
	assert.deepEqual(await label("Band"), ["BAND-01", "BAND-02", "BAND-03", "BAND-04", "BAND-05", "BAND-06", "BAND-07"]);
	assert.equal(await db.one(`SELECT COUNT(*) FROM labels`), 19);

	// Threads: the incident alerts are one conversation; a reply sits with what it answers
	const convo = async (id) => (await db.rows(`SELECT email_id FROM messages WHERE conversation_id = ? ORDER BY date`, `seed-alex-v2-${id}`)).map((r) => r.email_id.replace("seed-alex-v2-", ""));
	assert.deepEqual(await convo("O-03"), ["O-03", "O-04", "O-07"]);
	assert.deepEqual(await convo("SUP-06"), ["SUP-06", "SUP-07", "SUP-08"]);
	assert.deepEqual(await convo("B-05"), ["B-05", "B-06"]);
	assert.deepEqual(await convo("A-07"), ["A-07", "A-08"]);
	assert.deepEqual(await convo("RCC-07"), ["RCC-07", "RCC-08"]);
	assert.deepEqual(await convo("BAND-01"), ["BAND-01", "BAND-02", "BAND-03"]);
	assert.equal(await db.one(`SELECT date FROM messages WHERE email_id = 'seed-alex-v2-O-03'`), "2026-10-09T03:37:00.000Z", "11:37 pm in New York");

	// Files: inline photos are inline parts, the rest are files, all in R2 with their bytes
	const atts = await db.rows(`SELECT a.id, a.email_id, a.filename, a.mimetype, a.size, a.content_id, a.disposition FROM attachments a ORDER BY a.email_id, a.id`);
	assert.equal(atts.length, summary.attachments);
	const objects = new Map((await db.call("r2", { prefix: "attachments/" })).map((l) => l.split("\t")).map(([k, n]) => [k, Number(n)]));
	for (const a of atts) {
		assert.ok(a.size > 300, a.filename);
		assert.equal(objects.get(`attachments/${a.email_id}/${a.id}/${a.filename}`), a.size, a.filename);
		assert.equal(a.disposition, a.content_id ? "inline" : "attachment", a.filename);
	}
	assert.deepEqual(atts.filter((a) => a.content_id).map((a) => `${a.email_id.replace("seed-alex-v2-", "")} ${a.content_id}`), [
		"A-03 <keyboard.jpg@keyforgekeys.com>", "A-04 <food-burrito.jpg@ubereats.com>", "A-05 <food-burrito.jpg@ubereats.com>",
		"H-03 <coffee.jpg@buildnotes.news>", "L-01 <football-stadium.jpg@sundaydeployleague.com>", "L-06 <football-stadium.jpg@sundaydeployleague.com>",
	]);
	// The list's file marker counts files, not inline photos
	assert.equal(await db.one(`SELECT has_attachment FROM messages WHERE email_id = 'seed-alex-v2-L-06'`), 0);
	assert.equal(await db.one(`SELECT has_attachment FROM messages WHERE email_id = 'seed-alex-v2-A-03'`), 1);

	// Search and the list the UI runs
	const filter = (over) => ({ view: "inbox", address: [], from: [], label: [], is: [], has: [], subject: [], q: "", sort: "date", dir: "desc", tzOffset: 0, ...over });
	const list = (over) => db.call("store", { mailbox: "all", method: "queryMail", params: [filter(over), { limit: 200 }] });
	assert.equal((await list({ address: ["league@alexrivera.me"] })).conversations.length, 4);
	assert.equal((await list({ address: ["booking@latecommits.band"] })).conversations.length, 4);
	assert.ok((await list({ q: "DB-4821", view: "all" })).conversations.length >= 2, "search finds the database case");
	assert.equal((await list({ view: "drafts" })).conversations.length, 3);
	const opened = await db.call("store", { mailbox: "billing@partwell.dev", method: "getEmail", params: ["seed-alex-v2-B-06"] });
	assert.deepEqual(opened.attachments.map((a) => [a.filename, a.mimetype]), [["october-expenses.csv", "text/csv"]]);

	// A-08 is the agent's draft, so it opens with Redraft; Alex's own drafts don't
	const reschedule = await db.call("store", { mailbox: "alex@alexrivera.me", method: "getEmail", params: ["seed-alex-v2-A-08"] });
	assert.deepEqual(reschedule.draft_notes, { origin: "auto-draft", agent: null, model: null, instructions: [] });
	assert.equal(await db.one(`SELECT COUNT(*) FROM draft_notes`), 1);
});

test("running the profile again writes the same 100 and leaves other mail alone", async () => {
	const db = await start();
	await db.call("seed", { now: NOW });
	const defaults = await db.one(`SELECT COUNT(*) FROM messages WHERE email_id LIKE 'seed-mail-%'`);
	assert.ok(defaults >= 300);
	await db.call("store", { mailbox: "hello@example.com", method: "createEmail", params: ["inbox", { id: "mine-1", subject: "From me", sender: "me@example.net", recipient: "hello@example.com", date: new Date(NOW).toISOString(), body: "<p>hi</p>", thread_id: "mine-1" }, []] });

	const first = await db.call("seed", { profile: "alex", now: NOW });
	await db.call("store", { mailbox: "hello@partwell.dev", method: "createEmail", params: ["inbox", { id: "mine-2", subject: "Mine too", sender: "me@example.net", recipient: "hello@partwell.dev", date: new Date(NOW).toISOString(), body: "<p>hi</p>", thread_id: "mine-2" }, []] });
	const second = await db.call("seed", { profile: "alex", now: NOW });
	assert.equal(second.messages, 100);
	assert.equal(second.attachments, first.attachments);
	assert.deepEqual(await perMailbox(db), NINE);
	assert.equal(await db.one(`SELECT COUNT(*) FROM messages WHERE email_id LIKE 'seed-mail-%'`), defaults, "the default sample mail stays");
	assert.equal(await db.one(`SELECT COUNT(*) FROM messages WHERE email_id IN ('mine-1', 'mine-2')`), 2, "your own mail stays");
	assert.equal(await db.one(`SELECT COUNT(*) FROM messages`), defaults + 100 + 2);
	assert.equal((await db.call("r2", { prefix: "attachments/seed-alex-" })).length, second.attachments, "no leftover files");
	assert.equal(await db.one(`SELECT COUNT(*) FROM labels WHERE name = 'Fantasy'`), 1);
});

test("SEED_PROFILE=alex: the dev server's first request writes it, and a week later writes it again", async () => {
	const db = await start({ SEED_PROFILE: "alex" });
	await db.call("ensure", {});
	assert.deepEqual(await perMailbox(db), NINE);
	assert.equal(await db.one(`SELECT COUNT(*) FROM messages WHERE email_id LIKE 'seed-mail-%'`), 0);
	const newest = Date.parse(await db.one(`SELECT MAX(date) FROM messages`));
	assert.ok(Date.now() - newest < 7 * 86_400_000 && newest < Date.now(), "within the last week");
	const ny = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
	assert.equal(ny.format(newest), "Sun 19:58", "the round 3 recap, Sunday evening in New York");

	const reset = await db.call("reset", { now: NOW });
	assert.equal(reset.profile, "alex");
	assert.equal(await db.one(`SELECT COUNT(*) FROM messages`), 100);
});
