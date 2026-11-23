// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { keepPreviousData, useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { ACTIVITY_DAYS, type ActivityDays } from "shared/prefs";
import api, { type ActivityActor, type ActivityEntry, type AutoDraftRun } from "~/services/api";
import { useOpenMessage } from "./console-message";
import { AddressText, type Identities } from "./identity";
import { Async, Badge, Button, Field, Item, List, Section, Segmented, Table, Toolbar } from "./ConsoleUI";

const ACTORS: { value: ActivityActor | "all"; label: string }[] = [
	{ value: "all", label: "All" },
	{ value: "chat", label: "Agent" },
	{ value: "auto-draft", label: "Auto-draft" },
	{ value: "mcp", label: "MCP" },
	{ value: "person", label: "You" },
];

const ACTOR_LABELS: Record<ActivityActor, string> = { chat: "Agent", "auto-draft": "Auto-draft", mcp: "MCP", person: "You" };

const ACTION_LABELS: Record<ActivityEntry["action"], string> = {
	read: "Read",
	draft: "Drafted",
	send: "Sent",
	delete: "Deleted",
	label: "Labels",
	move: "Moved",
	settings: "Settings",
};

export const RUN_LABELS: Record<AutoDraftRun["state"], string> = {
	queued: "Queued",
	running: "Running",
	drafted: "Drafted",
	watched: "Watched",
	sent: "Sent",
	skipped: "Skipped",
	superseded: "Superseded",
	failed: "Failed",
};

export const when = (iso: string) =>
	new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

/** A run's state: live while queued or running, then the tone of what happened. */
export function RunBadge({ state }: { state: keyof typeof RUN_LABELS }) {
	const tone = state === "sent" ? "send" : state === "drafted" ? "draft" : state === "failed" ? "danger" : state === "running" || state === "queued" ? "draft" : "neutral";
	return <Badge tone={tone} dot live={state === "running" || state === "queued"}>{RUN_LABELS[state]}</Badge>;
}

/** Undo for an action agent's action: unstar, remove the label, back to the inbox, mark unread. */
export function UndoAction({ actionId }: { actionId: string }) {
	const queryClient = useQueryClient();
	const undo = useMutation({
		mutationFn: () => api.undoAgentAction(actionId),
		onSettled: () => {
			queryClient.invalidateQueries({ queryKey: ["activity"] });
			queryClient.invalidateQueries({ queryKey: ["agent-actions"] });
		},
	});
	return (
		<Button size="sm" variant="quiet" disabled={undo.isPending} title={undo.error?.message} onClick={() => undo.mutate()}>
			{undo.isPending ? "Undoing" : undo.isError ? "Retry undo" : "Undo"}
		</Button>
	);
}

export function ActivityEntryRow({ entry, identities }: { entry: ActivityEntry; identities: Identities }) {
	return (
		<Item
			bad={!entry.ok}
			badge={<Badge tone={entry.ok ? (entry.action === "send" ? "send" : entry.action === "draft" ? "draft" : "neutral") : "danger"}>{entry.ok ? ACTION_LABELS[entry.action] : "Failed"}</Badge>}
			title={entry.summary ?? entry.tool}
			time={when(entry.at)}
			aside={entry.undo ? <UndoAction actionId={entry.undo} /> : undefined}
			meta={<>
				<span>{ACTOR_LABELS[entry.actor]}{entry.client ? ` · ${entry.client}` : ""}</span>
				{entry.mailboxId && <AddressText address={entry.mailboxId} identity={identities.of(entry.mailboxId)} bold={false} short />}
				<span className="pg-mono">{entry.tool}</span>
			</>}
		/>
	);
}

/** What agents, auto-draft and MCP clients did, newest first, and the latest auto-draft runs. */
export function ActivityTab({ addresses, identities, days, onDays, autoDraft }: {
	addresses: string[];
	identities: Identities;
	days: ActivityDays;
	onDays: (days: ActivityDays) => void;
	autoDraft: boolean;
}) {
	const [mailbox, setMailbox] = useState("");
	const [actor, setActor] = useState<ActivityActor | "all">("all");
	const filter = { mailbox: mailbox || undefined, actor: actor === "all" ? undefined : actor };
	const log = useInfiniteQuery({
		queryKey: ["activity", filter],
		queryFn: ({ pageParam }) => api.getActivity({ ...filter, before: pageParam ?? undefined }),
		initialPageParam: null as number | null,
		getNextPageParam: (page) => page.next,
		// A new filter keeps the old rows, dimmed, until its own arrive.
		placeholderData: keepPreviousData,
	});
	const runs = useQuery({ queryKey: ["auto-draft-runs", mailbox], queryFn: () => api.getAutoDraftRuns(mailbox || undefined) });
	const openMessage = useOpenMessage();
	const entries = log.data?.pages.flatMap((p) => p.entries) ?? [];

	return (
		<>
			<Field inline label="Keep for" hint="Older entries are deleted once an hour.">
				<select className="pg-select pg-ui-keep" value={String(days)} aria-label="Keep activity for" onChange={(e) => onDays(Number(e.target.value) as ActivityDays)}>
					{ACTIVITY_DAYS.map((d) => <option key={d} value={d}>{d} days</option>)}
				</select>
			</Field>
			<Section
				title="Actions"
				actions={<Toolbar>
					{addresses.length > 1 && (
						<select className="pg-select" value={mailbox} aria-label="Address" onChange={(e) => setMailbox(e.target.value)}>
							<option value="">All addresses</option>
							{addresses.map((a) => <option key={a} value={a}>{a}</option>)}
						</select>
					)}
					<Segmented label="Who" value={actor} onChange={setActor} options={ACTORS} />
				</Toolbar>}
			>
				<Async query={{ ...log, data: entries }} empty={`No activity${mailbox || actor !== "all" ? " matches" : " yet"}.`}>
					{(list) => (
						<List label="Activity" busy={log.isPlaceholderData}>
							{list.map((e) => <ActivityEntryRow key={e.id} entry={e} identities={identities} />)}
						</List>
					)}
				</Async>
				{log.hasNextPage && (
					<Button size="sm" onClick={() => log.fetchNextPage()} disabled={log.isFetchingNextPage}>{log.isFetchingNextPage ? "Loading" : "Load more"}</Button>
				)}
			</Section>
			{(autoDraft || (runs.data?.length ?? 0) > 0) && (
				<Section title="Agent runs">
					<Async query={runs} empty="No runs yet.">
						{(rows) => (
							<Table
								label="Agent runs"
								rows={rows}
								rowKey={(r) => r.emailId}
								onRow={openMessage ? (r) => openMessage({ mailboxId: r.mailboxId, emailId: r.emailId }) : undefined}
								columns={[
									{ key: "at", label: "Received", cell: (r) => <span className="pg-mono">{when(r.createdAt)}</span> },
									{ key: "from", label: "From", cell: (r) => r.sender },
									{ key: "state", label: "State", cell: (r) => <RunBadge state={r.state} /> },
									{ key: "tries", label: "Tries", num: true, wide: true, cell: (r) => r.attempts },
									{ key: "why", label: "Why", wide: true, clip: (r) => r.reason, cell: (r) => r.reason ?? "" },
								]}
							/>
						)}
					</Async>
				</Section>
			)}
		</>
	);
}
