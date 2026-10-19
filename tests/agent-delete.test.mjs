import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { loadTs } from "./helpers/sqlite.mjs";

// Delete agent's confirm step (#48): a double-click on Delete can't also confirm it.

const { CONFIRM_GUARD_MS, confirmReady } = await loadTs("app/components/postal/confirm-guard.ts");

test("a click within 400 ms of the confirm step opening is ignored", () => {
	assert.equal(CONFIRM_GUARD_MS, 400);
	assert.equal(confirmReady(1_000, 1_150), false, "the second click of a double-click");
	assert.equal(confirmReady(1_000, 1_400), true);
	assert.equal(confirmReady(null, 5_000), false, "no confirm step open");
});

test("the confirming button says Yes, delete, and focus moves to Keep", () => {
	const source = readFileSync("app/components/postal/Console.tsx", "utf8");
	const confirm = source.slice(source.indexOf("function AgentDelete"), source.indexOf("function AgentDelete") + 1500);
	assert.match(confirm, />Yes, delete \{agent\.name\}</);
	assert.match(confirm, /<Button autoFocus onClick=\{\(\) => setConfirming\(null\)\}>Keep<\/Button>/);
	assert.match(confirm, /confirmReady\(confirming, Date\.now\(\)\)/);
	assert.equal((confirm.match(/>Delete Agent \{agent\.name\}</g) ?? []).length, 1, "only the first button says Delete Agent");
});
