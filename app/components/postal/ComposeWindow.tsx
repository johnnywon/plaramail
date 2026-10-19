// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import {
	ArrowBendDoubleUpLeftIcon, ArrowBendUpLeftIcon, ArrowBendUpRightIcon, ArrowSquareOutIcon, ArrowsInSimpleIcon, ArrowsOutSimpleIcon,
	CalendarBlankIcon, CaretDownIcon, CaretUpIcon, CheckIcon, ClockIcon, FileIcon, FloppyDiskIcon, MinusIcon, PaperclipIcon, PaperPlaneRightIcon,
	PencilSimpleLineIcon, SignatureIcon, TrashIcon, WarningIcon, XIcon,
} from "@phosphor-icons/react";
import { AgentIcon } from "./AgentIcon";
import type { Editor as TipTap } from "@tiptap/react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useId, useRef, useState } from "react";
import EmailIframe from "~/components/EmailIframe";
import { DRAFT_ORIGIN_LABELS, REDRAFT_INSTRUCTION_MAX } from "shared/draft-notes";
import api from "~/services/api";
import { type DraftResult, useDraftWithAgent } from "./Agent";
import {
	type AddressInfo, type ComposeMode, type ComposeState, composeSizeError, emptyCompose, sentText, isValidAddress, parseRecipient, readFiles, type Recipient, takeHandoff,
	textToParagraphs, useAddressInfo, useMailSender, usesSignature,
} from "./compose";
import { Editor, FormatBar } from "./Editor";
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
	draftWithAgent: (state: ComposeState) => Promise<DraftResult>;
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

/** One composer for new mail, replies and forwards, wherever it appears. */
export function Composer(props: ComposerProps) {
	const { tip } = useShortcuts();
	const { identities, info, sender, variant } = props;
	const [state, setState] = useState<ComposeState>(props.initial);
	const [mode, setMode] = useState<"normal" | "min" | "max">(props.maximised ? "max" : "normal");
	const [fromOpen, setFromOpen] = useState(false);
	const [schedOpen, setSchedOpen] = useState(false);
	const [custom, setCustom] = useState(false);
	const [customDate, setCustomDate] = useState(() => isoDay(new Date(Date.now() + 864e5)));
	const [customTime, setCustomTime] = useState("09:00");
	const [warn, setWarn] = useState<"norecip" | "nosubj" | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [saved, setSaved] = useState(false);
	const [busy, setBusy] = useState(false);
	const [agentBusy, setAgentBusy] = useState(false);
	const [instruction, setInstruction] = useState("");
	const queryClient = useQueryClient();
	const [editor, setEditor] = useState<TipTap | null>(null);
	const rootRef = useRef<HTMLDivElement>(null);
	const toRef = useRef<HTMLInputElement>(null);
	const fileRef = useRef<HTMLInputElement>(null);
	const saving = useRef<Promise<void>>(Promise.resolve());
	const stateRef = useRef(state);
	stateRef.current = state;
	const dirty = useRef(false);
	const done = useRef(false);
	// A redraft replaces the draft; a save with the old id meanwhile would leave a stray copy.
	const redrafting = useRef(false);
	const asked = useRef(false);
	const inline = variant === "inline";
	const reply = state.mode !== "new";

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

	const hasContent = (s: ComposeState) => !!(s.to.length || s.cc.length || s.bcc.length || s.html.replace(/<[^>]+>/g, "").trim() || (s.mode === "new" && s.subject.trim()));

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
		if (inline) rootRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
		if (!state.to.length || state.mode === "forward") toRef.current?.focus();
	}, []); // eslint-disable-line react-hooks/exhaustive-deps

	useEffect(() => {
		if (variant === "standalone") document.title = state.subject.trim() || "New message";
	}, [variant, state.subject]);

	const finish = (message: string | null) => {
		done.current = true;
		props.onClosed(message);
	};

	// The mail view's sender holds the send for Undo (send-hold.ts) and says when it went; the pop-out window's sends now.
	const send = async (force = false) => {
		if (busy) return;
		if (!state.to.length && !state.cc.length && !state.bcc.length) {
			setWarn("norecip");
			return;
		}
		if (!state.subject.trim() && !force) {
			setWarn("nosubj");
			return;
		}
		setBusy(true);
		try {
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
		if (!state.to.length && !state.cc.length && !state.bcc.length) {
			setWarn("norecip");
			setSchedOpen(false);
			return;
		}
		setBusy(true);
		try {
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
		await saving.current;
		await sender.discard(stateRef.current);
		finish("Draft discarded");
	};

	const askAgent = async () => {
		if (agentBusy) return;
		setAgentBusy(true);
		setError(null);
		try {
			const r = await props.draftWithAgent(stateRef.current);
			const html = r.text ? textToParagraphs(r.text) : r.html ?? "";
			if (html) patch({ html, ...(r.draftId ? { draftId: r.draftId, notes: { origin: "chat", agent: null, instructions: [] } } : {}) });
		} catch (e) {
			setError((e as Error).message);
		} finally {
			setAgentBusy(false);
		}
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
		askAgent();
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
						if (fromOpen || schedOpen) {
							setFromOpen(false);
							setSchedOpen(false);
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
					{variant !== "standalone" && (
						<button type="button" className="pg-cw-btn" title="Open in new window" aria-label="Open in new window" onMouseDown={(e) => { e.preventDefault(); done.current = true; props.onPopOut(stateRef.current); }}>
							<ArrowSquareOutIcon size={16} />
						</button>
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
					<div className="pg-cw-scroll">
						<Editor
							value={state.html}
							onChange={(html) => patch({ html })}
							placeholder={state.mode === "forward" ? "Add a note…" : reply ? "Write your reply…" : "Write your message…"}
							size={inline ? "inline" : "window"}
							onReady={setEditor}
							readOnly={agentBusy}
							autoFocus={state.to.length > 0 && state.mode !== "forward"}
						/>
						{signed && <div className="pg-signature" dangerouslySetInnerHTML={{ __html: fromInfo!.signatureHtml }} />}
						{state.quoteHead && state.quoteBody && <QuotePreview head={state.quoteHead} body={state.quoteBody} />}
					</div>
					{state.files.length > 0 && (
						<div className="pg-files">
							{state.files.map((f, i) => (
								<span key={`${f.name}-${i}`} className="pg-file">
									<FileIcon size={14} color="var(--pg-text-5)" />
									<span className="pg-file-name">{f.name}</span>
									<span className="pg-file-size">{formatSize(f.size)}</span>
									<button type="button" aria-label={`Remove ${f.name}`} onClick={() => patch({ files: state.files.filter((_, j) => j !== i) })}><XIcon size={12} /></button>
								</span>
							))}
						</div>
					)}
					{state.notes && state.draftId && (
						<form className="pg-cw-notes" onSubmit={(e) => { e.preventDefault(); redraftWith(instruction); }}>
							<span className="pg-cw-notes-text" title={state.notes.instructions.length ? `Redrafted: ${state.notes.instructions.join("; ")}` : undefined}>
								<AgentIcon size={12} weight="fill" />
								{DRAFT_ORIGIN_LABELS[state.notes.origin]}
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
					<FormatBar editor={editor} />
					<div className="pg-cw-foot">
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
						<button
							type="button"
							className="pg-tool-btn"
							aria-pressed={signed}
							disabled={!hasSignature && !props.onEditSignatures}
							title={hasSignature ? (signed ? "Remove signature" : "Add signature") : `No signature for ${state.from}${props.onEditSignatures ? ". Set one up" : ""}`}
							aria-label={hasSignature ? (signed ? "Remove signature" : "Add signature") : "Set up a signature"}
							onMouseDown={(e) => {
								e.preventDefault();
								if (hasSignature) patch({ signature: !signed });
								else props.onEditSignatures?.();
							}}
						>
							<SignatureIcon size={16} />
						</button>
						<button type="button" className="pg-btn pg-btn-agent" data-busy={agentBusy} title={`${reply ? "Draft reply" : "Draft"} · The agent writes a first draft here. Nothing is sent.`} onMouseDown={(e) => { e.preventDefault(); askAgent(); }}>
							<AgentIcon size={14} weight="fill" /><span className="pg-agent-label">{agentBusy ? "Drafting…" : reply ? "Draft reply" : "Draft"}</span>
						</button>
						<div className="pg-flex" />
						<button type="button" className="pg-btn pg-btn-outline" title="Save draft" onMouseDown={(e) => { e.preventDefault(); saveNow().then(() => finish("Draft saved")); }}>
							<FloppyDiskIcon size={14} /><span className="pg-save-label">Save draft</span>
						</button>
						<button type="button" className="pg-tool-btn" title="Discard draft" aria-label="Discard draft" onMouseDown={(e) => { e.preventDefault(); discard(); }}>
							<TrashIcon size={16} />
						</button>
					</div>
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
	const { draftWithAgent, runner } = useDraftWithAgent();
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
