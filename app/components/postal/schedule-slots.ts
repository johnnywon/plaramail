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
