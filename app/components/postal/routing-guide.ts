/**
 * Console > Addresses shows how to start receiving at an address that has no
 * mail yet (WON-228), and nothing once mail arrives. Receiving means any
 * message outside Sent and Drafts.
 */
import type { StorageStatusResponse } from "~/services/api";

/** Email Routing's rules for a zone the dashboard asks you to pick. */
export const ROUTING_URL = "https://dash.cloudflare.com/?to=/:account/:zone/email/routing/routes";

/** Messages an address has received, or null until the counts load. */
export function receivedCount(status: StorageStatusResponse | undefined, address: string): number | null {
	if (!status) return null;
	const box = status.mailboxes.find((m) => m.mailboxId.toLowerCase() === address.toLowerCase());
	if (!box) return 0;
	return Object.entries(box.states).reduce((n, [state, count]) => (state === "sent" || state === "draft" ? n : n + count), 0);
}
