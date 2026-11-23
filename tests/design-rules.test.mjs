// Enforces the "No accent stripes or edge bars" rule in DESIGN.md.
//
// Every text file under app/, workers/, shared/, public/ and any other top-level folder is analysed (not
// node_modules, build output, docs/ or tests/), plus root-level CSS, HTML and *.config.* files. Only the
// supplied artwork in public/brand is exempt. The rules live in tests/stripe-rules.mjs; this file collects
// the files, holds the fixtures that pin the rules down, and asserts that the real tree is clean.
//
// What a static text test cannot see, and is accepted:
//   - clip-path or mask tricks that cut a full-size element or full-perimeter ring down to one edge
//   - a single-axis shadow with a 1px blur in a neutral colour (the real bevel `inset 0 2px 1px #fff` is legal)
//   - SVG and data-URI artwork, including inline <svg><rect> bars
//   - widths that only exist at runtime: `${w}px`, w-[var(--x)], or a var() with no definition or fallback
//   - class fragments or border strings assembled across statements or files, or property names built at runtime
//   - CSS escapes in property names (`\62 order-left`)
//   - a custom property that holds a border shorthand and is never used in a one-sided border declaration
//   - a coloured bar that lies flat with no anchor and no width (`h-1 bg-kumo-brand`): it looks like a progress fill
//
// Add an entry to ALLOWLIST only for a deliberate exception, and say why in the commit.

import assert from "node:assert/strict";
import {
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	realpathSync,
	rmSync,
	statSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { extname, join, relative } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { analyse, buildContext, isChromatic, RULES } from "./stripe-rules.mjs";

// ---------------------------------------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------------------------------------

const ROOT = fileURLToPath(new URL("..", import.meta.url));
// These must exist. Any other top-level folder is scanned too, so a stripe cannot hide in a new one.
const REQUIRED_ROOTS = ["app", "workers", "shared", "public"];
// Top-level folders that are not source: dependencies, build output, notes and this suite's own fixtures.
const SKIP_ROOTS = new Set(["node_modules", "build", "dist", "coverage", "docs", "tests"]);
// Folders and files skipped, compared against the path from the repo root so app/build or app/brand are still scanned.
const SKIP_PATHS = new Set([...SKIP_ROOTS, ".react-router", ".wrangler"]);
// Brand artwork may carry stripes by design (DESIGN.md). Code in the same folder is still scanned.
const ARTWORK_DIR = "public/brand/";
const ARTWORK_EXTENSIONS = new Set(".svg .png .jpg .jpeg .webp .gif .ico .txt .md".split(" "));
const ROOT_FILE = /^(?:[\w.-]+\.config\.[cm]?[jt]s|[\w.-]+\.(?:css|html?))$/;
const BINARY_EXTENSIONS = new Set(
	".png .jpg .jpeg .gif .webp .avif .ico .icns .bmp .tiff .woff .woff2 .ttf .otf .eot .map .mp3 .mp4 .webm .mov .wav .ogg .pdf .zip .gz .br .wasm .bin .db .sqlite .tsbuildinfo".split(" "),
);
// Files with these extensions are always read as text; others are skipped when their start holds a NUL byte.
const TEXT_EXTENSIONS = new Set(".css .scss .sass .less .html .htm .js .jsx .mjs .cjs .ts .tsx .mts .cts .json .jsonc .md .mdx .svg .vue .svelte .astro .txt".split(" "));
// A larger file is reported instead of skipped; add it to SKIP_PATHS if it is data.
const MAX_BYTES = 5_000_000;

// Entries are "<path>:<rule>". Keep empty; a stale entry fails the suite.
const ALLOWLIST = [];

// ---------------------------------------------------------------------------------------------------------
// File collection
// ---------------------------------------------------------------------------------------------------------

const toPosix = (path) => path.split("\\").join("/");

// Walks the required folders plus any other top-level folder, following symlinks once (visited set of real
// paths). A dangling link, an unreadable entry or an oversized file is returned in `problems`, so the suite fails
// with a name instead of crashing or silently skipping it.
function collectFiles(root, requiredRoots = REQUIRED_ROOTS) {
	const files = [];
	const problems = [];
	const visited = new Set();

	const addFile = (abs, stat) => {
		const rel = toPosix(relative(root, abs));
		const ext = extname(abs).toLowerCase();
		if (BINARY_EXTENSIONS.has(ext) || SKIP_PATHS.has(rel) || (rel.startsWith(ARTWORK_DIR) && ARTWORK_EXTENSIONS.has(ext))) return;
		if (stat.size > MAX_BYTES) {
			problems.push(`${rel}: ${stat.size} bytes is too large to scan (add it to SKIP_PATHS if it is data)`);
			return;
		}
		let buffer;
		try {
			buffer = readFileSync(abs);
		} catch (error) {
			problems.push(`${rel}: unreadable (${error.code})`);
			return;
		}
		if (!TEXT_EXTENSIONS.has(ext) && buffer.subarray(0, 8000).includes(0)) return;
		const utf16 = buffer[0] === 0xff && buffer[1] === 0xfe;
		files.push({ path: rel, text: buffer.toString(utf16 ? "utf16le" : "utf8") });
	};

	const walk = (abs) => {
		const rel = toPosix(relative(root, abs));
		if (SKIP_PATHS.has(rel)) return;
		let real;
		let entries;
		try {
			real = realpathSync(abs);
			entries = readdirSync(abs, { withFileTypes: true });
		} catch (error) {
			problems.push(`${rel}: ${error.code === "ENOENT" ? "missing or dangling link" : `unreadable (${error.code})`}`);
			return;
		}
		if (visited.has(real)) return;
		visited.add(real);
		for (const entry of entries) {
			const child = join(abs, entry.name);
			let stat;
			try {
				stat = statSync(child);
			} catch {
				problems.push(`${toPosix(relative(root, child))}: dangling link`);
				continue;
			}
			if (stat.isDirectory()) walk(child);
			else if (stat.isFile()) addFile(child, stat);
		}
	};

	const roots = new Set(requiredRoots);
	for (const entry of readdirSync(root, { withFileTypes: true })) {
		if (entry.name.startsWith(".") || SKIP_ROOTS.has(entry.name)) continue;
		try {
			const stat = statSync(join(root, entry.name));
			if (stat.isDirectory()) roots.add(entry.name);
			else if (stat.isFile() && ROOT_FILE.test(entry.name)) addFile(join(root, entry.name), stat);
		} catch {
			problems.push(`${entry.name}: dangling link`);
		}
	}
	for (const name of roots) walk(join(root, name));
	return { files, problems };
}

function sourceLine(text, index) {
	const start = text.lastIndexOf("\n", index - 1) + 1;
	const end = text.indexOf("\n", index);
	return text.slice(start, end === -1 ? undefined : end).trim().slice(0, 120);
}


// ---------------------------------------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------------------------------------

const { files, problems } = collectFiles(ROOT);
const context = buildContext(files);
const unreadable = [];
const results = files.map((file) => {
	try {
		return { ...file, hits: analyse(file.path, file.text, context) };
	} catch (error) {
		unreadable.push(error.message);
		return { ...file, hits: [] };
	}
});

const allowed = (path, rule) => ALLOWLIST.includes(`${path}:${rule}`);
const describe = (file, hit) => `${file.path}:${hit.line} [${hit.rule}] ${sourceLine(file.text, hit.index)}`;

function explain(failures, rules) {
	const why = [...new Set(rules)].map((rule) => `${rule}: ${RULES[rule]}`);
	return [
		'DESIGN.md, "No accent stripes or edge bars". Show selected, active and unread state with fill, weight, a full ring, an icon or a glyph instead.',
		`  ${failures.join("\n  ")}`,
		"Rules hit:",
		`  ${why.join("\n  ")}`,
		"A deliberate exception goes in ALLOWLIST as <path>:<rule>.",
	].join("\n");
}

test("the scan reaches the app, worker, shared and public sources and nothing dangles", () => {
	assert.deepEqual(problems, [], `Dangling links or unreadable entries stop the scan from being complete:\n  ${problems.join("\n  ")}`);
	assert.deepEqual(unreadable, [], "A file that cannot be analysed is not checked");
	const paths = files.map((file) => file.path);
	assert.ok(paths.includes("app/index.css"));
	assert.ok(paths.some((path) => path.startsWith("app/components/") && path.endsWith(".tsx")));
	assert.ok(paths.some((path) => path.startsWith("app/routes/") && path.endsWith(".tsx")));
	assert.ok(paths.some((path) => path.startsWith("workers/") && path.endsWith(".ts")));
	assert.ok(paths.some((path) => path.startsWith("shared/")));
	assert.ok(paths.includes("public/site.webmanifest"), "public/ is scanned");
	assert.ok(!paths.some((path) => path.startsWith("public/brand/") && path.endsWith(".svg")), "the brand artwork is exempt");
	assert.ok(!paths.some((path) => path.startsWith("node_modules/")));
});

test("the file walk skips only what it should, follows links once and names broken ones", () => {
	const dir = mkdtempSync(join(tmpdir(), "design-rules-"));
	try {
		const put = (rel, text = ".a{}") => {
			mkdirSync(join(dir, rel, ".."), { recursive: true });
			writeFileSync(join(dir, rel), text);
		};
		put("app/a.css");
		put("app/notes.unknown");
		put("app/Makefile");
		put("app/build/inner.css");
		put("app/brand/inner.css");
		put("app/node_modules/dep.css");
		put("app/image.png", "\0binary");
		put("app/blob.dat", "ab\0cd");
		put("app/UPPER.CSS");
		put("outside/linked.css");
		put("public/brand/art.svg");
		put("public/brand/rogue.css");
		put("app/nul.css", "\0.a{}");
		writeFileSync(join(dir, "app/utf16.css"), Buffer.from("\ufeff.a{}", "utf16le"));
		writeFileSync(join(dir, "app/huge.css"), "a".repeat(MAX_BYTES + 1));
		put("public/site.css");
		put("build/skipped.css");
		put("node_modules/skipped.css");
		put("tailwind.config.ts");
		put("root.css");
		put("vite.config.ts");
		put("README.md");
		put("other/scanned.css");
		put("docs/skipped.css");
		put("tests/skipped.css");
		put(".hidden/skipped.css");
		mkdirSync(join(dir, "workers"));
		mkdirSync(join(dir, "shared"));
		symlinkSync(join(dir, "outside"), join(dir, "app/linked"), "dir");
		symlinkSync(join(dir, "app"), join(dir, "app/loop"), "dir");
		symlinkSync(join(dir, "outside/linked.css"), join(dir, "app/file-link.css"));
		symlinkSync(join(dir, "nowhere"), join(dir, "app/dangling.css"));
		const { files: found, problems: broken } = collectFiles(dir);
		const paths = found.map((file) => file.path).sort();
		assert.deepEqual(
			paths,
			[
				"app/UPPER.CSS",
				"app/a.css",
				"app/brand/inner.css",
				"app/build/inner.css",
				"app/file-link.css",
				"app/linked/linked.css",
				"app/Makefile",
				"app/node_modules/dep.css",
				"app/notes.unknown",
				"app/nul.css",
				"app/utf16.css",
				"other/scanned.css",
				"public/brand/rogue.css",
				"public/site.css",
				"root.css",
				"tailwind.config.ts",
				"vite.config.ts",
			].sort(),
		);
		assert.deepEqual(broken, ["app/dangling.css: dangling link", `app/huge.css: ${MAX_BYTES + 1} bytes is too large to scan (add it to SKIP_PATHS if it is data)`]);
		assert.match(found.find((file) => file.path === "app/utf16.css").text, /\.a\{\}/);
		assert.deepEqual(collectFiles(dir, ["app", "gone"]).problems.filter((p) => p.startsWith("gone")), ["gone: missing or dangling link"]);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

// ----- fixtures ---------------------------------------------------------------------------------------------

// Stand-ins for the project's custom properties; a snippet's own definitions are added on top.
const TOKENS = { text: ":root{--accent:#d2e5dd;--airmail-blue:#365a8a;--airmail-red:#b94d45;--rule:#c1c1c1;--bar-w:3px;--sel:#2563eb}" };
const FIXTURE_CONTEXT = buildContext([TOKENS]);
const run = (ext, code) => analyse(`fixture.${ext}`, code, buildContext([TOKENS, { text: code }]));
const css = (code) => ["css", code];
const tsx = (code) => ["tsx", code];
const ts_ = (code) => ["ts", code];
const html = (code) => ["html", code];
const json = (code) => ["json", code];
const scss = (code) => ["scss", code];

// Per technique: `bad` maps a rule to snippets it must flag, `good` lists near-misses that nothing may flag.
// Spellings that slipped past earlier versions of the test sit beside the canonical one.
const FIXTURES = [
	{
		technique: "one-sided borders",
		bad: {
			border_side_wide: [
				css(".a{border-left:3px solid red}"),
				css(".row[aria-selected='true']{border-left: solid 3px #2563eb}"),
				css(".a{border-left: #2563eb 3px solid}"),
				css(".a{border-left: solid #2563eb 3px}"),
				css(".a{border-left:0.25rem solid #2563eb}"),
				css(".a{border-left:0.2em solid blue}"),
				css(".a{border-left: var(--bar-w, 3px) solid #2563eb}"),
				css(".a{border-left: var(--bar-w) solid #2563eb}"),
				css(".a{border-left-width: 0.25rem; border-left-style: solid}"),
				css(".a{border-inline: 3px solid #2563eb}"),
				css(".a{border-inline-start: 0.25rem solid #2563eb}"),
				css(".a{border-top: 0.25rem solid #2563eb}"),
				css(".a{border-block-end: 0.25rem solid #2563eb}"),
				css(".a{border-left: calc(2px + 1px) solid #2563eb}"),
				css(".a{border-left: medium solid #ddd}"),
				css(".a{border-left: thick solid #ddd}"),
				css(".a{border-left: solid #ddd}"),
				css(".a{border-left: 2px solid #ddd}"),
				css(".a{BORDER-LEFT : 3PX SOLID RED; }"),
				css(".a{\n  border-left:\n    3px solid #2563eb;\n}"),
				css("@media (max-width:1px){.a{border-left: 4px solid #365a8a}}"),
				css(".a{border-left: 3px solid #2563eb !important}"),
				css(".card{border-bottom: 2px solid #53616b}"),
				css(":root{--bar: 3px solid #2563eb}.row{border-left: var(--bar)}"),
				tsx('export const s = { borderLeft: "3px solid #2563eb" };'),
				tsx('export const s = (on: boolean) => ({ borderLeft: on ? "3px solid #2563eb" : "3px solid transparent" });'),
				tsx('export const s = (on: boolean) => ({ borderLeft: on && "3px solid #2563eb" });'),
				tsx('export const s = { borderLeftStyle: "solid", borderLeftWidth: "0.25rem", borderLeftColor: "#2563eb" };'),
				tsx("export const s = { borderLeftWidth: 4, borderLeftStyle: 'solid' };"),
				tsx('export const s = { borderLeft: "0.25rem solid #2563eb" };'),
				tsx('export const s = { "border-left": "3px solid #2563eb" };'),
				tsx('export const s = { borderLeft: "solid 3px #2563eb" };'),
				tsx("export const s = (w: number) => ({ borderLeft: `${w}px solid #2563eb` });"),
				tsx('const BAR = "3px solid #2563eb";\nexport const s = { borderLeft: BAR };'),
				tsx('export function mark(el: HTMLElement) { el.style.borderLeft = "3px solid #2563eb"; }'),
				tsx('export function mark(el: HTMLElement) { el.style.setProperty("border-left", "3px solid #2563eb"); }'),
				tsx('export function mark(el: HTMLElement) { el.style["border-left"] = "3px solid #2563eb"; }'),
				tsx('export const css = `.row.is-selected { border-left: 0.1875rem solid var(--airmail-blue); }`;'),
				tsx('export const s = { borderBottom: "0.125rem solid #2563eb" };'),
				tsx('const sheet = { "& .row": { borderLeft: "4px solid var(--accent)" } };'),
				css(".a{border-left: 1mm solid red}"),
				css(".a{border-left: 0.5ch solid #ddd}"),
				css("@container (min-width: 400px){.row{border-left: 3px solid red}}"),
				css(".row{&.selected{border-left: 3px solid var(--primary)}}"),
				css(".a{border-left: /* accent */ 3px solid red}"),
				css(".a{border-inline-start-width: 3px; border-inline-start-style: solid}"),
				tsx("const borderLeft = '3px solid red';\nexport const s = { borderLeft };"),
				tsx("export const s = { borderLeft: 4, borderLeftColor: 'red', borderLeftStyle: 'solid' };"),
				tsx("export const Row = styled.li`border-left: 3px solid ${(p: any) => p.color};`;"),
				tsx('export const A = () => <Box sx={{ borderLeft: 4, borderColor: "primary.main" }} />;'),
				ts_("export const html = (b: string) => `<div style=\"border-left:3px solid #2563eb;padding-left:8px\">${b}</div>`;"),
				html('<div style="border-left:4px solid #ccc">x</div>'),
			html('<td style="padding:8px;border-left:4px solid {{brandColor}}">x</td>'),
			css(".border-card:hover{border-left: 3px solid red}"),
			html('<p>a glob like src/** or /* in prose</p><div style="border-left:4px solid #ccc">x</div>'),
				json('{ "row": { "borderLeft": "3px solid red" } }'),
				scss(".row {\n  &.active { border-left: 3px solid red; } // accent\n}"),
			],
			border_side_colored: [
				css(".a{border-left:1px solid var(--airmail-blue)}"),
				css(".a{border-left:1px solid #365a8a}"),
				css(".a{border-top:1px solid #b94d45}"),
				css(".a{border-left: 1px solid #2563EB80}"),
				css(".a{border-left:   1px   solid   #2563EB80; }"),
				css(".a{border-left: 1px solid #25eb}"),
				css(".a{border-left: 1px solid #d2e5dd}"),
				css(".a{border-left: 1px solid blue}"),
				css(".a{border-left: 1px dashed #2563eb}"),
				css(".a{border-left: 1.5px solid #2563eb}"),
				css(".a{border-left: solid 1px #2563eb}"),
				css(".a{border-left: 1px solid rgb(37 99 235)}"),
				css(".a{border-left: 1px solid rgba(37, 99, 235, .5)}"),
				css(".a{border-bottom: 1px solid rgb(37, 99, 235)}"),
				css(".a{border-left: 1px solid hsl(221 83% 53%)}"),
				css(".a{border-left: 1px solid oklch(0.55 0.2 260)}"),
				css(".a{border-left: 1px solid var(--color-brand)}"),
				css(".a{border-left: 1px solid color-mix(in srgb, blue 50%, transparent)}"),
				css(".a{border-left: 1px solid var(--unknown-token)}"),
				css(".a{border-bottom: solid 1px #2563eb}"),
				css(".row{border-left: 1px solid transparent}.row[aria-selected='true']{border-left-color: #2563eb}"),
				css(".tab{border-bottom: 1px solid transparent}.tab[aria-selected='true']{border-bottom-color: var(--airmail-blue)}"),
				css(".a{border-left-color: var(--sel)}"),
				css("@media (max-width: 1000px){.row[aria-selected='true']{border-left: 1px solid #365a8a}}"),
				css(".a{border-left: 1px solid #2563eb; }"),
				tsx('export const s = { borderLeft: "1px solid #365a8a" };'),
				tsx('export const s = { borderLeft: "1px solid var(--airmail-blue)" };'),
				tsx('export const s = { borderLeft: "1px solid dodgerblue" };'),
				tsx("export const s = (c: string) => ({ borderLeft: `1px solid ${c}` });"),
				tsx('export const s = { borderLeftWidth: 1, borderLeftStyle: "solid", borderLeftColor: "var(--airmail-blue)" };'),
				tsx('export const s = (sel: boolean) => ({ borderBottom: sel ? "1px solid var(--accent)" : "1px solid transparent" });'),
				tsx('export function mark(el: HTMLElement) { el.style.borderTop = "1px solid #2563eb"; }'),
				css(".row{border:3px solid transparent;border-left-color:var(--airmail-blue)}"),
				css(".a{border:1px solid #ddd;border-left-color:var(--airmail-blue)}"),
				css(".a{border-left: 1px solid AccentColor}"),
			html('<td style="border-left: 1px solid {{ color }}">x</td>'),
			tsx('export const s = (w: number, c: string) => ({ borderLeft: [w, "solid", c].join(" ") });'),
			],
			border_width_split: [
				css(".a{border-style: solid; border-color: #2563eb; border-width: 0 0 0 3px}"),
				css(".a{border-width: 0 0 2px}"),
				css(".a{border-width: 1px 1px 1px 4px}"),
				css(".a{border-inline-width: 0 0.25rem}"),
				css(".a{border-width: 0 0 0 thick}"),
			],
			border_color_split: [
				css(".a{border-color: transparent transparent transparent #2563eb}"),
				css(".a{border-color: #ddd #ddd #ddd var(--airmail-blue)}"),
				css(".a{border-color: transparent transparent #365a8a}"),
			],
			border_image: [
				css(".a{border-image: linear-gradient(red, blue) 1}"),
				css(".a{border-image-source: linear-gradient(to bottom, #365a8a, #365a8a); border-image-slice: 1}"),
				tsx('export const s = { borderImage: "linear-gradient(#2563eb, #2563eb) 1" };'),
			],
			underline_bar: [
				css(".link-active{text-decoration: underline 3px var(--airmail-blue)}"),
				css(".link-active{text-decoration: underline #2563eb 0.25rem}"),
				tsx('export const c = "underline decoration-2 decoration-blue-500";'),
				css(".a{text-decoration: underline; text-decoration-color: var(--airmail-blue); text-decoration-thickness: 3px}"),
			],
		},
		good: [
			css(".a{border-bottom:1px solid #c1c1c1}"),
			css(".a{border-left:1px solid #647077}"),
			css(".a{border-top:1px solid #fff}"),
			css(".a{border-left:1px solid rgba(0,0,0,0.12)}"),
			css(".a{border-left:1px solid var(--rule)}"),
			css(".a{border-left:1px solid var(--button-edge)}"),
			css(".a{border-left:1px solid gray}"),
			css(".a{border-left:1px solid transparent}"),
			css(".a{border-left:1px solid currentColor}"),
			css(".a{border-left:1px solid hsl(210 8% 40%)}"),
			css(".a{border-left:1px solid oklch(0.6 0.01 250)}"),
			css(".a{border-left:1px solid color-mix(in srgb, #888 50%, transparent)}"),
			css(".a{border-left: 1.5px solid #ddd}"),
			css(".a{border-bottom:1px solid #53616b}"),
			css("hr{border:0;border-top:1px solid #c1c1c1;margin:8px 0}"),
			css("th{border-bottom:1px solid #53616b;text-align:left}td{border-bottom:1px solid #dce3e7}"),
			css(".a{border:1px solid #ddd;padding:.75em 1em;background-color:#f9f9f9}"),
			css(".a{border:2px solid #365a8a}"),
			css(".a{border-width:2px}"),
			css(".a{border-width:1px 0}"),
			css(".a{border-width:0 0 1px}"),
			css(".a{border-width:2px 4px}"),
			css(".a{border-color:#4c565c}"),
			css(".a{border-color:#ddd #ccc}"),
			css(".a{border:1px solid #365a8a}"),
			css(".a{border-left:0;border-right:none;border-top:0px;border-bottom:medium none}"),
			css(".a{border-left:0 solid #2563eb}"),
			css(".a{border-image:none}"),
			css(".a{border-image:initial;border-image-source:none}"),
			tsx('export const FEATURES = { "border-image": require("./features/border-image") };'),
			css(":root{--border-top-width:4px;--bar:3px solid #2563eb}"),
			css(".a{border-top-left-radius:8px;border-bottom-right-radius:2px}"),
			css(".a{border-left-style:solid}"),
			css(".a{outline:3px solid #365a8a;outline-offset:2px}"),
			css(".a{text-decoration:underline 1px var(--airmail-blue)}"),
			css(".a{text-decoration:underline}"),
			tsx('export const s = { borderLeft: "1px solid #ccc", borderTop: "1px solid rgba(0,0,0,.1)" };'),
			tsx('export const s = { border: 0, borderTop: "1px solid #c1c1c1" };'),
			tsx("export const s = { borderTopWidth: 0, borderLeftWidth: 1, borderRadius: 4 };"),
			tsx('export const s = { borderRight: "1px solid #c1c1c1", borderBottom: "1px solid #dce3e7", marginLeft: 2 };'),
			tsx('export const s = { outline: "2px solid #365a8a", outlineOffset: 2 };'),
			tsx('export const s = (c: string) => ({ borderLeft: c });'),
			tsx('export const s = { border: "1px solid #365a8a" };'),
			tsx('export const A = () => <hr style={{ border: 0, borderTop: "1px solid #c1c1c1" }} />;'),
			tsx('export const A = () => <iframe className="block w-full border-0" style={{ height: "100%" }} />;'),
			// triangles, arrows and spinners are built from one-sided borders on purpose
			css(".caret{width:0;height:0;border-left:5px solid transparent;border-right:5px solid transparent;border-top:5px solid #252a2e}"),
			css(".tip::after{content:'';position:absolute;top:100%;left:50%;border:5px solid transparent;border-top-color:var(--airmail-blue)}"),
			css(".spinner{width:16px;height:16px;border:2px solid #ddd;border-top-color:var(--airmail-blue);border-radius:50%;animation:spin 1s linear infinite}"),
			tsx('export const s = { width: 0, height: 0, borderLeft: "5px solid transparent", borderRight: "5px solid transparent", borderTop: "5px solid #252a2e" };'),
			// the same border on all four sides is a box, and data keyed by property names is not a style
			tsx("export const s = { borderTopColor: c, borderRightColor: c, borderBottomColor: c, borderLeftColor: c };"),
			css(".a{border-top:2px solid #365a8a;border-right:2px solid #365a8a;border-bottom:2px solid #365a8a;border-left:2px solid #365a8a}"),
			tsx('export const LONGHANDS = { "border-block-color": ["border-bottom-color", "border-top-color"], "border-left": ["border-left-color"] };'),
			// a runtime colour is judged by the name it comes from
			tsx("export const s = (p: any) => ({ borderBottom: `1px solid ${p.theme.line}` });"),
			tsx("export const Row = styled.li`border-bottom: 1px solid ${(p: any) => p.theme.line};`;"),
			css(".a{text-decoration-color:var(--airmail-blue);text-decoration-thickness:1px}"),
			css(".a{text-decoration-color:var(--airmail-blue)}"),
			html('<div style="border-bottom:1px solid #ddd">x</div>'),
			html('<td style="border-bottom: 1px solid {{ theme.line }}">x</td>'),
			css(".border-card:hover{background:#eee}.background-dark:hover{color:#fff}"),
			json('{ "row": { "borderBottom": "1px solid #ddd" } }'),
		],
	},
	{
		technique: "shadows",
		bad: {
			shadow_bar: [
				css(".a{box-shadow: inset 3px 0 #365a8a}"),
				css(".a{box-shadow: inset 3px 0 var(--airmail-blue)}"),
				css(".a{box-shadow: inset 3px 0 0 #2563eb}"),
				css(".a{box-shadow: inset 0.25rem 0 0 #2563eb}"),
				css(".a{box-shadow: inset 0.2em 0 0 #2563eb}"),
				css(".a{box-shadow: inset 0 -0.25rem 0 #2563eb}"),
				css(".a{box-shadow: inset 3px 0 0 blue}"),
				css(".a{box-shadow: inset 3px 0 0 0 currentColor}"),
				css(".a{box-shadow: #2563eb 3px 0 0 inset}"),
				css(".a{box-shadow: inset 3px 0 1px #2563eb}"),
				css(".a{box-shadow: -6px 0 0 -3px #2563eb}"),
				css(".a{box-shadow: inset 0 1px #fff, inset 3px 0 #2563eb}"),
				css(".a{box-shadow:\n    inset 0 1px #fff,\n    inset 3px 0 #2563eb;\n}"),
				css(".a{BOX-SHADOW: INSET 3PX 0 #2563EB}"),
				css(".a{box-shadow: inset 3px 0 0 0 rgba(37, 99, 235, 1)}"),
				css(".a{box-shadow: inset 0.1875rem 0 0 rgba(54, 90, 138, 1)}"),
				css(".a{box-shadow: inset 0 3px 0 var(--airmail-red)}"),
				css(".a{box-shadow: 0 2px 0 #747d82}"),
				css(".a{-webkit-box-shadow: inset 4px 0 0 0 #2563eb}"),
				css(".a{filter: drop-shadow(-3px 0 0 #2563eb)}"),
				css(":root{--sel-shadow: inset 3px 0 0 #2563eb}"),
				css("@layer components{.a{box-shadow: inset 4px 0 0 0 #2563eb}}"),
				tsx('export const s = { boxShadow: "inset 3px 0 0 0 #2563eb" };'),
				tsx('export const s = (c: string) => ({ boxShadow: "inset 3px 0 0 " + c });'),
				tsx("export const s = (c: string) => ({ boxShadow: `inset 3px 0 0 0 ${c}` });"),
				tsx('export const s = { boxShadow: "inset 0.25rem 0 0 #2563eb" };'),
				tsx('export const s = { boxShadow: "inset 3px 0 0 blue" };'),
				tsx('export const c = "shadow-[inset_3px_0_0_#365a8a]";'),
				tsx('export const c = "shadow-[inset_3px_0_0_0_blue]";'),
				tsx('export const c = "shadow-[inset_0.25rem_0_0_#2563eb]";'),
				tsx('export const c = "[box-shadow:inset_3px_0_0_#2563eb]";'),
				tsx('export const c = "shadow-[inset_3px_0_0_0_currentColor]";'),
				tsx('export const c = "shadow-[inset_3px_0_0_0_color-mix(in_srgb,blue,transparent)]";'),
				tsx('export const c = "aria-selected:shadow-[inset_3px_0_0_0_theme(colors.blue.500)]";'),
				tsx('export const c = "aria-selected:shadow-[inset_4px_0_0_0_var(--color-kumo-brand)]";'),
				tsx('export const c = "inset-shadow-[3px_0_0_#2563eb]";'),
				tsx('export const c = "drop-shadow-[-3px_0_0_#2563eb]";'),
				tsx('export const c = "shadow-[0_1px_2px_#0003,inset_3px_0_0_#2563eb]";'),
			],
			shadow_hairline: [
				css(".a{box-shadow: inset 1px 0 0 #2563eb}"),
				css(".a{box-shadow: inset 0 -1px 0 var(--airmail-blue)}"),
				tsx('export const c = "shadow-[inset_1px_0_0_#2563eb]";'),
			],
		},
		good: [
			css(".a{box-shadow: inset 0 1px #fff, 0 1px 1px #5a5a5a33}"),
			css(".a{box-shadow: inset 0 0 0 1px var(--airmail-blue)}"),
			css(".a{box-shadow: inset 0 0 0 2px #d2e5dd}"),
			css(".a{box-shadow: 4px 0 16px #2c2c2c35}"),
			css(".a{box-shadow: -8px 4px 24px #17242f30}"),
			css(".a{box-shadow: inset 0 2px 1px #fff, inset 0 -2px 2px #76787a, inset 2px 0 2px #ffffffb0, inset -2px 0 3px #76787a80}"),
			css(".a{box-shadow: 0 1px #f4f7f8, 0 -1px #858f94, inset 0 2px 6px #0008}"),
			css(".a{box-shadow: inset 0 1px var(--button-highlight), 0 1px 1px #34363814}"),
			css(".a{box-shadow: 0 0 0 2px #fff, 0 0 0 4px #365a8a}"),
			css(".a{box-shadow: 0 0 3px #365a8a}"),
			css(".a{box-shadow: 0 2px 4px #0003, 0 8px 16px #0002}"),
			css(".a{box-shadow: 0 8px 24px rgba(0,0,0,.18), 0 0 0 1px rgba(0,0,0,.06)}"),
			css(".a{box-shadow: 0 0 0 3px rgba(54, 90, 138, 0.35)}"),
			css(".a{box-shadow: 0 0 0 1px #9ea0a260, 0 1px #fff}"),
			css(".a{box-shadow: 2px 2px 0 #000}"),
			css(".a{text-shadow: 2px 0 #fff, -2px 0 #fff, 0 2px #fff, 0 -2px #fff}"),
			css(".a{filter: drop-shadow(0 6px 5px #263e5020)}"),
			css(".a{filter: brightness(1.04)}"),
			css(":root{--gap: 4px 0;--pad: 8px 0 0;--shadow-card: 0 1px 2px #0003}"),
			tsx('export const s = { boxShadow: "0 0 0 3px rgba(54, 90, 138, 0.35)" };'),
			tsx('export const c = "ring-1 ring-inset ring-kumo-line bg-kumo-warning/[0.06] ring-kumo-warning/40";'),
			tsx('export const c = "shadow-[0_0_0_2px_var(--airmail-blue)]";'),
			tsx('export const c = "shadow-[inset_0_0_0_2px_var(--airmail-blue)]";'),
			tsx('export const c = "shadow-[0_0_8px_rgba(54,90,138,0.4)]";'),
			tsx('export const c = "shadow-[0_0_20px_#365a8a40]";'),
			tsx('export const c = "shadow-[inset_0_1px_0_#fff,0_1px_1px_#0003]";'),
			tsx('export const c = "shadow-[inset_0_2px_6px_#0008]";'),
			tsx('export const c = "shadow-[0_1px_2px_rgba(0,0,0,0.12),0_4px_12px_rgba(0,0,0,0.08)]";'),
			tsx('export const c = "shadow-[inset_0_1px_0_rgba(255,255,255,0.7)]";'),
			tsx('export const c = "shadow-md shadow-kumo-line drop-shadow-sm";'),
			tsx("export const s = (c: string) => ({ boxShadow: `0 0 0 3px ${c}` });"),
		],
	},
	{
		technique: "gradients and background sizes",
		bad: {
			gradient_hard_stop: [
				css(".a{background: linear-gradient(90deg, #365a8a 0 3px, transparent 3px)}"),
				css(".a{background: linear-gradient(to right, #2563eb 0.25rem, transparent 0.25rem)}"),
				css(".a{background: linear-gradient(to left, #2563eb 4px, transparent 4px)}"),
				css(".a{background: linear-gradient(90deg, #2563eb 0 4%, transparent 4%)}"),
				css(".a{background: linear-gradient(180deg, #2563eb 3px, transparent 3px)}"),
				css(".a{background: linear-gradient(to bottom, #2563eb 0 4px, transparent 4px)}"),
				css(".a{background: linear-gradient(to top, #2563eb 3px, transparent 3px)}"),
				css(".a{background: linear-gradient(0.25turn, #2563eb 3px, transparent 3px)}"),
				css(".a{background: repeating-linear-gradient(90deg, #2563eb 0 3px, transparent 3px 100%)}"),
				css(".a{background: linear-gradient(90deg, transparent calc(100% - 3px), #2563eb calc(100% - 3px))}"),
				css(".a{background: #eef2f5 linear-gradient(90deg, #f0f0f0 0 3px, #fff 3px)}"),
				css(".a{mask: linear-gradient(90deg, #000 0 3px, transparent 3px); background: var(--airmail-blue)}"),
				css(":root{--edge: linear-gradient(90deg, #2563eb 0 3px, transparent 3px)}"),
				tsx('export const s = { backgroundImage: "linear-gradient(to right, #2563eb 0.25rem, transparent 0.25rem)" };'),
				tsx('export const s = { backgroundImage: "linear-gradient(to left, var(--airmail-red) 4px, transparent 4px)" };'),
				tsx('export const c = "bg-[linear-gradient(90deg,#2563eb_0_3px,transparent_3px)]";'),
				tsx('export const c = "bg-[linear-gradient(to_right,#2563eb_3px,transparent_3px)]";'),
				tsx('export const c = "bg-linear-90 from-blue-500 from-[3px] to-transparent to-[3px]";'),
				tsx('export const c = "bg-gradient-to-r from-blue-500 from-4% to-transparent to-4%";'),
				css(".a{background: linear-gradient(var(--airmail-blue), var(--airmail-blue) 3px, transparent 3px)}"),
				css(".a{background: linear-gradient(to left, var(--airmail-blue) 0.5rem, transparent 0.5rem)}"),
			],
			gradient_accent_fade: [
				css(".a{background: linear-gradient(90deg, var(--airmail-blue), transparent)}"),
				css(".a{background: linear-gradient(to bottom, rgba(37, 99, 235, .3), transparent)}"),
				tsx('export const c = "bg-gradient-to-r from-blue-500 to-transparent";'),
				tsx('export const c = "bg-linear-90 from-transparent to-kumo-brand";'),
				css(".a{background: linear-gradient(to right, rgba(37,99,235,.15), transparent 40%)}"),
			],
			bg_size_bar: [
				css(".a{background-size: 3px 100%}"),
				css(".a{background-size: 0.25rem 100%}"),
				css(".a{background-size: 3px 80%}"),
				css(".a{background-size: 100% 4px}"),
				css(".a{background-size: 4px 40px}"),
				css(".a{background: linear-gradient(#2563eb, #2563eb) left center / 3px 100% no-repeat}"),
				css(".a{background:\n    linear-gradient(var(--airmail-blue), var(--airmail-blue)) 0 0 / 3px 100% no-repeat,\n    #eef2f5;\n}"),
				css(".a{background-image: linear-gradient(#2563eb, #2563eb); background-repeat: no-repeat; background-size: 0.25rem 100%}"),
				tsx('export const s = { backgroundSize: "3px 100%" };'),
				tsx('export const s = { background: "linear-gradient(#2563eb,#2563eb) left / 3px 100% no-repeat" };'),
				tsx('export const c = "bg-[image:linear-gradient(#2563eb,#2563eb)] bg-[length:3px_100%] bg-no-repeat bg-left";'),
			tsx('export const c = "bg-[linear-gradient(var(--airmail-blue),var(--airmail-blue))_left/3px_100%_no-repeat]";'),
			],
		},
		good: [
			css(".a{background: linear-gradient(90deg, #f4f6f7 0, #d2d8db 48px, #c1c9cd 100%)}"),
			css(".a{background: linear-gradient(to right, transparent, #edf2f4 24px)}"),
			css(".a{background: linear-gradient(180deg, #f4f6f7, #d2d8db 48%, #c1c9cd 49%, #dce1e3)}"),
			css(".a{background: linear-gradient(115deg, #979fa4 0%, #e3e7e8 18%, #bcc3c7 36%, #939da3 78%, #969fa4)}"),
			css(".a{background: linear-gradient(135deg, #373e43 0%, #252c31 48%, #1b2227 49%, #2a3338 100%)}"),
			css(".a{background: repeating-linear-gradient(90deg, #ffffff0a 0 1px, #00000004 1px 3px)}"),
			css(".a{background: repeating-linear-gradient(0deg, #ffffff0a 0 1px, #00000002 1px 2px), #bdc3c6}"),
			css(".a{background: linear-gradient(90deg, transparent, #ffffff66, transparent)}"),
			css(".a{background: linear-gradient(to top, rgba(0,0,0,.6), transparent)}"),
			css(".a{background: linear-gradient(#994a3b, #7b3428)}"),
			css(".a{background: radial-gradient(ellipse at 50% 40%, #fff, #edf1f3)}"),
			css(".a{background: linear-gradient(145deg, #343d43, #242a2f); background-size: 100% 100%}"),
			css(".a{background-size: 100% 100%}"),
			css(".a{background-size: 4px 4px}"),
			css(".a{background-size: cover}"),
			css(".a{background: url(/i.svg) center / contain no-repeat}"),
			css(".a{background: linear-gradient(#ddd, #ddd) 0 0 / 3px 100% repeat-y}"),
			tsx('export const c = "bg-gradient-to-r from-[#edf2f4] to-[#bac4ca]";'),
			tsx('export const c = "relative overflow-hidden after:absolute after:inset-0 after:-translate-x-full after:bg-gradient-to-r after:from-transparent after:via-white/40 after:to-transparent";'),
			tsx('export const c = "bg-gradient-to-b from-kumo-base to-kumo-recessed";'),
			tsx('export const c = "bg-gradient-to-r from-blue-500 to-purple-500";'),
			tsx('export const s = { backgroundImage: "linear-gradient(#f5f7f9, #c7c9cb)" };'),
			css(":root{--dir:90deg}.range{background:linear-gradient(var(--dir),transparent 50%,var(--mid) 50%)}"),
			css(".a{background:linear-gradient(to right,var(--mid),var(--mid2))}"),
		],
	},
	{
		technique: "bars drawn as pseudo-elements, glyphs and thin elements",
		bad: {
			pseudo_bar: [
				css('.a::before{content:"";position:absolute;left:0;top:0;bottom:0;width:3px;background:#2563eb}'),
				css('.a::before{content:"";position:absolute;left:0;width:3px;height:100%;background:#9c9c9c}'),
				css('.a::before{content:"";position:absolute;left:0;width:3px;background:#2563eb}'),
				css('.a:before{content:"";position:absolute;left:0;height:2rem;width:3px;background:#2563eb}'),
				css('.a::before{content:"";display:block;float:left;width:3px;height:2rem;background:#2563eb}'),
				css('.a::before{content:"";flex:none;width:3px;align-self:stretch;background:#2563eb}'),
				css('.a::before{content:"";display:inline-block;inline-size:0.25rem;block-size:100%;background:#2563eb}'),
				css('.a::before{content:"";grid-row:1 / -1;width:3px;background:#2563eb}'),
				css('.a::before{content:"";display:block;height:4px;background:#2563eb}'),
				css('.a::before{content:"";display:block;height:0.25rem;background:#2563eb}'),
				css('.card{&::before{content:"";display:block;height:0.3rem;background:#2563eb}}'),
				css('.a::before{content:"";display:inline-block;width:3px;height:1.5rem;background:#2563eb}'),
				css('.a::before{content:"";display:inline-block;width:3px;height:40px;background:#2563eb}'),
				css('.a::after{content:"";position:absolute;inset-block:0;inset-inline-start:0;inline-size:0.1875rem;background:var(--airmail-blue)}'),
				css('.a::after{content:"";position:absolute;inset:0 auto 0 0;width:3px;background:#2563eb}'),
				css('.a::after{content:"";position:absolute;top:0;left:0;right:0;height:3px;background:#2563eb}'),
				css('.a::after{content:"";width:1px;height:20px;background:#2563eb}'),
				css(".a::before{content:'';position:absolute;left:0;width:2px;height:100%;background:#9c9c9c}"),
				tsx('export const c = "relative before:absolute before:left-0 before:top-0 before:h-full before:w-1 before:bg-blue-500";'),
				tsx('export const c = "relative before:absolute before:left-0 before:w-1 before:bg-kumo-fill";'),
				tsx("export const c = \"flex before:w-2 before:self-stretch before:bg-blue-500 before:content-['']\";"),
				tsx("export const c = \"relative [&::before]:absolute [&::before]:left-0 [&::before]:h-full [&::before]:w-1 [&::before]:bg-blue-500\";"),
				tsx("export const c = \"relative before:!absolute before:!left-0 before:!h-6 before:!w-[3px] before:bg-blue-500\";"),
				tsx("export const c = \"before:block before:h-1 before:bg-kumo-brand before:content-['']\";"),
				tsx("export const c = \"relative after:content-[''] after:block after:w-[3px] after:h-[calc(100%-8px)] after:bg-blue-500\";"),
				tsx('export const c = "relative before:absolute before:inset-y-1 before:left-0 before:w-0.5 before:rounded-full before:bg-kumo-brand";'),
				tsx('export const c = "after:absolute after:inset-x-0 after:top-0 after:h-1 after:bg-kumo-fill";'),
				tsx('export const s = { "&::before": { content: \'""\', position: "absolute", left: 0, top: 0, bottom: 0, width: 3, background: "#2563eb" } };'),
				css('.a{@apply relative; &::before{content:"";@apply absolute left-0 top-0 h-full w-1 bg-blue-500}}'),
				tsx('export const c = "after:mt-1 after:block after:h-0.5 after:w-8 after:bg-kumo-brand";'),
			],
			glyph_bar: [
				css('.a::before{content:"\\258E";color:#2563eb}'),
				css(".a::after{content:'▎'}"),
				tsx('export const A = () => <span className="text-kumo-brand">▎</span>;'),
				tsx('export const MARK = "▍";'),
			],
			element_bar: [
				tsx('export const A = () => <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: 3, background: "#2563eb" }} />;'),
				tsx('export const A = () => <span style={{ width: 4, alignSelf: "stretch", background: "var(--airmail-blue)" }} />;'),
				tsx('export const A = () => <div className="absolute inset-y-0 left-0 w-1 bg-blue-500" />;'),
				tsx('export const A = () => <div className="absolute left-0 top-0 h-full w-[3px] bg-[#365a8a]" />;'),
				tsx('export const A = () => <span className="w-1 self-stretch rounded-full bg-kumo-brand" />;'),
				tsx('export const A = () => <div className="w-0.5 bg-kumo-brand" />;'),
				tsx('export const A = () => <span aria-hidden className="w-[3px] shrink-0 self-stretch rounded bg-[#365a8a]" />;'),
				tsx('export const A = () => <div className="h-6 w-1 bg-kumo-brand" />;'),
				tsx('export const A = () => <div className="absolute inset-x-0 top-0 h-1 bg-kumo-brand" />;'),
				tsx('export const A = () => <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-blue-500" />;'),
				tsx('export const A = () => <div className="w-px h-6 bg-blue-500" />;'),
				tsx('export const A = () => <Tabs tabs={[]} indicatorClassName="bottom-0 h-1 bg-kumo-brand" />;'),
				tsx('export const A = () => <div className="absolute left-0 top-0 h-full w-1 bg-gradient-to-b from-blue-500 to-blue-500" />;'),
				tsx('export const A = ({ on }: { on: boolean }) => <div className={`absolute inset-y-0 left-0 w-1 ${on ? "bg-blue-500" : "bg-transparent"}`} />;'),
				css(".marker{position:absolute;left:0;top:0;bottom:0;width:3px;background:var(--airmail-blue)}"),
				css(".marker{width:4px;height:24px;background:#365a8a}"),
				tsx('export const A = () => <div className="w-1 self-stretch rounded-full" style={{ background: label.color }} />;'),
				tsx('export const A = () => <div className="absolute inset-y-0 left-0 w-1" style={{ backgroundColor: color }} />;'),
				tsx('export const A = () => <div className="self-stretch bg-kumo-brand" style={{ width: 3 }} />;'),
				tsx('export const A = () => <div className="h-1 w-full bg-kumo-brand" />;'),
				css(".accent-line{height:3px;width:100%;background:var(--airmail-blue)}"),
			],
		},
		good: [
			css('.a::before{content:"";width:4px;height:4px;background:#9c9c9c}'),
			css('.a:before{content:"";width:4px;height:4px;background:#c4e2d5}'),
			css('.dot::before{content:"";display:inline-block;width:12px;height:12px;border-radius:50%;background:#2a8a4a}'),
			css('.dot::before{content:"";display:inline-block;width:8px;height:8px;background:#2a8a4a}'),
			css('.dot::before{content:"";position:absolute;left:6px;top:50%;width:6px;height:6px;background:var(--airmail-blue)}'),
			css('.unread::before{content:"";width:6px;height:6px;background:var(--airmail-blue);display:inline-block}'),
			css('.ico::before{content:"";display:inline-block;width:16px;height:16px;background:currentColor;mask:url(/i.svg) center / contain no-repeat}'),
			css('.sep::after{content:"";display:block;height:1px;width:100%;background:#c1c1c1}'),
			css('.sep::after{content:"";width:1px;height:20px;background:#c1c1c1}'),
			css('.tip{position:relative}.tip::after{content:attr(data-tip);position:absolute;bottom:100%;left:50%;transform:translateX(-50%);background:#252a2e;color:#fff;padding:2px 6px;white-space:nowrap}'),
			css('.tip::before{content:"";position:absolute;top:100%;left:50%;border:4px solid transparent;border-top-color:#252a2e}'),
			css('.skeleton::after{content:"";position:absolute;inset:0;background:linear-gradient(90deg,transparent,#ffffff66,transparent);animation:shimmer 1.2s infinite}'),
			css('.card::before{content:"";position:absolute;inset:0;border-radius:inherit;box-shadow:inset 0 0 0 1px #ffffff99;pointer-events:none}'),
			css('.field::after{content:"";position:absolute;inset:-2px;border:2px solid var(--airmail-blue);border-radius:inherit;pointer-events:none}'),
			css('.caret{width:0;height:0}.caret::after{content:"";border-color:transparent}'),
			css('.a::before{content:"\\2022";color:#2563eb;margin-right:4px}'),
			css('.a::after{content:"*";color:#b94d45}'),
			css('*,*::before,*::after{box-sizing:border-box}'),
			css('@media (prefers-reduced-motion: reduce){*,*:before,*:after{animation-duration:0.01ms !important}}'),
			css('*,*::before,*::after{border-radius:6px !important}'),
			css('.scroll::-webkit-scrollbar{width:5px;height:5px}.scroll::-webkit-scrollbar-thumb{background:#bcbcbc;border-radius:3px}'),
			css('.toolbar .sep{width:1px;height:16px;background:#c1c1c1}'),
			css('.grabber{width:40px;height:4px;background:#bcbcbc}'),
			css('.bar{width:3px;height:24px;background:#bcbcbc}'),
			css('.avatar{width:32px;height:32px;background:#2563eb}'),
			css('.progress{height:4px;width:100%;background:#e4e6e8}.fill{height:4px;width:33%;background:var(--airmail-blue)}'),
			tsx('export const A = () => <div className="relative after:absolute after:right-0 after:top-1/4 after:h-1/2 after:w-px after:bg-kumo-line">x</div>;'),
			tsx('export const A = () => <div className="relative before:pointer-events-none before:absolute before:inset-0 before:rounded-[inherit] before:ring-1 before:ring-inset before:ring-white/60">x</div>;'),
			tsx("export const A = () => <span className=\"inline-flex items-center gap-1 before:h-1 before:w-1 before:bg-kumo-fill before:content-['']\">x</span>;"),
			tsx("export const A = () => <label className=\"after:ml-0.5 after:text-kumo-danger after:content-['*']\">x</label>;"),
			tsx('export const A = () => <div className="relative after:absolute after:left-1/2 after:top-full after:-translate-x-1/2 after:border-4 after:border-transparent after:border-t-kumo-contrast">x</div>;'),
			tsx('export const A = () => <span className="size-1 bg-kumo-fill" />;'),
			tsx('export const A = () => <span className="size-2 rounded-full bg-kumo-brand" />;'),
			tsx('export const A = () => <div className="h-1 w-full bg-kumo-recessed"><div className="h-1 w-1/3 bg-kumo-brand" /></div>;'),
			tsx('export const A = () => <div className="border-b border-kumo-line divide-y divide-kumo-line border-r"><div className="h-px w-full bg-kumo-line" /><div className="h-4 w-px bg-kumo-line" /></div>;'),
			tsx('export const A = () => <div className="relative h-24 w-1.5 bg-kumo-recessed"><div className="absolute inset-x-0 top-0 h-1/3 w-full bg-kumo-fill" /></div>;'),
			tsx('export const A = () => <div className="mx-auto h-1 w-10 rounded-full bg-kumo-fill" />;'),
			tsx('export const A = () => <div className="w-1 h-6 bg-kumo-fill" />;'),
			tsx('export const A = () => <div className="[&::-webkit-scrollbar]:w-[5px] [&::-webkit-scrollbar-thumb]:bg-kumo-fill">x</div>;'),
			tsx('export const A = () => <div style={{ width: `${pct}%`, height: 4, background: "var(--airmail-blue)" }} />;'),
			tsx('export const A = () => <div style={{ width: 16, height: 16, background: "#2563eb", position: "absolute", left: 0 }} />;'),
			tsx('export const A = () => <div style={{ position: "absolute", inset: 0, width: 3, background: "#c1c1c1" }} />;'),
			tsx('export const A = ({ pct }: any) => <div className="h-1 rounded bg-kumo-brand" style={{ width: `${pct}%` }} />;'),
			tsx('export const A = ({ label }: any) => <span className="size-2 rounded-full" style={{ background: label.color }} />;'),
			tsx('export const A = () => <div className="mx-auto h-0.5 w-16 bg-kumo-brand" />;'),
			tsx('export const A = () => <span aria-hidden>│</span>;'),
			css(".sr-only{position:absolute;width:1px;height:1px;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);border:0}"),
			css(".timeline::before{content:'';position:absolute;left:11px;top:0;bottom:0;width:1px;background:#c1c1c1}"),
		],
	},
	{
		technique: "Tailwind classes",
		bad: {
			tw_border_wide: [
				tsx('export const c = "border-l-2 p-2";'),
				tsx('export const c = "border-l-4 border-kumo-line";'),
				tsx('export const c = "border-s-4";'),
				tsx('export const c = "border-e-2";'),
				tsx('export const c = "border-t-8";'),
				tsx('export const c = "border-x-4";'),
				tsx('export const c = "border-y-4 border-blue-500";'),
				tsx('export const c = "divide-x-4 divide-blue-500 flex";'),
				tsx('export const c = "divide-y-2";'),
				tsx('export const c = "border-l-[3px] border-blue-500";'),
				tsx('export const c = "border-b-[0.25rem]";'),
				tsx('export const c = "border-l-[length:3px]";'),
				tsx('export const c = "data-[selected=true]:border-l-2 data-[selected=true]:border-blue-500";'),
				tsx('export const c = "data-[selected=true]:!border-l-4";'),
				tsx('export const c = "md:border-l-2";'),
				css(".row{@apply border-l-4 border-blue-500}"),
				css(".row{@apply border-l-4}"),
				tsx('export const A = () => <li className={`\n  border-l-2\n  border-kumo-line\n`}>x</li>;'),
				tsx('export const c = "border-b-2 border-transparent";'),
			],
			tw_border_colored: [
				tsx('export const c = "border-l-kumo-warning";'),
				tsx('export const c = "border-l-primary";'),
				tsx('export const c = "border-l-[#2563eb]";'),
				tsx('export const c = "border-l-[color:var(--airmail-blue)]";'),
				tsx('export const c = "border-b-blue-500";'),
				tsx('export const c = "border-t-kumo-brand";'),
				tsx('export const c = "border-s-red-500/50";'),
				tsx('export const c = "border-l-(--airmail-blue)";'),
				tsx('export const c = "border-l-1 border-l-kumo-brand";'),
				tsx('export const c = "size-4 border-2 border-kumo-fill border-t-kumo-brand";'),
			],
			tw_border_plus_accent: [
				tsx('export const c = "border-l border-kumo-brand";'),
				tsx('export const c = "border-l border-blue-500";'),
				tsx('export const c = "border-l border-red-500/50";'),
				tsx('export const c = "border-l border-[#2563eb]";'),
				tsx('export const c = "border-l border-primary";'),
				tsx('export const c = "border-l border-accent";'),
				tsx('export const c = "border-b border-kumo-brand";'),
				tsx('export const c = "border-x border-blue-500";'),
				tsx('export const c = "border-l border-[color:var(--airmail-blue)]";'),
				tsx('export const c = "divide-y divide-kumo-brand";'),
				tsx('export const A = ({ selected }: { selected: boolean }) => <li className={`border-l ${selected ? "border-blue-500" : "border-transparent"}`}>x</li>;'),
				tsx('export const A = ({ selected }: { selected: boolean }) => <li className={`border-l ${selected ? "border-kumo-brand" : "border-kumo-line"}`}>x</li>;'),
				tsx('const cn = (...a: unknown[]) => a.join(" ");\nexport const A = ({ selected }: { selected: boolean }) => <li className={cn("border-l", selected && "border-blue-500")}>x</li>;'),
				tsx('import clsx from "clsx";\nexport const A = ({ selected }: { selected: boolean }) => <li className={clsx(["border-l", selected ? "border-indigo-500" : "border-transparent"])}>x</li>;'),
				tsx('export const A = ({ selected }: { selected: boolean }) => <li className={cn("flex", { "border-l border-kumo-brand": selected })}>x</li>;'),
				tsx('export const A = () => <li className={`\n  border-l\n  border-blue-500\n`}>x</li>;'),
				tsx('export const A = () => <li className="data-[selected=true]:border-l data-[selected=true]:border-kumo-brand">x</li>;'),
				tsx('const base = "border-l";\nexport const A = ({ on }: { on: boolean }) => <li className={on ? base + " border-blue-500" : base}>x</li>;'),
				tsx('const cls = "border-b " + (true ? "border-kumo-brand" : "");\nexport { cls };'),
				tsx('export const TAB = { selected: "border-b border-kumo-brand", idle: "" };'),
				tsx('export const TAB = cva("border-b", { variants: { on: { true: "border-kumo-brand" } } });'),
				css(".row{@apply border-l border-[#2563eb]}"),
				css(".row{@apply border-l border-kumo-brand}"),
				tsx('export const A = ({ on }: any) => <li className={classes("border-l", on && "border-blue-500")}>x</li>;'),
				tsx('export const c = ["pl-3", on && "border-l", on && "border-primary"].filter(Boolean).join(" ");'),
			],
		},
		good: [
			tsx('export const c = "border-b border-kumo-line";'),
			tsx('export const c = "md:border-r md:border-kumo-line";'),
			tsx('export const c = "border-b border-kumo-line/50";'),
			tsx('export const c = "border-b border-kumo-line focus:border-kumo-ring";'),
			tsx('export const c = "border-b border-kumo-elevated";'),
			tsx('export const c = "border-t border-kumo-base bg-kumo-base";'),
			tsx('export const c = "border-l border-gray-300 pl-2";'),
			tsx('export const c = "border-l border-l-[color:var(--rule)]";'),
			tsx('export const c = "border-b-[var(--rule-w)] border-kumo-line";'),
			tsx('export const c = "border-r-[1px] border-kumo-line";'),
			tsx('export const c = "border-l border-transparent";'),
			tsx('export const c = "border-l-0 border-r-0";'),
			tsx('export const c = "border-t-0 border-kumo-brand";'),
			tsx('export const c = "border border-kumo-brand rounded";'),
			tsx('export const c = "rounded border border-kumo-brand bg-kumo-brand/10";'),
			tsx('export const c = "border-2 border-blue-500";'),
			tsx('export const c = "border-solid border-collapse border-spacing-2";'),
			tsx('export const c = "divide-y divide-kumo-line";'),
			tsx('export const c = "divide-y divide-kumo-line border-y border-kumo-line";'),
			tsx('export const c = "ring-1 ring-kumo-brand focus-visible:ring-2 ring-offset-2";'),
			tsx('export const c = "size-4 animate-spin rounded-full border-2 border-kumo-fill border-t-kumo-brand";'),
			tsx('export const c = "h-4 w-4 animate-spin rounded-full border-2 border-kumo-line border-t-kumo-brand";'),
			tsx('export const c = "underline decoration-1 decoration-blue-500";'),
			tsx('export const c = "underline decoration-2";'),
			tsx('export const c = "bg-kumo-tint ring-1 ring-inset ring-kumo-line font-medium";'),
			tsx('export const A = ({ isLast, isDraft }: { isLast: boolean; isDraft: boolean }) => <div className={`${!isLast ? "border-b border-kumo-line" : ""} ${isDraft ? "bg-kumo-warning/[0.06] ring-1 ring-inset ring-kumo-warning/40" : ""}`} />;'),
			tsx('export const A = ({ on }: { on: boolean }) => <>{on ? <div className="border-b border-kumo-line" /> : <div className="border-kumo-brand" />}</>;'),
			tsx('export const A = () => <div className="border-b border-kumo-line"><div className="border-kumo-brand" /></div>;'),
			tsx('export const A = () => <><div className="border-b" /><div className="border-blue-500" /></>;'),
			tsx('export const A = () => <div className="[&_blockquote]:px-3 [&_blockquote]:bg-kumo-tint [&_blockquote]:py-1 [&_blockquote]:text-xs">x</div>;'),
			tsx('export const A = () => <div className="[&_blockquote]:border [&_blockquote]:border-kumo-line">x</div>;'),
			tsx('export const A = () => <div className="[&_blockquote]:border-l-0">x</div>;'),
			tsx('export const A = () => <div className="[&_p]:border-l-0 [&_p]:border-kumo-line">x</div>;'),
			css(".divider{@apply border-t}.callout{@apply border border-kumo-brand}"),
			css(".a{@apply border-b border-kumo-line}"),
			tsx('export const c = "border-0 border-b border-kumo-line bg-transparent";'),
			tsx('export const c = "border-b border-border";'),
			tsx('export const A = ({ ok }: any) => <>{ok ? jsx("div", { className: "border-b" }) : jsx("div", { className: "border-blue-500" })}</>;'),
			tsx('export const NAV = ["border", "left", "border-l", "blue-500"];'),
		],
	},
	{
		technique: "Kumo components",
		bad: {
			kumo_collapsible: [
				tsx('import { Button, Collapsible } from "@cloudflare/kumo";'),
				tsx('import { Collapsible as Section } from "@cloudflare/kumo";\nexport const S = Section;'),
				tsx('import * as Kumo from "@cloudflare/kumo";\nexport const A = () => <Kumo.Collapsible label="x" />;'),
				tsx('export { Collapsible } from "@cloudflare/kumo";'),
				tsx('export const Lazy = () => import("@cloudflare/kumo/components/collapsible");'),
				tsx('import { Collapsible } from "@cloudflare/kumo/components/collapsible";\nexport const X = Collapsible;'),
				tsx('import type {} from "@cloudflare/kumo/components/collapsible";'),
			],
			kumo_underline_tabs: [
				tsx('import { Tabs } from "@cloudflare/kumo";\nexport const A = () => <Tabs variant="underline" tabs={[]} />;'),
				tsx('import { Tabs } from "@cloudflare/kumo";\nexport const A = () => <Tabs variant={"underline"} tabs={[]} />;'),
				tsx('import { Tabs } from "@cloudflare/kumo";\nexport const A = ({ c }: { c: boolean }) => <Tabs variant={c ? "underline" : "segmented"} tabs={[]} />;'),
				tsx('import { Tabs } from "@cloudflare/kumo";\nconst V = "underline" as const;\nexport const A = () => <Tabs variant={V} tabs={[]} />;'),
				tsx('import { Tabs } from "@cloudflare/kumo";\nconst props = { variant: "underline" } as const;\nexport const A = () => <Tabs {...props} tabs={[]} />;'),
			],
		},
		good: [
			tsx('import { Button, Dialog } from "@cloudflare/kumo";\nexport const X = [Button, Dialog];'),
			tsx('import { Tabs } from "@cloudflare/kumo";\nexport const A = () => <Tabs variant="segmented" tabs={[]} />;'),
			tsx('import { Button } from "@cloudflare/kumo";\nexport const A = ({ editor }: { editor: { isActive: (n: string) => boolean } }) => <Button variant={editor.isActive("underline") ? "secondary" : "ghost"}>U</Button>;'),
			tsx('export const A = ({ editor }: { editor: { isActive: (n: string) => boolean } }) => <button aria-pressed={editor.isActive("underline")}>U</button>;'),
			tsx('export const A = () => <Tabs variant="underline" tabs={[]} />;'),
			tsx('export const note = "Never use Collapsible in navigation";'),
		],
	},
	{
		technique: "quoted replies",
		bad: {
			quote_bar: [
				css("blockquote{border-left:1px solid #ccc;margin:0;padding-left:1em}"),
				css("blockquote{margin:0 0 0 .8ex;border-left:1px #ccc solid;padding-left:1ex}"),
				css(".ProseMirror blockquote{border-left:2px solid #ddd}"),
				css(".quoted{border-inline-start:1px solid #ddd}"),
				css("blockquote{border-left-width:1px;border-left-style:solid}"),
				tsx("export const q = (b: string) => `<blockquote style=\"border-left: 1px solid #ccc; margin: 0; padding-left: 1em;\">${b}</blockquote>`;"),
				tsx("export const q = (b: string) => `<blockquote style=\"margin:0 0 0 .8ex;border-left:1px #ccc solid;padding-left:1ex\">${b}</blockquote>`;"),
				ts_("export const q = (b: string) => `<blockquote style='border-left:2px solid #ddd;margin:0 0 0 8px;padding-left:8px'>${b}</blockquote>`;"),
				ts_("export const q = `<blockquote style=\"margin:0;padding-left:12px;border-left:3px solid #365a8a\">x</blockquote>`;"),
				tsx('export const c = "prose [&_blockquote]:border-l [&_blockquote]:border-kumo-line [&_blockquote]:pl-3";'),
				tsx('export const c = "prose prose-blockquote:border-l-2";'),
				tsx('export const s = { blockquote: { borderLeft: "1px solid #ccc" } };'),
				tsx('export const s = { "& blockquote": { borderInlineStart: "1px solid #ccc" } };'),
				tsx('export const A = () => <blockquote style={{ borderLeft: "1px solid #ccc", paddingLeft: 8 }}>x</blockquote>;'),
				tsx('export const A = () => <blockquote className="border-l pl-3 border-kumo-line">x</blockquote>;'),
				ts_("export const q = (b: string) => `<div class=\"gmail_quote\" style=\"border-left:1px solid #ccc;padding-left:1ex\">${b}</div>`;"),
				css(".gmail_quote{border-left:1px solid #ccc;padding-left:1ex}"),
			],
		},
		good: [
			ts_('export const q = (b: string) => `<blockquote style="border: 1px solid #ddd; margin: 0; padding: 0.75em 1em; background-color: #f9f9f9; color: #666;">${b}</blockquote>`;'),
			ts_('export const html = `<style>blockquote { background: #f5f6f6; padding: 8px 12px; margin-left: 0; color: #5f6673; } blockquote blockquote { background: transparent; }</style>`;'),
			css("blockquote{border:1px solid #ddd;padding:.75em 1em;background:#f9f9f9}"),
			css("blockquote{margin-left:0;border-left:0;padding-left:0}"),
			css(".quote{border-left:none}"),
			tsx('export const A = () => <blockquote className="bg-kumo-tint px-3 py-1">x</blockquote>;'),
			tsx('export const A = () => <blockquote style={{ border: "1px solid #ddd", padding: 8 }}>x</blockquote>;'),
		],
	},
	{
		technique: "text that only mentions a stripe",
		bad: {
		},
		good: [
			css("/* replaced the old border-left: 3px solid #d1d5db quote bar */\n.q{border:1px solid #ddd;background:#f9f9f9}"),
			css("/* .a{border-left:3px solid red} */\n/*\n.b{box-shadow:inset 3px 0 #365a8a}\n*/\n.c{color:red}"),
			tsx('export const HELP = "Avoid border-left: 3px solid on rows.";'),
			tsx('// do not use border-l-2 here; selection uses a full ring\n/* border-l border-blue-500 */\nexport const x = 1;'),
			tsx('export const EXAMPLE = "Use box-shadow: inset 0 0 0 1px var(--airmail-blue) for selection.";'),
			css("/* Do not use border-left: 4px solid var(--primary) here. */\n.a{color:red}"),
			ts_("export const css = `/* border-left: 3px solid red */ .a{color:red} <!-- box-shadow: inset 3px 0 red -->`;"),
			scss(".row {\n  &.active { background: #eef; } // fill\n}"),
		],
	},
];

test("every rule has snippets and each one is flagged by the rule it names", () => {
	const covered = FIXTURES.flatMap((group) => Object.keys(group.bad));
	assert.deepEqual([...covered].sort(), Object.keys(RULES).sort(), "each rule needs bad snippets and each bad group needs a rule");
	const misses = [];
	for (const group of FIXTURES) {
		for (const [rule, snippets] of Object.entries(group.bad)) {
			if (snippets.length < 3) misses.push(`${rule} needs at least three snippets`);
			for (const [ext, code] of snippets) {
				const rules = run(ext, code).map((hit) => hit.rule);
				if (!rules.includes(rule)) misses.push(`${rule} missed ${ext}: ${code.replace(/\n/g, " ")}  (got: ${rules.join(", ") || "nothing"})`);
			}
		}
	}
	assert.deepEqual(misses, []);
});

test("no rule flags a near-miss that is allowed", () => {
	const flagged = [];
	for (const group of FIXTURES) {
		for (const [ext, code] of group.good) {
			const rules = run(ext, code).map((hit) => hit.rule);
			if (rules.length > 0) flagged.push(`[${group.technique}] ${rules.join(", ")} flagged ${ext}: ${code.replace(/\n/g, " ")}`);
		}
	}
	assert.deepEqual(flagged, []);
});

test("colour classification separates neutrals from accents", () => {
	const chromatic = (value) => isChromatic(value, FIXTURE_CONTEXT);
	for (const accent of ["#365a8a", "#b94d45", "#d2e5dd", "#2563eb", "#25eb", "#2563EB80", "blue", "rgb(37 99 235)", "hsl(221 83% 53%)", "oklch(0.55 0.2 260)", "var(--airmail-blue)", "var(--accent)", "var(--sel)", "var(--nope)", "color-mix(in srgb, red, white)", "§§", "§color§", "§accent§"]) {
		assert.equal(chromatic(accent), true, accent);
	}
	for (const neutral of ["#c1c1c1", "#647077", "#53616b", "#ddd", "#fff", "#ffffff0a", "rgba(0,0,0,.12)", "hsl(210 8% 40%)", "oklch(0.6 0.01 250)", "gray", "transparent", "currentColor", "var(--rule)", "var(--chassis-line)", "var(--unknown, #ccc)", "color-mix(in srgb, #888 50%, transparent)", "§line§", "§border§"]) {
		assert.equal(chromatic(neutral), false, neutral);
	}
});

// Pathological inputs once made a regex or a loop quadratic; a bound of seconds leaves ample room on slow machines.
test("hostile input stays fast", () => {
	const started = performance.now();
	const texts = [
		".border-t{border-top-width:1px}\n".repeat(12000),
		"a::before{" + "x:1;".repeat(100000),
		"/*".repeat(100000),
		"<!--".repeat(60000),
		"<a".repeat(100000),
		"background: linear-gradient(90deg," + " red".repeat(80000),
		`background: linear-gradient(${"red 1px,".repeat(50000)} blue)`,
		"(".repeat(200000),
		"calc(".repeat(50000) + ")".repeat(50000),
		"border-left: " + "a ".repeat(100000),
		"a-".repeat(150000),
		".a{" + "border-left:1px solid #ddd;".repeat(20000) + "}",
		"@apply ".repeat(30000),
	];
	for (const text of texts) for (const ext of ["css", "html"]) analyse(`hostile.${ext}`, text, FIXTURE_CONTEXT);
	const scripts = [
		`const c = "${"border-t ".repeat(40000)}";\nconst d = \`${"a:b;".repeat(60000)}\`;`,
		`const BIG = [${Array.from({ length: 4000 }, (_, i) => `"w-${i}"`).join(",")}];\n${'export const A = () => <div className={cn(BIG, BIG, BIG)} />;\n'.repeat(4000)}`,
		`export const A = () => (<>${'<i className="w-1 h-4" style={{ background: c }} />'.repeat(8000)}</>);`,
	];
	for (const text of scripts) analyse("hostile.tsx", text, FIXTURE_CONTEXT);
	// Time budgets hold only in CI. A busy laptop fails them with nothing wrong (WON-388); CI runs on every PR.
	const tookMs = Math.round(performance.now() - started);
	if (process.env.CI) assert.ok(tookMs < 5000, `hostile inputs took ${tookMs}ms`);
	else console.log(`hostile inputs took ${tookMs}ms`);
});

// ----- the real tree ------------------------------------------------------------------------------------------

test("no accent stripes or edge bars in app, workers, shared or public (DESIGN.md)", () => {
	const failures = [];
	const hitRules = [];
	for (const file of results) {
		for (const hit of file.hits) {
			if (allowed(file.path, hit.rule)) continue;
			failures.push(describe(file, hit));
			hitRules.push(hit.rule);
		}
	}
	assert.equal(failures.length, 0, explain(failures, hitRules));
});

test("every ALLOWLIST entry still suppresses a hit", () => {
	const live = new Set(results.flatMap((file) => file.hits.map((hit) => `${file.path}:${hit.rule}`)));
	const stale = ALLOWLIST.filter((entry) => !live.has(entry));
	assert.deepEqual(stale, [], `Remove allowlist entries that no longer match anything:\n  ${stale.join("\n  ")}`);
	for (const entry of ALLOWLIST) assert.ok(entry.split(":")[1] in RULES, `${entry} names an unknown rule`);
});

// ---------------------------------------------------------------------------------------------------------
// Postal view: one 6px radius with named exceptions, shapes from clip-path only
// ---------------------------------------------------------------------------------------------------------

const POSTAL_CSS = "app/components/postal/postal.css";

function cssBlocks(file) {
	const css = readFileSync(join(ROOT, file), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
	// Flatten @media and @container wrappers so each rule is one selector { body } block.
	return [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(([, selector, body]) => ({
		selector: selector.trim().replace(/^@[^{]*$/, "").trim(),
		decls: body.split(";").map((d) => d.trim()).filter(Boolean).map((d) => {
			const at = d.indexOf(":");
			return [d.slice(0, at).trim(), d.slice(at + 1).trim()];
		}),
	}));
}

// Exceptions to the 6px radius, by what may carry them.
const RADIUS_EXCEPTIONS = [
	{ value: /^50%\s*!important$/, selector: /pg-round|pg-switch > span/, why: "circles: switch knobs and the agent dot" },
	{ value: /^2px\s*!important$/, selector: /pg-swatch|mark/, why: "domain swatches and search highlights" },
	{ value: /^10px\s*!important$/, selector: /^\.postal \.pg-switch$/, why: "the switch track, a pill at half its 20px height" },
	{ value: /^0\s*!important$/, selector: /scrollbar-thumb|\.pg-cw/, why: "square scrollbars and the full-screen mobile composer" },
	{ value: /^max\(6px, calc\(var\(--window-corner\) - \d+px\)\)\s*!important$/, selector: /^:root\[data-os="mac"\]/, why: "controls in macOS's round window corners (WON-232)" },
];

test("postal styles use the 6px radius, with only the documented exceptions (DESIGN.md)", () => {
	const problems = [];
	for (const { selector, decls } of cssBlocks(POSTAL_CSS)) {
		for (const [prop, value] of decls) {
			if (!/radius$/.test(prop)) continue;
			const plain = value.replace(/\s*!important$/, "");
			if (plain.split(/\s+/).every((v) => v === "6px" || v === "0")) continue;
			if (RADIUS_EXCEPTIONS.some((e) => e.value.test(value) && e.selector.test(selector))) continue;
			problems.push(`${selector} { ${prop}: ${value} }`);
		}
	}
	assert.deepEqual(problems, [], `Radius outside the rule:\n  ${problems.join("\n  ")}`);
});

// A one-sided border under the global radius curls at both ends, so every divider is square.
test("postal dividers are straight: one-sided borders opt out of the radius (DESIGN.md)", () => {
	const blocks = cssBlocks(POSTAL_CSS);
	const square = blocks.find(({ selector, decls }) => selector.startsWith(".postal :is(") && decls.some(([p, v]) => p === "border-radius" && /^0\s*!important$/.test(v)));
	assert.ok(square, "missing the .postal :is(...) { border-radius: 0 !important } rule");
	const listed = new Set(square.selector.replace(/^\.postal :is\(/, "").replace(/\)$/, "").split(",").map((s) => s.trim()));
	// A selector with its own radius rule sets its corners itself (the send split's caret squares its divider side).
	const ownRadius = new Set(blocks.filter(({ decls }) => decls.some(([p]) => p === "border-radius")).flatMap(({ selector }) => selector.split(",").map((s) => s.trim().replace(/^\.postal\s+/, ""))));
	const missing = [];
	for (const { selector, decls } of blocks) {
		const oneSide = decls.some(([p, v]) => /^border-(top|right|bottom|left)$/.test(p) && !/^(0|none)\b/.test(v));
		const zeroedSides = decls.filter(([p, v]) => /^border-(top|right|bottom|left)$/.test(p) && /^(0|none)\b/.test(v)).length;
		if (!oneSide && zeroedSides < 3) continue;
		for (const part of selector.split(",").map((s) => s.trim())) {
			if (!listed.has(part) && !ownRadius.has(part)) missing.push(part);
		}
	}
	assert.deepEqual(missing, [], `Add these to the square-divider rule in postal.css:\n  ${missing.join("\n  ")}`);
});

test("postal domain shapes come from clip-path on .pg-shape-* only, and none is round", () => {
	const problems = [];
	const shapes = new Set();
	for (const { selector, decls } of cssBlocks(POSTAL_CSS)) {
		for (const [prop, value] of decls) {
			if (prop !== "clip-path" && !/^(-webkit-)?mask/.test(prop)) continue;
			if (/^(-webkit-)?mask/.test(prop) && /pg-reader-to|pg-attach-name/.test(selector)) continue; // text fades, not shapes
			if (prop === "clip-path" && /^\.pg-sw(\[data-open="false"\])?$/.test(selector) && /^inset\([^)]*\)$/.test(value)) continue; // the search window's reveal, a rectangle, not a shape
			if (!/^\.pg-shape-[a-z]+$/.test(selector)) problems.push(`${selector} { ${prop}: ${value} }`);
			else if (/circle|ellipse|round/.test(value)) problems.push(`${selector} is round`);
			else shapes.add(selector);
		}
	}
	assert.deepEqual(problems, []);
	for (const shape of ["diamond", "triangle", "hexagon"]) assert.ok(shapes.has(`.pg-shape-${shape}`), `missing .pg-shape-${shape}`);
});


// WON-399: text and icons stay on DESIGN.md's scales (type 10, 11, 12, 13, 15, 22, 26; icons 10, 12, 14, 16, 20).
test("postal text is never 14px, between the 13 and 15 steps (DESIGN.md)", () => {
	const problems = [];
	for (const { selector, decls } of cssBlocks(POSTAL_CSS)) {
		for (const [prop, value] of decls) if (prop === "font-size" && /^14px/.test(value)) problems.push(`${selector} { font-size: ${value} }`);
	}
	assert.deepEqual(problems, []);
});

test("Phosphor icons use the icon scale (DESIGN.md)", () => {
	const ICON_SCALE = new Set([10, 12, 14, 16, 20]);
	const problems = [];
	const walk = (dir) => {
		for (const name of readdirSync(dir)) {
			const path = join(dir, name);
			if (statSync(path).isDirectory()) walk(path);
			else if (/\.tsx$/.test(name)) {
				for (const m of readFileSync(path, "utf8").matchAll(/Icon size=\{(\d+)\}/g)) {
					if (!ICON_SCALE.has(Number(m[1]))) problems.push(`${relative(ROOT, path)}: size={${m[1]}}`);
				}
			}
		}
	};
	walk(join(ROOT, "app"));
	assert.deepEqual(problems, []);
});
