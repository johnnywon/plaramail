import assert from "node:assert/strict";
import { test } from "node:test";
import { loadTs } from "./helpers/sqlite.mjs";

// The Schedule send menu's quick slots (#39). Dates are local, like the menu.

const { scheduleSlots } = await loadTs("app/components/postal/schedule-slots.ts");

const slots = (now) => scheduleSlots(now).map(([label, at]) => [label, at.getDay(), at.getHours()]);

test("a weekday lists tomorrow morning, tomorrow afternoon and Monday morning", () => {
	assert.deepEqual(slots(new Date(2026, 9, 14, 10)), [
		["Tomorrow morning", 4, 8],
		["Tomorrow afternoon", 4, 13],
		["Monday morning", 1, 8],
	]);
});

test("on a Sunday, Monday morning isn't listed twice (#39)", () => {
	assert.deepEqual(slots(new Date(2026, 9, 18, 10)), [
		["Tomorrow morning", 1, 8],
		["Tomorrow afternoon", 1, 13],
	]);
});

test("on a Saturday, all three slots differ", () => {
	assert.deepEqual(slots(new Date(2026, 9, 17, 10)), [
		["Tomorrow morning", 0, 8],
		["Tomorrow afternoon", 0, 13],
		["Monday morning", 1, 8],
	]);
});
