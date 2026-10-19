import assert from "node:assert/strict";
import { test } from "node:test";
import { loadTs } from "./helpers/sqlite.mjs";

// WON-232: the window corners follow the macOS curve only when the page reaches them.

const { WINDOW_OS_SCRIPT } = await loadTs("app/lib/window-os.ts");

/** Run the head script in a fake window and return <html>'s dataset. */
function run({ platform = "MacIntel", touch = 0, outer = [1440, 900], inner = 1440, screen = [1728, 1117] } = {}) {
	const dataset = {};
	const g = {
		document: { documentElement: { dataset } },
		navigator: { platform, maxTouchPoints: touch },
		outerWidth: outer[0], outerHeight: outer[1], innerWidth: inner,
		screen: { width: screen[0], height: screen[1] },
		addEventListener: () => {},
	};
	new Function(...Object.keys(g), WINDOW_OS_SCRIPT)(...Object.values(g));
	return dataset;
}

test("a Mac window the page fills is normal", () => {
	assert.deepEqual(run(), { os: "mac", window: "normal" });
});

test("vertical tabs, a side panel or docked DevTools make it framed", () => {
	assert.equal(run({ inner: 1390 }).window, "framed");
	assert.equal(run({ inner: 1430 }).window, "normal");
});

test("full screen is full", () => {
	assert.equal(run({ outer: [1728, 1117], inner: 1728 }).window, "full");
});

test("other systems and iPads get nothing", () => {
	assert.deepEqual(run({ platform: "Win32" }), {});
	assert.deepEqual(run({ touch: 5 }), {});
});
