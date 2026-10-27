// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

/**
 * The unread count in the browser tab (WON-227): "(12) PlaraMail" in the
 * title and a badge drawn on the deployment's own favicon. At 0 both go back
 * to how the page loaded.
 */

import { useEffect } from "react";

/** The badge's text: the count, or 99+. */
export function badgeText(unread: number): string {
	return unread > 99 ? "99+" : String(unread);
}

/** The title with the count in front, replacing any count already there. */
export function unreadTitle(title: string, unread: number): string {
	const base = title.replace(/^\(\d+\+?\)\s+/, "");
	return unread > 0 ? `(${badgeText(unread)}) ${base}` : base;
}

const ICON_SIZE = 64;
/** The fold mark's Signal orange (DESIGN.md), with dark text. */
const BADGE_FILL = "#E46F2C";
const BADGE_TEXT = "#0c0d0f";

/** The favicon with the count drawn in its top-right corner, as a PNG data URL. */
async function badgedIcon(src: string, unread: number): Promise<string | null> {
	const img = new Image();
	img.src = src;
	try {
		await img.decode();
	} catch {
		return null;
	}
	const canvas = document.createElement("canvas");
	canvas.width = canvas.height = ICON_SIZE;
	const ctx = canvas.getContext("2d");
	if (!ctx) return null;
	ctx.drawImage(img, 0, 0, ICON_SIZE, ICON_SIZE);
	const text = badgeText(unread);
	const h = 34;
	ctx.font = `700 ${text.length > 2 ? 22 : 26}px system-ui, sans-serif`;
	const w = Math.max(h, ctx.measureText(text).width + 14);
	const x = ICON_SIZE - w;
	ctx.fillStyle = BADGE_FILL;
	ctx.beginPath();
	ctx.roundRect(x, 0, w, h, 6);
	ctx.fill();
	ctx.fillStyle = BADGE_TEXT;
	ctx.textAlign = "center";
	ctx.textBaseline = "middle";
	ctx.fillText(text, x + w / 2, h / 2 + 1);
	return canvas.toDataURL("image/png");
}

/** Keep the tab's title on `title` with the unread count in front, and the count on its icon. */
export function useUnreadTab(unread: number | null | undefined, title: string) {
	const n = unread ?? 0;
	useEffect(() => {
		document.title = unreadTitle(title, n);
	}, [title, n]);
	useEffect(() => {
		const links = [...document.querySelectorAll<HTMLLinkElement>('link[rel="icon"]')];
		for (const l of links) l.dataset.href ??= l.getAttribute("href") ?? "";
		let stale = false;
		const restore = () => {
			for (const l of links) {
				l.href = l.dataset.href ?? l.href;
				if (l.dataset.type) l.type = l.dataset.type;
			}
		};
		if (!n) restore();
		else {
			const svg = links.find((l) => l.type === "image/svg+xml") ?? links[0];
			if (svg) {
				badgedIcon(svg.dataset.href || svg.href, n).then((url) => {
					if (stale || !url) return;
					for (const l of links) {
						l.dataset.type ??= l.type;
						l.type = "image/png";
						l.href = url;
					}
				});
			}
		}
		return () => {
			stale = true;
		};
	}, [n]);
}
