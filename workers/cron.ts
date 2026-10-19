// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

/**
 * The one-minute cron. It sends due scheduled mail, then, when
 * ATTACHMENT_SEARCH is "true", converts a few attachments to searchable text.
 * Once an hour it deletes activity and auto-draft runs past the retention,
 * marks failed the auto-draft runs whose worker died, and, when prefs set
 * trashDays, purges mail that has been in Trash or Spam that long. Steps
 * that fail are recorded, and the hourly alert mails them to ALERT_TO.
 */
import { failAbandonedRuns, pruneRuns } from "./agent/runs";
import { pruneActivity } from "./lib/activity";
import { recordError, sendAlerts } from "./lib/alerts";
import { DEMO } from "./lib/demo";
import { resetDemo } from "./lib/dev-seed";
import { readPrefs } from "./lib/prefs";
import { extractAttachmentTextBatch, mailStore, sendDueScheduledMail, recordsSql } from "./store";
import type { Env } from "./types";

/** Delete activity log rows and auto-draft runs older than the retention in prefs; fail abandoned runs. */
export async function pruneAgentHistory(env: Env, now = Date.now()) {
	const { prefs } = await readPrefs(env);
	const sql = recordsSql(env);
	return {
		days: prefs.activityDays,
		activity: await pruneActivity(sql, prefs.activityDays, now),
		runs: await pruneRuns(sql, prefs.activityDays, now),
		abandoned: await failAbandonedRuns(sql, now),
	};
}

/** Purge Trash and Spam past prefs.trashDays (WON-212). Off (0) does nothing. */
export async function purgeTrashRetention(env: Env, now = Date.now()) {
	const { prefs } = await readPrefs(env);
	if (!prefs.trashDays) return null;
	return { days: prefs.trashDays, ...(await mailStore(env).all().purgeRetention(prefs.trashDays, now)) };
}

export async function runCron(env: Env, now = Date.now()) {
	// A demo sends nothing. Once an hour it writes the sample inbox again over what visitors changed.
	if (DEMO) return { demo: new Date(now).getUTCMinutes() === 0 ? await resetDemo(env, now) : null };
	const failed = (source: string) => async (e: unknown) => {
		console.error(`${source} failed:`, (e as Error).message);
		await recordError(env, source, e, now);
		return null;
	};
	const hourly = new Date(now).getUTCMinutes() === 0;
	const scheduled = await sendDueScheduledMail(env, now);
	if (scheduled.failed.length > 0) {
		console.error(`scheduled send failed for ${scheduled.failed.length} message(s)`);
		await recordError(env, "scheduled-send", `${scheduled.failed.length} scheduled message(s) failed to send`, now);
	}
	const attachments = String(env.ATTACHMENT_SEARCH ?? "") === "true"
		? await extractAttachmentTextBatch(env, now).catch(failed("attachment text"))
		: null;
	const pruned = hourly ? await pruneAgentHistory(env, now).catch(failed("activity prune")) : null;
	const purged = hourly ? await purgeTrashRetention(env, now).catch(failed("trash purge")) : null;
	// Last, so it reports this run's failures too.
	const alerted = hourly
		? await sendAlerts(env, now).catch((e) => {
			console.error("alert mail failed:", (e as Error).message);
			return null;
		})
		: null;
	return { scheduled, attachments, pruned, purged, alerted };
}
