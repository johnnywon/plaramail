// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import {
	ArrowBendDoubleUpLeftIcon, ArrowBendUpLeftIcon, ArrowBendUpRightIcon, ArrowSquareOutIcon, ArrowsInSimpleIcon, ArrowsOutSimpleIcon, ArrowUpIcon,
	CalendarBlankIcon, CaretDownIcon, CaretUpIcon, CheckIcon, ClockIcon, DotsThreeIcon, FileIcon, FloppyDiskIcon, ImageIcon, MinusIcon, PaperclipIcon,
	PaperPlaneRightIcon, PencilSimpleLineIcon, SignatureIcon, StopIcon, TextAaIcon, TrashIcon, WarningIcon, XIcon,
} from "@phosphor-icons/react";
import { AgentDraftIcon, type AgentAnim, AgentIcon } from "./AgentIcon";
import type { Editor as TipTap } from "@tiptap/react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import DOMPurify from "dompurify";
import { useEffect, useId, useRef, useState } from "react";
import EmailIframe from "~/components/EmailIframe";
import { htmlToPlainText } from "~/lib/utils";
import { DRAFT_ORIGIN_LABELS, REDRAFT_INSTRUCTION_MAX } from "shared/draft-notes";
import { MESSAGE_BYTES_MAX, messageBytes } from "shared/message-size";
import { prettyName } from "shared/models";
import api from "~/services/api";
import { type DraftWithAgent, useDraftWithAgent } from "./Agent";
import { type AgentDraft, bodyOnSend, draftKind, STARTS, takeDraft, type Tone, TONES } from "./agent-draft";
import { ownText, skipSave } from "./draft-start";
import {
	type AddressInfo, type ComposeFile, type ComposeMode, type ComposeState, composeSizeError, emptyCompose, sentText, isValidAddress, parseRecipient, readFiles, type Recipient, takeHandoff,
	textToParagraphs, useAddressInfo, useMailSender, usesSignature,
} from "./compose";
import { Editor, FormatBar, FormatCard } from "./Editor";
import { AddressText, buildIdentities, type Identities, Swatch } from "./identity";
import { formatSize, sendTimeLabel } from "./model";
import { scheduleSlots } from "./schedule-slots";
import { usePrefs, useResolvedTheme } from "./prefs";
import { useShortcuts } from "./shortcuts";
import { TooltipLayer } from "./Tooltip";

type Sender = ReturnType<typeof useMailSender>;

/** The quoted original at the end of a saved reply body. */
const QUOTE_AT_END = /(\s*<br\s*\/?>\s*)?<blockquote[\s\S]*<\/blockquote>\s*$/i;
type ReplyMode = Exclude<ComposeMode, "new">;

export interface ComposerProps {
	initial: ComposeState;
	/**
	 * floating: the window over the app, docked bottom right. inline: a reply at
	 * the foot of the open conversation. standalone: the whole popped-out window.
	 */
	variant: "floating" | "inline" | "standalone";
	/** Floating only: open maximised. */
	maximised?: boolean;
	addresses: string[];
	identities: Identities;
	info: ReadonlyMap<string, AddressInfo>;
	sender: Sender;
	/** Replies leave from the address the mail reached. */
	lockFrom?: boolean;
	onClosed: (message: string | null) => void;
	onPopOut: (state: ComposeState) => void;
	/** Inline replies switch between reply, reply all and forward. */
	onMode?: (mode: ReplyMode, state: ComposeState) => void;
	draftWithAgent: DraftWithAgent;
	/** Stops waiting for the agent's draft. */
	stopAgent?: () => void;
	/** Opens the signature settings; absent where there are none to open. */
	onEditSignatures?: () => void;
}

/** Recipient chips: Enter, Tab, comma or space adds; Backspace removes; invalid addresses get an amber outline. */
export function RecipientField({ label, list, onChange, inputRef, autoFocus, extra }: {
	label: string;
	list: Recipient[];
	onChange: (list: Recipient[]) => void;
	inputRef?: React.Ref<HTMLInputElement>;
	autoFocus?: boolean;
	extra?: React.ReactNode;
}) {
	const [text, setText] = useState("");
	const local = useRef<HTMLInputElement>(null);
	const add = (raw: string) => {
		const r = parseRecipient(raw);
		setText("");
		if (!r || list.some((x) => x.addr.toLowerCase() === r.addr.toLowerCase())) return;
		onChange([...list, r]);
	};
	// Suggestions from people you wrote to and who wrote to you (WON-216), a moment after typing stops.
	const [query, setQuery] = useState("");
	const [focused, setFocused] = useState(false);
	const [at, setAt] = useState(0);
	useEffect(() => {
		const t = setTimeout(() => setQuery(text.trim()), 120);
		return () => clearTimeout(t);
	}, [text]);
	const found = useQuery({
		queryKey: ["contacts", query],
		queryFn: ({ signal }) => api.contacts(query, { signal }),
		enabled: /[\p{L}\p{N}]/u.test(query),
		staleTime: 60_000,
	});
	const taken = new Set(list.map((r) => r.addr.toLowerCase()));
	const options = text.trim() && query === text.trim() ? (found.data?.contacts ?? []).filter((c) => !taken.has(c.value)) : [];
	const shown = focused && options.length > 0;
	const listId = useId();
	const pick = (c: { value: string; name?: string }) => {
		setText("");
		setAt(0);
		onChange([...list, { addr: c.value, name: c.name }]);
	};
	return (
		<div className="pg-cw-row is-wrap">
			<span className="pg-field-label">{label}</span>
			<div className="pg-chips" onClick={() => local.current?.focus()}>
				{list.map((r, i) => (
					<span key={`${r.addr}-${i}`} className="pg-chip" title={r.addr} data-invalid={!isValidAddress(r.addr) || undefined}>
						<span>{r.name || r.addr}</span>
						<button type="button" aria-label={`Remove ${r.addr}`} onMouseDown={(e) => { e.preventDefault(); onChange(list.filter((_, j) => j !== i)); }}>
							<XIcon size={10} />
						</button>
					</span>
				))}
				<input
					ref={(el) => {
						local.current = el;
						if (typeof inputRef === "function") inputRef(el);
						else if (inputRef) (inputRef as React.MutableRefObject<HTMLInputElement | null>).current = el;
					}}
					value={text}
					autoFocus={autoFocus}
					aria-label={label}
					role="combobox"
					aria-expanded={shown}
					aria-controls={listId}
					aria-autocomplete="list"
					aria-activedescendant={shown && options[at] ? `${listId}-${at}` : undefined}
					spellCheck={false}
					autoComplete="off"
					onChange={(e) => { setText(e.target.value); setAt(0); }}
					onFocus={() => setFocused(true)}
					onBlur={() => { setFocused(false); if (text.includes("@")) add(text); }}
					onPaste={(e) => {
						const pasted = e.clipboardData.getData("text");
						if (/[,;\s]/.test(pasted.trim())) {
							e.preventDefault();
							const parts = pasted.split(/[,;\s]+/).map(parseRecipient).filter((r): r is Recipient => !!r);
							onChange([...list, ...parts.filter((p) => !list.some((x) => x.addr === p.addr))]);
						}
					}}
					onKeyDown={(e) => {
						if (shown && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
							e.preventDefault();
							setAt((i) => (i + (e.key === "ArrowDown" ? 1 : options.length - 1)) % options.length);
						} else if (shown && (e.key === "Enter" || e.key === "Tab") && options[at]) {
							e.preventDefault();
							pick(options[at]);
						} else if (shown && e.key === "Escape") {
							e.preventDefault();
							e.stopPropagation();
							setText("");
						} else if ((e.key === "Enter" || e.key === "Tab") && text.trim()) {
							e.preventDefault();
							add(text);
						} else if ((e.key === "," || e.key === ";" || e.key === " ") && text.includes("@")) {
							e.preventDefault();
							add(text);
						} else if (e.key === "Backspace" && !text && list.length) {
							onChange(list.slice(0, -1));
						}
					}}
				/>
			</div>
			{shown && (
				<div className="pg-popover pg-contacts" id={listId} role="listbox" aria-label={`Suggestions for ${label}`} onMouseDown={(e) => e.preventDefault()}>
					{options.map((c, i) => (
						<button key={c.value} id={`${listId}-${i}`} type="button" role="option" aria-selected={i === at} className="pg-menu-item" data-active={i === at} onMouseEnter={() => setAt(i)} onClick={() => pick(c)}>
							{c.name && <span className="pg-contact-name pg-ellipsis">{c.name}</span>}
							<span className="pg-contact-addr pg-ellipsis">{c.value}</span>
						</button>
					))}
				</div>
			)}
			{extra}
		</div>
	);
}

const pad = (n: number) => String(n).padStart(2, "0");
const isoDay = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

const MODES = [
	{ mode: "reply", label: "Reply", Icon: ArrowBendUpLeftIcon },
	{ mode: "reply-all", label: "Reply all", Icon: ArrowBendDoubleUpLeftIcon },
	{ mode: "forward", label: "Forward", Icon: ArrowBendUpRightIcon },
] as const;

/** The original message under a reply or forward, rendered as HTML in the mail sandbox. */
function QuotePreview({ head, body }: { head: string; body: string }) {
	const [open, setOpen] = useState(false);
	const [clipped, setClipped] = useState(false);
	const frameRef = useRef<HTMLDivElement>(null);
	// Offer "Show the whole message" only when the quote is taller than its box.
	useEffect(() => {
		const iframe = frameRef.current?.querySelector("iframe");
		if (!iframe) return;
		const check = () => setClipped(iframe.getBoundingClientRect().height > 182);
		check();
		const ro = new ResizeObserver(check);
		ro.observe(iframe);
		return () => ro.disconnect();
	}, [body]);
	return (
		<div className="pg-quote" data-open={open || undefined}>
			<div className="pg-quote-head">{head}</div>
			<div className="pg-quote-frame" ref={frameRef}>
				<EmailIframe autoSize body={body} remoteImages={false} padding={12} />
			</div>
			{clipped && (
				<button type="button" className="pg-quote-toggle" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
					{open ? "Show less" : "Show the whole message"}
				</button>
			)}
		</div>
	);
}

/** Phones get the dock and the cards; wider screens keep the foot and the format bar. */
const PHONE = "(max-width: 600px)";

function usePhone(): boolean {
	const [phone, setPhone] = useState(() => typeof window !== "undefined" && window.matchMedia(PHONE).matches);
	useEffect(() => {
		const m = window.matchMedia(PHONE);
		const on = () => setPhone(m.matches);
		m.addEventListener("change", on);
		on();
		return () => m.removeEventListener("change", on);
	}, []);
	return phone;
}

/**
 * Keep the full-screen composer inside the visual viewport, so the dock rides
 * the keyboard. iOS draws the keyboard over the page and scrolls it; Chrome on
 * Android resizes the page (interactive-widget in root.tsx). data-kb is set
 * while the keyboard covers the page, which drops the home-area inset.
 */
function useKeyboardDock(ref: React.RefObject<HTMLDivElement | null>, on: boolean) {
	useEffect(() => {
		const el = ref.current;
		const vv = window.visualViewport;
		if (!on || !el || !vv) return;
		const update = () => {
			el.style.setProperty("--pg-vv-top", `${Math.round(vv.offsetTop)}px`);
			el.style.setProperty("--pg-vv-h", `${Math.round(vv.height)}px`);
			el.toggleAttribute("data-kb", window.innerHeight - vv.height - vv.offsetTop > 80);
		};
		update();
		vv.addEventListener("resize", update);
		vv.addEventListener("scroll", update);
		return () => {
			vv.removeEventListener("resize", update);
			vv.removeEventListener("scroll", update);
			el.style.removeProperty("--pg-vv-top");
			el.style.removeProperty("--pg-vv-h");
			el.removeAttribute("data-kb");
		};
	}, [ref, on]);
}

type Card = "format" | "attach" | "agent" | "later";

/** Send later's quick times on the phone's day picker. */
const LATER_TIMES = [["7:00", "07:00"], ["8:00", "08:00"], ["9:00", "09:00"], ["12:00", "12:00"], ["13:00", "13:00"], ["17:00", "17:00"]] as const;
const shortWhen = (d: Date) => `${d.toLocaleDateString("en-US", { weekday: "short" })} ${d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}`;
const zoneName = () => new Intl.DateTimeFormat("en-US", { timeZoneName: "short" }).formatToParts(new Date()).find((p) => p.type === "timeZoneName")?.value ?? "";
const isImage = (f: ComposeFile) => f.type.startsWith("image/");

/**
 * The agent key: the agent draft icon alone, the one green control in the
 * foot. Rest: a green tint and ring. Open (its card showing): solid green.
 * Busy: Stop. Ported from Plara Design's AgentKey (.pl-agent-btn).
 */
function AgentKey({ open, busy, label, onPress }: { open: boolean; busy: boolean; label: string; onPress: () => void }) {
	return (
		<button
			type="button"
			className="pg-agent-key"
			aria-label={busy ? "Stop the agent" : label}
			title={busy ? "Stop the agent" : label}
			aria-pressed={busy ? undefined : open}
			data-busy={busy || undefined}
			onPointerDown={(e) => e.preventDefault()}
			onMouseDown={(e) => e.preventDefault()}
			onClick={onPress}
		>
			{busy ? <StopIcon size={14} weight="fill" /> : <AgentDraftIcon size={16} className="pg-agent-icon" />}
		</button>
	);
}

/** One composer for new mail, replies and forwards, wherever it appears. */
export function Composer(props: ComposerProps) {
	const { tip } = useShortcuts();
	const { identities, info, sender, variant } = props;
	const phone = usePhone();
	const [state, setState] = useState<ComposeState>(props.initial);
	const [mode, setMode] = useState<"normal" | "min" | "max">(props.maximised ? "max" : "normal");
	const [fromOpen, setFromOpen] = useState(false);
	const [schedOpen, setSchedOpen] = useState(false);
	const [moreOpen, setMoreOpen] = useState(false);
	const [custom, setCustom] = useState(false);
	const [customDate, setCustomDate] = useState(() => isoDay(new Date(Date.now() + 864e5)));
	const [customTime, setCustomTime] = useState("09:00");
	const [warn, setWarn] = useState<"norecip" | "nosubj" | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [saved, setSaved] = useState(false);
	const [busy, setBusy] = useState(false);
	// A redraft of the whole saved draft (the notes row) holds the body read-only.
	const [agentBusy, setAgentBusy] = useState(false);
	const [instruction, setInstruction] = useState("");
	// One card over the dock at a time: Format, Photos and files, the agent, Send later.
	const [card, setCard] = useState<Card | null>(null);
	const [attachTab, setAttachTab] = useState<"photos" | "files">("files");
	// The agent's draft, in its own card until the writer uses or drops it (agent-draft.ts).
	const [agentDraft, setAgentDraftState] = useState<AgentDraft | null>(() =>
		props.initial.askAgent ? { status: "writing", kind: "write", html: "", request: "", job: 1 } : null,
	);
	const draftRef = useRef(agentDraft);
	const job = useRef(agentDraft ? 1 : 0);
	const [thinking, setThinking] = useState(false);
	const [request, setRequest] = useState("");
	const [tone, setTone] = useState<Tone | undefined>(undefined);
	// Send later on the phone: the chosen time, which Send then reads.
	const [later, setLater] = useState<Date | null>(null);
	const [picking, setPicking] = useState(false);
	const queryClient = useQueryClient();
	const [editor, setEditor] = useState<TipTap | null>(null);
	const rootRef = useRef<HTMLDivElement>(null);
	const cardRef = useRef<HTMLDivElement>(null);
	const toRef = useRef<HTMLInputElement>(null);
	const fileRef = useRef<HTMLInputElement>(null);
	const photoRef = useRef<HTMLInputElement>(null);
	const saving = useRef<Promise<void>>(Promise.resolve());
	const stateRef = useRef(state);
	stateRef.current = state;
	const dirty = useRef(false);
	const done = useRef(false);
	// A redraft replaces the draft; a save with the old id meanwhile would leave a stray copy.
	const redrafting = useRef(false);
	const asked = useRef(false);
	// Opened only for the agent to draft: an empty body is not a draft to save.
	const openedToDraft = useRef(!!props.initial.askAgent);
	const inline = variant === "inline";
	const reply = state.mode !== "new";
	const docked = phone && mode !== "min";
	useKeyboardDock(rootRef, docked);

	const setAgentDraft = (d: AgentDraft | null) => {
		draftRef.current = d;
		setAgentDraftState(d);
	};

	const patch = (p: Partial<ComposeState>, quiet = false) => {
		setState((s) => ({ ...s, ...p }));
		setWarn(null);
		setError(null);
		if (!quiet) {
			dirty.current = true;
			setSaved(false);
		}
	};

	// Picked, pasted and dropped files all come in here. Files that would take the message over 5 MiB stay out (WON-215).
	const addFiles = async (list: FileList | File[]) => {
		if (!list.length) return;
		const added = await readFiles(list);
		const s = stateRef.current;
		const tooLarge = composeSizeError([...s.files, ...added], `${s.html}${s.quoteHtml ?? ""}`);
		if (tooLarge) {
			setError(tooLarge);
			return;
		}
		patch({ files: [...s.files, ...added] });
	};
	const [dropping, setDropping] = useState(false);
	const hasFiles = (e: React.DragEvent) => Array.from(e.dataTransfer.types).includes("Files");

	// A reply opened for the agent has its recipients filled in, but isn't a draft until its body has text.
	const hasContent = (s: ComposeState) => !skipSave(openedToDraft.current, s.html) && !!(s.to.length || s.cc.length || s.bcc.length || s.html.replace(/<[^>]+>/g, "").trim() || (s.mode === "new" && s.subject.trim()));

	const saveNow = () => {
		saving.current = saving.current.then(async () => {
			const s = stateRef.current;
			if (!hasContent(s) || done.current || redrafting.current) return;
			dirty.current = false;
			const id = await sender.save(s);
			if (id) setState((cur) => ({ ...cur, draftId: id }));
			stateRef.current = { ...stateRef.current, draftId: id || stateRef.current.draftId };
			setSaved(true);
		}).catch(() => setSaved(false));
		return saving.current;
	};

	// Autosave a moment after typing stops.
	useEffect(() => {
		if (!dirty.current) return;
		const t = setTimeout(saveNow, 1500);
		return () => clearTimeout(t);
	}, [state]); // eslint-disable-line react-hooks/exhaustive-deps

	// An inline reply scrolls into view; a forward starts in To, everything else in the body.
	useEffect(() => {
		if (inline && !phone) rootRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
		if (!state.to.length || state.mode === "forward") toRef.current?.focus();
	}, []); // eslint-disable-line react-hooks/exhaustive-deps

	useEffect(() => {
		if (variant === "standalone") document.title = state.subject.trim() || "New message";
	}, [variant, state.subject]);

	// The body scrolls clear of the open card.
	useEffect(() => {
		const el = cardRef.current;
		const root = rootRef.current;
		if (!el || !root) {
			root?.style.removeProperty("--pg-card-h");
			return;
		}
		const ro = new ResizeObserver(() => root.style.setProperty("--pg-card-h", `${Math.ceil(el.getBoundingClientRect().height) + 8}px`));
		ro.observe(el);
		return () => ro.disconnect();
	}, [card, phone]);

	// The agent reads for a moment (agent-think), then writes (agent-write) until the draft lands.
	const writing = agentDraft?.status === "writing";
	useEffect(() => {
		if (!writing) return;
		setThinking(true);
		const t = setTimeout(() => setThinking(false), 900);
		return () => clearTimeout(t);
	}, [writing, agentDraft?.job]);

	const finish = (message: string | null) => {
		done.current = true;
		props.onClosed(message);
	};

	// ── The agent's draft ────────────────────────────────────────────

	/** Delete the server draft the agent saved for a card the writer dropped. */
	const dropSaved = (d: AgentDraft) => {
		if (d.draftId && d.draftId !== stateRef.current.draftId) sender.discard({ ...stateRef.current, draftId: d.draftId });
	};

	/** Stop the agent. The half-written draft goes; the request it already sent finishes on the server and its draft is deleted. */
	const stopAgent = () => {
		job.current++;
		props.stopAgent?.();
		setAgentDraft(null);
	};

	/** Drop the card: Stop while it writes, otherwise delete its saved draft. */
	const dropDraft = () => {
		const d = draftRef.current;
		if (!d) return;
		if (d.status === "writing") stopAgent();
		else {
			dropSaved(d);
			setAgentDraft(null);
		}
	};

	/**
	 * Use draft (or Replace with this): the text joins the message as the
	 * writer's own and the card goes. The agent's saved draft becomes this
	 * composer's draft, so its notes and Redraft come along; the composer's
	 * own saved copy gives way to it.
	 */
	const takeAgentDraft = (d: AgentDraft): ComposeState => {
		const s = stateRef.current;
		const html = takeDraft(s.html, d);
		const next: ComposeState = { ...s, html, ...(d.draftId ? { draftId: d.draftId, notes: d.notes ?? { origin: "chat", agent: null, instructions: [] } } : {}) };
		if (d.draftId && s.draftId && s.draftId !== d.draftId) {
			const own = { ...s };
			saving.current = saving.current.then(() => sender.discard(own)).catch(() => {});
		}
		stateRef.current = next;
		setState(next);
		dirty.current = true;
		setSaved(false);
		setAgentDraft(null);
		return next;
	};

	/** Before Send or Send later: a finished draft goes with the message; one being written, a rewrite or an empty one is dropped. */
	const settleAgent = () => {
		const d = draftRef.current;
		if (!d) return;
		if (bodyOnSend(stateRef.current.html, d).used) takeAgentDraft(d);
		else dropDraft();
	};

	/** `opening`: the ask the reply bar's Draft reply makes on open, which starts out writing. */
	const askAgent = async (opening = false, wanted = request) => {
		if (draftRef.current?.status === "writing" && !opening) return;
		const s = stateRef.current;
		const kind = draftKind(s.html);
		const prev = draftRef.current;
		if (prev && prev.status === "done") dropSaved(prev);
		const id = opening ? job.current : ++job.current;
		setAgentDraft({ status: "writing", kind, html: "", request: wanted.trim(), tone, job: id });
		setCard(null);
		setError(null);
		try {
			const r = await props.draftWithAgent(s, { request: wanted, tone, kind });
			if (job.current !== id) return;
			const html = r.text ? textToParagraphs(r.text) : r.html ?? "";
			if (!ownText(html)) throw new Error("The agent did not return a draft.");
			// The saved draft's notes name the model that wrote it (WON-594).
			const saved = r.draftId ? await api.getEmail(s.from, r.draftId).catch(() => null) : null;
			if (job.current !== id) {
				if (r.draftId) sender.discard({ ...stateRef.current, draftId: r.draftId });
				return;
			}
			setAgentDraft({ status: "done", kind, html, request: wanted.trim(), tone, job: id, draftId: r.draftId, notes: saved?.draft_notes });
			setRequest("");
		} catch (e) {
			if (job.current !== id) return;
			setAgentDraft(null);
			setError((e as Error).message);
		}
	};

	/** Redraft the card: the agent revises its saved draft, which gets a new id. The writer's text is not touched. */
	const redraftCard = async (text: string) => {
		const d = draftRef.current;
		const wanted = text.trim();
		if (!d || d.status !== "done" || !d.draftId || !wanted) return;
		const id = ++job.current;
		setAgentDraft({ ...d, status: "writing", request: wanted, job: id });
		setCard(null);
		setError(null);
		try {
			const r = await api.redraft(stateRef.current.from, d.draftId, wanted);
			if (job.current !== id) {
				sender.discard({ ...stateRef.current, draftId: r.draft.id });
				return;
			}
			setAgentDraft({ ...d, status: "done", html: r.draft.body.replace(QUOTE_AT_END, ""), draftId: r.draft.id, notes: r.notes, request: wanted, job: id });
			setRequest("");
			for (const queryKey of [["mail"], ["mail-facets"], ["emails", stateRef.current.from]]) queryClient.invalidateQueries({ queryKey });
		} catch (e) {
			if (job.current !== id) return;
			setAgentDraft(d);
			setError((e as Error).message || "Could not redraft.");
		}
	};

	// ── Send ──────────────────────────────────────────────────────────

	const noRecipients = () => !state.to.length && !state.cc.length && !state.bcc.length;

	/** Check what Send would send, the agent's finished draft included, before anything changes. */
	const precheck = () => {
		const s = stateRef.current;
		sender.check({ ...s, html: bodyOnSend(s.html, draftRef.current).html });
	};

	// The mail view's sender holds the send for Undo (send-hold.ts) and says when it went; the pop-out window's sends now.
	const send = async (force = false) => {
		if (busy) return;
		if (noRecipients()) {
			setWarn("norecip");
			return;
		}
		if (!state.subject.trim() && !force) {
			setWarn("nosubj");
			return;
		}
		if (phone && later) return schedule(later);
		setBusy(true);
		try {
			precheck();
			settleAgent();
			await saving.current;
			done.current = true;
			const held = await sender.send(stateRef.current);
			props.onClosed(held ? null : sentText(stateRef.current));
		} catch (e) {
			done.current = false;
			setError((e as Error).message || "Could not send.");
		} finally {
			setBusy(false);
		}
	};

	const schedule = async (at: Date) => {
		if (busy) return;
		if (noRecipients()) {
			setWarn("norecip");
			setSchedOpen(false);
			return;
		}
		if (at.getTime() <= Date.now() + 60_000) {
			setError("Pick a time in the future.");
			return;
		}
		setBusy(true);
		try {
			precheck();
			settleAgent();
			await saving.current;
			done.current = true;
			await sender.schedule(stateRef.current, at);
			props.onClosed(`Scheduled for ${sendTimeLabel(at)}`);
		} catch (e) {
			done.current = false;
			setError((e as Error).message || "Could not schedule.");
		} finally {
			setBusy(false);
			setSchedOpen(false);
		}
	};

	const close = async () => {
		if (hasContent(stateRef.current) && (dirty.current || !stateRef.current.draftId)) await saveNow();
		await saving.current;
		finish(hasContent(stateRef.current) ? "Draft saved" : null);
	};

	const discard = async () => {
		done.current = true;
		const d = draftRef.current;
		if (d?.status === "writing") stopAgent();
		else if (d) dropSaved(d);
		await saving.current;
		await sender.discard(stateRef.current);
		finish("Draft discarded");
	};

	/**
	 * Save pending edits, then have the agent revise the saved draft. The draft gets a new id.
	 * The body is read-only and autosave waits until it returns; other field edits save after.
	 */
	const redraftWith = async (text: string) => {
		const wanted = text.trim();
		if (!wanted || agentBusy) return;
		setAgentBusy(true);
		setError(null);
		try {
			if (dirty.current) await saveNow();
			await saving.current;
			const s = stateRef.current;
			if (!s.draftId) return;
			redrafting.current = true;
			const r = await api.redraft(s.from, s.draftId, wanted);
			// A reply composer keeps its quote apart and adds it on save.
			const html = s.quoteHtml ? r.draft.body.replace(QUOTE_AT_END, "") : r.draft.body;
			const next = { ...stateRef.current, html, draftId: r.draft.id, notes: r.notes };
			stateRef.current = next;
			redrafting.current = false;
			setState(next);
			// Still dirty if To or Subject changed during the redraft: autosave picks those up under the new id.
			setSaved(!dirty.current);
			setInstruction("");
			for (const queryKey of [["mail"], ["mail-facets"], ["emails", s.from]]) queryClient.invalidateQueries({ queryKey });
		} catch (e) {
			setError((e as Error).message || "Could not redraft.");
			redrafting.current = false;
			// To or Subject edits made while it ran.
			if (dirty.current) saveNow();
		} finally {
			redrafting.current = false;
			setAgentBusy(false);
		}
	};

	// "Draft reply" on the collapsed reply bar asks as soon as the composer opens.
	useEffect(() => {
		if (!props.initial.askAgent || asked.current) return;
		asked.current = true;
		setState((s) => ({ ...s, askAgent: false }));
		askAgent(true);
	}, []); // eslint-disable-line react-hooks/exhaustive-deps

	const customAt = new Date(`${customDate}T${customTime}`);
	const customOk = !Number.isNaN(customAt.getTime()) && customAt.getTime() > Date.now() + 60_000;
	const fromInfo = info.get(state.from);
	const fromId = identities.of(state.from);
	const signed = usesSignature(state, info);
	const hasSignature = !!fromInfo?.signatureHtml;
	const replyMode = MODES.find((m) => m.mode === state.mode);
	const title = inline ? replyMode?.label ?? "Reply" : state.subject.trim() || "New message";
	const dataState = variant === "standalone" ? "window" : inline ? "inline" : mode;
	const lockFrom = !!props.lockFrom && reply;
	const toggleCard = (c: Card) => setCard((cur) => (cur === c ? null : c));
	const written = !!ownText(state.html);
	const agentLabel = reply ? "Draft a reply with the agent" : written ? "Rewrite with the agent" : "Write with the agent";
	const agentWorking = writing || agentBusy;
	const pressAgent = () => (writing ? stopAgent() : toggleCard("agent"));
	const signatureLabel = hasSignature ? (signed ? "Remove signature" : "Add signature") : "Set up a signature";
	const toggleSignature = () => (hasSignature ? patch({ signature: !signed }) : props.onEditSignatures?.());

	// ── Cards ─────────────────────────────────────────────────────────

	const agentCard = () => {
		const redo = agentDraft?.status === "done";
		const rewrite = !redo && written;
		const heading = redo ? "Redraft" : rewrite ? "Rewrite your text" : reply ? "Draft a reply" : "Write with the agent";
		const placeholder = redo ? "What should change?" : rewrite ? "How should it change?" : "Tell the agent what to write";
		const starts = redo ? STARTS.redraft : rewrite ? STARTS.rewrite : reply ? STARTS.reply : STARTS.new;
		const go = (text: string) => (redo ? redraftCard(text) : askAgent(false, text));
		return (
			<div className="pg-cw-card pg-ask" role="dialog" aria-label={heading} ref={cardRef}>
				<div className="pg-card-head is-agent">
					<AgentDraftIcon size={14} anim="agent-ready" />
					{heading}
					{reply && <span className="pg-card-meta">Reads this thread</span>}
				</div>
				<form className="pg-ask-in" onSubmit={(e) => { e.preventDefault(); if (redo ? request.trim() : true) go(request); }}>
					<input
						className="pg-card-input"
						value={request}
						maxLength={REDRAFT_INSTRUCTION_MAX}
						placeholder={placeholder}
						aria-label={placeholder}
						autoFocus={!phone}
						enterKeyHint="send"
						onChange={(e) => setRequest(e.target.value)}
					/>
					<button type="submit" className="pg-ask-go" aria-label={redo ? "Redraft" : rewrite ? "Rewrite" : "Draft"} title={redo ? "Redraft" : rewrite ? "Rewrite" : "Draft"} disabled={redo && !request.trim()}>
						<ArrowUpIcon size={16} weight="bold" />
					</button>
				</form>
				<div className="pg-starts">
					{starts.map((t) => <button key={t} type="button" onClick={() => go(t)}>{t}</button>)}
				</div>
				{!redo && (
					<div className="pg-card-row">
						<span className="pg-card-label">Tone</span>
						<span className="pg-well pg-tone" role="radiogroup" aria-label="Tone">
							{TONES.map(([id, label]) => (
								<button key={id} type="button" role="radio" className="pg-key" aria-checked={tone === id} onClick={() => setTone(tone === id ? undefined : id)}>{label}</button>
							))}
						</span>
					</div>
				)}
				<span className="pg-card-note">{rewrite ? "The agent rewrites your text as a draft. Yours stays until you choose." : "Nothing is sent. You review every draft."}</span>
			</div>
		);
	};

	const attachCard = () => {
		const photos = attachTab === "photos";
		const shown = state.files.map((f, i) => [f, i] as const).filter(([f]) => isImage(f) === photos);
		const bytes = messageBytes({ html: `${state.html}${state.quoteHtml ?? ""}`, text: htmlToPlainText(state.html), fileBytes: state.files.map((f) => f.size) });
		const over = bytes > MESSAGE_BYTES_MAX;
		return (
			<div className="pg-cw-card pg-attach-card" role="dialog" aria-label="Photos and files" ref={cardRef}>
				<div className="pg-well pg-attach-tabs" role="tablist" aria-label="Photos and files">
					<button type="button" role="tab" className="pg-key" aria-selected={photos} onClick={() => setAttachTab("photos")}><ImageIcon size={16} />Photos</button>
					<button type="button" role="tab" className="pg-key" aria-selected={!photos} onClick={() => setAttachTab("files")}><FileIcon size={16} />Files</button>
				</div>
				{shown.length > 0 && (
					<div className="pg-attach-list">
						{shown.map(([f, i]) => (
							<span key={`${f.name}-${i}`} className="pg-file">
								{photos ? <ImageIcon size={14} color="var(--pg-text-5)" /> : <FileIcon size={14} color="var(--pg-text-5)" />}
								<span className="pg-file-name">{f.name}</span>
								<span className="pg-file-size">{formatSize(f.size)}</span>
								<button type="button" aria-label={`Remove ${f.name}`} onClick={() => patch({ files: state.files.filter((_, j) => j !== i) })}><XIcon size={12} /></button>
							</span>
						))}
					</div>
				)}
				<button type="button" className="pg-btn pg-attach-pick" onClick={() => (photos ? photoRef : fileRef).current?.click()}>
					{photos ? <ImageIcon size={16} /> : <PaperclipIcon size={16} />}{photos ? "Choose photos" : "Choose files"}
				</button>
				<div className="pg-meter-row">
					<span className="pg-meter" data-over={over || undefined} role="meter" aria-label="Message size" aria-valuemin={0} aria-valuemax={MESSAGE_BYTES_MAX} aria-valuenow={Math.min(bytes, MESSAGE_BYTES_MAX)}>
						<i style={{ width: `${Math.min(100, (bytes / MESSAGE_BYTES_MAX) * 100)}%` }} />
					</span>
					<span className="pg-card-meta">{formatSize(bytes)} of 5 MB</span>
				</div>
			</div>
		);
	};

	const laterCard = () => {
		const slots = scheduleSlots();
		const who = state.to[0] ? state.to[0].name?.split(" ")[0] || state.to[0].addr : null;
		const today = new Date();
		const days = Array.from({ length: 7 }, (_, i) => new Date(today.getFullYear(), today.getMonth(), today.getDate() + i));
		const pickDay = later ? isoDay(later) : customDate;
		const pickTime = later ? `${pad(later.getHours())}:${pad(later.getMinutes())}` : customTime;
		const fromSlot = !!later && slots.some(([, at]) => at.getTime() === later.getTime());
		const pick = (day: string, time: string) => {
			setCustomDate(day);
			setCustomTime(time);
			const at = new Date(`${day}T${time}`);
			setLater(!Number.isNaN(at.getTime()) && at.getTime() > Date.now() + 60_000 ? at : null);
		};
		return (
			<div className="pg-cw-card pg-later" role="dialog" aria-label="Send later" ref={cardRef}>
				<div className="pg-card-head"><ClockIcon size={16} color="var(--pg-mail)" />Send later<span className="pg-card-meta">Your time · {zoneName()}</span></div>
				<div className="pg-well pg-slots" role="radiogroup" aria-label="When">
					{slots.map(([label, at]) => {
						const on = !!later && later.getTime() === at.getTime();
						return (
							<button key={label} type="button" role="radio" className="pg-slot" aria-checked={on} onClick={() => { setPicking(false); setLater(on ? null : at); }}>
								<b>{label}</b>
								<time>{shortWhen(at)}</time>
							</button>
						);
					})}
				</div>
				<button type="button" className="pg-pickrow" aria-expanded={picking} aria-checked={!!later && !fromSlot} role="switch" onClick={() => { const open = !picking; setPicking(open); if (open && !later) pick(customDate, customTime); }}>
					<CalendarBlankIcon size={20} />
					<span className="pg-flex">Pick a day and time</span>
					{later && !fromSlot && <time>{shortWhen(later)}</time>}
					<CaretUpIcon size={14} className="pg-pick-caret" />
				</button>
				{picking && (
					<>
						<div className="pg-days" role="radiogroup" aria-label="Day">
							{days.map((d) => (
								<button key={isoDay(d)} type="button" role="radio" aria-checked={pickDay === isoDay(d)} onClick={() => pick(isoDay(d), pickTime)}>
									<small>{d.toLocaleDateString("en-US", { weekday: "short" })}</small>{d.getDate()}
								</button>
							))}
						</div>
						<span className="pg-well pg-later-times" role="radiogroup" aria-label="Time">
							{LATER_TIMES.map(([label, v]) => (
								<button key={v} type="button" role="radio" className="pg-key" aria-checked={pickTime === v} disabled={new Date(`${pickDay}T${v}`).getTime() <= Date.now() + 60_000} onClick={() => pick(pickDay, v)}>{label}</button>
							))}
						</span>
						<div className="pg-later-other">
							<input type="date" aria-label="Date" value={pickDay} min={isoDay(today)} onChange={(e) => pick(e.target.value, pickTime)} />
							<input type="time" aria-label="Time" value={pickTime} onChange={(e) => pick(pickDay, e.target.value)} />
						</div>
					</>
				)}
				<span className="pg-card-note">{later ? `${who ? `${who} gets it` : "It sends"} ${sendTimeLabel(later)}.` : "Pick a time. Send changes to show it."}</span>
			</div>
		);
	};

	const formatCard = () => <FormatCard editor={editor} cardRef={cardRef as React.Ref<HTMLDivElement & HTMLFormElement>} />;

	const draftCard = () => {
		if (!agentDraft) return null;
		const rewrite = agentDraft.kind === "rewrite";
		const anim: AgentAnim = writing ? (thinking ? "agent-think" : "agent-write") : "agent-done";
		const toneLabel = TONES.find(([id]) => id === agentDraft.tone)?.[1];
		const about = [agentDraft.request && `“${agentDraft.request}”`, toneLabel].filter(Boolean).join(" · ");
		return (
			<div className="pg-adraft" role="group" aria-label={rewrite ? "Agent rewrite" : "Agent draft"} data-writing={writing || undefined} aria-busy={writing}>
				<div className="pg-adraft-head">
					<AgentDraftIcon size={14} anim={anim} key={`${agentDraft.job}-${agentDraft.status}`} />
					<b>{rewrite ? "Agent rewrite" : "Agent draft"}</b>
					{about && <span className="pg-ellipsis">· {about}</span>}
					<small>{writing ? (thinking ? "reading" : "writing") : agentDraft.notes?.model ? prettyName(agentDraft.notes.model) : ""}</small>
				</div>
				{!writing && <div className="pg-adraft-text" dangerouslySetInnerHTML={{ __html: String(DOMPurify.sanitize(agentDraft.html, { USE_PROFILES: { html: true } })) }} />}
				{!writing && (
					<div className="pg-adraft-foot">
						<button type="button" className="pg-adraft-use" onClick={() => takeAgentDraft(agentDraft)}>{rewrite ? "Replace with this" : "Use draft"}</button>
						{agentDraft.draftId && <button type="button" className="pg-btn" onClick={() => { setRequest(""); setCard("agent"); }}>Redraft</button>}
						<span className="pg-flex" />
						<button type="button" className="pg-tool-btn" aria-label="Discard the agent draft" title="Discard the agent draft" onClick={dropDraft}><TrashIcon size={16} /></button>
					</div>
				)}
			</div>
		);
	};

	const sendLabel = phone && later ? `Send ${sendTimeLabel(later)}` : undefined;

	return (
		<>
			{variant === "floating" && mode === "max" && <div className="pg-cw-scrim" onMouseDown={() => setMode("normal")} />}
			<div
				ref={rootRef}
				className="pg-cw"
				role={inline ? "group" : "dialog"}
				aria-label={inline ? title : "New message"}
				data-state={dataState}
				data-dropping={dropping || undefined}
				data-card={card ?? undefined}
				onPasteCapture={(e) => {
					// A pasted file or screenshot is attached. A copy from a page (it carries HTML) stays with the editor;
					// a file copied in Finder can carry its name as plain text, so plain text alone doesn't count.
					const files = Array.from(e.clipboardData.files);
					if (!files.length || e.clipboardData.getData("text/html")) return;
					e.preventDefault();
					e.stopPropagation();
					addFiles(files);
				}}
				onDragOver={(e) => {
					if (!hasFiles(e)) return;
					e.preventDefault();
					setDropping(true);
				}}
				onDragLeave={(e) => {
					if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDropping(false);
				}}
				onDropCapture={(e) => {
					if (!hasFiles(e)) return;
					e.preventDefault();
					e.stopPropagation();
					setDropping(false);
					addFiles(e.dataTransfer.files);
				}}
				onKeyDown={(e) => {
					if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
						e.preventDefault();
						send();
					} else if (e.key === "Escape") {
						e.preventDefault();
						e.stopPropagation();
						if (fromOpen || schedOpen || moreOpen || card) {
							setFromOpen(false);
							setSchedOpen(false);
							setMoreOpen(false);
							setCard(null);
						} else if (variant === "floating") setMode("min");
						else if (inline) close();
					}
				}}
			>
				<div className="pg-cw-head" onClick={(e) => mode === "min" && !(e.target as Element).closest("button") && setMode("normal")}>
					{inline && replyMode ? <replyMode.Icon size={14} color="var(--pg-text-4)" /> : <PencilSimpleLineIcon size={14} color="var(--pg-text-5)" />}
					<span className={inline ? "pg-title is-inline" : "pg-title"}>{title}</span>
					{inline && props.onMode && (
						<div className="pg-modes" role="radiogroup" aria-label="Reply mode">
							{MODES.map(({ mode: m, label, Icon }) => (
								<button key={m} type="button" title={label} aria-label={label} role="radio" aria-checked={m === state.mode} onClick={() => m !== state.mode && props.onMode?.(m, stateRef.current)}>
									<Icon size={14} />
								</button>
							))}
						</div>
					)}
					{inline && <span className="pg-flex" />}
					<span className="pg-saved" aria-live="polite">{saved ? "Draft saved" : ""}</span>
					{variant !== "standalone" && !phone && (
						<button type="button" className="pg-cw-btn" title="Open in new window" aria-label="Open in new window" onMouseDown={(e) => { e.preventDefault(); done.current = true; props.onPopOut(stateRef.current); }}>
							<ArrowSquareOutIcon size={16} />
						</button>
					)}
					{phone && (
						<span className="pg-cw-more">
							<button type="button" className="pg-cw-btn" title="More" aria-label="More" aria-haspopup="menu" aria-expanded={moreOpen} onClick={() => setMoreOpen((v) => !v)}>
								<DotsThreeIcon size={20} weight="bold" />
							</button>
							{moreOpen && (
								<>
									<div className="pg-scrim-click" style={{ zIndex: 4 }} onClick={() => setMoreOpen(false)} />
									<div className="pg-popover pg-more-menu" style={{ zIndex: 5 }} role="menu" aria-label="More">
										<button type="button" role="menuitem" className="pg-menu-item" disabled={!hasSignature && !props.onEditSignatures} onClick={() => { setMoreOpen(false); toggleSignature(); }}>
											<SignatureIcon size={16} /><span className="pg-flex">{signatureLabel}</span>
										</button>
										<button type="button" role="menuitem" className="pg-menu-item" onClick={() => { setMoreOpen(false); saveNow().then(() => finish("Draft saved")); }}>
											<FloppyDiskIcon size={16} /><span className="pg-flex">Save draft</span>
										</button>
										<button type="button" role="menuitem" className="pg-menu-item" onClick={() => { setMoreOpen(false); discard(); }}>
											<TrashIcon size={16} /><span className="pg-flex">Discard draft</span>
										</button>
									</div>
								</>
							)}
						</span>
					)}
					{variant === "floating" && (
						<>
							<button type="button" className="pg-cw-btn" title={mode === "min" ? "Restore" : "Minimize"} aria-label={mode === "min" ? "Restore" : "Minimize"} onMouseDown={(e) => { e.preventDefault(); setMode(mode === "min" ? "normal" : "min"); }}>
								{mode === "min" ? <CaretUpIcon size={16} /> : <MinusIcon size={16} />}
							</button>
							<button type="button" className="pg-cw-btn pg-desktop-only" title="Full screen" aria-label="Full screen" onMouseDown={(e) => { e.preventDefault(); setMode(mode === "max" ? "normal" : "max"); }}>
								{mode === "max" ? <ArrowsInSimpleIcon size={16} /> : <ArrowsOutSimpleIcon size={16} />}
							</button>
						</>
					)}
					<button type="button" className="pg-cw-btn" title="Save and close" aria-label="Save and close" onMouseDown={(e) => { e.preventDefault(); close(); }}>
						<XIcon size={16} />
					</button>
				</div>
				<div className="pg-cw-body">
					<div className="pg-cw-row">
						<span className="pg-field-label">From</span>
						<button
							type="button"
							className="pg-cw-from"
							aria-haspopup="listbox"
							aria-expanded={fromOpen}
							disabled={lockFrom}
							title={lockFrom ? "Replies go out from the address the mail was delivered to. Change this in the Console." : "Send from"}
							onClick={() => setFromOpen((v) => !v)}
						>
							<Swatch identity={fromId} />
							<span className="pg-name">{fromInfo?.name}</span>
							<AddressText address={state.from} identity={fromId} bold={false} />
							{!lockFrom && <CaretDownIcon size={10} color="var(--pg-text-6)" />}
						</button>
						{fromOpen && (
							<>
								<div className="pg-scrim-click" style={{ zIndex: 4 }} onClick={() => setFromOpen(false)} />
								<div className="pg-popover pg-from-menu" style={{ zIndex: 5 }} role="listbox" aria-label="Send from">
									{props.addresses.map((a) => {
										const id = identities.of(a);
										return (
											<button key={a} type="button" role="option" aria-selected={a === state.from} className="pg-menu-item" data-active={a === state.from} onClick={() => { patch({ from: a }); setFromOpen(false); }}>
												<Swatch identity={id} />
												<span className="pg-flex pg-ellipsis" style={{ fontSize: 12 }}><AddressText address={a} identity={id} bold={false} /></span>
												<span className="pg-name">{info.get(a)?.name}</span>
												{a === state.from && <CheckIcon size={12} weight="bold" />}
											</button>
										);
									})}
								</div>
							</>
						)}
					</div>
					<RecipientField
						label="To"
						list={state.to}
						onChange={(to) => patch({ to })}
						inputRef={toRef}
						extra={
							<div className="pg-cc-toggles">
								{!state.showCc && <button type="button" onMouseDown={(e) => { e.preventDefault(); patch({ showCc: true }, true); }}>Cc</button>}
								{!state.showBcc && <button type="button" onMouseDown={(e) => { e.preventDefault(); patch({ showBcc: true }, true); }}>Bcc</button>}
							</div>
						}
					/>
					{state.showCc && <RecipientField label="Cc" list={state.cc} onChange={(cc) => patch({ cc })} autoFocus={!state.cc.length && !reply} />}
					{state.showBcc && <RecipientField label="Bcc" list={state.bcc} onChange={(bcc) => patch({ bcc })} autoFocus={!state.bcc.length && !state.showCc} />}
					<div className="pg-cw-row">
						<span className="pg-field-label">Subject</span>
						<input className="pg-cw-subject" value={state.subject} aria-label="Subject" onChange={(e) => patch({ subject: e.target.value })} />
					</div>
					<div className="pg-cw-scroll" onPointerDown={() => card && card !== "format" && setCard(null)}>
						<Editor
							value={state.html}
							onChange={(html) => patch({ html })}
							placeholder={state.mode === "forward" ? "Add a note…" : reply ? "Write your reply…" : "Write your message…"}
							size={inline ? "inline" : "window"}
							onReady={setEditor}
							readOnly={agentBusy}
							autoFocus={state.to.length > 0 && state.mode !== "forward" && !props.initial.askAgent}
						/>
						{draftCard()}
						{signed && <div className="pg-signature" dangerouslySetInnerHTML={{ __html: fromInfo!.signatureHtml }} />}
						{state.quoteHead && state.quoteBody && <QuotePreview head={state.quoteHead} body={state.quoteBody} />}
					</div>
					{state.files.length > 0 && (
						<div className="pg-files">
							{state.files.map((f, i) => (
								<span key={`${f.name}-${i}`} className="pg-file">
									{isImage(f) ? <ImageIcon size={14} color="var(--pg-text-5)" /> : <FileIcon size={14} color="var(--pg-text-5)" />}
									<span className="pg-file-name">{f.name}</span>
									<span className="pg-file-size">{formatSize(f.size)}</span>
									<button type="button" aria-label={`Remove ${f.name}`} onClick={() => patch({ files: state.files.filter((_, j) => j !== i) })}><XIcon size={12} /></button>
								</span>
							))}
						</div>
					)}
					{state.notes && state.draftId && !agentDraft && (
						<form className="pg-cw-notes" onSubmit={(e) => { e.preventDefault(); redraftWith(instruction); }}>
							<span className="pg-cw-notes-text" title={state.notes.instructions.length ? `Redrafted: ${state.notes.instructions.join("; ")}` : undefined}>
								<AgentIcon size={12} weight="fill" />
								{DRAFT_ORIGIN_LABELS[state.notes.origin]}
								{state.notes.agent && <> · {state.notes.agent}</>}
								{" · "}
								{state.notes.model ? <span title={state.notes.model}>{prettyName(state.notes.model)}</span> : "model not recorded"}
								{state.notes.instructions.length > 0 && <> · {state.notes.instructions.length === 1 ? "redrafted once" : `redrafted ${state.notes.instructions.length} times`}</>}
							</span>
							<input
								className="pg-input"
								value={instruction}
								maxLength={REDRAFT_INSTRUCTION_MAX}
								placeholder="Shorter, warmer, decline politely…"
								aria-label="How to change the draft"
								onChange={(e) => setInstruction(e.target.value)}
								disabled={agentBusy}
							/>
							<button type="submit" className="pg-btn pg-btn-sm" disabled={!instruction.trim() || agentBusy}>{agentBusy ? "Redrafting…" : "Redraft"}</button>
						</form>
					)}
					{warn && (
						<div className="pg-warn" role="alert">
							<WarningIcon size={14} />
							<span className="pg-flex">{warn === "norecip" ? "Add at least one recipient." : "This message has no subject."}</span>
							{warn === "nosubj" && <button type="button" className="pg-send-anyway" onClick={() => send(true)}>Send anyway</button>}
						</div>
					)}
					{error && (
						<div className="pg-error" role="alert"><WarningIcon size={14} /><span className="pg-flex">{error}</span></div>
					)}
					{!phone && <FormatBar editor={editor} />}
					<input
						ref={fileRef}
						type="file"
						multiple
						hidden
						onChange={async (e) => {
							const list = e.target.files;
							if (list?.length) await addFiles(Array.from(list));
							e.target.value = "";
						}}
					/>
					<input
						ref={photoRef}
						type="file"
						accept="image/*"
						multiple
						hidden
						onChange={async (e) => {
							const list = e.target.files;
							if (list?.length) await addFiles(Array.from(list));
							e.target.value = "";
						}}
					/>
					{phone ? (
						<div className="pg-cw-foot pg-dock" role="toolbar" aria-label="Compose tools">
							{card === "format" && formatCard()}
							{card === "attach" && attachCard()}
							{card === "agent" && agentCard()}
							{card === "later" && laterCard()}
							<span className="pg-well" role="group" aria-label="Tools">
								<button type="button" className="pg-key" title="Format" aria-label="Format" aria-pressed={card === "format"} onPointerDown={(e) => e.preventDefault()} onMouseDown={(e) => e.preventDefault()} onClick={() => toggleCard("format")}>
									<TextAaIcon size={20} />
								</button>
								<button type="button" className="pg-key" title="Attach files" aria-label="Attach files" aria-pressed={card === "attach" && attachTab === "files"} onClick={() => { setAttachTab("files"); setCard(card === "attach" && attachTab === "files" ? null : "attach"); }}>
									<PaperclipIcon size={20} />
								</button>
								<button type="button" className="pg-key" title="Add photos" aria-label="Add photos" aria-pressed={card === "attach" && attachTab === "photos"} onClick={() => { setAttachTab("photos"); setCard(card === "attach" && attachTab === "photos" ? null : "attach"); }}>
									<ImageIcon size={20} />
								</button>
							</span>
							<AgentKey open={card === "agent"} busy={agentWorking} label={agentLabel} onPress={pressAgent} />
							<span className="pg-flex" />
							<div className="pg-send-split pg-dock-send" data-later={later ? "" : undefined}>
								<button type="button" className="pg-send" aria-label={sendLabel} onClick={() => send()} disabled={busy}>
									{later ? <><ClockIcon size={16} weight="bold" />{shortWhen(later)}</> : <>Send<PaperPlaneRightIcon size={14} weight="bold" /></>}
								</button>
								<button type="button" className="pg-caret" title="Send later" aria-label="Send later" aria-expanded={card === "later"} onClick={() => toggleCard("later")}>
									<CaretUpIcon size={14} weight="bold" />
								</button>
							</div>
						</div>
					) : (
						<div className="pg-cw-foot">
							{card === "agent" && agentCard()}
							<div className="pg-send-split">
								<button type="button" className="pg-send" title={tip("send", "Send")} onClick={() => send()} disabled={busy}>
									Send<PaperPlaneRightIcon size={12} weight="bold" />
								</button>
								<button type="button" className="pg-caret" title="Schedule send" aria-label="Schedule send" aria-expanded={schedOpen} onClick={() => { setSchedOpen((v) => !v); setCustom(false); }}>
									<CaretDownIcon size={12} weight="bold" />
								</button>
								{schedOpen && (
									<>
										<div className="pg-scrim-click" style={{ zIndex: 4 }} onClick={() => setSchedOpen(false)} />
										<div className="pg-popover pg-sched" style={{ zIndex: 5 }} role="menu" aria-label="Schedule send">
											<span className="pg-caption">SCHEDULE SEND</span>
											{scheduleSlots().map(([label, at]) => (
												<button key={label} type="button" role="menuitem" className="pg-menu-item" onClick={() => schedule(at)}>
													<ClockIcon size={14} color="var(--pg-text-6)" />
													<span className="pg-flex">{label}</span>
													<span className="pg-when">{sendTimeLabel(at)}</span>
												</button>
											))}
											<hr />
											{!custom ? (
												<button type="button" role="menuitem" className="pg-menu-item" onClick={() => setCustom(true)}>
													<CalendarBlankIcon size={14} color="var(--pg-text-6)" />
													<span className="pg-flex">Pick date &amp; time…</span>
												</button>
											) : (
												<div className="pg-sched-custom">
													<span className="pg-small">Send at</span>
													<div className="pg-inputs">
														<input type="date" aria-label="Date" value={customDate} min={isoDay(new Date())} onChange={(e) => setCustomDate(e.target.value)} />
														<input type="time" aria-label="Time" value={customTime} onChange={(e) => setCustomTime(e.target.value)} />
													</div>
													<div className="pg-times">
														{([["8:00", "08:00"], ["9:00", "09:00"], ["13:00", "13:00"], ["17:00", "17:00"]] as const).map(([label, v]) => (
															<button key={v} type="button" onClick={() => setCustomTime(v)}>{label}</button>
														))}
													</div>
													<span className="pg-note" data-bad={!customOk || undefined}>{customOk ? `Sends ${sendTimeLabel(customAt)} · your time zone` : "Pick a time in the future"}</span>
													<button type="button" className="pg-btn pg-btn-primary" disabled={!customOk || busy} onClick={() => customOk && schedule(customAt)}>
														<ClockIcon size={12} weight="bold" />Schedule send
													</button>
												</div>
											)}
										</div>
									</>
								)}
							</div>
							<button type="button" className="pg-tool-btn" title="Attach files" aria-label="Attach files" onMouseDown={(e) => { e.preventDefault(); fileRef.current?.click(); }}>
								<PaperclipIcon size={16} />
							</button>
							<button
								type="button"
								className="pg-tool-btn"
								aria-pressed={signed}
								disabled={!hasSignature && !props.onEditSignatures}
								title={hasSignature ? signatureLabel : `No signature for ${state.from}${props.onEditSignatures ? ". Set one up" : ""}`}
								aria-label={signatureLabel}
								onMouseDown={(e) => {
									e.preventDefault();
									toggleSignature();
								}}
							>
								<SignatureIcon size={16} />
							</button>
							<AgentKey open={card === "agent"} busy={agentWorking} label={agentLabel} onPress={pressAgent} />
							<div className="pg-flex" />
							<button type="button" className="pg-btn pg-btn-outline" title="Save draft" onMouseDown={(e) => { e.preventDefault(); saveNow().then(() => finish("Draft saved")); }}>
								<FloppyDiskIcon size={14} /><span className="pg-save-label">Save draft</span>
							</button>
							<button type="button" className="pg-tool-btn" title="Discard draft" aria-label="Discard draft" onMouseDown={(e) => { e.preventDefault(); discard(); }}>
								<TrashIcon size={16} />
							</button>
						</div>
					)}
				</div>
			</div>
		</>
	);
}

/**
 * The page a popped-out composer opens (#compose): the composer alone, filling
 * its own browser window, like Gmail's pop-out. The draft arrives through
 * storage. Sending, discarding or closing closes the window.
 */
export function ComposePopout({ addresses, domains }: { addresses: string[]; domains: string[] }) {
	const [prefs] = usePrefs();
	const theme = useResolvedTheme(prefs.theme);
	const identities = buildIdentities(domains, addresses);
	const info = useAddressInfo(addresses);
	const sender = useMailSender(info);
	const { draftWithAgent, cancel, runner } = useDraftWithAgent();
	const [initial] = useState<ComposeState>(() => takeHandoff() ?? emptyCompose(addresses[0] ?? ""));
	const [note, setNote] = useState<string | null>(null);

	useEffect(() => {
		history.replaceState(null, "", `${window.location.pathname}${window.location.search}#compose`);
	}, []);

	const done = (message: string | null) => {
		window.close();
		// A window the app did not open cannot close itself: say what happened and go to the inbox.
		setNote(message ?? "Closed");
		setTimeout(() => window.location.replace(`${window.location.pathname}${window.location.search}`), 1200);
	};

	return (
		<div className="postal" data-theme={theme} data-keys={prefs.keys ? "on" : "off"}>
			<TooltipLayer />
			{note ? (
				<div className="pg-idle"><p>{note}</p></div>
			) : (
				<Composer
					initial={initial}
					variant="standalone"
					addresses={addresses}
					identities={identities}
					info={info}
					sender={sender}
					lockFrom={prefs.replyFrom}
					draftWithAgent={draftWithAgent}
					onClosed={done}
					onPopOut={() => {}}
				/>
			)}
			{runner}
		</div>
	);
}
