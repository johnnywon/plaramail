import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { loadTs } from "./helpers/sqlite.mjs";

// Agent order without a mouse (#37): Move up and Move down on each row, through the same order API as drag.

const { moveInOrder, afterMove } = await loadTs("app/components/postal/agent-order.ts");

// #63: focus stays on the moved agent's arrow, or the other arrow at the end of the list, and the move is announced.
test("after a move, focus goes to the same arrow, or the other one at an end", () => {
	assert.deepEqual(afterMove(["b", "a", "c", "d"], "a", -1, "Ann"), { focus: -1, message: "Moved Ann to position 2 of 4" });
	assert.deepEqual(afterMove(["a", "b", "c", "d"], "a", -1, "Ann"), { focus: 1, message: "Moved Ann to position 1 of 4" }, "Move up is disabled at the top");
	assert.deepEqual(afterMove(["b", "c", "a", "d"], "a", 1, "Ann"), { focus: 1, message: "Moved Ann to position 3 of 4" });
	assert.deepEqual(afterMove(["b", "c", "d", "a"], "a", 1, "Ann"), { focus: -1, message: "Moved Ann to position 4 of 4" }, "Move down is disabled at the bottom");
	assert.equal(afterMove(["b"], "a", 1, "Ann"), null);
});

test("Console keeps focus on the moved agent's arrow and announces the move", () => {
	const source = readFileSync("app/components/postal/Console.tsx", "utf8");
	assert.match(source, /afterMove\(ids, id, by, /);
	assert.match(source, /arrows\.current\.get\(`\$\{moved\.id\}:\$\{moved\.focus\}`\)\?\.focus\(\)/);
	assert.match(source, /<span className="pg-sr-only" role="status" aria-live="polite">\{announce\}<\/span>/);
});

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
