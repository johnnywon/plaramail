import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

// The frame is sized from body.scrollHeight. Without its own formatting context, the first
// child's top margin and the last child's bottom margin collapse through <body> and are left
// out of that height, so mail that opens with a heading is cut off at the bottom.
test("a message frame keeps its children's margins inside the measured body", () => {
	const source = readFileSync("app/components/EmailIframe.tsx", "utf8");
	const body = source.match(/\nbody \{([\s\S]*?)\n\}/)?.[1] ?? "";
	assert.match(body, /display:\s*flow-root/);
	assert.match(source, /document\.body\.scrollHeight/);
});

// Writing the same srcdoc twice in a row (React's dev double effects) left plain mail blank in Aside.
test("a message frame writes its document only when it changed", () => {
	const source = readFileSync("app/components/EmailIframe.tsx", "utf8");
	assert.match(source, /if \(iframe\.srcdoc !== doc\) iframe\.srcdoc = doc;/);
	assert.doesNotMatch(source, /iframe\.srcdoc = `/);
});

// Quoted history in HTML replies (Gmail, Apple Mail) folds like text-only mail, with no fill behind it.
test("quoted earlier messages fold and have no background", () => {
	const source = readFileSync("app/components/EmailIframe.tsx", "utf8");
	assert.match(source, /const QUOTE = "\.gmail_quote, [^"]*blockquote\[type='cite'\]/);
	assert.match(source, /fold\.className = "pm-quote"/);
	const quoteRules = source.match(/(?:^|\n)\s*(?:\.pm-quote )?blockquote \{[^}]*\}/g) ?? [];
	assert.ok(quoteRules.length > 0);
	for (const rule of quoteRules) assert.doesNotMatch(rule, /background/);
});
