// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { useQuery } from "@tanstack/react-query";
import { SEND_LIMITS } from "shared/send-limits";
import api from "~/services/api";
import { ActivityEntryRow, RUN_LABELS } from "./ActivityTab";
import type { ConsoleTab } from "./console-tabs";
import { List, Note, Section, Stat, Stats, Table } from "./ConsoleUI";
import { AddressText, type Identities } from "./identity";

// Failed comes second so the card never hides it.
const RUN_ORDER = ["drafted", "failed", "watched", "sent", "skipped", "queued", "running", "superseded"] as const;

/** The last day at a glance: sends against each limit, auto-draft runs, and failed agent actions. */
export function OverviewTab({ identities, autoDraft, onTab, agents }: { identities: Identities; autoDraft: boolean; onTab: (tab: ConsoleTab) => void; agents?: React.ReactNode }) {
	const overview = useQuery({ queryKey: ["agents-overview"], queryFn: () => api.getAgentOverview(), refetchInterval: 60_000 });
	const data = overview.data;
	if (overview.isPending) return <Note>Loading</Note>;
	if (overview.error || !data) return <Note tone="error">{overview.error?.message ?? "Could not load the overview."}</Note>;
	const agentSends = data.addresses.reduce((n, a) => n + a.agentDay, 0);
	// The card fits two states; the Activity log has the rest.
	const runs = RUN_ORDER.filter((s) => data.runs[s]).slice(0, 2).map((s) => `${data.runs[s]} ${RUN_LABELS[s].toLowerCase()}`);
	const usage = (used: number, limit: number) => ({ quiet: used === 0, bad: limit > 0 && used >= limit, text: `${used} / ${limit}` });
	type Row = (typeof data.addresses)[number];
	const col = (key: string, label: string, pick: (a: Row) => [number, number]) => ({
		key, label, num: true,
		quiet: (a: Row) => usage(...pick(a)).quiet, bad: (a: Row) => usage(...pick(a)).bad, cell: (a: Row) => usage(...pick(a)).text,
	});

	return (
		<>
			<Stats>
				<Stat label="Agent actions" value={data.actions.toLocaleString()} onClick={() => onTab("logs")} />
				<Stat label="Agent sends" value={agentSends.toLocaleString()} note={`limit ${data.limits.agentDay} per address`} onClick={() => onTab("mailroom")} />
				<Stat label="Auto-drafts" value={Object.values(data.runs).reduce((n, v) => n + (v ?? 0), 0)} note={autoDraft ? runs.join(" · ") || "none yet" : "off"} onClick={() => onTab("logs")} />
				<Stat label="Failed actions" value={data.failed.toLocaleString()} bad={data.failed > 0} onClick={() => onTab("logs")} />
			</Stats>
			{agents}
			<Section title="Sends per address">
				<Table
					label="Sends per address"
					rows={data.addresses}
					rowKey={(a) => a.mailboxId}
					columns={[
						{ key: "address", label: "Address", head: true, clip: (a) => a.mailboxId, cell: (a) => <AddressText address={a.mailboxId} identity={identities.of(a.mailboxId)} /> },
						col("hour", "This hour", (a) => [a.hour, SEND_LIMITS.hour]),
						col("day", "Today", (a) => [a.day, SEND_LIMITS.day]),
						col("agents", "By agents", (a) => [a.agentDay, data.limits.agentDay]),
					]}
				/>
			</Section>
			{data.failures.length > 0 && (
				<Section title="Recent failures">
					<List label="Recent failures">
						{data.failures.map((e) => <ActivityEntryRow key={e.id} entry={e} identities={identities} />)}
					</List>
				</Section>
			)}
		</>
	);
}
