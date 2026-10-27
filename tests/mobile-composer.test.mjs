import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { loadTs } from "./helpers/sqlite.mjs";

// The phone composer from Plara Design's compose lab: the dock on the keyboard, cards over it, the agent's
// draft in its own card, and one held send at a time.

const { bodyOnSend, draftKind, requestText, takeDraft, STARTS, TONES } = await loadTs("app/components/postal/agent-draft.ts");
const { holdSend, oneHold } = await loadTs("app/components/postal/send-hold.ts");

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

const draft = (over = {}) => ({ status: "done", kind: "write", html: "<p>Friday at 3 works.</p>", request: "", job: 1, ...over });

/** Timers the test runs by hand. */
function fakeTimers() {
	const queue = new Map();
	let next = 1;
	return {
		set: (fn, ms) => { const id = next++; queue.set(id, { fn, ms }); return id; },
		clear: (id) => queue.delete(id),
		fire: () => { for (const [id, { fn }] of queue) { queue.delete(id); fn(); } },
		queue,
	};
}

// ── The agent's draft and Send ────────────────────────────────────────

test("with nothing written the agent writes; with text written it rewrites", () => {
	assert.equal(draftKind(""), "write");
	assert.equal(draftKind("<p></p>"), "write");
	assert.equal(draftKind("<p>Thanks, Dana.</p>"), "rewrite");
	// A reopened reply's quote is not the writer's text.
	assert.equal(draftKind('<p></p><blockquote type="cite">Earlier</blockquote>'), "write");
});

test("Send uses a finished draft", () => {
	assert.deepEqual(bodyOnSend("", draft()), { html: "<p>Friday at 3 works.</p>", used: true, drop: false });
});

test("a used draft follows what the writer wrote, and the quote stays last", () => {
	assert.equal(takeDraft("<p>Hi Dana,</p>", draft()), "<p>Hi Dana,</p><p>Friday at 3 works.</p>");
	assert.equal(takeDraft("<p>Hi</p><blockquote>Old</blockquote>", draft()), "<p>Hi</p><p>Friday at 3 works.</p><blockquote>Old</blockquote>");
});

test("Send never replaces the writer's text with a pending rewrite", () => {
	const mine = "<p>My own words.</p>";
	assert.deepEqual(bodyOnSend(mine, draft({ kind: "rewrite", html: "<p>Better words.</p>" })), { html: mine, used: false, drop: true });
	// Replace with this is the writer's choice, and only then does a rewrite take their place.
	assert.equal(takeDraft(mine, draft({ kind: "rewrite", html: "<p>Better words.</p>" })), "<p>Better words.</p>");
});

test("Send while the agent writes drops the half-written draft", () => {
	const mine = "<p>Sending this.</p>";
	assert.deepEqual(bodyOnSend(mine, draft({ status: "writing", html: "" })), { html: mine, used: false, drop: true });
	assert.deepEqual(bodyOnSend("", draft({ status: "writing", html: "<p>Half</p>" })), { html: "", used: false, drop: true });
});

test("an empty draft is no draft, and no draft changes nothing", () => {
	assert.deepEqual(bodyOnSend("<p>Mine</p>", draft({ html: "<p> </p>" })), { html: "<p>Mine</p>", used: false, drop: true });
	assert.deepEqual(bodyOnSend("<p>Mine</p>", null), { html: "<p>Mine</p>", used: false, drop: false });
});

test("the composer settles the agent's draft before it sends or schedules, and checks first", () => {
	const win = read("app/components/postal/ComposeWindow.tsx");
	for (const fn of ["const send = async", "const schedule = async"]) {
		const body = win.slice(win.indexOf(fn), win.indexOf("\n\t};\n", win.indexOf(fn)));
		const order = ["precheck();", "settleAgent();", "await saving.current;"].map((s) => body.indexOf(s));
		assert.ok(order.every((i, n) => i > 0 && (n === 0 || i > order[n - 1])), `${fn}: check, then settle the agent, then send`);
	}
	// Stop drops the card and cancels the wait; the agent never sends.
	assert.match(win, /const stopAgent = \(\) => \{\n\t\tjob\.current\+\+;\n\t\tprops\.stopAgent\?\.\(\);\n\t\tsetAgentDraft\(null\);/);
	const agent = read("app/components/postal/Agent.tsx");
	assert.doesNotMatch(agent.slice(agent.indexOf("export function useDraftWithAgent")), /send_draft|sendEmail/);
});

test("the agent's request and tone reach its instructions", () => {
	assert.equal(requestText({}), "");
	assert.equal(requestText({ request: "  Decline   politely ", tone: "formal" }), "What I want: Decline politely. Tone: formal.");
	assert.equal(requestText({ request: "Say yes!" }), "What I want: Say yes!");
	assert.match(requestText({ kind: "rewrite" }), /^Rewrite my text/);
	assert.deepEqual(TONES.map(([id]) => id), ["direct", "friendly", "formal"]);
	for (const list of Object.values(STARTS)) assert.equal(list.length, 3);
});

test("the agent's draft is sanitized before it shows, and the request is plain text", () => {
	const win = read("app/components/postal/ComposeWindow.tsx");
	const card = win.slice(win.indexOf("const draftCard = () =>"), win.indexOf("const sendLabel"));
	assert.match(card, /DOMPurify\.sanitize\(agentDraft\.html/);
	assert.equal((card.match(/dangerouslySetInnerHTML/g) ?? []).length, 1);
	// Agent text becomes escaped paragraphs.
	assert.match(win, /r\.text \? textToParagraphs\(r\.text\)/);
});

// ── Undo send: one held message at a time ─────────────────────────────

test("flush sends a held message now, once", async () => {
	const timers = fakeTimers();
	let sent = 0;
	const hold = holdSend(async () => { sent++; }, 5000, timers);
	assert.equal(hold.flush(), true);
	assert.equal(await hold.done, "sent");
	assert.equal(sent, 1);
	assert.equal(timers.queue.size, 0);
	assert.equal(hold.flush(), false);
	assert.equal(hold.undo(), false);
});

test("a second send settles the first, so Undo means the last send", async () => {
	const timers = fakeTimers();
	const holds = oneHold();
	const sent = [];
	const first = holds.hold(async () => { sent.push("first"); }, 5000, timers);
	const second = holds.hold(async () => { sent.push("second"); }, 5000, timers);
	assert.equal(await first.done, "sent");
	assert.deepEqual(sent, ["first"]);
	assert.equal(holds.isLatest(first), false);
	assert.equal(holds.isLatest(second), true);
	assert.equal(second.undo(), true);
	assert.equal(await second.done, "undone");
	assert.deepEqual(sent, ["first"]);
});

test("opening a composer settles the held send, so Undo can't write over it", async () => {
	const timers = fakeTimers();
	const holds = oneHold();
	let sent = 0;
	const hold = holds.hold(async () => { sent++; }, 5000, timers);
	holds.settle();
	assert.equal(await hold.done, "sent");
	assert.equal(sent, 1);
	assert.equal(hold.undo(), false);
	holds.settle();
	assert.equal(sent, 1);

	const mail = read("app/components/postal/PostalMail.tsx");
	const open = mail.slice(mail.indexOf("const openCompose = "), mail.indexOf("};", mail.indexOf("const openCompose = ")));
	assert.ok(open.indexOf("holds.settle();") > 0 && open.indexOf("holds.settle();") < open.indexOf("setCw("), "settle before the new composer opens");
	assert.match(mail, /const startReply = [^]*?holds\.settle\(\);\n\t\tconst next = composeFor/);
	assert.match(mail, /onUndo: \(\) => \{\n\t\t\t\t\tif \(!holds\.isLatest\(hold\) \|\| !hold\.undo\(\)\) return;/);
});

// ── The dock, the keyboard and the agent key ──────────────────────────

test("the dock follows the visual viewport and Chrome resizes for the keyboard", () => {
	const win = read("app/components/postal/ComposeWindow.tsx");
	assert.match(win, /window\.visualViewport/);
	assert.match(win, /vv\.addEventListener\("resize", update\)/);
	assert.match(read("app/root.tsx"), /interactive-widget=resizes-content/);
	const css = read("app/components/postal/postal.css");
	assert.match(css, /height: var\(--pg-vv-h, 100dvh\)/);
	assert.match(css, /env\(safe-area-inset-bottom, 0px\)/);
});

test("the dock's keys are 44px: the tool well, the agent key and Send", () => {
	const css = read("app/components/postal/postal.css");
	assert.match(css, /\.pg-dock > \.pg-well \.pg-key \{ width: 40px; \}/);
	assert.match(css, /\.pg-well \{ display: inline-flex; flex: none; gap: 2px; padding: 2px;/);
	assert.match(css, /\.pg-key \{[^}]*height: 40px;/);
	assert.match(css, /\.pg-dock \.pg-agent-key \{ width: 58px; height: 44px; \}/);
	assert.match(css, /\.pg-dock-send \{ height: 44px;/);
});

test("the agent key is icon only, named for what it does, and keeps its fill on hover when open or busy", () => {
	const win = read("app/components/postal/ComposeWindow.tsx");
	assert.match(win, /"Draft a reply with the agent" : written \? "Rewrite with the agent" : "Write with the agent"/);
	assert.match(win, /aria-label=\{busy \? "Stop the agent" : label\}/);
	assert.match(win, /aria-pressed=\{busy \? undefined : open\}/);
	assert.doesNotMatch(win, /pg-agent-label/);
	const css = read("app/components/postal/postal.css");
	assert.match(css, /\.pg-agent-key:hover:not\(:disabled, \[aria-pressed="true"\], \[data-busy\]\) \{/);
	assert.match(css, /\.pg-agent-key\[aria-pressed="true"\] \{ background: var\(--pg-green\);/);
	assert.match(css, /\.pg-agent-key\[data-busy\] \{ background: var\(--pg-segment\);/);
});

test("the agent draft icon carries the four motion presets, and reduced motion shows it drawn", () => {
	const icon = read("app/components/postal/AgentIcon.tsx");
	assert.match(icon, /viewBox="0 0 36 24"/);
	assert.match(icon, /"agent-ready" \| "agent-think" \| "agent-write" \| "agent-done"/);
	const css = read("app/components/postal/postal.css");
	for (const anim of ["agent-ready", "agent-think", "agent-write", "agent-done"]) assert.match(css, new RegExp(`\\[data-anim="${anim}"\\]`));
	assert.match(css, /@media \(prefers-reduced-motion: reduce\) \{ \[data-anim="agent-think"\] \.pg-agent-line \{ opacity: 1; \} \}/);
	// Translate and opacity only, plus the lines' draw-on.
	const motion = css.slice(css.indexOf("@keyframes pg-agent-glow"), css.indexOf("/* ── Cards over the foot"));
	assert.doesNotMatch(motion, /\b(scale|rotate|transform):/);
});

test("Signal is on Send only", () => {
	const css = read("app/components/postal/postal.css");
	const uses = css.split("\n").filter((l) => /var\(--pg-signal/.test(l));
	assert.ok(uses.length > 0);
	for (const line of uses) assert.match(line, /^\s*\.pg-dock-send/, line);
});

test("the format keys keep the editor's focus, so the caret stays put", () => {
	const editor = read("app/components/postal/Editor.tsx");
	const card = editor.slice(editor.indexOf("export function FormatCard"));
	assert.match(card, /onPointerDown=\{keep\} onMouseDown=\{keep\}/);
	// The editor is never remounted: no key on it.
	assert.doesNotMatch(read("app/components/postal/ComposeWindow.tsx"), /<Editor\s+key=/);
});
