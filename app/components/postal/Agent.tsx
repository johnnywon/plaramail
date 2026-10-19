// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { openableDrafts, type ToolCall } from "./agent-drafts";
import { ArrowElbowDownLeftIcon, CaretDoubleLeftIcon, CaretDoubleRightIcon, StopIcon, TrashIcon } from "@phosphor-icons/react";
import { AgentIcon } from "./AgentIcon";
import { useQueryClient } from "@tanstack/react-query";
import type { UIMessage } from "ai";
import type { ComposeState } from "./compose";
import { Keys, useShortcuts } from "./shortcuts";
import { Suspense, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { canSend, DRAFT_START_MS, draftStartStep, ownText } from "./draft-start";
import { AgentMarkdown } from "./agent-markdown";
import { SHARED_AGENT, type AgentContext } from "../../../shared/agent";
import { DEMO_AGENT_NOTICE, useDemo } from "~/lib/demo";

type Hooks = {
	useAgent: typeof import("agents/react").useAgent;
	useAgentChat: typeof import("@cloudflare/ai-chat/react").useAgentChat;
};

let hooksPromise: Promise<Hooks> | null = null;

/** The agent client libraries, loaded once on first use. */
export function useAgentHooks() {
	const [hooks, setHooks] = useState<Hooks | null>(null);
	const [error, setError] = useState<string | null>(null);
	useEffect(() => {
		hooksPromise ??= Promise.all([import("agents/react"), import("@cloudflare/ai-chat/react")]).then(([a, c]) => ({
			useAgent: a.useAgent,
			useAgentChat: c.useAgentChat,
		}));
		let live = true;
		hooksPromise.then((h) => live && setHooks(() => h)).catch(() => {
			hooksPromise = null;
			if (live) setError("Could not reach the agent. Reload to retry.");
		});
		return () => {
			live = false;
		};
	}, []);
	return { hooks, error };
}

type Part = UIMessage["parts"][number];

function toolName(part: Part): string | null {
	if (part.type === "dynamic-tool") return (part as { toolName?: string }).toolName ?? null;
	if (part.type.startsWith("tool-")) return part.type.slice(5);
	return null;
}

function toolOutput(part: Part): unknown {
	const p = part as { output?: unknown; result?: unknown };
	return p.output ?? p.result;
}

function toolDone(part: Part): boolean {
	const state = (part as { state?: string }).state;
	return state === "output-available" || state === "output-error" || state === "result";
}

function toolSummary(part: Part): string {
	const input = (part as { input?: Record<string, unknown> }).input ?? {};
	const arg = ["query", "emailId", "threadId", "folder", "to", "originalEmailId"].map((k) => input[k]).find((v) => typeof v === "string") as string | undefined;
	return `${toolName(part)}${arg ? ` ${arg.length > 40 ? `${arg.slice(0, 40)}…` : arg}` : ""}`;
}

function toolCount(part: Part): string {
	if (!toolDone(part)) return "…";
	const out = toolOutput(part) as Record<string, unknown> | unknown[] | null;
	if (Array.isArray(out)) return String(out.length);
	if (out && typeof out === "object") {
		if ("error" in out) return "error";
		for (const key of ["emails", "results", "labels", "messages"]) {
			const v = (out as Record<string, unknown>)[key];
			if (Array.isArray(v)) return String(v.length);
		}
	}
	return "ok";
}

export interface DraftResult {
	html?: string;
	text?: string;
	draftId?: string;
}

// ── Panel ────────────────────────────────────────────────────────────

export interface AgentPanelProps {
	/** The conversation on screen, so "this email" means something to the agent. */
	open: AgentContext["open"];
	/** Subject of the open conversation, shown under the header. */
	reading: string | null;
	onCollapse: () => void;
	overlay: boolean;
	/** Closed: still mounted for its motion, out of reach of focus and assistive tech. */
	inert?: boolean;
	prefill: { text: string; id: number } | null;
	onOpenDraft: (mailboxId: string, draftId: string) => void;
	onBusy: (busy: boolean) => void;
}

/** What "this email" means to the agent right now. */
function Reading({ subject }: { subject: string | null }) {
	return (
		<span className="pg-agent-reading pg-flex pg-ellipsis" title={subject ?? undefined}>
			{subject === null ? "No email open" : `Reading: ${subject || "(no subject)"}`}
		</span>
	);
}

export function AgentPanel(props: AgentPanelProps) {
	return useDemo() ? <DemoAgentPanel {...props} /> : <LiveAgentPanel {...props} />;
}

/**
 * The panel on a demo build: the same header, suggestions and box, no agent
 * behind it. Whatever is asked gets the notice as the reply.
 */
/** The demo's notice: the agent is off here. Full in the empty chat, compact as the reply to anything asked. */
function DemoNotice({ compact }: { compact?: boolean }) {
	return (
		<div className="pg-demo-notice" role="note" data-compact={compact || undefined}>
			<div className="pg-demo-notice-head">
				<AgentIcon size={14} />
				<span className="pg-caption">Demo</span>
			</div>
			<b>The agent is off in the demo</b>
			{!compact && <span>On your own deployment it reads, searches, labels, drafts and sends your mail.</span>}
		</div>
	);
}

/**
 * Puts a prefill in the box and focuses it once the panel can take focus: on its first open
 * the panel mounts inert for a frame, and focus() on an inert element does nothing.
 */
function usePrefill(prefill: AgentPanelProps["prefill"], inert: boolean | undefined, setInput: (text: string) => void, inputRef: React.RefObject<HTMLTextAreaElement | null>) {
	const focusedFor = useRef<number | null>(null);
	useEffect(() => {
		if (prefill) setInput(prefill.text);
	}, [prefill, setInput]);
	useEffect(() => {
		if (!prefill || inert || focusedFor.current === prefill.id) return;
		focusedFor.current = prefill.id;
		requestAnimationFrame(() => inputRef.current?.focus());
	}, [prefill, inert, inputRef]);
}

function DemoAgentPanel({ reading, prefill, onCollapse, overlay, inert }: AgentPanelProps) {
	const { tip } = useShortcuts();
	const [messages, setMessages] = useState<{ id: string; text: string }[]>([]);
	const [input, setInput] = useState("");
	const inputRef = useRef<HTMLTextAreaElement>(null);
	const scrollRef = useRef<HTMLDivElement>(null);
	usePrefill(prefill, inert, setInput, inputRef);
	useEffect(() => {
		const el = scrollRef.current;
		if (el) el.scrollTop = el.scrollHeight;
	}, [messages]);
	const submit = (text = input) => {
		const t = text.trim();
		if (!t) return;
		setInput("");
		const id = Date.now();
		setMessages((m) => [...m, { id: `q${id}`, text: t }]);
	};
	return (
		<aside className="pg-agent" aria-label="PluraMail Agent" data-overlay={overlay || undefined} inert={inert}>
			<button type="button" className="pg-rail-head" onClick={onCollapse} title={tip("agent", "Collapse agent panel")}>
				<CaretDoubleRightIcon size={14} weight="bold" />
				<span className="pg-head-label">PLURAMAIL AGENT</span>
				<AgentIcon size={14} weight="fill" color="var(--pg-green)" />
			</button>
			<div className="pg-agent-sub">
				<Reading subject={reading} />
			</div>
			<div className="pg-agent-scroll" ref={scrollRef} role="log" aria-label="Agent chat">
				{messages.length === 0 ? (
					<div className="pg-agent-empty">
						<DemoNotice />
						{SUGGESTIONS.map((s) => (
							<button key={s} type="button" className="pg-btn" onClick={() => submit(s)}>{s}</button>
						))}
					</div>
				) : (
					<div className="pg-agent-thread">
						{messages.map((m) => (
							<div key={m.id} className="pg-agent-turn">
								<div className="pg-agent-q" role="article" aria-label="You">{m.text}</div>
								<div role="article" aria-label="Agent"><DemoNotice compact /></div>
							</div>
						))}
					</div>
				)}
			</div>
			<div className="pg-agent-input-wrap">
				<form className="pg-agent-input" onSubmit={(e) => { e.preventDefault(); submit(); }}>
					<textarea
						ref={inputRef}
						rows={2}
						value={input}
						onChange={(e) => setInput(e.target.value)}
						onKeyDown={(e) => {
							if (e.nativeEvent.isComposing) return;
							if (e.key === "Enter" && !e.shiftKey) {
								e.preventDefault();
								submit();
							}
						}}
						placeholder="Ask about your mail…"
						aria-label="Ask the agent"
						id="pg-agent-input"
					/>
					<button type="submit" className="pg-return" title="Send (↵)" aria-label="Send" disabled={!input.trim()}><ArrowElbowDownLeftIcon size={14} weight="bold" /></button>
				</form>
			</div>
		</aside>
	);
}

function LiveAgentPanel(props: AgentPanelProps) {
	const { hooks, error } = useAgentHooks();
	const { tip } = useShortcuts();
	return (
		<aside className="pg-agent" aria-label="PluraMail Agent" data-overlay={props.overlay || undefined} inert={props.inert}>
			<button type="button" className="pg-rail-head" onClick={props.onCollapse} title={tip("agent", "Collapse agent panel")}>
				<CaretDoubleRightIcon size={14} weight="bold" />
				<span className="pg-head-label">PLURAMAIL AGENT</span>
				<AgentIcon size={14} weight="fill" color="var(--pg-green)" />
			</button>
			{hooks ? (
				<AgentChat hooks={hooks} {...props} />
			) : (
				<>
					<div className="pg-agent-sub">
						<Reading subject={props.reading} />
					</div>
					<div className="pg-agent-empty"><p>{error ?? "Connecting…"}</p></div>
				</>
			)}
		</aside>
	);
}

const SUGGESTIONS = ["What came in today that needs a reply?", "Summarize unread mail", "Draft a reply to the open conversation"];

function AgentChat({ hooks, open, reading, prefill, inert, onOpenDraft, onBusy }: AgentPanelProps & { hooks: Hooks }) {
	// One agent for every address; each tool call names the address it acts on.
	const agent = hooks.useAgent({ agent: "EmailAgent", name: SHARED_AGENT });
	const context = useRef<AgentContext>({ open });
	context.current = { open };
	const { messages, sendMessage, status, setMessages, stop } = hooks.useAgentChat({ agent, body: () => context.current });
	const busy = status === "streaming" || status === "submitted";
	const [input, setInput] = useState("");
	// Up and Down walk through what you asked before, like a shell.
	const history = useMemo(() => sentHistory(messages), [messages]);
	const [historyAt, setHistoryAt] = useState<number | null>(null);
	const unsent = useRef("");
	const inputRef = useRef<HTMLTextAreaElement>(null);
	const scrollRef = useRef<HTMLDivElement>(null);
	const queryClient = useQueryClient();
	const was = useRef(false);

	useEffect(() => {
		onBusy(busy);
		// Agent tools label, move and draft mail and rebind shortcuts; refresh when a turn ends.
		if (was.current && !busy) for (const queryKey of [["mail"], ["mail-facets"], ["emails"], ["labels"], ["prefs"]]) queryClient.invalidateQueries({ queryKey });
		was.current = busy;
	}, [busy]); // eslint-disable-line react-hooks/exhaustive-deps
	useEffect(() => () => onBusy(false), []); // eslint-disable-line react-hooks/exhaustive-deps

	useEffect(() => {
		const el = scrollRef.current;
		if (el) el.scrollTop = el.scrollHeight;
	}, [messages]);

	// The box starts at two lines and grows with what you type.
	useLayoutEffect(() => {
		const el = inputRef.current;
		if (!el) return;
		el.style.height = "auto";
		el.style.height = `${el.scrollHeight}px`;
	}, [input]);

	usePrefill(prefill, inert, setInput, inputRef);

	const submit = (text = input) => {
		const t = text.trim();
		if (!t || busy) return;
		setInput("");
		setHistoryAt(null);
		sendMessage({ text: t });
	};

	return (
		<>
			<div className="pg-agent-sub">
				<Reading subject={reading} />
				{messages.length > 0 && !busy && (
					<button type="button" className="pg-head-btn" title="Clear chat" aria-label="Clear chat" onClick={() => window.confirm("Clear this chat?") && setMessages([])}>
						<TrashIcon size={14} />
					</button>
				)}
			</div>
			<div className="pg-agent-scroll" ref={scrollRef} role="log" aria-label="Agent chat">
				{messages.length === 0 ? (
					<div className="pg-agent-empty">
						{SUGGESTIONS.map((s) => (
							<button key={s} type="button" className="pg-btn" onClick={() => submit(s)}>{s}</button>
						))}
					</div>
				) : (
					<div className="pg-agent-thread">
						{messages.map((m) => <ChatMessage key={m.id} message={m} onOpenDraft={onOpenDraft} />)}
						{busy && (
							<div className="pg-agent-tool" data-running="true"><span className="pg-tri">▸</span><span>working…</span></div>
						)}
					</div>
				)}
			</div>
			<div className="pg-agent-input-wrap">
				<form className="pg-agent-input" onSubmit={(e) => { e.preventDefault(); submit(); }}>
					<textarea
						ref={inputRef}
						rows={2}
						value={input}
						onChange={(e) => {
							setInput(e.target.value);
							setHistoryAt(null);
						}}
						onKeyDown={(e) => {
							if (e.nativeEvent.isComposing) return;
							// Enter sends; Shift+Enter starts a new line.
							if (e.key === "Enter" && !e.shiftKey) {
								e.preventDefault();
								submit();
								return;
							}
							if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
							if (!history.length) return;
							// Arrows move the caret between lines; history takes over at the first or last line.
							const el = e.currentTarget;
							const before = input.slice(0, el.selectionStart);
							const after = input.slice(el.selectionEnd);
							if (e.key === "ArrowUp" ? before.includes("\n") : after.includes("\n")) return;
							const next = stepHistory(history.length, historyAt, e.key === "ArrowUp" ? -1 : 1);
							if (next === historyAt) return;
							e.preventDefault();
							if (historyAt === null) unsent.current = input;
							setHistoryAt(next);
							const text = next === null ? unsent.current : history[next];
							setInput(text);
							requestAnimationFrame(() => el.setSelectionRange(text.length, text.length));
						}}
						placeholder="Ask about your mail…"
						aria-label="Ask the agent"
						id="pg-agent-input"
					/>
					{busy ? (
						<button type="button" className="pg-return" title="Stop" aria-label="Stop" onClick={() => stop()}><StopIcon size={14} weight="fill" /></button>
					) : (
						<button type="submit" className="pg-return" title="Send (↵)" aria-label="Send" disabled={!input.trim()}><ArrowElbowDownLeftIcon size={14} weight="bold" /></button>
					)}
				</form>
			</div>
		</>
	);
}

function ChatMessage({ message, onOpenDraft }: { message: UIMessage; onOpenDraft: (mailboxId: string, draftId: string) => void }) {
	if (message.role === "user") {
		const text = message.parts.map((p) => (p.type === "text" ? p.text : "")).join("");
		return <div className="pg-agent-q" role="article" aria-label="You">{text}</div>;
	}
	const calls: ToolCall[] = [];
	const out: React.ReactNode[] = [];
	message.parts.forEach((part, i) => {
		const name = toolName(part);
		if (name) {
			out.push(
				<div key={i} className="pg-agent-tool" data-running={!toolDone(part) || undefined}>
					<span className="pg-tri">▸</span>
					<span className="pg-flex pg-ellipsis">{toolSummary(part)}</span>
					<span>{toolCount(part)}</span>
				</div>,
			);
			calls.push({ name, input: (part as { input?: ToolCall["input"] }).input, output: toolOutput(part) });
			return;
		}
		if (part.type === "text" && part.text.trim()) {
			out.push(
				<div key={i} className="pg-agent-a">
					<span className="pg-bot is-small"><AgentIcon size={14} weight="fill" /></span>
					<div className="pg-answer">
						<AgentMarkdown text={part.text} />
					</div>
				</div>,
			);
		}
	});
	const drafts = openableDrafts(calls);
	if (drafts.length) {
		out.push(
			<div key="actions" className="pg-agent-actions" style={{ paddingLeft: 28 }}>
				{drafts.map((d) => (
					<button key={d.draftId} type="button" className="pg-btn" onClick={() => onOpenDraft(d.mailboxId, d.draftId)}>Open draft</button>
				))}
			</div>,
		);
	}
	if (!out.length) return null;
	return <div className="pg-agent-turn" role="article" aria-label="Agent">{out}</div>;
}

/** Messages you sent, oldest first, without repeats in a row or auto-triggered entries. */
export function sentHistory(messages: UIMessage[]): string[] {
	const out: string[] = [];
	for (const m of messages) {
		if (m.role !== "user") continue;
		const text = m.parts.map((p) => (p.type === "text" ? p.text : "")).join("").trim();
		if (!text || text.startsWith("[Auto-triggered]") || out[out.length - 1] === text) continue;
		out.push(text);
	}
	return out;
}

/** Next history position: null is the line you were typing; Up from there goes to the newest entry. */
export function stepHistory(length: number, at: number | null, delta: -1 | 1): number | null {
	if (delta < 0) return at === null ? length - 1 : Math.max(0, at - 1);
	if (at === null) return null;
	return at + 1 >= length ? null : at + 1;
}

export function AgentRail({ onOpen, busy, inert }: { onOpen: () => void; busy: boolean; inert?: boolean }) {
	const { tip } = useShortcuts();
	return (
		<button type="button" className="pg-agentrail" inert={inert} onClick={onOpen} title={tip("agent", "Open agent chat")} aria-label="Open agent chat">
			<span className="pg-rail-head">
				<CaretDoubleLeftIcon size={10} weight="bold" />
				<AgentIcon size={14} weight="fill" color="var(--pg-green)" />
			</span>
			<span className="pg-vert">
				<span className="pg-vert-label">PLURAMAIL AGENT</span>
				{busy && <span className="pg-dot pg-round" title="Agent working" />}
			</span>
			<span style={{ flex: 1 }} />
			<Keys id="agent" />
		</button>
	);
}

// ── Draft reply ─────────────────────────────────────────────────

export interface DraftJob {
	id: number;
	mailboxId: string;
	prompt: string;
	/** Sends so far, counting this one. */
	tries: number;
}

interface RunnerProps {
	job: DraftJob;
	/** The agent began answering: the request reached it. */
	onStarted: () => void;
	onDone: (r: DraftResult) => void;
	onError: (message: string) => void;
}

/**
 * Sends one message to the mailbox's agent and waits for its draft_reply or
 * draft_email result. Mount while a job runs; it renders nothing. The chat
 * hook suspends while it loads history, so it has its own boundary: the
 * composer's "Drafting…" doesn't wait on it.
 */
export function AgentDraftRunner(props: RunnerProps) {
	const { hooks, error } = useAgentHooks();
	useEffect(() => {
		if (error) props.onError(error);
	}, [error]); // eslint-disable-line react-hooks/exhaustive-deps
	if (!hooks) return null;
	return (
		<Suspense fallback={null}>
			<Runner hooks={hooks} {...props} />
		</Suspense>
	);
}

function Runner({ hooks, job, onStarted, onDone, onError }: RunnerProps & { hooks: Hooks }) {
	const agent = hooks.useAgent({ agent: "EmailAgent", name: job.mailboxId });
	const { messages, sendMessage, status } = hooks.useAgentChat({ agent });
	const sent = useRef(false);
	const settled = useRef(false);
	const started = useRef(false);
	const reported = useRef(false);
	// The request waits for the connection: a send before it opens can be lost (#60).
	const [open, setOpen] = useState(() => canSend(agent.readyState));

	useEffect(() => {
		if (open) return;
		const onOpen = () => setOpen(true);
		agent.addEventListener("open", onOpen);
		if (canSend(agent.readyState)) setOpen(true);
		return () => agent.removeEventListener("open", onOpen);
	}, [agent, open]);

	useEffect(() => {
		if (sent.current || !open) return;
		sent.current = true;
		sendMessage({ text: job.prompt });
	}, [open, sendMessage, job.prompt]);

	useEffect(() => {
		if (settled.current) return;
		if (status === "streaming" || status === "submitted") started.current = true;
		const at = messages.map((m) => m.role === "user" && m.parts.some((p) => p.type === "text" && p.text === job.prompt)).lastIndexOf(true);
		if (!reported.current && (status === "streaming" || (at >= 0 && messages.slice(at + 1).some((m) => m.role === "assistant")))) {
			reported.current = true;
			onStarted();
		}
		if (at < 0) return;
		for (const m of messages.slice(at + 1)) {
			for (const part of m.parts) {
				const name = toolName(part);
				if ((name === "draft_reply" || name === "draft_email") && toolDone(part)) {
					const out = toolOutput(part) as { error?: string; draftId?: string; draft?: { body?: string } } | undefined;
					settled.current = true;
					if (!out || out.error) onError(out?.error ?? "The agent could not draft this.");
					else onDone({ text: out.draft?.body, draftId: out.draftId });
					return;
				}
			}
		}
		if (started.current && status === "ready") {
			settled.current = true;
			const reply = messages.slice(at + 1).flatMap((m) => m.parts).map((p) => (p.type === "text" ? p.text : "")).join("").trim();
			onError(reply ? `No draft: ${reply.length > 140 ? `${reply.slice(0, 140)}…` : reply}` : "The agent did not return a draft.");
		} else if (status === "error") {
			settled.current = true;
			onError("The agent ran into an error.");
		}
	}, [messages, status]); // eslint-disable-line react-hooks/exhaustive-deps

	return null;
}

/**
 * "Draft reply" for any composer: returns the request function and the
 * runner element to render while a request is out.
 */
export function useDraftWithAgent() {
	const demo = useDemo();
	const queryClient = useQueryClient();
	const [job, setJob] = useState<DraftJob | null>(null);
	const waiter = useRef<{ resolve: (r: DraftResult) => void; reject: (e: Error) => void } | null>(null);
	// The job whose agent began answering.
	const startedJob = useRef<number | null>(null);

	const finish = (fn: (w: NonNullable<typeof waiter.current>) => void) => {
		const w = waiter.current;
		waiter.current = null;
		setJob(null);
		if (w) fn(w);
		queryClient.invalidateQueries({ queryKey: ["mail"] });
	};

	// Nothing started a few seconds after the send: send once more on a fresh connection, then give up with an error.
	useEffect(() => {
		if (!job) return;
		const t = setTimeout(() => {
			const step = draftStartStep({ started: startedJob.current === job.id, elapsed: DRAFT_START_MS, tries: job.tries });
			if (step === "retry") setJob({ ...job, id: Date.now(), tries: job.tries + 1 });
			else if (step === "fail") finish((w) => w.reject(new Error("The agent didn't start. Try again.")));
		}, DRAFT_START_MS);
		return () => clearTimeout(t);
	}, [job]); // eslint-disable-line react-hooks/exhaustive-deps

	const draftWithAgent = (state: ComposeState): Promise<DraftResult> => {
		if (demo) return Promise.reject(new Error(DEMO_AGENT_NOTICE));
		// The writer's own words, not the quote under a reopened reply draft.
		const notes = ownText(state.html);
		const to = state.to[0]?.addr;
		let mailboxId = state.from;
		let prompt: string;
		if ((state.mode === "reply" || state.mode === "reply-all") && state.originalId) {
			mailboxId = state.originalMailbox ?? state.from;
			prompt = `Draft a reply to email ${state.originalId} with draft_reply. Read the thread first.${to ? ` Address it to ${to}.` : ""}${notes ? ` Use these notes from me: ${notes}` : ""}`;
		} else {
			if (!to) return Promise.reject(new Error("Add a recipient first, then ask the agent."));
			prompt = `Draft a new email with draft_email to ${to}.${state.subject.trim() ? ` Subject: ${state.subject.trim()}.` : ""}${state.mode === "forward" && state.originalId ? ` It forwards email ${state.originalId}; write a short note to go with it.` : ""}${notes ? ` Use these notes from me: ${notes}` : ""}`;
		}
		if (waiter.current) return Promise.reject(new Error("The agent is already drafting."));
		return new Promise<DraftResult>((resolve, reject) => {
			const timer = setTimeout(() => {
				waiter.current = null;
				setJob(null);
				reject(new Error("The agent took too long. Try again."));
			}, 120_000);
			waiter.current = {
				resolve: (r) => {
					clearTimeout(timer);
					resolve(r);
				},
				reject: (e) => {
					clearTimeout(timer);
					reject(e);
				},
			};
			setJob({ id: Date.now(), mailboxId, prompt, tries: 1 });
		});
	};

	const runner = job ? (
		<AgentDraftRunner
			key={job.id}
			job={job}
			onStarted={() => {
				startedJob.current = job.id;
			}}
			onDone={(r) => finish((w) => w.resolve(r))}
			onError={(m) => finish((w) => w.reject(new Error(m)))}
		/>
	) : null;

	return { draftWithAgent, runner };
}
