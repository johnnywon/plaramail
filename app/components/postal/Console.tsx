// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import {
	ArrowDownIcon, ArrowLeftIcon, ArrowRightIcon, ArrowUpIcon, AtIcon, CheckIcon, EyeIcon, LockSimpleIcon, ClockCounterClockwiseIcon, CpuIcon, DatabaseIcon, HouseIcon, KeyboardIcon, PaperPlaneRightIcon, PencilSimpleIcon, PlugsConnectedIcon, PlusIcon,
	SignatureIcon, SlidersHorizontalIcon, TagIcon, TrayIcon, WarningIcon, XIcon,
} from "@phosphor-icons/react";
import { type UseQueryResult, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Fragment, type ReactNode, type Ref, useEffect, useRef, useState } from "react";
import { SEND_VERSION } from "shared/agent";
import type { Unmatched } from "shared/prefs";
import { moveInOrder } from "./agent-order";
import { confirmReady } from "./confirm-guard";
import api, { type Agent, type AgentDraft, type AgentMode, type AgentRule, type AgentStats, type AutoDraftRun } from "~/services/api";
import { RunBadge, when } from "./ActivityTab";
import { AgentIcon } from "./AgentIcon";
import type { AddressInfo } from "./compose";
import { ConsoleMessageContext, type MessageRef, useOpenMessage } from "./console-message";
import { CONSOLE_LABELS, CONSOLE_RAIL, type ConsoleTab, isSettingsTab } from "./console-tabs";
import { ConsoleMessage } from "./ConsoleMessage";
import { ConsoleColophon } from "./ConsoleColophon";
import { FoldMark } from "./NavIcons";
import { type ConsoleHit, ConsoleSearch, type ConsoleSearchHandle } from "./ConsoleSearch";
import {
	Async, Badge, Button, Choices, DialogHead, InlineText, Picker, Summary, SummaryRow, Track, Section, Field, Fields, Modal, Name, Note, NumberInput, Page, Row, SaveBar, Segmented, Split, Table,
} from "./ConsoleUI";
import { AddressText, type Identities, Swatch } from "./identity";
import { ConsoleSettings } from "./Modals";
import { useDemo } from "~/lib/demo";
import { McpTab } from "./McpTab";
import { dayKey, dayLabel, timeLabel } from "./model";
import { OverviewTab } from "./OverviewTab";
import type { Prefs } from "./prefs";
import { Keys } from "./shortcuts";

const MODES: { value: AgentMode; label: string; disabled?: boolean; title?: string }[] = [
	{ value: "watch", label: "Watch" },
	{ value: "draft", label: "Draft" },
	// Send arrives in SEND_VERSION, after Test on past mail (workers/lib/agents.ts, SEND_ENABLED).
	{ value: "send", label: "Send", disabled: true, title: `Arrives in ${SEND_VERSION}` },
];

/** One icon per page, at rail size and search size. */
const ICONS: Record<ConsoleTab, (size: number) => React.ReactNode> = {
	home: (s) => <HouseIcon size={s} />, agents: (s) => <AgentIcon size={s} />, mailroom: (s) => <AgentIcon size={s} />,
	review: (s) => <TrayIcon size={s} />, logs: (s) => <ClockCounterClockwiseIcon size={s} />,
	models: (s) => <CpuIcon size={s} />, mcp: (s) => <PlugsConnectedIcon size={s} />,
	addresses: (s) => <AtIcon size={s} />, signatures: (s) => <SignatureIcon size={s} />, labels: (s) => <TagIcon size={s} />,
	general: (s) => <SlidersHorizontalIcon size={s} />, shortcuts: (s) => <KeyboardIcon size={s} />, storage: (s) => <DatabaseIcon size={s} />,
};

/** Words that find a page in console search besides its name. */
const SEARCH_WORDS: Record<ConsoleTab, string> = {
	home: "today counts home", agents: "hire create watch draft send", mailroom: "auto-draft limits fallback prompt sends a day per sender recipients",
	review: "drafts waiting approve", logs: "activity runs history audit", models: "provider key openrouter cloudflare default model",
	mcp: "tools tool key api key claude desktop claude code cursor connections server url",
	addresses: "mailbox domain inbox from display name", signatures: "signature sign-off footer", labels: "tags folders",
	general: "theme dark light remote images key hints mark read reply from general settings", shortcuts: "keys keyboard bindings hotkeys",
	storage: "index usage messages counts d1 r2",
};

const TEMPLATES: { label: string; name: string; job: string; instructions: string }[] = [
	{ label: "Decline pitches", name: "Outreach", job: "Politely decline guest-post, link-exchange and sales pitches.", instructions: "Thank them in one line and say no. Don't explain." },
	{ label: "Ask for missing details", name: "Intake", job: "When a request is missing the order number or account email, ask for it once.", instructions: "Ask only for what's missing. One short paragraph." },
	{ label: "Acknowledge", name: "Acknowledge", job: "Tell first-time senders I'll reply within two business days.", instructions: "Two sentences. Thank them and say when I'll reply." },
	{ label: "Answer FAQs", name: "FAQ answers", job: "Answer common product questions the instructions cover.", instructions: "Answer only from these instructions. If unsure, say a person will follow up." },
];

export function ModeBadge({ mode }: { mode: AgentMode }) {
	return <Badge tone={mode} dot>{MODES.find((m) => m.value === mode)?.label}</Badge>;
}

/** Working: the agent has a message running or queued right now. */
function WorkingBadge({ stats }: { stats: AgentStats | undefined }) {
	const n = stats?.live ?? 0;
	return n ? <Badge tone="draft" live>Working{n > 1 ? ` · ${n}` : ""}</Badge> : null;
}

function Addresses({ list, identities }: { list: string[]; identities: Identities }) {
	if (list.length === 0) return <span className="pg-ui-quiet">All addresses</span>;
	return (
		<span className="pg-console-addrs">
			{list.map((a) => <span key={a} className="pg-console-addr"><Swatch identity={identities.of(a)} /><AddressText address={a} identity={identities.of(a)} short /></span>)}
		</span>
	);
}

function weekText(stats: AgentStats | undefined, mode: AgentMode) {
	const runs = stats?.runs ?? {};
	if (mode === "watch") return `${runs.watched ?? 0} would handle`;
	const sent = runs.sent ?? 0;
	const drafted = runs.drafted ?? 0;
	return [sent ? `${sent} sent` : "", drafted || !sent ? `${drafted} ${drafted === 1 ? "draft" : "drafts"}` : ""].filter(Boolean).join(", ");
}

function useAgents() {
	return useQuery({ queryKey: ["agents"], queryFn: () => api.getAgents() });
}

/** The console, a full page over the mail: agents first, then tools, models and the mail client's settings. */
export function ConsolePage(props: {
	tab: ConsoleTab;
	agentId: string | null;
	onTab: (tab: ConsoleTab) => void;
	onAgent: (id: string) => void;
	onClose: () => void;
	onOpenDraft: (mailboxId: string, draftId: string) => void;
	/** Sends an agent draft as written; rejects with the reason it could not. */
	onSendDraft: (mailboxId: string, draftId: string) => Promise<void>;
	prefs: Prefs;
	setPrefs: (p: Partial<Prefs>) => Promise<unknown>;
	addresses: string[];
	identities: Identities;
	info: ReadonlyMap<string, AddressInfo>;
	autoDraft: boolean;
	onSaved: (message: string) => void;
	settingsKey: string;
	searchRef: Ref<ConsoleSearchHandle>;
	onAgentPanel: () => void;
}) {
	// A demo has no agents, so its console is the mail settings alone.
	const demo = useDemo();
	const tab: ConsoleTab = demo && !isSettingsTab(props.tab) ? "general" : props.tab;
	const rail = demo ? CONSOLE_RAIL.filter((g) => g.tabs.every(isSettingsTab)) : CONSOLE_RAIL;
	const { agentId, onTab, onClose } = props;
	const agents = useAgents();
	const review = useQuery({ queryKey: ["agent-drafts"], queryFn: () => api.getAgentDrafts() });
	const [navOpen, setNavOpen] = useState(false);
	const [message, setMessage] = useState<MessageRef | null>(null);
	const go = (t: ConsoleTab) => { setNavOpen(false); onTab(t); };
	// Escape goes back to mail, unless a dialog is open or a field is being edited.
	useEffect(() => {
		const onKey = (e: KeyboardEvent) => {
			if (e.key !== "Escape" || e.defaultPrevented || document.querySelector(".pg-modal")) return;
			if (e.target instanceof HTMLElement && e.target.closest("input, textarea, select, [contenteditable]")) return;
			onClose();
		};
		document.addEventListener("keydown", onKey);
		return () => document.removeEventListener("keydown", onKey);
	}, [onClose]);

	// Your agents is a list beside the picked agent, like mail's list and reader.
	const split = tab === "agents" || tab === "mailroom" || tab === "review";
	const current = (id: ConsoleTab) => tab === id || (id === "agents" && tab === "mailroom");
	const counts: Partial<Record<ConsoleTab, number | undefined>> = { agents: (agents.data?.agents.length ?? 0) + 1, review: review.data?.length };
	const hits: ConsoleHit[] = [
		...(Object.keys(CONSOLE_LABELS) as ConsoleTab[]).filter((id) => !demo || isSettingsTab(id)).map((id): ConsoleHit => ({
			id: `p-${id}`, section: "Pages", label: CONSOLE_LABELS[id], icon: ICONS[id](14), words: SEARCH_WORDS[id], run: () => go(id),
		})),
		...(agents.data?.agents ?? []).map((a): ConsoleHit => ({
			id: `a-${a.id}`, section: "Agents", label: a.name, detail: a.job, words: a.mode, icon: <AgentIcon size={14} />, run: () => { setNavOpen(false); props.onAgent(a.id); },
		})),
		...(review.data ?? []).map((d): ConsoleHit => ({
			id: `d-${d.emailId}`, section: "Review", label: d.subject || "(no subject)", detail: `to ${d.recipient}`, words: d.agent ?? "PluraMail Agent",
			icon: <TrayIcon size={14} />, run: () => props.onOpenDraft(d.mailboxId, d.emailId),
		})),
	];
	const settingsFor = (t: ConsoleTab) => (
		<ConsoleSettings
			key={props.settingsKey}
			tab={t}
			onTab={go}
			prefs={props.prefs}
			setPrefs={props.setPrefs}
			addresses={props.addresses}
			identities={props.identities}
			info={props.info}
			autoDraft={props.autoDraft}
		/>
	);
	const settings = settingsFor(tab);
	return (
		<ConsoleMessageContext.Provider value={setMessage}>
		<div className="pg-console" data-nav-open={navOpen || undefined}>
			<nav className="pg-console-nav" aria-label="Console">
				<div className="pg-rail-head pg-console-brand"><FoldMark size={14} /><b>Console</b></div>
				<button type="button" className="pg-console-mail" onClick={onClose}><ArrowLeftIcon size={14} /><span>Back to mail</span><Keys id="back" /></button>
				<div className="pg-console-links">
					{rail.map((g) => (
						<div key={g.group ?? "top"} className="pg-console-links-group">
							{g.group && <span className="pg-console-group">{g.group}</span>}
							{g.tabs.map((id) => (
								<button key={id} type="button" className="pg-console-link" aria-current={current(id) ? "page" : undefined} onClick={() => go(id)}>
									{ICONS[id](16)}<span>{CONSOLE_LABELS[id]}</span>{counts[id] ? <em>{counts[id]}</em> : null}
								</button>
							))}
						</div>
					))}
				</div>
				<ConsoleColophon />
			</nav>
			{navOpen && <div className="pg-drawer-scrim pg-console-scrim" onClick={() => setNavOpen(false)} aria-hidden />}
			<div className="pg-console-center">
			<ConsoleSearch ref={props.searchRef} hits={hits} onMenu={() => setNavOpen(true)} onAgent={props.onAgentPanel} />
			<main className="pg-console-main" data-split={split || undefined}>
				{tab === "review" ? <ReviewPage {...props} /> : split ? <AgentsSplit {...props} settings={settingsFor("mailroom")} /> : (
				<div className="pg-console-page">
					{tab === "home" && <HomePage {...props} />}
					{tab === "mcp" && (
						<Page title={CONSOLE_LABELS.mcp}>
							<McpTab onTab={onTab} />
						</Page>
					)}
					{tab === "logs" && <Page title={CONSOLE_LABELS.logs}>{settings}</Page>}
					{tab === "models" && <Page title={CONSOLE_LABELS.models}>{settings}</Page>}
					{isSettingsTab(tab) && <Page title={CONSOLE_LABELS[tab]}>{settings}</Page>}
				</div>
				)}
			</main>
			</div>
			{message && (
				<ConsoleMessage
					open={message}
					identities={props.identities}
					onClose={() => setMessage(null)}
					onEditDraft={(mailboxId, draftId) => { setMessage(null); props.onOpenDraft(mailboxId, draftId); }}
				/>
			)}
		</div>
		</ConsoleMessageContext.Provider>
	);
}

type PageProps = Parameters<typeof ConsolePage>[0];

/** The PluraMail Agent's row, first in every list of agents. */
const MAILROOM_ROW = { id: "mailroom", name: "PluraMail Agent", builtin: true } as const;
type AgentRow = Agent | typeof MAILROOM_ROW;
const isBuiltin = (r: AgentRow): r is typeof MAILROOM_ROW => "builtin" in r;

function HomePage({ identities, autoDraft, onTab, onAgent }: PageProps) {
	const { data } = useAgents();
	const stats = new Map((data?.stats ?? []).map((s) => [s.agentId, s]));
	const rows: AgentRow[] = [MAILROOM_ROW, ...(data?.agents ?? [])];
	return (
		<Page title={CONSOLE_LABELS.home}>
			<OverviewTab identities={identities} autoDraft={autoDraft} onTab={onTab} agents={
				<Section title="Agents today">
					<Table<AgentRow>
						label="Agents today"
						rows={rows}
						rowKey={(r) => r.id}
						onRow={(r) => (isBuiltin(r) ? onTab("mailroom") : onAgent(r.id))}
						rowProps={(r) => ({ "data-off": (!isBuiltin(r) && !r.enabled) || undefined })}
						columns={[
							{ key: "name", label: "Agent", head: true, cell: (r) => <Name icon={isBuiltin(r) ? <AgentIcon size={14} /> : undefined} tag={isBuiltin(r) ? undefined : <WorkingBadge stats={stats.get(r.id)} />}>{r.name}</Name> },
							{ key: "mode", label: "Mode", cell: (r) => (isBuiltin(r) ? <Badge>Chat</Badge> : <ModeBadge mode={r.mode} />) },
							{ key: "today", label: "Today", num: true, quiet: (r) => isBuiltin(r) || !stats.get(r.id)?.today, cell: (r) => (isBuiltin(r) ? "—" : stats.get(r.id)?.today ?? 0) },
						]}
					/>
				</Section>
			} />
		</Page>
	);
}

/** Your agents: the list column (PluraMail Agent first, then the crew in order) beside the picked agent. */
function AgentsSplit(props: PageProps & { settings: React.ReactNode }) {
	const { tab, agentId, identities, addresses, prefs, setPrefs, onTab, onAgent } = props;
	const { data } = useAgents();
	const queryClient = useQueryClient();
	const [creating, setCreating] = useState(false);
	const [dragging, setDragging] = useState<string | null>(null);
	const stats = new Map((data?.stats ?? []).map((s) => [s.agentId, s]));
	const order = useMutation({
		mutationFn: (ids: string[]) => api.orderAgents(ids),
		onSettled: () => queryClient.invalidateQueries({ queryKey: ["agents"] }),
	});
	const drop = (over: string) => {
		if (!data || !dragging || dragging === over) return;
		const ids = data.agents.map((a) => a.id).filter((id) => id !== dragging);
		ids.splice(ids.indexOf(over), 0, dragging);
		queryClient.setQueryData(["agents"], { ...data, agents: ids.map((id) => data.agents.find((a) => a.id === id)!) });
		order.mutate(ids);
	};
	// The keyboard's and screen reader's way to reorder: the same order API as dragging.
	const move = (id: string, by: -1 | 1) => {
		if (!data) return;
		const ids = moveInOrder(data.agents.map((a) => a.id), id, by);
		if (!ids) return;
		queryClient.setQueryData(["agents"], { ...data, agents: ids.map((i) => data.agents.find((a) => a.id === i)!) });
		order.mutate(ids);
	};
	// With nothing picked, the detail shows the PluraMail Agent; on a phone the list shows instead.
	const picked = tab === "mailroom" || !!agentId;
	const shown = tab === "agents" && agentId ? agentId : MAILROOM_ROW.id;

	return (
		<>
			<Split
				label={CONSOLE_LABELS.agents}
				title={CONSOLE_LABELS.agents}
				count={(data?.agents.length ?? 0) + 1}
				picked={picked}
				actions={<Button size="sm" variant="primary" icon={<PlusIcon size={12} weight="bold" />} onClick={() => setCreating(true)}>Create agent</Button>}
				foot="Each agent starts in Watch, moves to Draft, then to Send once you trust it. Higher in the list takes a message first. Drag to reorder, or use the arrows."
				rows={<>
					<Row
						icon={<AgentIcon size={14} />}
						title={MAILROOM_ROW.name}
						tag={<Badge>built in</Badge>}
						aside={<Badge>Chat</Badge>}
						sub={prefs.unmatched === "draft" ? "Chat in the side panel, and drafts for mail no agent takes." : "Chat in the side panel."}
						meta={<span>All addresses</span>}
						current={shown === MAILROOM_ROW.id}
						onClick={() => onTab("mailroom")}
					/>
					{data?.agents.map((a, i, all) => (
						<Row
							key={a.id}
							title={a.name}
							tag={<>{!a.enabled && <Badge>paused</Badge>}<WorkingBadge stats={stats.get(a.id)} /></>}
							aside={<ModeBadge mode={a.mode} />}
							sub={a.job}
							meta={<><Addresses list={a.addresses} identities={identities} /><span>{weekText(stats.get(a.id), a.mode)} in 7 days</span></>}
							current={shown === a.id}
							off={!a.enabled}
							onClick={() => onAgent(a.id)}
							tools={all.length > 1 && <>
								<button type="button" className="pg-icon-btn" aria-label={`Move ${a.name} up`} title="Move up" disabled={i === 0} onClick={() => move(a.id, -1)}><ArrowUpIcon size={12} /></button>
								<button type="button" className="pg-icon-btn" aria-label={`Move ${a.name} down`} title="Move down" disabled={i === all.length - 1} onClick={() => move(a.id, 1)}><ArrowDownIcon size={12} /></button>
							</>}
							liProps={{
								"data-dragging": dragging === a.id || undefined,
								draggable: true,
								onDragStart: () => setDragging(a.id),
								onDragEnd: () => setDragging(null),
								onDragOver: (e) => e.preventDefault(),
								onDrop: (e) => { e.preventDefault(); drop(a.id); },
							}}
						/>
					))}
				</>}
			>
				{shown === MAILROOM_ROW.id ? (
					<Page title={CONSOLE_LABELS.mailroom} icon={<AgentIcon size={20} />} trail={{ label: CONSOLE_LABELS.agents, onClick: () => onTab("agents") }}
						sub={prefs.unmatched === "draft"
							? "Built in. You talk to it in the side panel, and it drafts for mail none of your agents take."
							: "Built in. You talk to it in the side panel. Mail none of your agents take is left alone."}>
						<Section title="When no agent matches">
							<div className="pg-ui-trust">
								<Segmented<Unmatched>
									label="When no agent matches"
									value={prefs.unmatched}
									onChange={(unmatched) => setPrefs({ ...prefs, unmatched })}
									options={[{ value: "leave", label: "Leave it" }, { value: "draft", label: "PluraMail Agent drafts" }]}
								/>
							</div>
						</Section>
						{props.settings}
					</Page>
				) : <AgentPage key={shown} {...props} agentId={shown} />}
			</Split>
			{creating && <CreateAgent addresses={addresses} identities={identities} onClose={() => setCreating(false)} onCreated={(a) => { setCreating(false); onAgent(a.id); }} />}
		</>
	);
}

const NEW_STEPS = ["Job", "Addresses", "Name"] as const;

/**
 * New agent, left to right: what it does, which addresses it reads, then its name over a summary
 * of the first two. Each step slides in from the right; a done step in the head jumps back to it.
 */
function CreateAgent({ addresses, identities, onClose, onCreated }: { addresses: string[]; identities: Identities; onClose: () => void; onCreated: (a: Agent) => void }) {
	const queryClient = useQueryClient();
	const [step, setStep] = useState(0);
	const [name, setName] = useState("");
	const [job, setJob] = useState("");
	const [instructions, setInstructions] = useState("");
	const [picked, setPicked] = useState<string[]>([]);
	const [choosing, setChoosing] = useState(false);
	const panels = useRef<(HTMLElement | null)[]>([]);
	const template = TEMPLATES.find((t) => t.job === job);
	const done = [!!job.trim(), !(choosing && picked.length === 0), !!name.trim()];
	const create = useMutation({
		mutationFn: () => api.createAgent({ name: name.trim(), job: job.trim(), instructions, addresses: choosing ? picked : [] }),
		onSuccess: (a) => { queryClient.invalidateQueries({ queryKey: ["agents"] }); onCreated(a); },
	});
	const last = step === NEW_STEPS.length - 1;
	const go = (to: number) => {
		setStep(to);
		// Focus the new step's first field once it has slid in, without the browser scrolling the track.
		// Addresses has no text field, so its question takes focus and the first Tab reaches the choice.
		setTimeout(() => panels.current[to]?.querySelector<HTMLElement>("textarea, input#new-agent-name, [data-step-focus]")?.focus({ preventScroll: true }), 220);
	};
	const next = () => {
		if (!done[step]) return;
		if (!last) go(step + 1);
		else if (!create.isPending) create.mutate();
	};
	const scope = !choosing ? `All ${addresses.length} addresses`
		: picked.length === 1 ? <span className="pg-console-addr"><Swatch identity={identities.of(picked[0])} /><AddressText address={picked[0]} identity={identities.of(picked[0])} bold={false} /></span>
		: `${picked.length} addresses`;
	return (
		<Modal className="is-roomy" label="New agent" onClose={onClose}>
			<DialogHead icon={<AgentIcon size={16} />} title="New agent" onClose={onClose}>
				<Track
					label="Steps" current={step} onPick={go}
					steps={NEW_STEPS.map((label, i) => ({ label, disabled: i > step && !done.slice(0, i).every(Boolean) }))}
				/>
			</DialogHead>
			<form
				className="pg-ui-compose"
				onSubmit={(e) => { e.preventDefault(); next(); }}
				onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); next(); } }}
			>
				<div className="pg-ui-wiz">
					<div className="pg-ui-wiz-track" data-step={step}>
						<section ref={(el) => { panels.current[0] = el; }} className="pg-ui-wiz-panel" inert={step !== 0} aria-label="Job">
							<label className="pg-ui-wiz-q" htmlFor="new-agent-job">What should this agent do?</label>
							<textarea
								id="new-agent-job" className="pg-textarea pg-ui-ask-input" rows={3} value={job} data-autofocus
								placeholder="Politely decline guest-post pitches." onChange={(e) => setJob(e.target.value)}
							/>
							{(!job.trim() || template) && (
								<div className="pg-ui-starts" role="group" aria-label="Start from">
									{TEMPLATES.map((t) => (
										<button
											key={t.label} type="button" className="pg-ui-start" aria-pressed={template === t}
											onClick={() => { setName(t.name); setJob(t.job); setInstructions(t.instructions); }}
										>
											<b>{t.label}</b>
											<span>{t.job}</span>
										</button>
									))}
								</div>
							)}
						</section>
						<section ref={(el) => { panels.current[1] = el; }} className="pg-ui-wiz-panel" inert={step !== 1} aria-label="Addresses">
							<span className="pg-ui-wiz-q" id="new-agent-addresses" tabIndex={-1} data-step-focus>Which addresses should it read?</span>
							<AddressPicker
								labelledBy="new-agent-addresses" addresses={addresses} identities={identities}
								choosing={choosing} value={picked} onChoosing={setChoosing} onChange={setPicked}
							/>
						</section>
						<section ref={(el) => { panels.current[2] = el; }} className="pg-ui-wiz-panel" inert={step !== 2} aria-label="Name">
							<label className="pg-ui-wiz-q" htmlFor="new-agent-name">What should it be called?</label>
							<input id="new-agent-name" className="pg-input pg-ui-wiz-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Penny" autoComplete="off" />
							<Summary>
								<SummaryRow label="Job" onEdit={() => go(0)}>{job.trim()}</SummaryRow>
								<SummaryRow label="Reads" onEdit={() => go(1)}>{scope}</SummaryRow>
								<SummaryRow label="Mode"><ModeBadge mode="watch" /></SummaryRow>
							</Summary>
							{create.error && <Note tone="error">{create.error.message}</Note>}
						</section>
					</div>
				</div>
				<div className="pg-modal-foot">
					{step > 0 ? <Button icon={<ArrowLeftIcon size={12} />} onClick={() => go(step - 1)}>Back</Button> : <Button onClick={onClose}>Cancel</Button>}
					<div className="pg-flex" />
					<span className="pg-ui-wiz-count">{step + 1} of {NEW_STEPS.length}</span>
					<Button type="submit" variant="primary" disabled={!done[step] || create.isPending}>
						{last ? (create.isPending ? "Creating…" : "Create agent") : "Next"}
						{!last && <ArrowRightIcon size={12} />}
					</Button>
				</div>
			</form>
		</Modal>
	);
}

/** Domains of `list`, in order of first appearance, each with its addresses. */
function byDomain(list: string[]) {
	const groups = new Map<string, string[]>();
	for (const a of list) {
		const d = a.slice(a.indexOf("@") + 1);
		groups.set(d, [...(groups.get(d) ?? []), a]);
	}
	return [...groups];
}

/** Which addresses an agent reads: all of them, or the ones picked from a Picker grouped by domain. */
function AddressPicker({ addresses, identities, choosing, value, onChoosing, onChange, labelledBy }: {
	addresses: string[];
	identities: Identities;
	choosing: boolean;
	value: string[];
	onChoosing: (on: boolean) => void;
	onChange: (list: string[]) => void;
	labelledBy?: string;
}) {
	const groups = byDomain(addresses).map(([domain, list]) => ({
		key: domain, label: domain, mark: <Swatch identity={identities.of(list[0])} />,
		items: list.map((a) => ({ value: a, text: a, label: <AddressText address={a} identity={identities.of(a)} bold={false} /> })),
	}));
	return (
		<div className="pg-ui-scope">
			<Choices
				labelledBy={labelledBy} value={choosing ? "some" : "all"} onChange={(v) => onChoosing(v === "some")}
				options={[{ value: "all", label: "All addresses", meta: addresses.length }, { value: "some", label: "Only some", meta: choosing ? `${value.length} picked` : "" }]}
			/>
			{choosing && <Picker groups={groups} value={value} onChange={onChange} noun="addresses" />}
		</div>
	);
}

/** What step 3 does with a reply, by mode. */
const REPLY_WITH: Record<AgentMode, string> = { watch: "logs only", draft: "drafts for review", send: "sends" };

const RULE_FIELDS: { value: AgentRule["field"]; label: string }[] = [{ value: "from", label: "From" }, { value: "subject", label: "Subject" }, { value: "body", label: "Body" }];
const RULE_OPS: { value: AgentRule["op"]; label: string }[] = [
	{ value: "contains", label: "contains" }, { value: "not_contains", label: "doesn't contain" }, { value: "is", label: "is" }, { value: "domain", label: "domain is" },
];

/**
 * One agent, in the order you decide things: what it's trusted to do and the week behind that,
 * what it has done, then how it works, as the same rows New agent ends on. Each row edits in place.
 */
function AgentPage({ agentId, identities, addresses, onTab }: PageProps & { agentId: string }) {
	const queryClient = useQueryClient();
	const { data, isPending } = useAgents();
	const agent = data?.agents.find((a) => a.id === agentId);
	const stats = data?.stats.find((s) => s.agentId === agentId);
	const refresh = () => queryClient.invalidateQueries({ queryKey: ["agents"] });
	const update = useMutation({ mutationFn: (input: Partial<Agent>) => api.updateAgent(agentId, input), onSuccess: refresh });
	const runs = useQuery({ queryKey: ["agent-runs", agentId], queryFn: () => api.getAgentRuns(agentId, 100) });
	const trail = { label: CONSOLE_LABELS.agents, onClick: () => onTab("agents") };

	if (isPending) return <Page title="" trail={trail}><p className="pg-ui-note">Loading</p></Page>;
	if (!agent) return <Page title="Agent not found" trail={trail}><Button onClick={() => onTab("agents")}>Back to your agents</Button></Page>;
	return (
		<Page
			title={agent.name}
			icon={<AgentIcon size={20} />}
			sub={agent.job}
			trail={trail}
			actions={<>
				{agent.enabled ? <WorkingBadge stats={stats} /> : <Badge>Paused</Badge>}
				<Button
					variant={agent.enabled ? "default" : "primary"} icon={<AgentIcon size={14} />} disabled={update.isPending}
					onClick={() => update.mutate({ enabled: !agent.enabled })}
				>
					{agent.enabled ? "Pause" : "Turn on"} Agent {agent.name}
				</Button>
			</>}
		>
			{update.error && <Note tone="error">{update.error.message}</Note>}
			<AgentTrust agent={agent} stats={stats} runs={runs.data ?? []} onMode={(mode) => update.mutate({ mode })} />
			<AgentRuns runs={runs} identities={identities} />
			<AgentSetup key={agent.id} agent={agent} addresses={addresses} identities={identities} />
			<AgentDelete key={`d-${agent.id}`} agent={agent} onDeleted={() => { refresh(); onTab("agents"); }} />
		</Page>
	);
}

/** What moves an agent up a rung. Advisory: you can move it sooner, and the button says so. */
const TRUST_GATE = { matched: 10 };

/** The rungs, left to right: what each lets the agent do, and what it never does. */
const RUNGS: Record<AgentMode, { icon: (s: number) => ReactNode; does: string[]; never?: string }> = {
	watch: { icon: (s) => <EyeIcon size={s} />, does: ["Reads matched mail", "Logs the reply it would write"], never: "Sends nothing" },
	draft: { icon: (s) => <PencilSimpleIcon size={s} />, does: ["Writes a draft for each match", "You send, edit or discard it"], never: "Sends nothing" },
	send: { icon: (s) => <PaperPlaneRightIcon size={s} />, does: ["Sends its replies", "Inside its daily limit"] },
};

/** The last 7 days, oldest first, with what the agent handled, skipped and failed each day. */
function weekBars(runs: AutoDraftRun[]) {
	const days = Array.from({ length: 7 }, (_, i) => {
		const d = new Date();
		d.setHours(0, 0, 0, 0);
		d.setDate(d.getDate() - (6 - i));
		return { key: dayKey(d.toISOString()), label: d.toLocaleDateString(undefined, { weekday: "narrow" }), handled: 0, skipped: 0, failed: 0 };
	});
	for (const r of runs) {
		const day = days.find((d) => d.key === dayKey(r.createdAt));
		if (!day) continue;
		if (r.state === "failed") day.failed++;
		else if (r.state === "skipped" || r.state === "superseded") day.skipped++;
		else if (r.state === "watched" || r.state === "drafted" || r.state === "sent") day.handled++;
	}
	return days;
}

/**
 * Trust: three rungs, Watch, Draft and Send, each saying what it lets the agent do. Under them, the gate
 * to the next rung: what it asks for, how far along the agent is, a week of runs, and the move.
 */
function AgentTrust({ agent, stats, runs, onMode }: { agent: Agent; stats: AgentStats | undefined; runs: AutoDraftRun[]; onMode: (mode: AgentMode) => void }) {
	const at = MODES.findIndex((m) => m.value === agent.mode);
	const next = MODES[at + 1];
	const counts = stats?.runs ?? {};
	const matched = (counts.watched ?? 0) + (counts.drafted ?? 0) + (counts.sent ?? 0);
	const failed = counts.failed ?? 0;
	const bars = weekBars(runs);
	const peak = Math.max(1, ...bars.map((d) => d.handled + d.skipped + d.failed));
	const gate: { label: string; met?: boolean; value?: number; later?: boolean }[] = agent.mode === "watch"
		? [
			{ label: `${Math.min(matched, TRUST_GATE.matched)} of ${TRUST_GATE.matched} messages matched`, value: matched / TRUST_GATE.matched, met: matched >= TRUST_GATE.matched },
			{ label: failed ? `${failed} failed this week` : "None failed this week", met: !failed, value: failed ? 0 : 1 },
		]
		: [
			{ label: "Test on past mail", later: true },
			{ label: "Drafts you send without edits", later: true },
		];
	const ready = gate.every((g) => g.met);
	return (
		<Section title="Trust" actions={<span className="pg-ui-quiet">{weekText(stats, agent.mode)} in 7 days</span>}>
			<div className="pg-ui-trust">
				<ol className="pg-ui-rungs" aria-label="Trust">
					{MODES.map((m, i) => {
						const rung = RUNGS[m.value];
						const state = i === at ? "now" : i < at ? "done" : m.disabled ? "locked" : "next";
						return (
							<li key={m.value} data-state={state}>
								<button type="button" className="pg-ui-rung" disabled={m.disabled} aria-current={i === at ? "step" : undefined} title={m.title} onClick={() => { if (i !== at) onMode(m.value); }}>
									<span className="pg-ui-rung-head">
										<span className="pg-ui-rung-n" aria-hidden>{i < at ? <CheckIcon size={11} weight="bold" /> : i + 1}</span>
										<b>{m.label}</b>
										{state === "now" && <Badge tone={m.value} dot>Now</Badge>}
										{state === "locked" && <span className="pg-ui-rung-later"><LockSimpleIcon size={11} />{SEND_VERSION}</span>}
										<span className="pg-ui-rung-icon" aria-hidden>{rung.icon(16)}</span>
									</span>
									<ul>
										{rung.does.map((d) => <li key={d}><CheckIcon size={11} weight="bold" aria-hidden />{d}</li>)}
										{rung.never && <li data-never><XIcon size={11} weight="bold" aria-hidden />{rung.never}</li>}
									</ul>
								</button>
							</li>
						);
					})}
				</ol>
				<div className="pg-ui-gate">
					<div className="pg-ui-gate-main">
						<h3>To move to {next?.label}</h3>
						<ul className="pg-ui-gate-list">
							{gate.map((g) => (
								<li key={g.label} data-met={g.met || undefined} data-later={g.later || undefined}>
									<span className="pg-ui-gate-mark" aria-hidden>{g.later ? <LockSimpleIcon size={11} /> : g.met ? <CheckIcon size={11} weight="bold" /> : null}</span>
									<span className="pg-ui-gate-label">{g.label}</span>
									{g.later ? <span className="pg-ui-gate-later">{SEND_VERSION}</span> : (
										<svg className="pg-ui-meter" viewBox="0 0 100 4" preserveAspectRatio="none" aria-hidden><rect width="100" height="4" /><rect data-fill width={Math.round(Math.min(1, g.value ?? 0) * 100)} height="4" /></svg>
									)}
								</li>
							))}
						</ul>
						<div className="pg-ui-toolbar">
							{next && !next.disabled && (
								<Button variant={ready ? "primary" : "default"} icon={<ArrowRightIcon size={12} />} onClick={() => onMode(next.value)}>
									{ready ? `Move to ${next.label}` : `Move to ${next.label} anyway`}
								</Button>
							)}
							{next?.disabled && <Button disabled title={next.title} icon={<LockSimpleIcon size={12} />}>Move to {next.label}</Button>}
							{at > 0 && <Button variant="quiet" icon={<ArrowLeftIcon size={12} />} onClick={() => onMode(MODES[at - 1].value)}>Back to {MODES[at - 1].label}</Button>}
						</div>
					</div>
					<figure className="pg-ui-week" aria-label={`Last 7 days, ${bars.map((d) => d.handled).join(", ")} handled`}>
						<svg className="pg-ui-week-bars" viewBox="0 0 140 64" preserveAspectRatio="none" aria-hidden>
							{bars.map((d, i) => {
								const h = (n: number) => (n / peak) * 60;
								let y = 64;
								return (
									<g key={d.key}>
										<title>{`${d.handled} handled, ${d.skipped} skipped, ${d.failed} failed`}</title>
										<rect data-k="track" x={i * 20 + 3} y={0} width={14} height={64} />
										{(["handled", "skipped", "failed"] as const).map((k) => {
											if (!d[k]) return null;
											y -= h(d[k]);
											return <rect key={k} data-k={k} x={i * 20 + 3} y={y} width={14} height={h(d[k])} />;
										})}
									</g>
								);
							})}
						</svg>
						<div className="pg-ui-week-labels" aria-hidden>{bars.map((d) => <span key={d.key}>{d.label}</span>)}</div>
						<figcaption className="pg-ui-week-key">
							<span data-k="handled">{agent.mode === "watch" ? "Would handle" : "Handled"}</span>
							<span data-k="skipped">Skipped</span>
							<span data-k="failed">Failed</span>
						</figcaption>
					</figure>
				</div>
			</div>
		</Section>
	);
}

/** What the agent did with each message it matched, newest first. The latest few, then all of them. */
function AgentRuns({ runs, identities }: { runs: UseQueryResult<AutoDraftRun[]>; identities: Identities }) {
	const openMessage = useOpenMessage();
	const [all, setAll] = useState(false);
	const total = runs.data?.length ?? 0;
	return (
		<Section title="Activity" actions={total > 6 && <Button size="sm" variant="quiet" onClick={() => setAll(!all)}>{all ? "Show fewer" : `Show all ${total}`}</Button>}>
			<Async query={runs} empty="No runs yet">
				{(rows) => (
					<Table
						label="Runs"
						rows={all ? rows : rows.slice(0, 6)}
						rowKey={(r) => r.emailId}
						onRow={(r) => openMessage?.({ mailboxId: r.mailboxId, emailId: r.emailId })}
						columns={[
							{ key: "at", label: "Received", cell: (r) => <span className="pg-mono">{when(r.createdAt)}</span> },
							{ key: "from", label: "From", cell: (r) => r.sender },
							{ key: "to", label: "To", wide: true, cell: (r) => <AddressText address={r.mailboxId} identity={identities.of(r.mailboxId)} bold={false} short /> },
							{ key: "state", label: "Result", cell: (r) => <RunBadge state={r.state} /> },
							{ key: "why", label: "Why", wide: true, clip: (r) => r.reason, cell: (r) => r.reason ?? "" },
						]}
					/>
				)}
			</Async>
		</Section>
	);
}

type SetupRow = "reads";

/** How the agent works, as Summary rows. Typed fields save after a pause; picks and buttons save at once. */
function AgentSetup({ agent, addresses, identities }: { agent: Agent; addresses: string[]; identities: Identities }) {
	const queryClient = useQueryClient();
	const [form, setForm] = useState(() => ({ ...agent }));
	const [choosing, setChoosing] = useState(agent.addresses.length > 0);
	const [open, setOpen] = useState<SetupRow | null>(null);
	const [typed, setTyped] = useState(false);
	const save = useMutation({
		mutationFn: (body: string) => api.updateAgent(agent.id, JSON.parse(body)),
		onSuccess: (_, body) => {
			setSavedAs(body);
			queryClient.invalidateQueries({ queryKey: ["agents"] });
		},
	});
	const set = (patch: Partial<Agent>, isTyped = false) => {
		setTyped(isTyped);
		if (save.isError) save.reset();
		setForm((f) => ({ ...f, ...patch }));
	};
	const body = JSON.stringify({
		name: form.name, job: form.job, addresses: form.addresses, rules: form.rules.filter((r) => r.value.trim()),
		instructions: form.instructions, exampleReply: form.exampleReply, dailyLimit: form.dailyLimit, perSenderLimit: form.perSenderLimit,
	});
	// What the server holds. Moves forward on each save, ahead of the agents refetch.
	const [savedAs, setSavedAs] = useState(body);
	const valid = !!form.name.trim() && !!form.job.trim();
	useEffect(() => {
		if (body === savedAs || !valid || save.isPending || save.isError) return;
		const t = setTimeout(() => save.mutate(body), typed ? 700 : 0);
		return () => clearTimeout(t);
	}, [body, savedAs, valid, save.isPending, save.isError]); // eslint-disable-line react-hooks/exhaustive-deps
	const setRule = (i: number, patch: Partial<AgentRule>, isTyped = false) => set({ rules: form.rules.map((r, j) => (j === i ? { ...r, ...patch } : r)) }, isTyped);
	const toggle = (row: SetupRow) => setOpen(open === row ? null : row);

	const rules = form.rules.filter((r) => r.value.trim());
	const one = form.addresses.length === 1 ? form.addresses[0] : null;
	const reads = one ? <span className="pg-console-addr"><Swatch identity={identities.of(one)} /><AddressText address={one} identity={identities.of(one)} bold={false} /></span>
		: form.addresses.length === 0 ? "All addresses" : `${form.addresses.length} addresses`;

	return (
		<Section title="How it works">
			<Summary>
				<SummaryRow
					label="Reads" open={open === "reads"} onEdit={() => toggle("reads")}
					editor={<>
						<AddressPicker
							addresses={addresses} identities={identities} choosing={choosing} value={form.addresses}
							onChoosing={(on) => { setChoosing(on); if (!on) set({ addresses: [] }); }} onChange={(list) => set({ addresses: list })}
						/>
						<div className="pg-ui-sum-label">Rules</div>
						{form.rules.length > 0 && (
							<div className="pg-console-rules">
								{form.rules.map((r, i) => (
									<div key={i} className="pg-console-rule">
										<em>{i === 0 ? "If" : "and"}</em>
										<select className="pg-select" value={r.field} aria-label="Field" onChange={(e) => setRule(i, { field: e.target.value as AgentRule["field"] })}>
											{RULE_FIELDS.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
										</select>
										<select className="pg-select" value={r.op} aria-label="Match" onChange={(e) => setRule(i, { op: e.target.value as AgentRule["op"] })}>
											{RULE_OPS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
										</select>
										<input className="pg-input" value={r.value} aria-label="Value" placeholder="guest post, link exchange" onChange={(e) => setRule(i, { value: e.target.value }, true)} />
										<Button size="sm" variant="quiet" aria-label="Remove rule" icon={<XIcon size={12} />} onClick={() => set({ rules: form.rules.filter((_, j) => j !== i) })} />
									</div>
								))}
							</div>
						)}
						{form.rules.length < 10 && (
							<div><Button size="sm" icon={<PlusIcon size={12} />} onClick={() => set({ rules: [...form.rules, { field: "subject", op: "contains", value: "" }] })}>Add rule</Button></div>
						)}
					</>}
				>
					{reads}
					<span className="pg-ui-sum-sub">{rules.length ? rules.map((r, i) => `${i ? "and " : "If "}${RULE_FIELDS.find((f) => f.value === r.field)?.label.toLowerCase()} ${RULE_OPS.find((o) => o.value === r.op)?.label} “${r.value}”`).join(" ") : "No rules"}</span>
				</SummaryRow>
				<SummaryRow label="Job">
					<InlineText multiline label="Job" value={form.job} invalid={!form.job.trim()} placeholder="Describe the job" onChange={(v) => set({ job: v }, true)} />
				</SummaryRow>
				<SummaryRow label="Reply">
					<InlineText multiline label="Instructions" value={form.instructions} placeholder="How it should write" onChange={(v) => set({ instructions: v }, true)} />
					<InlineText multiline label="Example reply" value={form.exampleReply} placeholder="Example reply" onChange={(v) => set({ exampleReply: v }, true)} />
				</SummaryRow>
				<SummaryRow label="Limits">
					<span className="pg-ui-sum-nums">
						<NumberInput label="Sends a day" min={0} max={100} value={form.dailyLimit} onChange={(v) => set({ dailyLimit: Number(v) }, true)} unit="a day" />
						<NumberInput label="Replies to one sender a day" min={1} max={10} value={form.perSenderLimit} onChange={(v) => set({ perSenderLimit: Number(v) }, true)} unit="per sender" />
					</span>
				</SummaryRow>
				<SummaryRow label="Name">
					<InlineText label="Name" value={form.name} invalid={!form.name.trim()} placeholder="Name" onChange={(v) => set({ name: v }, true)} />
				</SummaryRow>
			</Summary>
			{save.error && <SaveBar error={save.error.message} saving={save.isPending} onSave={() => save.mutate(body)} />}
		</Section>
	);
}

/**
 * The last thing on an agent's page, apart from the rest: Delete, then a second click to confirm.
 * The confirm says something else, takes focus to Keep, and ignores clicks for a moment, so a double-click can't delete.
 */
function AgentDelete({ agent, onDeleted }: { agent: Agent; onDeleted: () => void }) {
	// When the confirm step opened, or null.
	const [confirming, setConfirming] = useState<number | null>(null);
	const remove = useMutation({ mutationFn: () => api.deleteAgent(agent.id), onSuccess: onDeleted });
	return (
		<div className="pg-ui-toolbar pg-ui-danger-zone">
			{confirming !== null
				? <>
					<Button variant="danger" icon={<AgentIcon size={14} />} disabled={remove.isPending} onClick={() => confirmReady(confirming, Date.now()) && remove.mutate()}>Yes, delete {agent.name}</Button>
					<Button autoFocus onClick={() => setConfirming(null)}>Keep</Button>
					<span className="pg-ui-quiet">Its activity stays in the log.</span>
					{remove.error && <Note tone="error">{remove.error.message}</Note>}
				</>
				: <Button variant="danger" icon={<AgentIcon size={14} />} onClick={() => setConfirming(Date.now())}>Delete Agent {agent.name}</Button>}
		</div>
	);
}

/** Draft review: agent drafts as mail rows, the written reply in full, and Send on each. A click opens the draft in the compose window. */
function ReviewPage({ identities, onOpenDraft, onSendDraft }: PageProps) {
	const queryClient = useQueryClient();
	const review = useQuery({ queryKey: ["agent-drafts"], queryFn: () => api.getAgentDrafts() });
	const [busy, setBusy] = useState<string | null>(null);
	const [confirming, setConfirming] = useState<string | null>(null);
	const [error, setError] = useState<{ id: string; text: string } | null>(null);
	const drop = (id: string) => queryClient.setQueryData<AgentDraft[]>(["agent-drafts"], (list) => list?.filter((d) => d.emailId !== id));
	const run = async (d: AgentDraft, job: () => Promise<unknown>) => {
		setBusy(d.emailId);
		setError(null);
		try {
			await job();
			drop(d.emailId);
		} catch (e) {
			setError({ id: d.emailId, text: e instanceof Error ? e.message : "Something went wrong." });
		} finally {
			setBusy(null);
			setConfirming(null);
			queryClient.invalidateQueries({ queryKey: ["agent-drafts"] });
		}
	};
	const drafts = review.data ?? [];
	let lastDay: string | null = null;
	return (
		<section className="pg-list-col pg-review" aria-label={CONSOLE_LABELS.review}>
			<div className="pg-list-head">
				<span className="pg-scope-icon"><TrayIcon size={14} /></span>
				<span className="pg-title">{CONSOLE_LABELS.review}</span>
				{drafts.length > 0 && <span className="pg-count">{drafts.length}</span>}
			</div>
			<div className="pg-list">
				{review.isPending && <div className="pg-empty"><p>Loading</p></div>}
				{review.error && (
					<div className="pg-empty">
						<div className="pg-empty-icon"><WarningIcon size={20} /></div>
						<h2>Could not load drafts</h2>
						<p>{review.error.message}</p>
						<button type="button" className="pg-btn" onClick={() => review.refetch()}>Retry</button>
					</div>
				)}
				{review.isSuccess && drafts.length === 0 && (
					<div className="pg-empty">
						<div className="pg-empty-icon"><TrayIcon size={20} /></div>
						<h2>No drafts waiting</h2>
						<p>Drafts your agents write land here for you to send.</p>
					</div>
				)}
				{/* Each draft is a list item whose subject opens it, so agents read its parts. The whole row still opens it. */}
				{drafts.length > 0 && <div role="list">{drafts.map((d) => {
					const day = dayKey(d.date);
					const dayStart = day !== lastDay;
					const gap = dayStart && lastDay !== null;
					lastDay = day;
					const identity = identities.of(d.mailboxId);
					const working = busy === d.emailId;
					const open = () => onOpenDraft(d.mailboxId, d.emailId);
					return (
						<Fragment key={d.emailId}>
							{gap && <div className="pg-gap" aria-hidden />}
							<div
								className="pg-row pg-review-row"
								role="listitem"
								data-busy={working || undefined}
								onClick={open}
							>
								<div className="pg-row-when">
									<span className={dayStart ? "pg-day-first" : undefined}>{dayLabel(d.date)}</span>
									<span>{timeLabel(d.date)}</span>
								</div>
								<div className="pg-row-main">
									<div className="pg-row-to" title={`Sends from ${d.mailboxId}`}>
										<Swatch identity={identity} />
										<AddressText address={d.mailboxId} identity={identity} />
										<ArrowRightIcon size={10} />
										<span className="pg-ellipsis">{d.recipient}</span>
									</div>
									<div className="pg-row-subject">
										<button type="button" className="pg-row-link" onClick={(e) => { e.stopPropagation(); open(); }}>{d.subject || "(no subject)"}</button>
									</div>
									<p className="pg-review-body">{d.text || d.snippet}</p>
									<div className="pg-review-foot" onClick={(e) => e.stopPropagation()}>
										<span className="pg-row-badge"><AgentIcon size={11} />{d.agent ?? "PluraMail Agent"}</span>
										{error?.id === d.emailId && <span className="pg-review-error">{error.text}</span>}
										<span className="pg-flex" />
										{confirming === d.emailId ? (
											<>
												<button type="button" className="pg-btn pg-btn-sm pg-btn-quiet" onClick={() => setConfirming(null)}>Keep</button>
												<button type="button" className="pg-btn pg-btn-sm pg-btn-danger" disabled={working} onClick={() => run(d, () => api.deleteEmail(d.mailboxId, d.emailId))}>Discard draft</button>
											</>
										) : (
											<>
												<button type="button" className="pg-btn pg-btn-sm pg-btn-quiet" disabled={working} onClick={() => setConfirming(d.emailId)}>Discard</button>
												<button type="button" className="pg-btn pg-btn-sm pg-btn-outline" disabled={working} onClick={open}><PencilSimpleIcon size={13} />Edit</button>
												<button type="button" className="pg-btn pg-btn-sm pg-btn-primary" disabled={working} onClick={() => run(d, () => onSendDraft(d.mailboxId, d.emailId))}>
													<PaperPlaneRightIcon size={13} weight="fill" />{working ? "Sending" : "Send"}
												</button>
											</>
										)}
									</div>
								</div>
							</div>
						</Fragment>
					);
				})}</div>}
			</div>
		</section>
	);
}
