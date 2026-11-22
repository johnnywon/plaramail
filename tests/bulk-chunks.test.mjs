import assert from "node:assert/strict";
import { test } from "node:test";
import { loadTs } from "./helpers/sqlite.mjs";

const { sendBulk, BULK_MAX_THREADS } = await loadTs("app/lib/bulk-optimistic.ts");
const { BULK_MAX_THREADS: serverMax } = await loadTs("shared/bulk.ts");

test("the client splits a selection at the server's limit", () => {
	assert.equal(BULK_MAX_THREADS, serverMax);
});

test("a selection over the limit goes in batches and comes back as one result", async () => {
	const calls = [];
	const send = async (target) => {
		calls.push(target.threadKeys.length);
		return { affected: target.threadKeys.length, undoId: `u${calls.length}`, failed: calls.length === 2 ? [{ mailboxId: "a@example.com", error: "x" }] : [] };
	};
	const keys = Array.from({ length: 1201 }, (_, i) => `k${i}`);
	const result = await sendBulk(send, { threadKeys: keys, view: "inbox", filter: "view=inbox" }, { type: "archive" });
	assert.deepEqual(calls, [500, 500, 201]);
	assert.equal(result.affected, 1201);
	assert.deepEqual(result.undoIds, ["u1", "u2", "u3"]);
	assert.equal(result.failed.length, 1);
});

test("a small selection is one request", async () => {
	let n = 0;
	const result = await sendBulk(async () => (n++, { affected: 2, undoId: "u1", failed: [] }), { threadKeys: ["a", "b"], view: "inbox" }, { type: "read" });
	assert.equal(n, 1);
	assert.deepEqual(result.undoIds, ["u1"]);
});
