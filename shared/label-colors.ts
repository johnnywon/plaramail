// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

/**
 * Label palette. Label color appears only as a filled chip or a square
 * swatch of at least 8px; each fill has a text color that reads on it.
 */
export const LABEL_COLORS: readonly { bg: string; fg: string; name: string }[] = [
	{ bg: "#c8372d", fg: "#ffffff", name: "Red" },
	{ bg: "#d9822b", fg: "#1d1f21", name: "Orange" },
	{ bg: "#e2c044", fg: "#1d1f21", name: "Yellow" },
	{ bg: "#4f8a3c", fg: "#ffffff", name: "Green" },
	{ bg: "#2e8b84", fg: "#ffffff", name: "Teal" },
	{ bg: "#2f6db3", fg: "#ffffff", name: "Blue" },
	{ bg: "#5b4fb0", fg: "#ffffff", name: "Violet" },
	{ bg: "#b0457f", fg: "#ffffff", name: "Pink" },
	{ bg: "#7a5a3a", fg: "#ffffff", name: "Brown" },
	{ bg: "#5f6b74", fg: "#ffffff", name: "Slate" },
	{ bg: "#b9c4cb", fg: "#1d1f21", name: "Silver" },
	{ bg: "#2d2f31", fg: "#ffffff", name: "Graphite" },
];

export const DEFAULT_LABEL_COLOR = LABEL_COLORS[5].bg;

export function isLabelColor(value: string): boolean {
	return LABEL_COLORS.some((c) => c.bg === value.toLowerCase());
}

/** Text color for a label fill. Unknown fills get dark text. */
export function labelTextColor(bg: string): string {
	return LABEL_COLORS.find((c) => c.bg === bg.toLowerCase())?.fg ?? "#1d1f21";
}
