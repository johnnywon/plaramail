// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import api, { type BlockedSender } from "~/services/api";
import { Async, Button, Note, Table } from "./ConsoleUI";
import { AddressText, type Identities } from "./identity";

const day = (iso: string) => new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });

/** Senders blocked from the reader, per address, with Remove (WON-217). Console > Addresses. */
export function BlockedSenders({ identities }: { identities: Identities }) {
	const queryClient = useQueryClient();
	const blocked = useQuery({ queryKey: ["blocked-senders"], queryFn: () => api.getBlockedSenders() });
	const remove = useMutation({
		mutationFn: (b: BlockedSender) => api.unblockSender(b.mailboxId, b.address),
		onSettled: () => queryClient.invalidateQueries({ queryKey: ["blocked-senders"] }),
	});
	return (
		<>
			<Async query={blocked} empty="No blocked senders">
				{(rows) => (
					<Table
						label="Blocked senders"
						rows={rows}
						rowKey={(b) => `${b.mailboxId} ${b.address}`}
						columns={[
							{ key: "sender", label: "Sender", head: true, cell: (b) => <span className="pg-mono">{b.address}</span>, clip: (b) => b.address },
							{ key: "to", label: "To", cell: (b) => <AddressText address={b.mailboxId} identity={identities.of(b.mailboxId)} bold={false} short /> },
							{ key: "at", label: "Blocked", wide: true, cell: (b) => day(b.createdAt) },
							{
								key: "remove", label: "", num: true,
								cell: (b) => (
									<Button size="sm" aria-label={`Unblock ${b.address} for ${b.mailboxId}`} disabled={remove.isPending} onClick={() => remove.mutate(b)}>
										Remove
									</Button>
								),
							},
						]}
					/>
				)}
			</Async>
			{remove.error && <Note tone="error">{remove.error.message}</Note>}
		</>
	);
}
