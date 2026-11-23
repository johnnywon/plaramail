import assert from "node:assert/strict";
import { test } from "node:test";
import { loadTs } from "./helpers/sqlite.mjs";

const { cleanPrefs, DEFAULT_PREFS, samePrefs } = await loadTs("shared/prefs.ts");
const { readPrefs, writePrefs } = await loadTs("workers/lib/prefs.ts");

function fakeBucket() {
	const store = new Map();
	return {
		store,
		async get(key) {
			if (!store.has(key)) return null;
			const text = store.get(key);
			return { json: async () => JSON.parse(text) };
		},
		async put(key, value) {
			store.set(key, value);
		},
	};
}

test("cleanPrefs keeps valid fields, takes the rest from base and drops unknown ones", () => {
	assert.deepEqual(cleanPrefs({ theme: "light", keys: false, markRead: false, images: "never", replyFrom: false }), { theme: "light", keys: false, markRead: false, images: "never", replyFrom: false, shortcuts: {}, activityDays: 90, unmatched: "leave", trashDays: 0, timeZone: "" });
	assert.equal(cleanPrefs({ unmatched: "leave" }).unmatched, "leave");
	assert.equal(cleanPrefs({ unmatched: "send" }).unmatched, "leave");
	assert.equal(cleanPrefs({ activityDays: 180 }).activityDays, 180);
	assert.equal(cleanPrefs({ activityDays: 30 }).activityDays, 90);
	assert.ok(!samePrefs({ ...DEFAULT_PREFS, activityDays: 120 }, DEFAULT_PREFS));
	assert.deepEqual(cleanPrefs({ theme: "neon", keys: "yes", images: 3, extra: 1 }), DEFAULT_PREFS);
	assert.deepEqual(cleanPrefs(null), DEFAULT_PREFS);
	assert.deepEqual(cleanPrefs({ images: "always" }, { ...DEFAULT_PREFS, theme: "system" }), { ...DEFAULT_PREFS, theme: "system", images: "always" });
	assert.ok(samePrefs(cleanPrefs({}), DEFAULT_PREFS));
	assert.ok(!samePrefs({ ...DEFAULT_PREFS, keys: true }, DEFAULT_PREFS));
});

test("Trash and Spam retention is off unless set to 30, 60 or 90 days (WON-212)", () => {
	assert.equal(DEFAULT_PREFS.trashDays, 0);
	assert.equal(cleanPrefs({ trashDays: 30 }).trashDays, 30);
	assert.equal(cleanPrefs({ trashDays: 7 }).trashDays, 0);
	assert.equal(cleanPrefs({ trashDays: "90" }).trashDays, 0);
	assert.ok(!samePrefs({ ...DEFAULT_PREFS, trashDays: 60 }, DEFAULT_PREFS));
});

test("cleanPrefs keeps a time zone Intl knows and drops anything else (#33)", () => {
	assert.equal(cleanPrefs({ timeZone: "America/New_York" }).timeZone, "America/New_York");
	assert.equal(cleanPrefs({ timeZone: "Not/A_Zone" }).timeZone, "");
	assert.equal(cleanPrefs({ timeZone: 5 }, { ...DEFAULT_PREFS, timeZone: "Asia/Tokyo" }).timeZone, "Asia/Tokyo");
	assert.ok(!samePrefs({ ...DEFAULT_PREFS, timeZone: "Asia/Tokyo" }, DEFAULT_PREFS));
});

test("cleanPrefs keeps rebound shortcuts that can be bound and drops the rest", () => {
	const prefs = cleanPrefs({ shortcuts: { archive: ["y", "Escape", 3], help: ["h"], nope: ["q"], star: [] } });
	assert.deepEqual(prefs.shortcuts, { archive: ["y"], star: [] });
	assert.deepEqual(cleanPrefs({ theme: "light" }, prefs).shortcuts, prefs.shortcuts);
	assert.ok(!samePrefs(prefs, DEFAULT_PREFS));
	assert.ok(samePrefs(cleanPrefs({ shortcuts: { archive: ["y"], star: [] } }), prefs));
});

test("a deployment with nothing saved reports the defaults as unsaved", async () => {
	const env = { BUCKET: fakeBucket() };
	assert.deepEqual(await readPrefs(env), { prefs: DEFAULT_PREFS, saved: false });
});

test("writePrefs merges a patch over what is saved and stores only valid fields", async () => {
	const env = { BUCKET: fakeBucket() };
	await writePrefs(env, { theme: "light", images: "never" });
	const next = await writePrefs(env, { keys: false, theme: "bogus", apiKey: "nope" });
	assert.deepEqual(next, { ...DEFAULT_PREFS, theme: "light", images: "never", keys: false });
	assert.deepEqual(await readPrefs(env), { prefs: next, saved: true });
	assert.deepEqual(JSON.parse(env.BUCKET.store.get("config/prefs.json")), next);
});

test("a corrupt saved file reads as unsaved defaults", async () => {
	const env = { BUCKET: fakeBucket() };
	env.BUCKET.store.set("config/prefs.json", "{not json");
	assert.deepEqual(await readPrefs(env), { prefs: DEFAULT_PREFS, saved: false });
});
