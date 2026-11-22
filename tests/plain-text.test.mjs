import assert from "node:assert/strict";
import { test } from "node:test";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";
import { NODE_REQUIRE } from "./helpers/node-require.mjs";

const bundle = await build({
	entryPoints: ["app/components/plain-text.ts"], bundle: true, platform: "node", banner: NODE_REQUIRE, format: "esm", write: false,
});
const tmp = new URL(`./plain-text.bundle.${process.pid}.mjs`, pathToFileURL(`${process.cwd()}/tests/`));
const { writeFile, rm } = await import("node:fs/promises");
await writeFile(tmp, bundle.outputFiles[0].text);
const { isHtmlBody, linkify, plainTextToHtml } = await import(tmp.href).finally(() => rm(tmp));

test("blank lines make paragraphs, and a run of them counts as one", () => {
	assert.equal(plainTextToHtml("does this come in?\n\n\n\njw\n"), '<div class="pm-plain"><p>does this come in?</p><p>jw</p></div>');
	assert.equal(plainTextToHtml("Best Regards,\r\nDevansh"), '<div class="pm-plain"><p>Best Regards,<br>Devansh</p></div>');
});

test("text is escaped", () => {
	assert.match(plainTextToHtml("a <b> & c"), /a &lt;b&gt; &amp; c/);
});

test("bare URLs and addresses become links, trailing punctuation stays out", () => {
	assert.equal(linkify("see https://example.com/a."), 'see <a href="https://example.com/a">https://example.com/a</a>.');
	assert.equal(linkify("(www.example.org)"), '(<a href="https://www.example.org">www.example.org</a>)');
	assert.equal(linkify("mail jane@example.net,"), 'mail <a href="mailto:jane@example.net">jane@example.net</a>,');
	assert.equal(linkify("https://en.example.com/wiki/A_(b)"), '<a href="https://en.example.com/wiki/A_(b)">https://en.example.com/wiki/A_(b)</a>');
	assert.equal(linkify('x "><script>'), "x &quot;&gt;&lt;script&gt;");
});

test("the signature after a '-- ' line is set apart", () => {
	const html = plainTextToHtml("Thanks\n\n-- \nJane\nexample.com");
	assert.equal(html, '<div class="pm-plain"><p>Thanks</p><div class="pm-sig"><p>Jane<br>example.com</p></div></div>');
	assert.doesNotMatch(plainTextToHtml("a -- b"), /pm-sig/);
});

test("quoted replies fold behind a toggle with their attribution", () => {
	const html = plainTextToHtml("Sounds good.\n\nOn Mon, Oct 12, 2026 at 9:00 AM Jane <jane@example.com> wrote:\n> Lunch?\n>\n> J");
	assert.match(html, /^<div class="pm-plain"><p>Sounds good\.<\/p><details class="pm-quote"><summary[^>]*>···<\/summary><div class="pm-attr">On Mon/);
	assert.match(html, /<blockquote><p>Lunch\?<\/p><p>J<\/p><\/blockquote><\/details><\/div>$/);
});

test("a signature above a quoted reply keeps the quote out of it", () => {
	const html = plainTextToHtml("Yes\n-- \nJ\n\nOn Tue, Jane wrote:\n> Lunch?");
	assert.match(html, /<div class="pm-sig"><p>J<\/p><\/div><details class="pm-quote">/);
});

test("an address in angle brackets is text, real tags are HTML", () => {
	assert.equal(isHtmlBody("On Mon Jane <jane@example.com> wrote:"), false);
	assert.equal(isHtmlBody("x < y and y > z"), false);
	assert.equal(isHtmlBody("<p>Hi</p>"), true);
	assert.equal(isHtmlBody('<div dir="ltr">Hi<br></div>'), true);
});
