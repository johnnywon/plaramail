// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BULK_OVER, type HoldKind, type QueueItem } from "shared/approvals";
import api from "~/services/api";
import { when } from "./ActivityTab";
import { Async, Badge, Button, Field, Fields, Item, List, Note, Section, Switch } from "./ConsoleUI";
import { AddressText, type Identities } from "./identity";

const STATE: Record<QueueItem["state"], { label: string; tone: "ok" | "danger" | "neutral" | "draft" }> = {
	waiting: { label: "Waiting", tone: "neutral" },
	running: { label: "Running", tone: "draft" },
	approved: { label: "Approved", tone: "ok" },
	failed: { label: "Failed", tone: "danger" },
	dropped: { label: "Dropped", tone: "neutral" },
};

/** "23h left", "40m left". */
function left(iso: string, now = Date.now()): string {
	const m = Math.max(0, Math.floor((Date.parse(iso) - now) / 60_000));
	return m >= 60 ? `${Math.floor(m / 60)}h left` : `${m}m left`;
}

function Who({ item, identities }: { item: QueueItem; identities: Identities }) {
	return <>
		<span>{item.actor === "mcp" ? "MCP" : "Agent"}{item.sourceName ? ` · ${item.sourceName}` : ""}</span>
		{item.messages != null && <span className="pg-mono">{item.messages} messages</span>}
		{item.mailboxId && <AddressText address={item.mailboxId} identity={identities.of(item.mailboxId)} bold={false} short />}
		<span className="pg-mono">{item.tool}</span>
	</>;
}

/** Approve and Drop: one click each. */
function Decide({ item }: { item: QueueItem }) {
	const queryClient = useQueryClient();
	const decide = useMutation({
		mutationFn: (decision: "approve" | "drop") => api.decideApproval(item.id, decision),
		onSettled: () => {
			queryClient.invalidateQueries({ queryKey: ["approvals"] });
			queryClient.invalidateQueries({ queryKey: ["activity"] });
		},
	});
	const busy = decide.isPending || item.state === "running";
	const noun = item.kind === "send" ? "send" : "change";
	return (
		<span className="pg-ui-toolbar">
			<Button size="sm" disabled={busy} aria-label={`Approve ${noun} ${item.summary}`} onClick={() => decide.mutate("approve")}>
				{decide.isPending && decide.variables === "approve" ? "Approving" : "Approve"}
			</Button>
			<Button size="sm" variant="quiet" disabled={busy} aria-label={`Drop ${noun} ${item.summary}`} onClick={() => decide.mutate("drop")}>Drop</Button>
			{decide.error && <Note tone="error">{decide.error.message}</Note>}
		</span>
	);
}

function HoldSwitch({ kind, id, name, on }: { kind: HoldKind; id: string; name: string; on: boolean }) {
	const queryClient = useQueryClient();
	const set = useMutation({
		mutationFn: (hold: boolean) => api.setHold(kind, id, hold),
		onSettled: () => queryClient.invalidateQueries({ queryKey: ["approvals"] }),
	});
	const shown = set.isPending && set.variables !== undefined ? set.variables : on;
	return <Switch on={shown} disabled={set.isPending} label={`Hold for approval, ${name}`} onChange={(v) => set.mutate(v)} />;
}

/**
 * Console > Approvals: sends and bulk changes held for approval, each with
 * Approve and Drop, then the latest decided, then each agent's and MCP
 * client's Hold for approval switch.
 */
export function ApprovalsTab({ identities }: { identities: Identities }) {
	const approvals = useQuery({ queryKey: ["approvals"], queryFn: () => api.getApprovals(), refetchInterval: 30_000 });
	const agents = useQuery({ queryKey: ["agents"], queryFn: () => api.getAgents() });
	const apps = useQuery({ queryKey: ["mcp-apps"], queryFn: () => api.getMcpApps() });
	const holds = approvals.data?.holds;

	return (
		<>
			<Section title="Waiting">
				<Async query={approvals} empty="Nothing is waiting." isEmpty={(d) => d.waiting.length === 0}>
					{(d) => (
						<List label="Waiting for approval">
							{d.waiting.map((item) => (
								<Item
									key={item.id}
									badge={<Badge tone={item.kind === "send" ? "send" : "neutral"}>{item.kind === "send" ? "Send" : "Change"}</Badge>}
									title={item.summary}
									time={left(item.expiresAt)}
									meta={<Who item={item} identities={identities} />}
									quote={<Decide item={item} />}
								/>
							))}
						</List>
					)}
				</Async>
			</Section>

			{!!approvals.data?.recent.length && (
				<Section title="Decided">
					<List label="Decided">
						{approvals.data.recent.map((item) => (
							<Item
								key={item.id}
								bad={item.state === "failed"}
								badge={<Badge tone={STATE[item.state].tone}>{STATE[item.state].label}</Badge>}
								title={item.summary}
								time={item.decidedAt ? when(item.decidedAt) : undefined}
								meta={<>
									<Who item={item} identities={identities} />
									{item.result && <span>{item.result}</span>}
								</>}
							/>
						))}
					</List>
				</Section>
			)}

			<Section
				title="Hold for approval"
				sub={`While on, its sends and any change to more than ${BULK_OVER} messages in one call wait here. Each waits 24 hours, then is dropped. A send counts toward the daily limit when it is approved.`}
			>
				<Fields>
					{(agents.data?.agents ?? []).map((a) => (
						<Field key={a.id} inline label={a.name} hint={a.mode === "send" ? "Agent in Send. On for its first 7 days unless you set it." : "Agent. Applies once it is in Send."}>
							<HoldSwitch kind="agent" id={a.id} name={a.name} on={holds?.agent[a.id] ?? false} />
						</Field>
					))}
					{(apps.data?.apps ?? []).map((app) => (
						<Field key={app.id} inline label={app.name} hint={app.scopes.includes("mail.send") ? "MCP app. Read and send." : "MCP app. Read. Bulk changes only."}>
							<HoldSwitch kind="mcp" id={app.clientId} name={app.name} on={holds?.mcp[app.clientId] ?? false} />
						</Field>
					))}
				</Fields>
				{agents.data && apps.data && agents.data.agents.length === 0 && apps.data.apps.length === 0 && <Note>No agents or MCP apps yet.</Note>}
			</Section>
		</>
	);
}
