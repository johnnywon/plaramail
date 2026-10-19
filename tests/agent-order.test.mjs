import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { loadTs } from "./helpers/sqlite.mjs";

// Agent order without a mouse (#37): Move up and Move down on each row, through the same order API as drag.

const { moveInOrder } = await loadTs("app/components/postal/agent-order.ts");

test("Move up and Move down swap an agent with its neighbour", () => {
	assert.deepEqual(moveInOrder(["a", "b", "c"], "b", -1), ["b", "a", "c"]);
	assert.deepEqual(moveInOrder(["a", "b", "c"], "b", 1), ["a", "c", "b"]);
});

test("the ends and unknown agents leave the order alone", () => {
	assert.equal(moveInOrder(["a", "b"], "a", -1), null);
	assert.equal(moveInOrder(["a", "b"], "b", 1), null);
	assert.equal(moveInOrder(["a", "b"], "x", 1), null);
});

test("each agent row has Move up and Move down buttons named for the agent, sent to the order API", () => {
	const source = readFileSync("app/components/postal/Console.tsx", "utf8");
	assert.match(source, /aria-label=\{`Move \$\{a\.name\} up`\}/);
	assert.match(source, /aria-label=\{`Move \$\{a\.name\} down`\}/);
	assert.match(source, /const move = \(id: string, by: -1 \| 1\) => \{[\s\S]*?moveInOrder\([\s\S]*?order\.mutate\(/);
});
