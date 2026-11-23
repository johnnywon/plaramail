// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { ListIcon, MagnifyingGlassIcon, XIcon } from "@phosphor-icons/react";
import { AgentIcon } from "./AgentIcon";
import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import type { Conversation, SavedSearch, Suggestions } from "~/services/api";
import type { Identities } from "./identity";
import { Keys } from "./shortcuts";
import {
	addRecent,
	appendTerm,
	applyCompletion,
	completionAt,
	completions,
	filterTerms,
	loadRecent,
	looksLikeRequest,
	removeRange,
	saveRecent,
	windowKey,
} from "./search-window";
import { type FilterSuggestion, rowDomId, SearchWindow, type SearchWindowProps, type WindowRow, type WindowSection } from "./SearchWindow";

export type { FilterSuggestion } from "./SearchWindow";

const MAX_RESULTS = 6;

export interface SearchBarProps {
	value: string;
	onChange: (value: string) => void;
	/** Enter with nothing highlighted: open the first result. */
	onOpenFirst: () => void;
	onOpenResult: (row: Conversation) => void;
	/** ↑↓ with the window closed move through the list. */
	onMove: (delta: number) => void;
	resultCount: number | null;
	/** The list's first conversations for the search. */
	results: Conversation[];
	/** The search text the results are for. */
	resultsFor: string;
	resultsLoading: boolean;
	terms: string[];
	/** An operator whose value doesn't parse. It is left out of the search. */
	error?: string;
	filters: FilterSuggestion[];
	addresses: { address: string; count?: number }[];
	labels: { name: string; count: number }[];
	/** The server's suggestions, and the box text they answer. */
	suggest?: Suggestions;
	suggestFor: string;
	/** The cursor when the term under it completes from the mail (`from:`, `to:`, `cc:`), else -1. */
	onCursor: (at: number) => void;
	saved: SavedSearch[];
	onSave: (text: string) => void;
	onDeleteSaved: (saved: SavedSearch) => void;
	identities: Identities;
	/** Open the agent panel, with the text as the request when there is one. */
	onAsk: (text: string) => void;
	/** Turn plain words into search text with the agent model (POST /api/v1/search/interpret). */
	onInterpret: (text: string) => Promise<{ query: string; explanation?: string; error?: string }>;
	onMenu: () => void;
	onAgent: () => void;
	onFocusChange?: (focused: boolean) => void;
}

function storage(): Storage | undefined {
	try {
		return typeof window === "undefined" ? undefined : window.localStorage;
	} catch {
		return undefined;
	}
}

export const SearchBar = forwardRef<HTMLInputElement, SearchBarProps>(function SearchBar(props, ref) {
	const input = useRef<HTMLInputElement>(null);
	useImperativeHandle(ref, () => input.current as HTMLInputElement);
	const [focused, setFocused] = useState(false);
	const [dismissed, setDismissed] = useState(false);
	const [active, setActive] = useState<string | null>(null);
	const [cursor, setCursor] = useState(0);
	const [help, setHelp] = useState(false);
	const [recent, setRecent] = useState<string[]>([]);
	// The last plain-words request: what was typed, what came back, and why.
	const [interpreting, setInterpreting] = useState<string | null>(null);
	const [interpreted, setInterpreted] = useState<{ from: string; to: string; note: string; failed: boolean } | null>(null);
	useEffect(() => setRecent(loadRecent(storage())), []);

	const text = props.value;
	const hasQ = text.trim().length > 0;
	const open = focused && !dismissed;

	const remember = (q: string) => {
		const next = addRecent(recent, q);
		setRecent(next);
		saveRecent(storage(), next);
	};
	const forget = (q: string) => {
		const next = recent.filter((s) => s !== q);
		setRecent(next);
		saveRecent(storage(), next);
	};
	const setText = (next: string, at = next.length) => {
		props.onChange(next);
		setActive(null);
		setCursor(at);
		requestAnimationFrame(() => input.current?.setSelectionRange(at, at));
	};
	const leave = () => input.current?.blur();

	const ctx = useMemo(() => completionAt(text, cursor), [text, cursor]);
	const serverAt = ctx?.kind === "value" && SERVER_COMPLETES.has(ctx.op) ? cursor : -1;
	useEffect(() => props.onCursor(serverAt), [serverAt]); // eslint-disable-line react-hooks/exhaustive-deps
	const suggest = props.suggest;
	const suggestCurrent = !!suggest && props.suggestFor.trim() === text.trim();
	const savedText = text.replace(/\s+/g, " ").trim();
	const isSaved = props.saved.some((s) => s.query === savedText);
	const save = () => {
		if (savedText && !isSaved) props.onSave(savedText);
	};
	const focusDate = (id: string) => document.getElementById(`${rowDomId(id)}-input`)?.focus();

	const interpret = async (request: string) => {
		setInterpreting(request);
		const result = await props.onInterpret(request);
		setInterpreting(null);
		const to = `${result.query.trim()} `;
		setInterpreted({ from: request, to: to.trim(), note: result.error ?? result.explanation ?? "", failed: !!result.error });
		setText(to);
		input.current?.focus();
	};

	const sections = useMemo<WindowSection[]>(() => {
		const out: WindowSection[] = [];
		if (interpreted && interpreted.to === text.trim()) {
			const rows: WindowRow[] = [{
				id: "interpreted", kind: "action", icon: interpreted.failed ? "remove" : "ask", label: interpreted.note || "Search made from your words", detail: "Undo",
				choose: () => {
					setInterpreted(null);
					setText(`${interpreted.from} `);
				},
			}];
			if (interpreted.failed) {
				rows.push({ id: "interpreted-ask", kind: "action", icon: "ask", label: "Ask the agent instead", choose: () => { leave(); props.onAsk(interpreted.from); } });
			}
			out.push({ id: "interpreted", title: "From your words", rows });
		}
		const filterRow = (f: FilterSuggestion, section: string): WindowRow => ({
			id: `${section}:${f.token}`, kind: "filter", filter: f, choose: () => setText(appendTerm(text, f.token)),
		});
		if (ctx) {
			const server = suggest?.completions ?? [];
			const op = ctx.kind === "value" ? ctx.op : null;
			const list = completions(ctx, {
				addresses: props.addresses.map((a) => a.address),
				senders: op === "from" ? server : suggest?.people ?? [],
				recipients: op === "to" || op === "cc" ? server : [],
				labels: props.labels,
				now: new Date(),
			});
			const rows: WindowRow[] = list.map((c) => ({
				id: `c:${c.insert}`, kind: "completion", completion: c,
				choose: () => {
					const r = applyCompletion(text, ctx, c.insert);
					setText(r.text, r.cursor);
				},
			}));
			if (ctx.kind === "value" && (ctx.op === "before" || ctx.op === "after")) {
				const id = "date";
				rows.push({
					id, kind: "date", label: "Pick a date…",
					choose: () => focusDate(id),
					onPick: (day) => {
						const r = applyCompletion(text, ctx, `${ctx.negate ? "-" : ""}${ctx.op}:${day}`);
						setText(r.text, r.cursor);
						input.current?.focus();
					},
					onCancel: () => input.current?.focus(),
				});
			}
			if (rows.length) out.push({ id: "complete", title: ctx.kind === "operator" ? "Operators" : "Complete", rows });
		}
		if (!hasQ) {
			if (recent.length) {
				out.push({
					id: "recent", title: "Recent",
					rows: recent.map((q) => ({ id: `r:${q}`, kind: "recent", text: q, remove: () => forget(q), choose: () => setText(`${q} `) })),
				});
			}
			if (props.saved.length) {
				out.push({
					id: "saved", title: "Saved",
					rows: props.saved.map((s) => ({
						id: `s:${s.id}`, kind: "saved", name: s.name, query: s.query, count: s.count,
						remove: () => props.onDeleteSaved(s), choose: () => setText(`${s.query} `),
					})),
				});
			}
			const people = suggest?.people ?? [];
			if (people.length) {
				out.push({
					id: "people", title: "People",
					rows: people.slice(0, 6).map((p) => ({
						id: `p:${p.value}`, kind: "person", address: p.value, name: p.name, count: p.count,
						choose: () => setText(appendTerm(text, `from:${p.value}`)),
					})),
				});
			}
			out.push({ id: "filters", title: "Filters", side: true, rows: props.filters.map((f) => filterRow(f, "f")) });
			out.push({
				id: "addresses", title: "Addresses", side: true,
				rows: props.addresses.map((a) => ({
					id: `a:${a.address}`, kind: "address", address: a.address, count: a.count,
					choose: () => setText(appendTerm(text, `to:${a.address}`)),
				})),
			});
			out.push({
				id: "ask", title: "Ask", side: true,
				rows: [{ id: "ask", kind: "action", icon: "ask", label: "Ask the agent…", choose: () => { leave(); props.onAsk(""); } }],
			});
			return out;
		}

		const current = props.resultsFor.trim() === text.trim();
		if (props.results.length) {
			out.push({
				id: "results", title: "Top results",
				rows: props.results.slice(0, MAX_RESULTS).map((row) => ({
					id: `m:${row.thread_key}`, kind: "result", row,
					choose: () => {
						remember(text);
						leave();
						props.onOpenResult(row);
					},
				})),
			});
		} else if (current && !props.resultsLoading && props.resultCount === 0) {
			const rows: WindowRow[] = [];
			const everywhere = () => setText(appendTerm(withoutScope(text), "in:anywhere"));
			if (suggestCurrent && suggest.didYouMean) {
				const fix = suggest.didYouMean;
				rows.push({ id: "spell", kind: "action", icon: "spell", label: `Did you mean ${fix.words.map((w) => w.to).join(" ")}?`, detail: fix.text, choose: () => setText(`${fix.text} `) });
			}
			if (suggestCurrent && suggest.nothing) {
				// The server counted what each way out would find.
				const { nothing } = suggest;
				if (nothing.everywhere) rows.push({ id: "everywhere", kind: "action", icon: "everywhere", label: "Search everywhere", detail: count(nothing.everywhere), choose: everywhere });
				for (const t of nothing.removals) {
					rows.push({ id: `rm:${t.start}`, kind: "action", icon: "remove", label: `Remove ${t.text}`, detail: count(t.count), choose: () => setText(`${removeRange(text, t.start, t.end)} `) });
				}
			} else if (!suggestCurrent) {
				if (!/(^|\s)in:anywhere\b/i.test(text)) rows.push({ id: "everywhere", kind: "action", icon: "everywhere", label: "Search everywhere", detail: "in:anywhere", choose: everywhere });
				for (const t of filterTerms(text).slice(0, 3)) {
					rows.push({ id: `rm:${t.start}`, kind: "action", icon: "remove", label: `Remove ${t.text}`, choose: () => setText(`${removeRange(text, t.start, t.end)} `) });
				}
			}
			if (rows.length) out.push({ id: "nothing", title: "No results", rows });
		}
		const narrow = (suggest?.narrow ?? []).map(narrowRow);
		if (narrow.length) out.push({ id: "narrow", title: "Narrow", side: true, rows: narrow.map((f) => filterRow(f, "n")) });
		if (looksLikeRequest(text) && interpreted?.to !== text.trim()) {
			const request = text.trim();
			const busy = interpreting === request;
			out.push({
				id: "ask", title: "Ask", side: true,
				rows: [
					{
						id: "interpret", kind: "action", icon: "ask", label: busy ? "Making a search…" : "Turn into a search", detail: busy ? undefined : "agent model",
						choose: () => {
							if (!interpreting) void interpret(request);
						},
					},
					...[{
						id: "ask", kind: "action" as const, icon: "ask" as const, label: "Ask the agent about it",
						choose: () => {
							remember(text);
							leave();
							props.onAsk(request);
						},
					}],
				],
			});
		}
		return out;
	}, [ctx, text, hasQ, recent, suggest, suggestCurrent, interpreting, interpreted, props.saved, props.filters, props.addresses, props.labels, props.results, props.resultsFor, props.resultsLoading, props.resultCount]); // eslint-disable-line react-hooks/exhaustive-deps

	// Keyboard order: the wide column, then the side column.
	const rows = useMemo(() => [...sections.filter((s) => !s.side), ...sections.filter((s) => s.side)].flatMap((s) => s.rows), [sections]);
	const activeIndex = active ? rows.findIndex((r) => r.id === active) : -1;
	// A highlighted row that left the window is no longer highlighted.
	useEffect(() => {
		if (active && activeIndex < 0) setActive(null);
	}, [active, activeIndex]);
	useEffect(() => {
		if (active) document.getElementById(rowDomId(active))?.scrollIntoView({ block: "nearest" });
	}, [active]);

	const show = open && (help || rows.length > 0);
	const completing = sections[0]?.id === "complete";

	const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
		const action = windowKey(
			{ key: e.key, meta: e.metaKey, ctrl: e.ctrlKey, shift: e.shiftKey },
			{ open: show, active: activeIndex, rows: help ? 0 : rows.length, completing: completing && !help, hasText: !!text },
		);
		if (!action) return;
		e.preventDefault();
		switch (action.type) {
			case "close":
				setDismissed(true);
				setHelp(false);
				return;
			case "clear": setText(""); return;
			case "blur": leave(); return;
			case "reopen": setDismissed(false); return;
			case "highlight": setActive(action.active >= 0 ? rows[action.active].id : null); return;
			case "list": props.onMove(action.delta); return;
			case "complete": (activeIndex >= 0 && rows[activeIndex].kind === "completion" ? rows[activeIndex] : sections[0].rows[0]).choose(); return;
			case "choose": rows[activeIndex]?.choose(); return;
			case "run":
				remember(text);
				leave();
				return;
			case "save":
				save();
				return;
			case "openFirst":
				remember(text);
				props.onOpenFirst();
				leave();
				return;
		}
	};
	// The window stays mounted so it can close with motion. Closing, it keeps what it last showed
	// rather than emptying while it rolls up.
	const liveWindow: Omit<SearchWindowProps, "open"> = {
		sections,
		active,
		terms: props.terms,
		identities: props.identities,
		stale: props.resultsFor.trim() !== text.trim(),
		help,
		onHelp: setHelp,
		onHover: setActive,
		save: hasQ ? (isSaved ? "saved" : save) : null,
	};
	const lastWindow = useRef(liveWindow);
	if (show) lastWindow.current = liveWindow;
	const windowProps = show ? liveWindow : lastWindow.current;
	const syncCursor = (e: React.SyntheticEvent<HTMLInputElement>) => setCursor(e.currentTarget.selectionStart ?? e.currentTarget.value.length);
	const error = props.error ?? (suggestCurrent ? suggest.errors[0] : undefined);
	const announced = hasQ && props.resultCount !== null && props.resultsFor.trim() === text.trim();

	return (
		<div
			className="pg-search-wrap"
			onFocus={(e) => {
				if (focused || !inWindow(e.target, input.current)) return;
				setFocused(true);
				setDismissed(false);
				props.onFocusChange?.(true);
			}}
			onBlur={(e) => {
				// Focus moving to the date field stays inside the window.
				if (inWindow(e.relatedTarget, input.current)) return;
				setFocused(false);
				setActive(null);
				setHelp(false);
				props.onFocusChange?.(false);
			}}
		>
			<div className="pg-search" data-suggest={show} data-active={hasQ || focused} role="search">
				<button type="button" className="pg-icon-btn pg-mobile-only" onClick={props.onMenu} aria-label="Open menu">
					<ListIcon size={16} />
				</button>
				<MagnifyingGlassIcon size={14} className="pg-search-icon" aria-hidden />
				<input
					ref={input}
					value={text}
					onChange={(e) => {
						props.onChange(e.target.value);
						setActive(null);
						setDismissed(false);
						setHelp(false);
						syncCursor(e);
					}}
					onSelect={syncCursor}
					onKeyDown={onKeyDown}
					placeholder="Search mail"
					spellCheck={false}
					autoComplete="off"
					aria-label="Search mail"
					aria-expanded={show}
					aria-controls="pg-sw"
					aria-autocomplete="list"
					aria-activedescendant={show && active ? rowDomId(active) : undefined}
					role="combobox"
				/>
				{hasQ && (
					<>
						{error ? (
							<span className="pg-search-error pg-ellipsis" role="status" title={error}>{error}</span>
						) : props.resultCount !== null && (
							<span className="pg-result-count">{props.resultCount.toLocaleString()} result{props.resultCount === 1 ? "" : "s"}</span>
						)}
						<button type="button" className="pg-clear" title="Clear search (Esc)" aria-label="Clear search" onMouseDown={(e) => { e.preventDefault(); setText(""); }}>
							<XIcon size={14} />
						</button>
					</>
				)}
				<Keys id="search" className="pg-kbd pg-desktop-only" />
				<button type="button" className="pg-icon-btn pg-mobile-only" onClick={props.onAgent} aria-label="Open agent">
					<AgentIcon size={16} weight="fill" />
				</button>
			</div>
			<span className="pg-sr-only" aria-live="polite">
				{announced ? `${props.resultCount} result${props.resultCount === 1 ? "" : "s"}` : ""}
			</span>
			<SearchWindow open={show} {...windowProps} />
		</div>
	);
});

/** The search box or something inside the window, such as the date field. The menu and agent buttons don't count. */
function inWindow(target: EventTarget | null, box: HTMLInputElement | null): boolean {
	return !!target && (target === box || (target instanceof Element && !!target.closest(".pg-sw")));
}

/** Operators whose values come from the mail, through the suggest API. */
const SERVER_COMPLETES = new Set(["from", "to", "cc"]);

const count = (n: number) => `${n.toLocaleString()} result${n === 1 ? "" : "s"}`;

/** The search without its `in:` terms, for searching everywhere. */
function withoutScope(text: string): string {
	let out = text;
	for (const t of filterTerms(text).filter((t) => /^-?in:/i.test(t.text)).reverse()) out = removeRange(out, t.start, t.end);
	return out;
}

function narrowRow(n: Suggestions["narrow"][number]): FilterSuggestion {
	const icon = n.token.startsWith("from:") ? "from" : n.token.startsWith("label:") ? "label" : n.token === "is:unread" ? "unread" : "attachment";
	return { token: n.token, desc: n.label, icon, count: n.count };
}
