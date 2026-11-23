// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { useId } from "react";

/**
 * Domain identity: every domain gets a hue and a shape, derived from its
 * position in DOMAINS. The shape keeps domains apart for color-blind readers.
 * Shapes are never round; round is reserved for the agent.
 */

const HUES = [200, 300, 30, 110];
export const SHAPES = ["square", "diamond", "triangle", "hexagon"] as const;
export type Shape = (typeof SHAPES)[number];

export interface DomainIdentity {
	domain: string;
	index: number;
	hue: number;
	shape: Shape;
}

/** Domains in DOMAINS order, then any address domain DOMAINS does not list. */
export function orderDomains(domains: string[], addresses: string[]): string[] {
	const configured = domains.map((d) => d.trim().toLowerCase()).filter(Boolean);
	const out: string[] = [];
	const add = (d: string) => {
		if (!out.includes(d)) out.push(d);
	};
	for (const d of configured) if (addresses.some((a) => domainOf(a) === d)) add(d);
	for (const a of addresses) add(domainOf(a));
	return out;
}

export function identityFor(domain: string, ordered: string[]): DomainIdentity {
	const at = ordered.indexOf(domain);
	const index = at < 0 ? ordered.length : at;
	// Past four domains the hue steps on so hue + shape stays unique.
	const hue = (HUES[index % HUES.length] + 45 * Math.floor(index / HUES.length)) % 360;
	return { domain, index, hue, shape: SHAPES[index % SHAPES.length] };
}

export function domainOf(address: string): string {
	return address.slice(address.lastIndexOf("@") + 1).toLowerCase();
}

export function handleOf(address: string): string {
	const at = address.lastIndexOf("@");
	return at < 0 ? address : address.slice(0, at);
}

/** The domain without its last label: example.com → example. */
export function shortDomain(domain: string): string {
	const parts = domain.split(".");
	return parts.length > 1 ? parts.slice(0, -1).join(".") : domain;
}

/** Inline style that colors a swatch or domain text with the domain's hue. */
export function hueVars(hue: number): React.CSSProperties {
	return { "--pg-h": String(hue) } as React.CSSProperties;
}

export function Swatch({ identity, size = 9, className = "" }: { identity: DomainIdentity; size?: 9 | 10 | 13; className?: string }) {
	return (
		<span
			aria-hidden
			className={`pg-swatch pg-shape-${identity.shape} pg-swatch-${size} ${className}`}
			style={hueVars(identity.hue)}
		/>
	);
}

/** Bold handle, muted @, domain in its hue. */
export function AddressText({
	address, identity, short = false, bold = true, className = "",
}: {
	address: string;
	identity: DomainIdentity;
	short?: boolean;
	bold?: boolean;
	className?: string;
}) {
	const domain = domainOf(address);
	return (
		<span className={`pg-addr ${className}`} title={address}>
			<span className={bold ? "pg-addr-handle" : "pg-addr-handle-plain"}>{handleOf(address)}</span>
			<span className="pg-addr-at">@</span>
			<span className="pg-addr-domain" style={hueVars(identity.hue)}>{short ? shortDomain(domain) : domain}</span>
		</span>
	);
}

/** Swatch plus address. */
export function AddressMark({
	address, identities, short, bold, size, className,
}: {
	address: string;
	identities: Identities;
	short?: boolean;
	bold?: boolean;
	size?: 9 | 10 | 13;
	className?: string;
}) {
	const identity = identities.of(address);
	return (
		<span className={`pg-addr-mark ${className ?? ""}`}>
			<Swatch identity={identity} size={size} />
			<AddressText address={address} identity={identity} short={short} bold={bold} />
		</span>
	);
}

export interface Identities {
	domains: string[];
	/** Addresses grouped by domain, in DOMAINS order. */
	groups: { identity: DomainIdentity; addresses: string[] }[];
	of: (addressOrDomain: string) => DomainIdentity;
}

export function buildIdentities(domains: string[], addresses: string[]): Identities {
	const ordered = orderDomains(domains, addresses);
	const cache = new Map(ordered.map((d) => [d, identityFor(d, ordered)]));
	const of = (value: string) => {
		const domain = value.includes("@") ? domainOf(value) : value.toLowerCase();
		let id = cache.get(domain);
		if (!id) {
			id = identityFor(domain, ordered);
			cache.set(domain, id);
		}
		return id;
	};
	return {
		domains: ordered,
		groups: ordered.map((d) => ({ identity: of(d), addresses: addresses.filter((a) => domainOf(a) === d) })),
		of,
	};
}

/**
 * Label identity: a hue and a background pattern picked from a hash of the
 * label id, so a label looks the same everywhere and across reloads.
 */
export const LABEL_PATTERNS = ["dots", "grid", "diagonal", "cross", "checks", "rings"] as const;

export function labelLook(id: string): React.CSSProperties & { "data-pattern": string } {
	let h = 2166136261;
	for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619);
	// Murmur3 finalizer: short ids differ in a few low bits, so spread them before taking the hue.
	h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
	h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
	h = (h ^ (h >>> 16)) >>> 0;
	return { "--pg-lh": String(h % 360), "data-pattern": LABEL_PATTERNS[(h >>> 9) % LABEL_PATTERNS.length] } as never;
}

const TAG_PATH = "M243.31,136,144,36.69A15.86,15.86,0,0,0,132.69,32H40a8,8,0,0,0-8,8v92.69A15.86,15.86,0,0,0,36.69,144L136,243.31a16,16,0,0,0,22.63,0l84.68-84.68a16,16,0,0,0,0-22.63ZM84,96A12,12,0,1,1,96,84,12,12,0,0,1,84,96Z";

/** One tile of each pattern, in the tag's 256-unit space. */
const PATTERN_TILES: Record<(typeof LABEL_PATTERNS)[number], { size: number; rotate?: number; tile: React.ReactNode }> = {
	dots: { size: 44, tile: <circle className="pg-lt-ink" cx="22" cy="22" r="9" /> },
	grid: { size: 48, tile: <path className="pg-lt-line" d="M0 0H48M0 0V48" /> },
	diagonal: { size: 44, rotate: 45, tile: <path className="pg-lt-line" d="M0 0V44" /> },
	cross: { size: 52, rotate: 45, tile: <path className="pg-lt-line" d="M0 0H52M0 0V52" /> },
	checks: { size: 64, tile: <path className="pg-lt-ink" d="M0 0H32V32H0ZM32 32H64V64H32Z" /> },
	rings: { size: 52, tile: <circle className="pg-lt-ring" cx="26" cy="26" r="13" /> },
};

/** The tag shape, filled with the label's hue and pattern. */
export function LabelTag({ id, size = 14 }: { id: string; size?: number }) {
	const { "data-pattern": pattern, ...vars } = labelLook(id);
	const { size: tile, rotate, tile: shape } = PATTERN_TILES[pattern as keyof typeof PATTERN_TILES];
	const patternId = `pg-lt-${useId().replace(/:/g, "")}`;
	return (
		<svg aria-hidden className="pg-label-tag" width={size} height={size} viewBox="0 0 256 256" style={vars}>
			<defs>
				<pattern id={patternId} width={tile} height={tile} patternUnits="userSpaceOnUse" patternTransform={rotate ? `rotate(${rotate})` : undefined}>
					<rect className="pg-lt-base" width={tile} height={tile} />
					{shape}
				</pattern>
			</defs>
			<path d={TAG_PATH} fill={`url(#${patternId})`} />
		</svg>
	);
}
