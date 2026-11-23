// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

// Local QA and demo builds (workers/lib/demo.ts). A lived-in sample inbox: about 470
// messages across every configured address, in every folder, with threads,
// attachments, labels, drafts, newsletters and spam, all from made-up
// companies on example.com, example.org and example.net.
//
// `ensureDevMail` runs when the dev server first answers an API request. It
// fills an inbox that has no sample mail, and moves existing sample mail
// forward so the newest message is minutes old. `seedMail` (POST
// /api/v1/dev/seed) wipes the sample mail and writes it again. Mail you
// created yourself is never touched. `resetDemo` (a demo build's hourly cron)
// wipes everything first. Set DEV_SEED=off in .dev.vars to skip it.
//
// SEED_PROFILE picks what gets written: the default inbox above, or `alex`,
// 47 messages for Alex Rivera across seven named mailboxes (alex/).

import { attachmentKey } from "../../store/d1/rows";
import { mailStore, mailboxIds, recordsSql } from "../../store";
import type { Env } from "../../types";
import { configuredAddresses } from "../addresses";
import { ALEX_FROM_NAMES, ALEX_LABELS, ALEX_PREFIX, ALEX_SEARCHES, buildAlex } from "./alex";
import { FROM_NAMES } from "./cast";
import { ID_PREFIX, type Inbox, LABELS, NEWEST_MINUTES, SEARCHES, addressOf, buildInbox, resolveAddresses, toStored } from "./build";
import type { Box, LabelSpec, Role } from "./kit";
import { StoryClock } from "./alex/clock";
import { type Restored, restoreSnapshot, takeSnapshot } from "./snapshot";
import { DEMO } from "../demo";

declare const __PLARAMAIL_TZ_OFFSET__: number | undefined;

export type SeedProfile = "default" | "alex";

/** The profile asked for (a /dev/seed body), else SEED_PROFILE, else the default inbox. */
export function seedProfile(env: Env, asked?: unknown): SeedProfile {
	return String(asked ?? env.SEED_PROFILE ?? "").trim().toLowerCase() === "alex" ? "alex" : "default";
}

interface Profile {
	prefix: string;
	labels: LabelSpec[];
	searches: { name: string; query: string }[];
	fromName(box: Box): string;
	build(env: Env, opts: { now: number; tzOffset: number; extra?: number }): Promise<Inbox>;
}

const PROFILES: Record<SeedProfile, Profile> = {
	default: {
		prefix: ID_PREFIX, labels: LABELS, searches: SEARCHES,
		fromName: (box) => FROM_NAMES[box as Role],
		build: async (env, o) => buildInbox({ ...o, addresses: await addressesFor(env) }),
	},
	// Seven addresses named outright, whatever EMAIL_ADDRESSES holds. Times are New York's, not the machine's.
	alex: {
		prefix: ALEX_PREFIX, labels: ALEX_LABELS, searches: ALEX_SEARCHES,
		fromName: (box) => ALEX_FROM_NAMES[box as keyof typeof ALEX_FROM_NAMES],
		build: async (_env, o) => buildAlex(o.now),
	},
};

export interface SeedSummary {
	profile: SeedProfile;
	messages: number;
	byFolder: Record<string, number>;
	unread: number;
	attachments: number;
	labels: number;
	addresses: Partial<Record<Box, string>>;
}

async function addressesFor(env: Env): Promise<Record<Role, string>> {
	const configured = configuredAddresses(env);
	return resolveAddresses(configured.length > 0 ? configured : await mailboxIds(env));
}

/** Remove one profile's sample mail, all its versions. The default also takes the "Sample message" rows the first seed route made. Other mail stays. */
async function purge(env: Env, profile: SeedProfile): Promise<void> {
	const sql = recordsSql(env);
	const family = profile === "alex" ? "seed-alex-" : "seed-mail-";
	if (profile === "alex") await sql.run(`DELETE FROM messages WHERE email_id LIKE 'seed-alex-%'`);
	// The first seed route's rows are told apart by their untouched body: one you edited stays. (D1 caps a LIKE pattern at 50 bytes.)
	else await sql.run(`DELETE FROM messages WHERE email_id LIKE 'seed-mail-%' OR (message_id LIKE '%@seed.local' AND body LIKE '<p>Sample message %' AND body LIKE '%a follow-up.</p>')`);
	let cursor: string | undefined;
	do {
		const page = await env.BUCKET.list({ prefix: `attachments/${family}`, cursor, limit: 1000 });
		if (page.objects.length > 0) await env.BUCKET.delete(page.objects.map((o) => o.key));
		cursor = page.truncated ? page.cursor : undefined;
	} while (cursor);
}

/** Wipe the sample mail and write it again. Returns what it wrote. */
export async function seedMail(env: Env, opts: { tzOffset?: number; extra?: number; now?: number; profile?: SeedProfile } = {}): Promise<SeedSummary> {
	const store = mailStore(env);
	const sql = recordsSql(env);
	const name = opts.profile ?? seedProfile(env);
	const profile = PROFILES[name];
	const now = opts.now ?? Date.now();
	const tz = opts.tzOffset ?? (typeof __PLARAMAIL_TZ_OFFSET__ === "number" ? __PLARAMAIL_TZ_OFFSET__ : 0);
	const inbox = await profile.build(env, { now, tzOffset: tz, extra: opts.extra });
	const stored = toStored(inbox, profile.prefix);

	for (const [box, addr] of Object.entries(inbox.addresses) as [Box, string][]) {
		if (!(await store.mailboxes.exists(addr))) {
			await store.mailboxes.put(addr, { fromName: profile.fromName(box), forwarding: { enabled: false, email: "" }, signature: { enabled: false, text: "" }, autoReply: { enabled: false, subject: "", message: "" } });
		}
	}

	await purge(env, name);

	const labelIds = new Map<string, string>();
	const existing = await store.all().listLabels();
	for (const spec of profile.labels) {
		const found = existing.find((l) => l.name.toLowerCase() === spec.name.toLowerCase());
		if (found) labelIds.set(spec.name, found.id);
		else {
			const made = await store.all().createLabel({ name: spec.name, color: spec.color });
			if ("label" in made && made.label) labelIds.set(spec.name, made.label.id);
		}
	}

	for (const s of stored) {
		await Promise.all(s.attachments.map((a) => env.BUCKET.put(attachmentKey(a), a.bytes, { httpMetadata: { contentType: a.mimetype } })));
		const mailbox = store.mailbox(addressOf(inbox, s.msg));
		await mailbox.createEmail(s.msg.folder, s.email, s.attachments);
		if (s.msg.draftNotes) await mailbox.setDraftNotes(s.email.id, s.msg.draftNotes);
	}

	for (const [name, id] of labelIds) {
		const ids = stored.filter((s) => s.msg.labels?.includes(name)).map((s) => s.id);
		if (ids.length > 0) await sql.run(`INSERT OR IGNORE INTO message_labels (message, label_id) SELECT id, ? FROM messages WHERE email_id IN (SELECT value FROM json_each(?))`, id, JSON.stringify(ids));
	}

	const saved = await store.all().listSavedSearches();
	for (const search of profile.searches) {
		if (!saved.some((s) => s.name === search.name)) await store.all().createSavedSearch(search);
	}

	const byFolder: Record<string, number> = {};
	for (const s of stored) byFolder[s.msg.folder] = (byFolder[s.msg.folder] ?? 0) + 1;
	return {
		profile: name, messages: stored.length, byFolder, unread: stored.filter((s) => !s.msg.read && s.msg.folder === "inbox").length,
		attachments: stored.reduce((n, s) => n + s.attachments.length, 0), labels: labelIds.size, addresses: inbox.addresses,
	};
}

/** Bump when the sample mail changes, so a demo drops its old copy and writes the inbox again. */
const SAMPLE_VERSION = 3;

/** The story version a copy of the inbox belongs to: the Alex profile moves in whole weeks, the default with the clock. */
function snapshotKey(profile: SeedProfile, now: number): string {
	return profile === "alex" ? `alex:${SAMPLE_VERSION}:${new StoryClock(now).shiftDays}` : `default:${SAMPLE_VERSION}`;
}

/**
 * A demo build's hourly reset: drop everything visitors made or changed (mail,
 * files, labels, saved searches, undo history, the activity log). It puts back
 * the copy taken after the last full write (snapshot.ts), which costs the
 * Worker almost no CPU. With no usable copy (first run, a new story week, a
 * sample message or file gone), it writes the inbox again and takes a new copy.
 */
export async function resetDemo(env: Env, now = Date.now()): Promise<SeedSummary | (Restored & { profile: SeedProfile; restored: true })> {
	const profile = seedProfile(env);
	const key = snapshotKey(profile, now);
	// A copy that can't be applied (the batch rolls back) gets replaced by a full write, not retried every hour.
	const restored = await restoreSnapshot(env, key, { now, shiftDates: profile !== "alex", maxAgeMs: 14 * 86_400_000 }).catch((e) => {
		console.error(`demo reset: restore failed, writing the inbox again: ${(e as Error).message}`);
		return null;
	});
	if (restored) return { profile, restored: true, ...restored };
	const sql = recordsSql(env);
	// A first request in another isolate sees an empty inbox while this runs; the marker tells it not to seed too.
	await env.BUCKET.put(RESET_MARKER, new Date(now).toISOString());
	try {
		for (const table of ["messages", "labels", "saved_searches", "bulk_job", "undo", "agent_activity", "auto_draft_runs"]) await sql.run(`DELETE FROM ${table}`);
		for (const prefix of ["attachments/", "bodies/"]) {
			let cursor: string | undefined;
			do {
				const page = await env.BUCKET.list({ prefix, cursor, limit: 1000 });
				if (page.objects.length > 0) await env.BUCKET.delete(page.objects.map((o) => o.key));
				cursor = page.truncated ? page.cursor : undefined;
			} while (cursor);
		}
		const summary = await seedMail(env, { now, profile });
		await takeSnapshot(env, key, now);
		return summary;
	} finally {
		await env.BUCKET.delete(RESET_MARKER);
	}
}

/** Set while a demo reset rewrites the inbox. Older than this, it's left from a reset that died. */
export const RESET_MARKER = "demo/reset-started";
const RESET_MARKER_TTL = 10 * 60_000;

async function resetRunning(env: Env): Promise<boolean> {
	const marker = await env.BUCKET.get(RESET_MARKER);
	if (!marker) return false;
	return Date.now() - Date.parse(await marker.text()) < RESET_MARKER_TTL;
}

/**
 * Move the sample mail forward when the server has been off for a while,
 * keeping what you read, starred and labelled. After two weeks the dates quoted
 * inside replies would be far off, so it writes the inbox again.
 */
async function refresh(env: Env, newest: string): Promise<string | null> {
	const delta = Date.now() - NEWEST_MINUTES * 60_000 - Date.parse(newest);
	if (delta < 30 * 60_000) return null;
	if (delta > 14 * 86_400_000) return `${(await seedMail(env)).messages} messages, replaced after ${Math.round(delta / 86_400_000)} days`;
	await recordsSql(env).run(
		`UPDATE messages SET date = strftime('%Y-%m-%dT%H:%M:%fZ', julianday(date) + ? / 86400000.0) WHERE email_id LIKE ?`,
		delta, `${ID_PREFIX}%`,
	);
	return `moved forward ${Math.round(delta / 3_600_000)} hours`;
}

/**
 * The Alex profile keeps its New York times of day, so it moves a week at a
 * time (alex/clock.ts). When the week has turned, write it again.
 */
async function refreshAlex(env: Env, newest: string): Promise<string | null> {
	const expected = Math.max(...buildAlex(Date.now()).messages.map((m) => m.at));
	if (new Date(expected).toISOString() === newest) return null;
	return `${(await seedMail(env, { profile: "alex" })).messages} messages, written again for this week`;
}

let started: Promise<void> | undefined;

/** Called on the dev server's first API request. Never throws: a failed seed must not break the app. */
export function ensureDevMail(env: Env): Promise<void> {
	started ??= (async () => {
		if (String(env.DEV_SEED ?? "").toLowerCase() === "off") return;
		try {
			// The hourly reset writes the inbox itself. Try again on a later request.
			if (await resetRunning(env)) {
				started = undefined;
				return;
			}
			const profile = seedProfile(env);
			const row = await recordsSql(env).first(`SELECT COUNT(*) AS n, MAX(date) AS newest FROM messages WHERE email_id LIKE ?`, `${PROFILES[profile].prefix}%`);
			// A demo's cron keeps its inbox current; rebuilding it here would cost every new isolate's first request.
			if (DEMO) {
				if (Number(row?.n) === 0) await resetDemo(env);
				return;
			}
			if (Number(row?.n) > 0) {
				const moved = profile === "alex" ? await refreshAlex(env, String(row?.newest)) : await refresh(env, String(row?.newest));
				if (moved) console.log(`[dev seed] sample inbox ${moved}`);
				return;
			}
			const t = Date.now();
			const summary = await seedMail(env);
			console.log(`[dev seed] ${summary.profile} sample inbox written: ${summary.messages} messages in ${Date.now() - t} ms (DEV_SEED=off in .dev.vars skips it)`);
		} catch (e) {
			console.warn(`[dev seed] skipped: ${(e as Error).message}. Run the D1 migrations first if the database is new.`);
		}
	})();
	return started;
}
