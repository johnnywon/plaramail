// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import type { Sql } from "../store/sql";
import type { McpProps } from "./scopes";

/**
 * The addresses an MCP grant may reach. The consent page puts the chosen ones in the
 * grant's props, which are encrypted and can't change. Console > MCP narrows a grant by
 * storing a shorter list in `mcp_grant_addresses` (migration 0018), read on every tool
 * call. A grant reaches the stored list within its consented one; a grant made before
 * address limits has neither and reaches every address (`null`).
 */

const normalize = (list: unknown[]): string[] =>
	[...new Set(list.filter((a): a is string => typeof a === "string").map((a) => a.trim().toLowerCase()).filter(Boolean))].sort();

/** The addresses ticked on the consent page, kept only if the deployment has them. */
export function chosenAddresses(form: FormData, available: string[]): string[] {
	const known = new Set(available.map((a) => a.toLowerCase()));
	return normalize(form.getAll("address")).filter((a) => known.has(a));
}

/** What a grant reaches: the consented list narrowed by Console's stored one, or `null` for every address. */
export function effectiveAddresses(consented: string[] | undefined, stored: string[] | undefined): string[] | null {
	if (!consented && !stored) return null;
	if (!stored) return consented!;
	if (!consented) return stored;
	return stored.filter((a) => consented.includes(a));
}

/** The grant id in a bearer token. The provider's tokens are `userId:grantId:secret`. */
export function grantIdFromAuthorization(header: string | null | undefined): string | null {
	const token = header?.match(/^Bearer\s+(\S+)$/i)?.[1];
	const parts = token?.split(":");
	return parts && parts.length === 3 && parts[1] ? parts[1] : null;
}

/** Console's stored lists for these grants. */
export async function storedAddresses(sql: Sql, grantIds: string[]): Promise<Map<string, string[]>> {
	if (grantIds.length === 0) return new Map();
	const rows = await sql.all<{ grant_id: string; addresses: string }>(
		`SELECT grant_id, addresses FROM mcp_grant_addresses WHERE grant_id IN (SELECT value FROM json_each(?))`,
		JSON.stringify(grantIds),
	);
	return new Map(rows.map((r) => [String(r.grant_id), normalize(JSON.parse(String(r.addresses)) as unknown[])]));
}

export async function storeAddresses(sql: Sql, grantId: string, addresses: string[], now = new Date().toISOString()): Promise<void> {
	await sql.run(
		`INSERT INTO mcp_grant_addresses (grant_id, addresses, updated_at) VALUES (?, ?, ?)
		ON CONFLICT (grant_id) DO UPDATE SET addresses = excluded.addresses, updated_at = excluded.updated_at`,
		grantId, JSON.stringify(normalize(addresses)), now,
	);
}

export async function forgetAddresses(sql: Sql, grantId: string): Promise<void> {
	await sql.run(`DELETE FROM mcp_grant_addresses WHERE grant_id = ?`, grantId);
}

/** The addresses this token's grant reaches now, or `null` for every address. */
export async function grantAddresses(sql: Sql, props: Partial<McpProps> | undefined): Promise<string[] | null> {
	const stored = props?.grantId ? (await storedAddresses(sql, [props.grantId])).get(props.grantId) : undefined;
	return effectiveAddresses(props?.addresses ? normalize(props.addresses) : undefined, stored);
}

/** A Console narrowing: one or more of the grant's current addresses, nothing new. */
export function narrowTo(current: string[], requested: unknown): { addresses: string[] } | { error: string } {
	if (!Array.isArray(requested)) return { error: "Send addresses as a list." };
	const addresses = normalize(requested);
	if (addresses.length === 0) return { error: "Choose at least one address." };
	const outside = addresses.filter((a) => !current.includes(a));
	if (outside.length > 0) return { error: `This app can't be given ${outside.join(", ")}. Connect it again to add an address.` };
	return { addresses };
}

/** Conversations per label on these addresses, for list_labels on a narrowed grant. Trash and Spam don't count. */
export async function labelCounts(sql: Sql, addresses: string[]): Promise<Map<string, number>> {
	const rows = await sql.all<{ id: string; n: number }>(
		`SELECT l.label_id AS id, COUNT(DISTINCT m.thread_key) AS n FROM message_labels l
		JOIN messages m ON m.id = l.message
		WHERE m.deleted = 0 AND m.state NOT IN ('trash', 'spam') AND m.mailbox_id IN (SELECT value FROM json_each(?))
		GROUP BY l.label_id`,
		JSON.stringify(addresses),
	);
	return new Map(rows.map((r) => [String(r.id), Number(r.n)]));
}

/** Whether a label is on mail at an address outside these. */
export async function labelOutside(sql: Sql, labelId: string, addresses: string[]): Promise<boolean> {
	return !!(await sql.first(
		`SELECT 1 AS ok FROM message_labels l JOIN messages m ON m.id = l.message
		WHERE l.label_id = ? AND m.mailbox_id NOT IN (SELECT value FROM json_each(?)) LIMIT 1`,
		labelId, JSON.stringify(addresses),
	));
}

/**
 * A grant's addresses as Console > MCP shows them. The consent page copies its list into the
 * grant's metadata, which Console can read; props it can't. `every` is a grant from before
 * address limits that was never narrowed.
 */
export function shownAddresses(metadata: unknown, stored: string[] | undefined, all: string[]): { addresses: string[]; every: boolean } {
	const consented = (metadata as { addresses?: unknown } | null)?.addresses;
	const effective = effectiveAddresses(Array.isArray(consented) ? normalize(consented) : undefined, stored);
	return effective ? { addresses: effective.filter((a) => all.includes(a)), every: false } : { addresses: all, every: true };
}
