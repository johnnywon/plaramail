// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

// Every sender's look in the Alex profile: tokens, logos, an email shell per
// brand, signatures and the small parts designed mail is built from.
//
// Real vendors use their published logo files (vendor/, with sources in
// manifest.json); invented companies and people have original marks
// (original/). The mail renders in a sandboxed frame that loads no web fonts,
// so every brand font is listed with the system stack that stands in for it.

import { esc } from "../../kit";
import { LOGOS } from "./logos";

export type LogoId = keyof typeof LOGOS;

export interface Brand {
	name: string;
	/** Header logo: a logo file, or a mark beside the name set as live text. */
	logo: { id: LogoId; width: number; height: number } | { mark: LogoId; text: string; font?: string; weight?: number; size?: number; color?: string };
	ink: string;
	muted: string;
	accent: string;
	/** Behind the card. */
	paper: string;
	card: string;
	rule: string;
	font: string;
	/** The brand's own typeface, when the system stack only stands in for it. */
	brandFont?: string;
	mono?: string;
	radius: number;
	/** Card border, or none for flat brands. */
	border: boolean;
	headerPad: number;
	bodyPad: number;
	/** Header row under its own rule. */
	headerRule: boolean;
	heading: [size: number, line: number, weight: number];
	body: [size: number, line: number];
	button: { bg: string; fg: string; radius: number; height: number; pad: number };
	headingFont?: string;
}

const SANS = "-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif";
const HELV = "'Helvetica Neue',Helvetica,Arial,sans-serif";
const SERIF = "Georgia,'Times New Roman',serif";
const MONO = "ui-monospace,SFMono-Regular,Menlo,Consolas,monospace";

export const BRANDS = {
	// ── Real vendors (published logos, demo tokens) ──
	ubereats: { name: "Uber Eats", logo: { id: "ubereats-wordmark", width: 140, height: 25 }, ink: "#111111", muted: "#5E5E5E", accent: "#06C167", paper: "#F3F3F3", card: "#FFFFFF", rule: "#E2E2E2", font: HELV, brandFont: "UberMove / UberMoveText", radius: 0, border: false, headerPad: 32, bodyPad: 32, headerRule: false, heading: [30, 36, 700], body: [16, 24], button: { bg: "#000000", fg: "#FFFFFF", radius: 8, height: 48, pad: 20 } },
	vercel: { name: "Vercel", logo: { id: "vercel-logotype", width: 141, height: 28 }, ink: "#0A0A0A", muted: "#666666", accent: "#0A0A0A", paper: "#FAFAFA", card: "#FFFFFF", rule: "#EAEAEA", font: SANS, brandFont: "Geist Sans / Geist Mono", mono: MONO, radius: 6, border: true, headerPad: 24, bodyPad: 24, headerRule: true, heading: [24, 30, 600], body: [14, 22], button: { bg: "#000000", fg: "#FFFFFF", radius: 6, height: 40, pad: 16 } },
	xai: { name: "xAI", logo: { id: "xai-logo", width: 62, height: 44 }, ink: "#0A0A0A", muted: "#A1A1A1", accent: "#0A0A0A", paper: "#FFFFFF", card: "#FFFFFF", rule: "#292929", font: HELV, brandFont: "grotesk sans (substituted)", mono: MONO, radius: 0, border: false, headerPad: 24, bodyPad: 24, headerRule: true, heading: [28, 34, 500], body: [15, 24], button: { bg: "#0A0A0A", fg: "#FFFFFF", radius: 22, height: 44, pad: 24 } },
	github: { name: "GitHub", logo: { id: "github-lockup", width: 140, height: 32 }, ink: "#1F2328", muted: "#59636E", accent: "#0969DA", paper: "#F6F8FA", card: "#FFFFFF", rule: "#D0D7DE", font: SANS, mono: MONO, radius: 6, border: true, headerPad: 20, bodyPad: 24, headerRule: true, heading: [22, 28, 600], body: [14, 21], button: { bg: "#1F883D", fg: "#FFFFFF", radius: 6, height: 40, pad: 16 } },
	cloudflare: { name: "Cloudflare", logo: { id: "cloudflare-logo", width: 136, height: 46 }, ink: "#1A1A1A", muted: "#595959", accent: "#F48120", paper: "#F7F7F8", card: "#FFFFFF", rule: "#E5E7EB", font: SANS, radius: 4, border: true, headerPad: 24, bodyPad: 28, headerRule: true, heading: [24, 30, 700], body: [15, 23], button: { bg: "#F48120", fg: "#1A1A1A", radius: 6, height: 42, pad: 18 } },
	supabase: { name: "Supabase", logo: { id: "supabase-wordmark", width: 144, height: 28 }, ink: "#171717", muted: "#707070", accent: "#3ECF8E", paper: "#FAFAFA", card: "#FFFFFF", rule: "#E5E5E5", font: SANS, brandFont: "Manrope (boards only)", mono: MONO, radius: 6, border: true, headerPad: 24, bodyPad: 24, headerRule: true, heading: [24, 30, 600], body: [14, 22], button: { bg: "#3ECF8E", fg: "#171717", radius: 6, height: 40, pad: 16 } },
	stripe: { name: "Stripe", logo: { id: "stripe-wordmark", width: 96, height: 40 }, ink: "#0A2540", muted: "#596171", accent: "#635BFF", paper: "#F6F9FC", card: "#FFFFFF", rule: "#E3E8EE", font: HELV, brandFont: "Söhne", radius: 8, border: false, headerPad: 32, bodyPad: 32, headerRule: false, heading: [22, 28, 600], body: [15, 24], button: { bg: "#635BFF", fg: "#FFFFFF", radius: 6, height: 44, pad: 20 } },
	resend: { name: "Resend", logo: { id: "resend-wordmark", width: 132, height: 28 }, ink: "#000000", muted: "#737373", accent: "#000000", paper: "#FFFFFF", card: "#FFFFFF", rule: "#E5E5E5", font: SANS, mono: MONO, radius: 6, border: true, headerPad: 24, bodyPad: 24, headerRule: true, heading: [24, 30, 600], body: [14, 22], button: { bg: "#000000", fg: "#FFFFFF", radius: 6, height: 40, pad: 16 } },
	claude: { name: "Claude", logo: { id: "claude-logo", width: 131, height: 28 }, ink: "#191919", muted: "#6B6862", accent: "#D97757", paper: "#F5F3EE", card: "#FFFDF9", rule: "#E2DDD3", font: SANS, headingFont: SERIF, brandFont: "Anthropic Serif / Sans (substituted)", radius: 8, border: true, headerPad: 28, bodyPad: 28, headerRule: true, heading: [26, 32, 500], body: [15, 24], button: { bg: "#191919", fg: "#FFFFFF", radius: 8, height: 42, pad: 18 } },
	openai: { name: "OpenAI", logo: { id: "openai-wordmark", width: 103, height: 28 }, ink: "#111111", muted: "#6B6B6B", accent: "#111111", paper: "#FFFFFF", card: "#FFFFFF", rule: "#E5E5E5", font: SANS, brandFont: "OpenAI Sans (substituted)", mono: MONO, radius: 0, border: false, headerPad: 28, bodyPad: 28, headerRule: true, heading: [26, 32, 600], body: [15, 24], button: { bg: "#111111", fg: "#FFFFFF", radius: 22, height: 44, pad: 22 } },
	cursor: { name: "Cursor", logo: { id: "cursor-lockup", width: 118, height: 28 }, ink: "#14120B", muted: "#85837A", accent: "#14120B", paper: "#F7F7F4", card: "#FFFFFF", rule: "#DDDCD5", font: SANS, mono: MONO, radius: 8, border: true, headerPad: 24, bodyPad: 24, headerRule: true, heading: [24, 30, 600], body: [14, 22], button: { bg: "#14120B", fg: "#F7F7F4", radius: 6, height: 40, pad: 16 } },
	linear: { name: "Linear", logo: { mark: "linear-mark", text: "Linear", weight: 600, size: 22 }, ink: "#171717", muted: "#6B6F76", accent: "#5E6AD2", paper: "#F7F8FA", card: "#FFFFFF", rule: "#E5E7EB", font: SANS, radius: 8, border: true, headerPad: 24, bodyPad: 24, headerRule: true, heading: [24, 30, 600], body: [14, 22], button: { bg: "#5E6AD2", fg: "#FFFFFF", radius: 6, height: 40, pad: 16 } },
	figma: { name: "Figma", logo: { mark: "figma-mark", text: "Figma", weight: 600, size: 22 }, ink: "#1E1E1E", muted: "#757575", accent: "#1E1E1E", paper: "#FFFFFF", card: "#FFFFFF", rule: "#E6E6E6", font: SANS, radius: 0, border: false, headerPad: 24, bodyPad: 24, headerRule: true, heading: [22, 28, 600], body: [14, 22], button: { bg: "#1E1E1E", fg: "#FFFFFF", radius: 6, height: 44, pad: 18 } },
	notes: { name: "Notes", logo: { mark: "affine-mark", text: "Notes", weight: 600, size: 22 }, ink: "#1F2329", muted: "#6B7280", accent: "#4A6FA5", paper: "#F4F5F7", card: "#FFFFFF", rule: "#E3E5E8", font: SANS, radius: 8, border: true, headerPad: 24, bodyPad: 24, headerRule: true, heading: [22, 28, 600], body: [14, 22], button: { bg: "#1F2329", fg: "#FFFFFF", radius: 6, height: 40, pad: 16 } },

	// ── Invented companies (original marks) ──
	partwell: { name: "Partwell", logo: { mark: "partwell", text: "Partwell", weight: 600, size: 23, color: "#162127" }, ink: "#162127", muted: "#5B6B66", accent: "#0F766E", paper: "#FAFCFB", card: "#FFFFFF", rule: "#D8E3DF", font: SANS, brandFont: "Inter / IBM Plex Mono", mono: MONO, radius: 6, border: true, headerPad: 28, bodyPad: 28, headerRule: true, heading: [26, 32, 600], body: [15, 24], button: { bg: "#0F766E", fg: "#FFFFFF", radius: 6, height: 42, pad: 18 } },
	buildnotes: { name: "Build Notes", logo: { mark: "buildnotes", text: "build notes", font: SERIF, weight: 400, size: 27, color: "#27251F" }, ink: "#27251F", muted: "#6E6A60", accent: "#A74C2B", paper: "#F3EFE6", card: "#FFFDF7", rule: "#E6E0D5", font: SANS, headingFont: SERIF, brandFont: "Libre Baskerville / Source Sans 3", radius: 0, border: false, headerPad: 28, bodyPad: 28, headerRule: true, heading: [28, 36, 400], body: [16, 26], button: { bg: "#A74C2B", fg: "#FFFFFF", radius: 0, height: 40, pad: 16 } },
	keyforge: { name: "Keyforge Keys", logo: { mark: "keyforge", text: "Keyforge Keys", weight: 700, size: 22, color: "#1D1B28" }, ink: "#1D1B28", muted: "#6B6780", accent: "#6D4AFF", paper: "#F4F2FA", card: "#FFFFFF", rule: "#E3DEEF", font: SANS, brandFont: "Space Grotesk / Inter", radius: 8, border: false, headerPad: 24, bodyPad: 28, headerRule: true, heading: [26, 32, 700], body: [15, 24], button: { bg: "#6D4AFF", fg: "#FFFFFF", radius: 8, height: 44, pad: 20 } },
	launchboard: { name: "Launchboard Directory", logo: { mark: "launchboard", text: "Launchboard", weight: 700, size: 22, color: "#26334D" }, ink: "#26334D", muted: "#6A7180", accent: "#D94D35", paper: "#FFF1E9", card: "#FFFFFF", rule: "#EEDDD3", font: SANS, brandFont: "DM Sans", radius: 6, border: false, headerPad: 24, bodyPad: 28, headerRule: true, heading: [24, 30, 700], body: [15, 24], button: { bg: "#D94D35", fg: "#FFFFFF", radius: 6, height: 44, pad: 20 } },
	fieldstone: { name: "Fieldstone Catalogs", logo: { mark: "fieldstone", text: "Fieldstone Catalogs", font: SERIF, weight: 400, size: 22, color: "#353C35" }, ink: "#353C35", muted: "#6E746B", accent: "#788A70", paper: "#F5F2E9", card: "#FFFFFF", rule: "#D9D6CD", font: SANS, headingFont: SERIF, brandFont: "Libre Baskerville / Source Sans 3", radius: 0, border: true, headerPad: 28, bodyPad: 32, headerRule: true, heading: [22, 30, 400], body: [14, 22], button: { bg: "#353C35", fg: "#FFFFFF", radius: 0, height: 40, pad: 18 } },
	league: { name: "Sunday Deploy League", logo: { mark: "sunday-deploy-league", text: "SUNDAY DEPLOY LEAGUE", font: "'Arial Narrow',Arial,sans-serif", weight: 800, size: 21, color: "#FFF9E9" }, ink: "#14223B", muted: "#69758A", accent: "#286B45", paper: "#14223B", card: "#FFF9E9", rule: "#E5DCC4", font: SANS, headingFont: "'Arial Narrow',Arial,sans-serif", brandFont: "Barlow Condensed / Inter", radius: 6, border: false, headerPad: 20, bodyPad: 24, headerRule: false, heading: [28, 32, 800], body: [14, 22], button: { bg: "#286B45", fg: "#FFFFFF", radius: 6, height: 42, pad: 18 } },
	latecommits: { name: "The Late Commits", logo: { mark: "late-commits", text: "THE LATE COMMITS", weight: 800, size: 19, color: "#E8E4DA" }, ink: "#1B1B1F", muted: "#6D6A63", accent: "#F2545B", paper: "#1B1B1F", card: "#FAF7F0", rule: "#E2DCCF", font: SANS, radius: 4, border: false, headerPad: 20, bodyPad: 24, headerRule: false, heading: [26, 32, 800], body: [15, 24], button: { bg: "#F2545B", fg: "#1B1B1F", radius: 4, height: 42, pad: 18 } },
	riverbend: { name: "Riverbend Code Club", logo: { mark: "riverbend-code-club", text: "Riverbend Code Club", weight: 700, size: 21, color: "#2B3A42" }, ink: "#2B3A42", muted: "#5E6D73", accent: "#1F7A8C", paper: "#E6F2EF", card: "#FFFFFF", rule: "#D3E4E0", font: SANS, radius: 8, border: false, headerPad: 24, bodyPad: 28, headerRule: true, heading: [24, 30, 700], body: [15, 24], button: { bg: "#1F7A8C", fg: "#FFFFFF", radius: 8, height: 42, pad: 18 } },
} satisfies Record<string, Brand>;

export type BrandId = keyof typeof BRANDS;

// ── Logos ───────────────────────────────────────────────────────────

/** A logo file as an image. `alt` is empty unless the logo is the only place a name appears. */
export function logo(id: LogoId, width: number, height: number, alt = ""): string {
	// The reader styles every image max-width:100%; a min-width keeps a logo its size in a narrow cell.
	return `<img src="${LOGOS[id]}" width="${width}" height="${height}" alt="${esc(alt)}" style="display:block;border:0;width:${width}px;min-width:${width}px;max-width:none;height:${height}px">`;
}

function header(b: Brand): string {
	if ("id" in b.logo) return logo(b.logo.id, b.logo.width, b.logo.height, b.name);
	const l = b.logo;
	return `<table cellpadding="0" cellspacing="0" role="presentation"><tr><td width="40" style="width:40px;min-width:40px;vertical-align:middle">${logo(l.mark, 40, 40)}</td><td style="padding-left:12px;vertical-align:middle;font-family:${l.font ?? b.font};font-size:${l.size ?? 22}px;line-height:1.1;font-weight:${l.weight ?? 600};color:${l.color ?? b.ink};letter-spacing:${l.text === l.text.toUpperCase() ? "0.06em" : "-0.01em"}">${esc(l.text)}</td></tr></table>`;
}

// ── The shell ───────────────────────────────────────────────────────

export interface MailParts {
	/** Hidden first line: what the inbox list shows. */
	preheader: string;
	/** Small line above the heading. */
	eyebrow?: string;
	heading?: string;
	body: string;
	footer?: string;
}

/** A designed email in the brand's own layout: at most 600px wide, inline styles, presentation tables. */
export function mail(id: BrandId, parts: MailParts): string {
	const b: Brand = BRANDS[id];
	const dark = id === "league" || id === "latecommits";
	const card = `background:${b.card};${b.border ? `border:1px solid ${b.rule};` : ""}border-radius:${b.radius}px`;
	const head = `<tr><td style="padding:${b.headerPad}px ${b.bodyPad}px ${dark ? 0 : b.headerPad}px;${b.headerRule ? `border-bottom:1px solid ${b.rule}` : ""}">${header(b)}</td></tr>`;
	return `<div style="background:${b.paper};padding:16px 0;font-family:${b.font};color:${b.ink}">
<div style="display:none;max-height:0;overflow:hidden">${esc(parts.preheader)}</div>
<table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="max-width:600px;margin:0 auto">${dark ? head : ""}<tr><td style="padding-top:${dark ? 20 : 0}px"><table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="${card}">
${dark ? "" : head}<tr><td style="padding:${b.bodyPad}px;font-size:${b.body[0]}px;line-height:${b.body[1]}px;color:${b.ink}">
${parts.eyebrow ? `<p style="margin:0 0 6px;font-size:12px;line-height:18px;color:${b.muted};letter-spacing:0.02em">${esc(parts.eyebrow)}</p>` : ""}
${parts.heading ? `<h1 style="margin:0 0 16px;font-family:${b.headingFont ?? b.font};font-size:${b.heading[0]}px;line-height:${b.heading[1]}px;font-weight:${b.heading[2]};color:${b.ink}">${esc(parts.heading)}</h1>` : ""}
${parts.body}
</td></tr>
${parts.footer ? `<tr><td style="padding:16px ${b.bodyPad}px ${b.bodyPad - 8}px;border-top:1px solid ${b.rule};font-size:12px;line-height:18px;color:${b.muted}">${parts.footer}</td></tr>` : ""}
</table></td></tr></table></div>`;
}

// ── Parts ───────────────────────────────────────────────────────────

export function para(id: BrandId, html: string, extra = ""): string {
	return `<p style="margin:0 0 14px;${extra}">${html}</p>`;
}

export function button(id: BrandId, label: string, href: string, secondary = false): string {
	const k = BRANDS[id].button;
	const b: Brand = BRANDS[id];
	const style = secondary
		? `background:transparent;color:${b.ink};border:1px solid ${b.rule}`
		: `background:${k.bg};color:${k.fg};border:1px solid ${k.bg}`;
	return `<p style="margin:20px 0 4px"><a href="${esc(href)}" style="display:inline-block;${style};text-decoration:none;font-weight:600;font-size:14px;line-height:${k.height - 2}px;height:${k.height - 2}px;padding:0 ${k.pad}px;border-radius:${k.radius}px">${esc(label)}</a></p>`;
}

/** Label and value rows with aligned figures. `total` rows sit under a rule in bold. */
export function rows(id: BrandId, items: ([string, string] | [string, string, "total" | "muted"])[], totalSize = 16): string {
	const b: Brand = BRANDS[id];
	return `<table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="margin:12px 0;font-size:${b.body[0]}px;font-variant-numeric:tabular-nums">${items.map(([k, v, s]) => {
		const top = s === "total" ? `border-top:1px solid ${b.ink};padding-top:12px;` : "";
		const weight = s === "total" ? `font-weight:700;font-size:${totalSize}px;` : "";
		const color = s === "muted" ? `color:${b.muted};` : "";
		return `<tr><td style="padding:7px 12px 7px 0;${top}${weight}${color}">${esc(k)}</td><td align="right" style="padding:7px 0;white-space:nowrap;${top}${weight}${color}">${esc(v)}</td></tr>`;
	}).join("")}</table>`;
}

/** A table with a header row, for metrics, DNS records and standings. The first column is text; the rest align right. */
export function grid(id: BrandId, head: string[], body: string[][], opts: { mono?: number[]; strong?: number } = {}): string {
	const b: Brand = BRANDS[id];
	const cell = (v: string, i: number, th: boolean, strong: boolean) =>
		`<td${i ? ' align="right"' : ""} style="padding:${th ? 6 : 9}px ${i ? 0 : 10}px ${th ? 6 : 9}px ${i ? 10 : 0};border-bottom:1px solid ${b.rule};${th ? `font-size:11px;letter-spacing:0.04em;text-transform:uppercase;color:${b.muted};font-weight:600` : ""}${opts.mono?.includes(i) && !th ? `font-family:${b.mono ?? MONO};font-size:13px;` : ""}${strong ? "font-weight:700;" : ""}">${v}</td>`;
	return `<table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="margin:14px 0;font-size:${b.body[0]}px;font-variant-numeric:tabular-nums">${`<tr>${head.map((h, i) => cell(esc(h), i, true, false)).join("")}</tr>`}${body.map((r, n) => `<tr>${r.map((v, i) => cell(v, i, false, n === opts.strong)).join("")}</tr>`).join("")}</table>`;
}

export function mono(id: BrandId, text: string): string {
	const b: Brand = BRANDS[id];
	return `<pre style="white-space:pre-wrap;word-break:break-word;margin:14px 0;padding:12px 14px;background:${b.paper === "#FFFFFF" ? "#F6F6F6" : b.paper};border:1px solid ${b.rule};border-radius:6px;font-family:${b.mono ?? MONO};font-size:12.5px;line-height:19px;color:${b.ink}">${esc(text)}</pre>`;
}

/** A status written out, with a small dot of colour beside it. */
export function status(label: string, tone: "ok" | "warn" | "bad" | "info"): string {
	const c = { ok: ["#1A7F37", "#DAFBE1"], warn: ["#9A6700", "#FFF8C5"], bad: ["#CF222E", "#FFEBE9"], info: ["#0969DA", "#DDF4FF"] }[tone];
	return `<span style="display:inline-block;padding:2px 10px 2px 8px;border-radius:12px;background:${c[1]};color:${c[0]};font-size:12px;line-height:18px;font-weight:600"><span style="display:inline-block;width:7px;height:7px;border-radius:4px;background:${c[0]};margin-right:6px;vertical-align:1px"></span>${esc(label)}</span>`;
}

/** Small key/value metadata: repository, branch, case number. */
export function meta(id: BrandId, items: [string, string][]): string {
	const b: Brand = BRANDS[id];
	return `<table cellpadding="0" cellspacing="0" role="presentation" style="margin:4px 0 14px;font-size:12px;line-height:18px">${items.map(([k, v]) => `<tr><td style="padding:2px 14px 2px 0;color:${b.muted};white-space:nowrap">${esc(k)}</td><td style="padding:2px 0;font-family:${b.mono ?? MONO};color:${b.ink}">${esc(v)}</td></tr>`).join("")}</table>`;
}

// ── People: avatars and signatures ──────────────────────────────────

export interface Signer {
	name: string;
	title?: string;
	org?: string;
	mark?: LogoId;
	/** Width of a wordmark set beside the mark; the mark alone otherwise. */
	link?: string;
	color?: string;
	font?: string;
}

/** A human signature: a 48px mark beside name and role at 13/20, as tall as the block beside it. */
export function signature(s: Signer): string {
	const lines = [s.title, s.org, s.link].filter(Boolean).map((l) => esc(l as string)).join("<br>");
	return `<table cellpadding="0" cellspacing="0" role="presentation" style="margin:20px 0 0;font-family:${s.font ?? SANS};font-size:13px;line-height:20px;color:#5b6168"><tr>${s.mark ? `<td width="48" style="width:48px;min-width:48px;vertical-align:middle;padding:0 14px 0 0">${logo(s.mark, 48, 48)}</td>` : ""}<td style="vertical-align:middle"><strong style="color:${s.color ?? "#1f2328"};font-weight:600;font-size:14px">${esc(s.name)}</strong>${lines ? `<br>${lines}` : ""}</td></tr></table>`;
}

export const SIGNERS = {
	alexPartwell: { name: "Alex Rivera", title: "Founder", org: "Partwell", link: "partwell.dev", mark: "partwell", color: "#162127" },
	alexSupport: { name: "Alex Rivera", title: "Partwell Support", link: "docs.partwell.dev", mark: "partwell", color: "#162127" },
	alexBilling: { name: "Alex Rivera", title: "Partwell Billing", link: "partwell.dev", mark: "partwell", color: "#162127" },
	alexBand: { name: "Alex Rivera", title: "Bass, booking", org: "The Late Commits", mark: "late-commits" },
	alexClub: { name: "Alex Rivera", title: "Treasurer (volunteer)", org: "Riverbend Code Club", link: "riverbendcode.org", mark: "riverbend-code-club" },
	ben: { name: "Ben Ortiz", title: "Developer", org: "Northline Parts", mark: "northline", color: "#17324D", font: "Arial,sans-serif" },
	nora: { name: "Nora Bell", title: "Bookkeeper", org: "Northline Parts", mark: "northline", color: "#17324D", font: "Arial,sans-serif" },
	lena: { name: "Lena Park", title: "Engineering Lead", org: "Cedar Supply", mark: "cedar", color: "#244B3C" },
	omar: { name: "Omar Reed", title: "Finance Manager", org: "Cedar Supply", link: "Accounts payable · cedarsupply.co", mark: "cedar", color: "#244B3C" },
	theo: { name: "Theo Martin", title: "Data Partnerships", org: "Atlas Dataworks", mark: "atlas", color: "#26374A" },
	evelyn: { name: "Evelyn Brooks", title: "Licensing Manager", org: "Fieldstone Catalogs", mark: "fieldstone", color: "#353C35", font: SERIF },
	tess: { name: "Tess Morgan", title: "CPA", org: "Morgan Ledger", link: "morganledger.com", mark: "morganledger", color: "#6B2D3E", font: "Arial,sans-serif" },
	mara: { name: "Mara Lewis", title: "Producer", org: "Westhaven Studio", mark: "westhaven", color: "#2447E8" },
	eli: { name: "Eli Santos", title: "Software Engineer", org: "Procura Works", link: "procuraworks.io/docs", mark: "procura", color: "#252442" },
	june: { name: "June Park", title: "Developer", org: "Harbor Assembly", mark: "harbor", color: "#174B60", font: "Arial,sans-serif" },
	miles: { name: "Miles Carter", title: "Partnerships", org: "Launchboard Directory", mark: "launchboard", color: "#26334D" },
	priya: { name: "Priya Shah", title: "Independent developer", link: "priyashah.dev", mark: "priya-shah", color: "#273542" },
	rae: { name: "Rae Collins", title: "Rae Collins Design", link: "raecollins.design", mark: "rae-collins", color: "#6C4B85" },
	sofia: { name: "Sofia Chen", title: "Support Engineer, Supabase", org: "Case DB-4821", mark: "supabase-icon" },
	jordan: { name: "Jordan Ellis", title: "Commissioner, Sunday Deploy League", mark: "sunday-deploy-league" },
} satisfies Record<string, Signer>;

/** Token record for docs/demo-alex.md and the tests: every brand with its colours and type. */
export function tokens(): Record<string, { ink: string; accent: string; paper: string; rule: string; font: string; brandFont?: string; heading: string; body: string; button: string }> {
	return Object.fromEntries(Object.entries(BRANDS).map(([id, b]: [string, Brand]) => [id, {
		ink: b.ink, accent: b.accent, paper: b.paper, rule: b.rule, font: b.font, brandFont: b.brandFont,
		heading: `${b.heading[0]}/${b.heading[1]}`, body: `${b.body[0]}/${b.body[1]}`, button: `${b.button.height}px, radius ${b.button.radius}`,
	}]));
}
