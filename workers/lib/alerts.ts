// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

/**
 * Error alerts (WON-220). The Worker records what fails (requests that throw,
 * inbound mail it can't store, cron steps) in error_log. Once an hour, when
 * ALERT_TO is set, the cron runs the health check and mails ALERT_TO from the
 * first address in EMAIL_ADDRESSES if the check failed or anything was
 * recorded since the last alert. Recording never fails the work it records.
 */
import { sendEmail } from "../email-sender";
import { recordsSql } from "../store";
import type { Env } from "../types";
import { configuredAddresses } from "./addresses";
import { checkHealth, type Health } from "./health";

/** Unsent rows kept at most, so a loop that fails every request can't fill the table. */
export const ERROR_LOG_CAP = 200;
/** Errors listed in one alert mail; the rest are counted. */
export const ALERT_LIST = 20;
const KEEP_DAYS = 30;
const MESSAGE_CHARS = 500;

export async function recordError(env: Pick<Env, "DB">, source: string, error: unknown, now = Date.now()): Promise<void> {
	const message = (error instanceof Error ? error.message : String(error)).slice(0, MESSAGE_CHARS) || "(no message)";
	try {
		await recordsSql(env as Env).run(
			`INSERT INTO error_log (at, source, message)
			 SELECT ?, ?, ? WHERE (SELECT COUNT(*) FROM error_log WHERE alerted_at IS NULL) < ?`,
			new Date(now).toISOString(), source, message, ERROR_LOG_CAP,
		);
	} catch (e) {
		console.error("error log write failed:", (e as Error).message);
	}
}

interface ErrorRow {
	id: number;
	at: string;
	source: string;
	message: string;
	[key: string]: unknown;
}

export function alertMail(appName: string, health: Health, rows: ErrorRow[], total: number) {
	const lines: string[] = [];
	for (const [name, check] of [["D1", health.d1], ["R2", health.r2]] as const) {
		if (!check.ok) lines.push(`Health check: ${name} failed: ${check.error ?? "no reason given"}`);
	}
	if (lines.length) lines.push("");
	if (total > 0) {
		lines.push(`${total} error${total === 1 ? "" : "s"} since the last alert:`, "");
		for (const row of rows) lines.push(`${row.at}  ${row.source}  ${row.message}`);
		if (total > rows.length) lines.push(`… and ${total - rows.length} more.`);
		lines.push("", "Worker logs have the full details.");
	}
	const subject = !health.ok
		? `${appName}: health check failed`
		: `${appName}: ${total} error${total === 1 ? "" : "s"}`;
	return { subject, text: lines.join("\n") };
}

/** The hourly alert. Returns null when ALERT_TO is unset or there is nothing to send. */
export async function sendAlerts(env: Env, now = Date.now()) {
	const to = String(env.ALERT_TO ?? "").trim();
	const from = configuredAddresses(env)[0];
	if (!to || !from) return null;

	const health = await checkHealth(env);
	let rows: ErrorRow[] = [];
	let total = 0;
	let last = 0;
	const sql = recordsSql(env);
	if (health.d1.ok) {
		await sql.run(`DELETE FROM error_log WHERE at < ?`, new Date(now - KEEP_DAYS * 86_400_000).toISOString());
		const unsent = await sql.first<{ n: number; last: number | null }>(
			`SELECT COUNT(*) AS n, MAX(id) AS last FROM error_log WHERE alerted_at IS NULL`,
		);
		total = Number(unsent?.n ?? 0);
		last = Number(unsent?.last ?? 0);
		rows = await sql.all<ErrorRow>(
			`SELECT id, at, source, message FROM error_log WHERE alerted_at IS NULL AND id <= ? ORDER BY id LIMIT ?`,
			last, ALERT_LIST,
		);
	}
	if (health.ok && total === 0) return null;

	const { subject, text } = alertMail(String(env.APP_NAME || "PluraMail"), health, rows, total);
	await sendEmail(env.EMAIL, { to, from, subject, text });
	if (health.d1.ok) {
		await sql.run(`UPDATE error_log SET alerted_at = ? WHERE alerted_at IS NULL AND id <= ?`, new Date(now).toISOString(), last);
	}
	return { to, subject, errors: total, healthy: health.ok };
}
