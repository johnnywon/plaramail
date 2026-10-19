import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";

async function load(entry, options = {}) {
	const bundle = await build({
		entryPoints: [entry],
		bundle: true,
		platform: "node",
		format: "esm",
		write: false,
		tsconfig: "tsconfig.cloudflare.json",
		...options,
	});
	return import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`);
}

const { parseAddressList, getReplyToAddresses, getReplyAddresses, extractReplyQuote } = await load("app/lib/reply.ts");

// The postal composer's hooks, API client and sanitizer are stubbed; only composeFor runs.
const stubs = {
	"@tanstack/react-query": "export const useQueries = () => []; export const useQueryClient = () => ({});",
	react: "export const useCallback = (f) => f; export const useMemo = (f) => f();",
	dompurify: "export default { sanitize: (html) => html };",
	"~/services/api": "export default {};",
	"~/queries/keys": "export const queryKeys = {};",
	"./identity": "export const handleOf = (a) => a;",
};
const { composeFor, sendFiles } = await load("app/components/postal/compose.ts", {
	jsx: "automatic",
	plugins: [
		{
			name: "stub-ui",
			setup(b) {
				b.onResolve({ filter: /^(@tanstack\/react-query|react|dompurify|~\/services\/api|~\/queries\/keys|\.\/identity)$/ }, (args) => ({
					path: args.path,
					namespace: "stub",
				}));
				b.onLoad({ filter: /.*/, namespace: "stub" }, (args) => ({ contents: stubs[args.path], loader: "js" }));
			},
		},
	],
});
const addrs = (list) => list.map((r) => r.addr).join(", ");

const postalHeaders = (value) =>
	JSON.stringify([
		{ key: "from", originalKey: "From", value: "Example.org <news@updates.example.org>" },
		{ key: "reply-to", originalKey: "Reply-To", value },
	]);

test("parses address lists with names, quoted commas and duplicates", () => {
	assert.deepEqual(parseAddressList("Alex Reader <alex@example.com>"), ["alex@example.com"]);
	assert.deepEqual(parseAddressList('"Reader, Alex" <alex@example.com>, b@example.org'), ["alex@example.com", "b@example.org"]);
	assert.deepEqual(parseAddressList("a@example.com, A@Example.com"), ["a@example.com"]);
	assert.deepEqual(parseAddressList("not an address, <broken@>"), []);
});

test("reads Reply-To from stored headers in array or object form", () => {
	assert.deepEqual(getReplyToAddresses(postalHeaders("Alex <alex@example.com>")), ["alex@example.com"]);
	assert.deepEqual(getReplyToAddresses(JSON.stringify({ "Reply-To": "alex@example.com" })), ["alex@example.com"]);
	assert.deepEqual(getReplyToAddresses(JSON.stringify([{ name: "REPLY-TO", value: "a@example.com, b@example.com" }])), ["a@example.com", "b@example.com"]);
	assert.deepEqual(getReplyToAddresses(null), []);
	assert.deepEqual(getReplyToAddresses("not json"), []);
	assert.deepEqual(getReplyToAddresses(JSON.stringify([{ key: "from", value: "a@example.com" }])), []);
});

test("replies go to Reply-To when present and to the sender otherwise", () => {
	assert.deepEqual(getReplyAddresses({ sender: "news@updates.example.org", raw_headers: postalHeaders("alex@example.com") }), ["alex@example.com"]);
	assert.deepEqual(getReplyAddresses({ sender: "news@updates.example.org", raw_headers: null }), ["news@updates.example.org"]);
});

test("extracts the marked quote with line breaks and decoded entities", () => {
	const html = '<table><tr><td>Sender</td><td data-reply-quote="message" style="x">How do I filter?<br>Line two &amp; &lt;b&gt;more&lt;/b&gt;<br><br>Thanks</td></tr></table>';
	assert.equal(extractReplyQuote(html), "How do I filter?\nLine two & <b>more</b>\n\nThanks");
	assert.equal(extractReplyQuote("<p>No marker</p>"), null);
	assert.equal(extractReplyQuote(null), null);
	assert.equal(extractReplyQuote("<td data-reply-quote></td>"), null);
	// A visitor's text cannot add a marker: it arrives escaped.
	assert.equal(extractReplyQuote("<td>&lt;td data-reply-quote&gt;fake&lt;/td&gt;</td>"), null);
	// Each entity is decoded once.
	assert.equal(extractReplyQuote("<td data-reply-quote>&amp;lt;</td>"), "&lt;");
});

const inquiry = {
	id: "m1",
	sender: "news@updates.example.org",
	recipient: "hello@example.org",
	subject: "Example.org inquiry: Media",
	date: "2026-10-08T14:26:51.000Z",
	raw_headers: postalHeaders("Alex Reader <alex@example.com>"),
	body: '<div>Media</div><table><tr><td data-reply-quote="message">How do I filter?<br>Line two &amp; more</td></tr></table><table><tr><td>Reference CONTACT-1 Ray ID abc</td></tr></table>',
};

test("Reply on an inquiry addresses the visitor and quotes only their message", () => {
	const state = composeFor("reply", inquiry, "hello@example.org", "hello@example.org");
	assert.equal(addrs(state.to), "alex@example.com");
	assert.equal(state.subject, "Re: Example.org inquiry: Media");
	assert.match(state.quoteBody, /How do I filter\?<br>Line two &amp; more/);
	assert.doesNotMatch(state.quoteBody, /CONTACT-1|Ray ID|news@updates/);
});

test("Reply All on an inquiry leaves out the mailbox itself", () => {
	const state = composeFor("reply-all", inquiry, "hello@example.org", "hello@example.org");
	assert.equal(addrs(state.to), "alex@example.com");
	assert.equal(addrs(state.cc), "");
});

test("Reply without Reply-To or a marker behaves as before", () => {
	const plain = { ...inquiry, raw_headers: null, sender: "sam@example.net", body: "<p>Hello there</p>" };
	const state = composeFor("reply", plain, "hello@example.org", "hello@example.org");
	assert.equal(addrs(state.to), "sam@example.net");
	assert.match(state.quoteHead, /sam@example\.net wrote:/);
	assert.match(state.quoteBody, /Hello there/);
});

test("Reply with Reply-To but no marker still quotes the whole message, attributed to the sender", () => {
	const unmarked = { ...inquiry, body: "<p>Name: Alex Topic: Media</p>" };
	const state = composeFor("reply", unmarked, "hello@example.org", "hello@example.org");
	assert.equal(addrs(state.to), "alex@example.com");
	assert.match(state.quoteHead, /news@updates\.example\.org wrote:/);
	assert.match(state.quoteBody, /Name: Alex Topic: Media/);
});

const withFiles = {
	...inquiry,
	attachments: [
		{ id: "att1", filename: "qa-notes.txt", mimetype: "text/plain", size: 36, disposition: "attachment" },
		{ id: "att2", filename: "logo.png", mimetype: "image/png", size: 900, disposition: "inline", content_id: "logo" },
	],
};

test("Forward carries the original's attachments as files the writer can remove (#32)", () => {
	const state = composeFor("forward", withFiles, "hello@example.org", "hello@example.org");
	assert.deepEqual(state.files, [{ name: "qa-notes.txt", size: 36, type: "text/plain", content: "", attachmentId: "att1" }]);
	assert.deepEqual(composeFor("reply", withFiles, "hello@example.org", "hello@example.org").files, []);
});

test("the original's files go by id, new files by content (#32)", () => {
	const kept = { name: "qa-notes.txt", size: 36, type: "text/plain", content: "", attachmentId: "att1" };
	const added = { name: "new.txt", size: 3, type: "", content: "YWJj" };
	assert.deepEqual(sendFiles([kept, added]), {
		attachments: [{ content: "YWJj", filename: "new.txt", type: "application/octet-stream", disposition: "attachment" }],
		forward_attachments: ["att1"],
	});
	assert.deepEqual(sendFiles([]), { attachments: undefined, forward_attachments: undefined });
});
