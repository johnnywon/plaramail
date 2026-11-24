// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { ArrowSquareOutIcon, PlugsConnectedIcon } from "@phosphor-icons/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import api from "~/services/api";
import type { ConsoleTab } from "./console-tabs";
import type { McpApp } from "~/services/api";
import { Async, Badge, Button, Code, CopyField, Name, Note, Picker, Section, Table, Tabs } from "./ConsoleUI";
import { AddressText, Swatch, type Identities } from "./identity";
import { BYPASS_PATHS, checkBypass } from "./mcp-access";

type Client = "claude-code" | "claude-desktop" | "codex" | "cursor" | "grok" | "other";

const CLIENTS: { value: Client; label: string }[] = [
	{ value: "claude-code", label: "Claude Code" },
	{ value: "claude-desktop", label: "Claude Desktop" },
	{ value: "codex", label: "Codex" },
	{ value: "cursor", label: "Cursor" },
	{ value: "grok", label: "Grok" },
	{ value: "other", label: "Other" },
];

const REFERENCE = "https://github.com/johnnywon/plaramail/blob/main/docs/mcp.md";
/** Zero Trust › Access › Applications. `:account` lets the dashboard ask which account. */
const ACCESS_APPS = "https://dash.cloudflare.com/?to=/:account/one/access-controls/apps";


/** What to run or paste for each client. Each opens the consent page on its first call: no keys to copy. */
function setup(client: Client, url: string): { lang: "sh" | "json"; title: string; code: string } {
	switch (client) {
		case "claude-code":
			return { lang: "sh", title: "terminal", code: `claude mcp add --transport http plaramail ${url}` };
		case "claude-desktop":
			return { lang: "sh", title: "Settings › Connectors › Add custom connector", code: url };
		case "codex":
			return { lang: "sh", title: "terminal", code: `codex mcp add plaramail --url ${url}\ncodex mcp login plaramail` };
		case "cursor":
			return { lang: "json", title: "~/.cursor/mcp.json", code: JSON.stringify({ mcpServers: { plaramail: { url } } }, null, 2) };
		case "grok":
			return { lang: "sh", title: "grok.com/connectors › New Connector › Custom", code: url };
		case "other":
			return { lang: "sh", title: "Any client with MCP sign-in", code: url };
	}
}

/** "just now", "4m ago", "3h ago", "2d ago". */
export function ago(iso: string, now = Date.now()): string {
	const s = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
	if (s < 45) return "just now";
	if (s < 3600) return `${Math.round(s / 60)}m ago`;
	if (s < 86_400) return `${Math.round(s / 3600)}h ago`;
	return `${Math.round(s / 86_400)}d ago`;
}

/** What a connected app can use: every address, one, or a count with the list as its title. */
function AppAddresses({ app, identities }: { app: McpApp; identities: Identities }) {
	if (app.every) return <span>Every address</span>;
	if (app.addresses.length === 1) return <AddressText address={app.addresses[0]} identity={identities.of(app.addresses[0])} bold={false} />;
	return <span title={app.addresses.join(", ")}>{app.addresses.length} addresses</span>;
}

/** Narrow one app to some of its addresses. Only addresses it already has are offered. */
function NarrowApp({ app, identities, onDone }: { app: McpApp; identities: Identities; onDone: () => void }) {
	const [value, setValue] = useState(app.addresses);
	const queryClient = useQueryClient();
	const save = useMutation({
		mutationFn: () => api.narrowMcpApp(app.id, value),
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: ["mcp-apps"] });
			onDone();
		},
	});
	const domains = new Map<string, string[]>();
	for (const a of app.addresses) {
		const d = a.slice(a.indexOf("@") + 1);
		domains.set(d, [...(domains.get(d) ?? []), a]);
	}
	const groups = [...domains].map(([domain, list]) => ({
		key: domain, label: domain, mark: <Swatch identity={identities.of(list[0])} />,
		items: list.map((a) => ({ value: a, text: a, label: <AddressText address={a} identity={identities.of(a)} bold={false} /> })),
	}));
	const unchanged = value.length === app.addresses.length && !app.every;
	return (
		<Section
			title={`Addresses for ${app.name}`}
			sub="Its tools see and act on only the addresses ticked, from its next call. To add an address, connect the app again."
		>
			<Picker groups={groups} value={value} onChange={setValue} noun="addresses" />
			{value.length === 0 && <Note tone="warn">Choose at least one address. To remove every address, revoke the app.</Note>}
			{save.error && <Note tone="error">{(save.error as Error).message}</Note>}
			<div className="pg-ui-actions">
				<Button onClick={onDone}>Cancel</Button>
				<Button variant="primary" disabled={value.length === 0 || unchanged || save.isPending} onClick={() => save.mutate()}>
					{save.isPending ? "Saving" : "Save"}
				</Button>
			</div>
		</Section>
	);
}

/** Console > MCP: the server's URL, how to connect a client, and the apps connected, with their addresses and Revoke. */
export function McpTab({ onTab, identities }: { onTab: (tab: ConsoleTab) => void; identities: Identities }) {
	const url = `${window.location.origin}/mcp`;
	const [client, setClient] = useState<Client>("claude-code");
	const step = setup(client, url);
	// MCP clients and health checks reach their paths without an Access session (mcp-access.ts).
	const open = useQuery({ queryKey: ["mcp-reachable"], queryFn: () => checkBypass(window.location.origin) });
	const host = window.location.host;
	const apps = useQuery({ queryKey: ["mcp-apps"], queryFn: () => api.getMcpApps() });
	// Last use comes from the activity log, which names each call by the app's registered name.
	const usage = useQuery({ queryKey: ["mcp-usage"], queryFn: () => api.getMcpUsage() });
	const lastUse = new Map((usage.data?.clients ?? []).map((c) => [c.client, c.last]));
	const queryClient = useQueryClient();
	const revoke = useMutation({
		mutationFn: (id: string) => api.revokeMcpApp(id),
		onSettled: () => queryClient.invalidateQueries({ queryKey: ["mcp-apps"] }),
	});
	const [editing, setEditing] = useState<string | null>(null);
	const edited = apps.data?.apps.find((a) => a.id === editing);

	return (
		<>
			<CopyField value={url} label="MCP server URL" />
			{open.data && (!open.data.mcp || !open.data.health) && (
				<Section>
					<Note tone="warn">
						{open.data.mcp ? <>Access is blocking <code>/health</code>, so health checks and <code>npm run smoke</code> fail.</> : "Access is blocking MCP clients."} In{" "}
						<a href={ACCESS_APPS} target="_blank" rel="noreferrer">Access applications <ArrowSquareOutIcon size={12} /></a>,{" "}
						{open.data.mcp ? <>add <code>/health</code> to the application that bypasses these paths</> : <>add a self-hosted application for these three paths</>} with a{" "}
						<b>Bypass</b> policy for <b>Everyone</b>.
					</Note>
					{BYPASS_PATHS.map((path) => <CopyField key={path} value={`${host}${path}`} label="Path to bypass" />)}
					<div>
						<Button size="sm" disabled={open.isFetching} onClick={() => open.refetch()}>{open.isFetching ? "Checking" : "Check again"}</Button>
					</div>
				</Section>
			)}

			<Section
				title="Connect"
				actions={
					<a className="pg-btn pg-btn-sm pg-btn-quiet" href={REFERENCE} target="_blank" rel="noreferrer">
						Reference <ArrowSquareOutIcon size={12} />
					</a>
				}
			>
				<Tabs value={client} options={CLIENTS} onChange={setClient} />
				<Code lang={step.lang} title={step.title}>{step.code}</Code>
			</Section>

			<Section
				title="Connected apps"
				actions={<Button size="sm" variant="quiet" onClick={() => onTab("logs")}>Activity log</Button>}
			>
				<Async query={apps} empty="No apps connected." isEmpty={(d) => d.apps.length === 0}>
					{(d) => (
						<Table
							label="Connected apps"
							rows={d.apps}
							rowKey={(r) => r.id}
							columns={[
								{ key: "name", label: "App", head: true, cell: (r) => <Name icon={<PlugsConnectedIcon size={14} />}>{r.name}</Name> },
								{ key: "access", label: "Can", cell: (r) => (r.scopes.includes("mail.send") ? <Badge tone="danger">Read and send</Badge> : <Badge tone="ok">Read</Badge>) },
								{
									key: "addresses", label: "Addresses", cell: (r) => r.addresses.length < 2 ? <AppAddresses app={r} identities={identities} /> : (
										<Button size="sm" variant="quiet" aria-label={`Change addresses for ${r.name}`} onClick={() => setEditing(r.id)}>
											<AppAddresses app={r} identities={identities} />
										</Button>
									),
								},
								{ key: "used", label: "Last used", wide: true, cell: (r) => <span className="pg-mono">{lastUse.has(r.name) ? ago(lastUse.get(r.name)!) : "never"}</span> },
								{ key: "revoke", label: "", cell: (r) => <Button size="sm" disabled={revoke.isPending} onClick={() => revoke.mutate(r.id)}>Revoke</Button> },
							]}
						/>
					)}
				</Async>
			</Section>
			{edited && <NarrowApp key={edited.id} app={edited} identities={identities} onDone={() => setEditing(null)} />}
		</>
	);
}
