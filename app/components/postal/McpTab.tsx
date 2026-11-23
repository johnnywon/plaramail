// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { ArrowSquareOutIcon, PlugsConnectedIcon } from "@phosphor-icons/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import api from "~/services/api";
import type { ConsoleTab } from "./console-tabs";
import { Async, Badge, Button, Code, CopyField, Name, Note, Section, Table, Tabs } from "./ConsoleUI";
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

/** Console > MCP: the server's URL, how to connect a client, and the apps connected, with Revoke. */
export function McpTab({ onTab }: { onTab: (tab: ConsoleTab) => void }) {
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
								{ key: "used", label: "Last used", cell: (r) => <span className="pg-mono">{lastUse.has(r.name) ? ago(lastUse.get(r.name)!) : "never"}</span> },
								{ key: "revoke", label: "", cell: (r) => <Button size="sm" disabled={revoke.isPending} onClick={() => revoke.mutate(r.id)}>Revoke</Button> },
							]}
						/>
					)}
				</Async>
			</Section>
		</>
	);
}
