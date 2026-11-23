// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { useQuery } from "@tanstack/react-query";
import api from "~/services/api";
import { Section, Stat, Stats, Table } from "./ConsoleUI";
import { AddressText, type Identities } from "./identity";

const STATE_COLUMNS = [
	["inbox", "Inbox"],
	["archive", "Archive"],
	["sent", "Sent"],
	["draft", "Drafts"],
	["trash", "Trash"],
	["spam", "Spam"],
] as const;

/** Where the mail lives, and each address's message counts. */
export function StorageTab({ identities }: { identities: Identities }) {
	const status = useQuery({ queryKey: ["storage-status"], queryFn: () => api.getStorageStatus() });
	const data = status.data;
	const rows = data?.mailboxes ?? [];
	const heading = status.isLoading ? "Checking" : status.error ? "Could not read the counts"
		: `${rows.length} ${rows.length === 1 ? "address" : "addresses"} on D1`;
	const columns: { label: string; count: (row: (typeof rows)[number]) => number }[] = [
		...STATE_COLUMNS.map(([state, label]) => ({ label, count: (row: (typeof rows)[number]) => row.states[state] ?? 0 })),
		{ label: "Unread", count: (row) => row.unread },
		{ label: "Starred", count: (row) => row.starred },
	];

	return (
		<>
			<Stats>
				<Stat label={heading} value={data ? data.messages.toLocaleString() : "—"} note="messages" />
			</Stats>
			{rows.length > 0 && (
				<Section title="Messages per address">
					<Table
						label="Messages per address"
						rows={rows}
						rowKey={(r) => r.mailboxId}
						columns={[
							{ key: "address", label: "Address", head: true, clip: (r) => r.mailboxId, cell: (r) => <AddressText address={r.mailboxId} identity={identities.of(r.mailboxId)} /> },
							...columns.map((c) => ({ key: c.label, label: c.label, num: true, quiet: (r: (typeof rows)[number]) => c.count(r) === 0, cell: (r: (typeof rows)[number]) => c.count(r).toLocaleString() })),
						]}
					/>
				</Section>
			)}
		</>
	);
}
