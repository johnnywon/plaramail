// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

/**
 * Figures: how the product shows a count, a size or a length of time in a small space.
 *
 * Every figure is a number of at most six characters and a unit in caps, singular or plural
 * with the value ("1 EMAIL", "12,408 EMAILS"). The unit steps up before the number gets long, so
 * a figure always fits its cell. null means unknown: the caller shows "—" and keeps the unit.
 * DESIGN.md (Figures) has the rules; the console colophon is the first user.
 */

export interface Figure {
	/** The number as shown, six characters at most. */
	fig: string;
	/** The unit in caps, singular when the value is 1. */
	unit: string;
}

const known = (n: number | null | undefined): n is number => n != null && Number.isFinite(n) && n >= 0;
const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);
/** One decimal under 10 ("3.2"), none from 10 ("40"), dropping a trailing ".0". */
const short = (n: number) => (n < 10 ? String(Math.floor(n * 10) / 10) : String(Math.floor(n)));

/** A count of things: 12,408 up to 99,999, then 248k, then 2.4M. */
export function countFigure(n: number | null | undefined, one: string, many: string): Figure | null {
	if (!known(n)) return null;
	const v = Math.round(n);
	if (v < 1e5) return { fig: v.toLocaleString("en-US"), unit: plural(v, one, many) };
	if (v < 1e6) return { fig: `${Math.floor(v / 1e3)}k`, unit: many };
	return { fig: `${short(v / 1e6)}M`, unit: many };
}

const BYTE_UNITS = ["KB", "MB", "GB", "TB", "PB"];

/**
 * Bytes in decimal units: 600 KB, 412 MB, 1.39 GB, 48.6 GB, 1.28 TB. KB and MB are whole numbers;
 * GB and up keep three significant figures. A value that would round to 1000 steps up a unit
 * (999.6 MB is 1.00 GB, not 1000 MB), and so does 9.996 GB (10.0 GB, not 10.00).
 */
export function bytesFigure(b: number | null | undefined): Figure | null {
	if (!known(b)) return null;
	let v = b / 1e3;
	for (let i = 0; i < BYTE_UNITS.length; i++, v /= 1e3) {
		const last = i === BYTE_UNITS.length - 1;
		if (i < 2) {
			if (Math.round(v) < 1000 || last) return { fig: String(Math.round(v)), unit: BYTE_UNITS[i] };
			continue;
		}
		const fig = v < 9.995 ? v.toFixed(2) : v < 99.95 ? v.toFixed(1) : v.toFixed(0);
		if (Number(fig) < 1000 || last) return { fig, unit: BYTE_UNITS[i] };
	}
	return null;
}

const MINUTE = 60;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;
/** The average month and year, so twelve months make a year. */
const YEAR = 365.2425 * DAY;
const MONTH = YEAR / 12;

/**
 * A length of time, in the largest unit that still reads as a number you can picture:
 * minutes under an hour, hours under two days, days under two weeks, weeks under eight weeks,
 * months under two years, then years.
 * 45 MINS, 3 HRS, 47 HRS, 2 DAYS, 3.2 DAYS, 13 DAYS, 2 WKS, 5.7 WKS, 1.8 MOS, 11 MOS, 23 MOS, 2 YRS, 10 YRS.
 * Rounds down, so the figure never claims more time than has passed.
 */
export function durationFigure(seconds: number | null | undefined): Figure | null {
	if (!known(seconds)) return null;
	if (seconds < HOUR) {
		const m = Math.floor(seconds / MINUTE);
		return { fig: String(m), unit: plural(m, "MIN", "MINS") };
	}
	if (seconds < 2 * DAY) {
		const h = Math.floor(seconds / HOUR);
		return { fig: String(h), unit: plural(h, "HR", "HRS") };
	}
	const step = (n: number, one: string, many: string): Figure => {
		const fig = short(n);
		return { fig, unit: fig === "1" ? one : many };
	};
	if (seconds < 2 * WEEK) return step(seconds / DAY, "DAY", "DAYS");
	if (seconds < 8 * WEEK) return step(seconds / WEEK, "WK", "WKS");
	if (seconds < 2 * YEAR) return step(seconds / MONTH, "MO", "MOS");
	return step(seconds / YEAR, "YR", "YRS");
}

/** Seconds since an ISO time, or null when there is no time to count from. */
export function secondsSince(iso: string | null | undefined, now = Date.now()): number | null {
	const t = iso ? Date.parse(iso) : NaN;
	return Number.isFinite(t) ? Math.max(0, (now - t) / 1000) : null;
}

/** What a screen reader hears for a figure: "Storage: 1.39 gb", or "Storage: unavailable". */
export function figureLabel(label: string, f: Figure | null): string {
	return f ? `${label}: ${f.fig} ${f.unit.toLowerCase()}` : `${label}: unavailable`;
}
