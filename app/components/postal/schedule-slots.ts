// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

/** The Schedule send menu's quick slots, in local time. A slot at the same time as an earlier one is left out. */
export function scheduleSlots(now = new Date()): [string, Date][] {
	const nextDay = (add: number, hour: number) => {
		const d = new Date(now);
		d.setDate(d.getDate() + add);
		d.setHours(hour, 0, 0, 0);
		return d;
	};
	const toMonday = (8 - now.getDay()) % 7 || 7;
	const slots: [string, Date][] = [
		["Tomorrow morning", nextDay(1, 8)],
		["Tomorrow afternoon", nextDay(1, 13)],
		["Monday morning", nextDay(toMonday, 8)],
	];
	return slots.filter(([, at], i) => !slots.slice(0, i).some(([, earlier]) => earlier.getTime() === at.getTime()));
}

/** Send later reaches one year ahead, inside the server's 366-day limit (workers/lib/scheduled-send.ts). */
export const SCHEDULE_MAX_DAYS = 365;

/** The last day Send later offers, as yyyy-mm-dd in local time. */
export function lastScheduleDay(now = new Date()): string {
	const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + SCHEDULE_MAX_DAYS);
	return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Whether a Send later time is at least a minute away and no later than the last day. */
export function inScheduleRange(at: Date, now = new Date()): boolean {
	const t = at.getTime();
	if (Number.isNaN(t) || t <= now.getTime() + 60_000) return false;
	const end = new Date(now.getFullYear(), now.getMonth(), now.getDate() + SCHEDULE_MAX_DAYS + 1);
	return t < end.getTime() && t < now.getTime() + 366 * 864e5;
}
