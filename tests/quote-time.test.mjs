import assert from "node:assert/strict";
import { test } from "node:test";
import { openD1 } from "./helpers/d1.mjs";
import { loadTs } from "./helpers/sqlite.mjs";

// Quotes the Worker builds ("On …, … wrote:") use the reader's time zone, saved in prefs (#33).
// Workers run in UTC; so does this file, whatever the machine's zone.
process.env.TZ = "UTC";

const { formatQuotedDate } = await loadTs("shared/dates.ts");
const tools = await loadTs("workers/lib/tools.ts");
const { D1Mailbox } = await loadTs("workers/store/d1/mailbox.ts");

const NOON_UTC = "2026-10-18T12:00:00.000Z";

test("a quote's time is in the saved time zone", () => {
	assert.equal(formatQuotedDate(NOON_UTC, "Asia/Tokyo"), "Sun, Oct 18, 2026, 9:00 PM");
	assert.equal(formatQuotedDate(NOON_UTC, "America/New_York"), "Sun, Oct 18, 2026, 8:00 AM");
});

test("with no saved time zone, a quote says UTC", () => {
	assert.equal(formatQuotedDate(NOON_UTC), "Sun, Oct 18, 2026, 12:00 PM UTC");
	assert.equal(formatQuotedDate(NOON_UTC, "Not/A_Zone"), "Sun, Oct 18, 2026, 12:00 PM UTC");
});

function bucketWith(prefs) {
	const store = new Map([["config/prefs.json", JSON.stringify(prefs)]]);
	return {
		get: async (key) => (store.has(key) ? { json: async () => JSON.parse(store.get(key)) } : null),
		put: async (key, value) => { store.set(key, value); },
	};
}

test("draft_reply quotes the original in the reader's time zone", async () => {
	const d1 = await openD1();
	await d1.addMailboxes("a@example.com");
	const env = { DB: d1.DB, BUCKET: bucketWith({ timeZone: "America/New_York" }) };
	const box = new D1Mailbox(d1.sql, env.BUCKET, "a@example.com");
	await box.createEmail("inbox", { id: "e1", subject: "Hi", sender: "alice@example.org", recipient: "a@example.com", date: NOON_UTC, body: "<p>Hello</p>" }, []);

	const result = await tools.toolDraftReply(env, "a@example.com", { originalEmailId: "e1", to: "alice@example.org", subject: "Re: Hi", body: "Thanks", isPlainText: true });
	const draft = await box.getEmail(result.draftId);
	assert.match(draft.body, /On Sun, Oct 18, 2026, 8:00 AM, alice@example\.org wrote:/);
});
