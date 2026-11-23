// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

// HTML pieces for the Alex profile: prose, inline photos with their credit,
// and links that stay inside the app.

import { type Attachment, esc, md } from "../kit";
import { type Signer, signature } from "./brands";
import { PHOTO_BASE64 } from "./photos";

export type PhotoId = keyof typeof PHOTO_BASE64;

/** Source and license for each photo, as assets/manifest.json records them. */
export const PHOTO_CREDITS: Record<PhotoId, { title: string; source: string; creator: string; license: string; licenseUrl: string; width: number; height: number }> = {
	"food-burrito": { title: "Beef birria burrito with sauces to taste", source: "https://commons.wikimedia.org/wiki/File:Beef_birria_burrito_with_sauces_to_taste.jpg", creator: "Ser Amantio di Nicolao", license: "CC0", licenseUrl: "https://creativecommons.org/publicdomain/zero/1.0/", width: 960, height: 540 },
	"football-stadium": { title: "Scott Stadium during an American Football game", source: "https://commons.wikimedia.org/wiki/File:Scott_Stadium_during_an_American_Football_game.jpg", creator: "carlinmack", license: "CC0", licenseUrl: "https://creativecommons.org/publicdomain/zero/1.0/", width: 960, height: 720 },
	coffee: { title: "Coffee cup seen from above", source: "https://commons.wikimedia.org/wiki/File:Coffee_cup_seen_from_above.jpg", creator: "www.Pixel.la Free Stock Photos", license: "CC0", licenseUrl: "https://creativecommons.org/publicdomain/zero/1.0/", width: 960, height: 540 },
	keyboard: { title: "Keyboard", source: "https://commons.wikimedia.org/wiki/File:Keyboard_(Unsplash).jpg", creator: "Anas Alshanti", license: "CC0", licenseUrl: "https://creativecommons.org/publicdomain/zero/1.0/", width: 960, height: 606 },
};

const decoded = new Map<PhotoId, Uint8Array>();

/** A photo's JPEG bytes, decoded once and shared by every message that uses it. */
export function photoBytes(id: PhotoId): Uint8Array {
	let bytes = decoded.get(id);
	if (!bytes) {
		bytes = Uint8Array.from(atob(PHOTO_BASE64[id]), (c) => c.charCodeAt(0));
		decoded.set(id, bytes);
	}
	return bytes;
}

/** The photo as a file in the attachment list. */
export const photoFile = (id: PhotoId, filename = `${id}.jpg`): Attachment => ({ filename, mimetype: "image/jpeg", bytes: photoBytes(id) });

/** The photo as an inline part, for `<img src="cid:…">`. */
export const photoPart = (id: PhotoId, domain: string): Attachment => ({ ...photoFile(id), contentId: `${id}.jpg@${domain}` });

/**
 * An inline photo. A photo whose license asks for attribution gets its credit under it;
 * CC0 photos are credited in assets/manifest.json only. `domain` matches the photoPart
 * the message carries. `crop` is a height to cut it to.
 */
export function photo(id: PhotoId, domain: string, alt: string, label = "Photo", crop?: number, radius = 6): string {
	const c = PHOTO_CREDITS[id];
	const size = crop ? `height:${crop}px;object-fit:cover` : "height:auto";
	const img = `<img src="cid:${id}.jpg@${domain}" alt="${esc(alt)}" width="${c.width}" style="display:block;width:100%;max-width:100%;${size};border-radius:${radius}px">`;
	if (c.license === "CC0") return img;
	return img +
		`<p style="margin:6px 0 0;font-size:11px;line-height:1.4;color:#6b7280">${esc(label)}: <a href="${esc(c.source)}" style="color:#6b7280">${esc(c.title)}</a> by ${esc(c.creator)}, <a href="${esc(c.licenseUrl)}" style="color:#6b7280">${esc(c.license)}</a>, via Wikimedia Commons</p>`;
}

/** Plain mail with fenced ``` blocks kept as preformatted text. */
export function prose(text: string): string {
	return text.trim().split(/```\n?/).map((part, i) => i % 2
		? `<pre style="white-space:pre-wrap;font-family:ui-monospace,Menlo,Consolas,monospace;font-size:13px;line-height:1.45;margin:0 0 1em">${esc(part.replace(/\n$/, ""))}</pre>`
		: part.trim() ? md(part) : "").join("");
}

/** Mail a person wrote: plain paragraphs, then their signature. */
export function human(text: string, signer?: Signer): string {
	return prose(text) + (signer ? signature(signer) : "");
}

/** Hosts a link may leave the app for: the photo sources and their licenses. */
const OUTSIDE = /^https:\/\/(commons\.wikimedia\.org|upload\.wikimedia\.org|creativecommons\.org)\//;

/** The app's own page for a link in the sample mail (workers/index.ts). */
export const sampleLink = (url: string) => `/api/v1/sample-link?to=${encodeURIComponent(url)}`;

/** Every link except a photo credit points at the app's sample-link page, which shows where it would go. */
export function keepLinksLocal(html: string): string {
	return html.replace(/href="(https?:\/\/[^"]+)"/g, (whole, url: string) => {
		const raw = url.replace(/&amp;/g, "&");
		return OUTSIDE.test(raw) ? whole : `href="${esc(sampleLink(raw))}"`;
	});
}
