// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { ArchiveIcon, BellSlashIcon, BookmarkSimpleIcon, ClockIcon, EnvelopeOpenIcon, EnvelopeSimpleIcon, FileIcon, KeyboardIcon, PaperPlaneTiltIcon, ProhibitIcon, StarIcon, TagIcon, TrashIcon, TrayArrowUpIcon, WarningIcon } from "@phosphor-icons/react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router";
import { LABEL_COLORS } from "shared/label-colors";
import type { UnsubscribeMethod } from "shared/unsubscribe";
import { cleanOverrides, cycleView, describeChanges, KeyMatcher, type KeyLike, type MailShortcutId, ownerOf, resolveBindings, type ShortcutOverrides, stepOf } from "shared/shortcuts";
import { type BulkAction, applyAction, readToggle, starToggle } from "~/lib/bulk-optimistic";
import { type MailFilter, type OpenRef, filterToParams, openParam, parseOpen, VIEW_LABELS } from "~/lib/mail-filter";
import * as sel from "~/lib/selection";
import { useBulkAction, useUndoBulk } from "~/queries/bulk";
import { useCreateLabel, useLabels } from "~/queries/labels";
import { useMailFacets, useMailList, useViewCounts } from "~/queries/mail";
import api, { ApiError, type BulkResult, type Conversation, type Label, type SavedSearch } from "~/services/api";
import type { Email } from "~/types";
import { AgentPanel, AgentRail, useDraftWithAgent } from "./Agent";
import { DemoContext } from "~/lib/demo";
import { markLayoutMoving } from "~/lib/layout-motion";
import { useUnreadTab } from "~/lib/unread-tab";
import { useEmail } from "~/queries/emails";
import {
	type ComposeMode, type ComposeState, composeFor, composeFromDraft, emptyCompose, handOff, HANDOFF_KEY, useAddressInfo,
	sentText, textToParagraphs, useMailSender,
} from "./compose";
import { ComposePopout, Composer } from "./ComposeWindow";
import { buildIdentities } from "./identity";
import { ListPane } from "./ListPane";
import { LogoutModal, ShortcutsModal, Toast, type ToastState } from "./Modals";
import { ConsolePage } from "./Console";
import { oneHold, warnBeforeUnload } from "./send-hold";
import type { ConsoleSearchHandle } from "./ConsoleSearch";
import { type ConsoleTab, consoleTabFrom } from "./console-tabs";
import { conversations, HOME, labelOf, type MailAction, parsePostalFilter, RESTORABLE, scoped, scopeOf, searchErrors, searchTerms, withSearch } from "./model";
import { withOrder } from "./search-window";
import { useDeleteSavedSearch, useSavedSearches, useSaveSearch, useSuggest } from "~/queries/search";
import { readJson, SEEN_SHORTCUTS_KEY, useLayout, usePrefs, useResolvedTheme, useWidth, writeJson } from "./prefs";
import { Reader } from "./Reader";
import { SearchBar, type FilterSuggestion } from "./SearchBar";
import { NavRail, Sidebar } from "./Sidebar";
import { isMac, ShortcutsProvider } from "./shortcuts";
import { TooltipLayer } from "./Tooltip";

const EDITABLE = "input, textarea, select, [contenteditable=''], [contenteditable='true']";
const ICON = 15;
/** The longest side-column motion in postal.css (--pg-side-ms). */
const SIDE_MS = 420;
/** How long data-arrive stays on after a switch: the longest arrive animation (.42s) and a frame or two. */
const ARRIVE_MS = 480;
/** Keys that still work in the console. The rest act on mail. */
const CONSOLE_KEYS = new Set<MailShortcutId>(["compose", "agent", "help", "undo", "back"]);

function actionText(action: BulkAction, n: number, labelName?: string): [string, React.ReactNode] {
	const what = conversations(n);
	switch (action.type) {
		case "archive": return [`Archived ${what}`, <ArchiveIcon size={ICON} />];
		case "trash": return [`Moved ${what} to Trash`, <TrashIcon size={ICON} />];
		case "restore": return [`Moved ${what} to Inbox`, <TrayArrowUpIcon size={ICON} />];
		case "move": return [`Moved ${what} to ${VIEW_LABELS[action.folder] ?? action.folder}`, <ArchiveIcon size={ICON} />];
		case "label_add": return [`Added ${labelName ?? "label"} to ${what}`, <TagIcon size={ICON} />];
		case "label_remove": return [`Removed ${labelName ?? "label"} from ${what}`, <TagIcon size={ICON} />];
		case "read": return [`Marked ${what} read`, <EnvelopeOpenIcon size={ICON} />];
		case "unread": return [`Marked ${what} unread`, <EnvelopeSimpleIcon size={ICON} />];
		case "star": return [`Starred ${what}`, <StarIcon size={ICON} />];
		case "unstar": return [`Unstarred ${what}`, <StarIcon size={ICON} />];
	}
}

function useDebounced<T>(value: T, ms: number): T {
	const [v, setV] = useState(value);
	useEffect(() => {
		const t = setTimeout(() => setV(value), ms);
		return () => clearTimeout(t);
	}, [value, ms]);
	return v;
}

type PostalProps = { addresses: string[]; domains: string[]; autoDraft: boolean; demo?: boolean };

/** A popped-out composer opens this page at #compose and shows only the composer. */
export default function PostalMail(props: PostalProps) {
	const [popout] = useState(() => typeof window !== "undefined" && window.location.hash === "#compose");
	return (
		<DemoContext.Provider value={!!props.demo}>
			{popout ? <ComposePopout addresses={props.addresses} domains={props.domains} /> : <PostalApp {...props} />}
		</DemoContext.Provider>
	);
}

function PostalApp({ addresses, domains, autoDraft, demo }: PostalProps) {
	const [searchParams, setSearchParams] = useSearchParams();
	const queryClient = useQueryClient();
	const identities = useMemo(() => buildIdentities(domains, addresses), [domains, addresses]);
	const [prefs, setPrefs] = usePrefs();
	const [layout, setLayout] = useLayout();
	const theme = useResolvedTheme(prefs.theme);
	const width = useWidth();
	const mobile = width <= 600;
	const narrow = width < 1300;

	// ── URL state ──────────────────────────────────────────────────
	const filter = useMemo(() => parsePostalFilter(searchParams), [searchParams]);
	const open = useMemo(() => parseOpen(searchParams), [searchParams]);
	const filterKey = filterToParams(filter).toString();
	const [search, setSearchText] = useState(() => searchParams.get("search") ?? "");
	const debounced = useDebounced(search, 120);
	const { labels, byId: labelsById } = useLabels();
	const labelRefs = useMemo(() => labels.map((l) => ({ id: l.id, name: l.name })), [labels]);
	const effective = useMemo(() => withSearch(filter, debounced, labelRefs), [filter, debounced, labelRefs]);
	const effectiveKey = filterToParams(effective).toString();
	const terms = useMemo(() => searchTerms(debounced, labelRefs), [debounced, labelRefs]);
	const searchError = useMemo(() => searchErrors(debounced)[0]?.message, [debounced]);

	const write = useCallback(
		(next: MailFilter, nextOpen: OpenRef | null, replace = false, nextSearch = debounced) => {
			const params = filterToParams(next);
			if (nextOpen) params.set("open", openParam(nextOpen));
			if (nextSearch.trim()) params.set("search", nextSearch);
			// An open console stays open while the mail behind it moves.
			setSearchParams((cur) => {
				for (const key of ["console", "settings", "agent"]) {
					const value = cur.get(key);
					if (value) params.set(key, value);
				}
				return params;
			}, { replace });
		},
		[debounced, setSearchParams],
	);

	// The search text lives in the URL once typing pauses.
	useEffect(() => {
		if ((searchParams.get("search") ?? "") === debounced) return;
		write(filter, open, true, debounced);
	}, [debounced]); // eslint-disable-line react-hooks/exhaustive-deps

	// ── Data ───────────────────────────────────────────────────────
	const list = useMailList(effective);
	const pages = list.data?.pages ?? [];
	const serverRows = useMemo(() => pages.flatMap((p) => p.conversations), [pages]);
	const total = pages[0]?.total ?? serverRows.length;
	// The store ranks searches (D1), or the search asks for date order.
	const rankable = pages[0]?.order === "relevance" || !!pages[0]?.rankSkipped || /(^|\s)sort:date\b/i.test(debounced);
	const counts = useViewCounts();
	useUnreadTab(counts.unread);
	const unreadFacets = useMailFacets({ view: "inbox", chips: [{ kind: "is", value: "unread" }], sort: "date", dir: "desc" }, true);
	const unreadByAddress = useMemo(() => new Map((unreadFacets.data?.address ?? []).map((f) => [f.value.toLowerCase(), f.count])), [unreadFacets.data]);
	const [facetsWanted, setFacetsWanted] = useState(false);
	const [searchFocus, setSearchFocus] = useState(false);
	const listFacets = useMailFacets(filter, facetsWanted || searchFocus);
	// The search window: suggestions for the box and the cursor, and saved searches.
	const [suggestAt, setSuggestAt] = useState(-1);
	const suggestKey = useDebounced(`${suggestAt}\u0000${search}`, 120);
	const suggestText = suggestKey.slice(suggestKey.indexOf("\u0000") + 1);
	const suggest = useSuggest(filter, suggestText, Number(suggestKey.slice(0, suggestKey.indexOf("\u0000"))), searchFocus);
	const saved = useSavedSearches();
	const saveSearch = useSaveSearch();
	const deleteSaved = useDeleteSavedSearch();
	const info = useAddressInfo(addresses);
	const sender = useMailSender(info);
	const createLabel = useCreateLabel();
	const bulk = useBulkAction(effective);
	const undo = useUndoBulk();
	const scheduledQuery = useQuery({ queryKey: ["scheduled"], queryFn: () => api.getScheduled(), enabled: filter.view === "drafts", refetchInterval: 30_000 });
	const scheduled = useMemo(() => new Map((scheduledQuery.data ?? []).map((s) => [s.emailId, s])), [scheduledQuery.data]);

	// Conversations opened since the filter changed stay listed even when they stop matching (read under Unread only).
	const [kept, setKept] = useState<Map<string, Conversation>>(new Map());
	const [selection, setSelection] = useState<sel.Selection>(sel.EMPTY_SELECTION);
	const keptFor = useRef(effectiveKey);
	if (keptFor.current !== effectiveKey) {
		keptFor.current = effectiveKey;
		if (kept.size) setKept(new Map());
		if (selection !== sel.EMPTY_SELECTION) setSelection(sel.EMPTY_SELECTION);
	}
	const rows = useMemo(() => {
		const present = new Set(serverRows.map((r) => r.thread_key));
		const extra = [...kept.values()].filter((c) => !present.has(c.thread_key));
		if (!extra.length) return serverRows;
		const out = [...serverRows];
		for (const c of extra) {
			const at = out.findIndex((r) => (effective.dir === "asc" ? r.date > c.date : r.date < c.date));
			out.splice(at < 0 ? out.length : at, 0, c);
		}
		return out;
	}, [serverRows, kept, effective.dir]);
	const rowKeys = useMemo(() => rows.map((r) => r.thread_key), [rows]);
	const checked = useMemo(() => sel.prune(selection, rowKeys), [selection, rowKeys]);
	const openRow = open ? rows.find((r) => r.mailbox_id === open.mailboxId && r.email_id === open.emailId) : undefined;
	// The open email can be missing from the list, as when a search leaves it out. The Reader loads it
	// anyway, and this shares that query, so the agent still knows what is open.
	const { data: openEmail } = useEmail(open?.mailboxId, open?.emailId);
	const [currentKey, setCurrentKey] = useState<string | null>(null);
	const activeKey = openRow?.thread_key ?? (open ? currentKey : null);
	const [autoOpenedKey, setAutoOpenedKey] = useState<string | null>(null);

	// ── UI state ───────────────────────────────────────────────────
	const [navTemp, setNavTemp] = useState(false);
	const [panelTemp, setPanelTemp] = useState(false);
	const navOpen = mobile ? navTemp : narrow ? navTemp : layout.nav ?? true;
	const panelOpen = mobile ? panelTemp : narrow ? panelTemp : layout.panel ?? true;
	// Both sides stay mounted, closed ones hidden and inert, so opening and closing are CSS
	// transitions that reverse from wherever they are. The agent mounts on first open.
	const sideMode = mobile ? "sheet" : narrow ? "overlay" : "dock";
	// On its first open the agent mounts closed and opens a frame later, so that open moves too.
	const [agentMounted, setAgentMounted] = useState(panelOpen);
	const [agentReady, setAgentReady] = useState(panelOpen);
	if (panelOpen && !agentMounted) setAgentMounted(true);
	useEffect(() => {
		if (!agentMounted || agentReady) return;
		const id = requestAnimationFrame(() => setAgentReady(true));
		return () => cancelAnimationFrame(id);
	}, [agentMounted, agentReady]);
	const panelShown = panelOpen && agentReady;
	const [modal, setModal] = useState<"logout" | null>(null);
	const [toast, setToast] = useState<ToastState | null>(null);
	const [cw, setCw] = useState<{ key: number; initial: ComposeState; max?: boolean } | null>(null);
	const [inline, setInline] = useState<{ key: number; initial: ComposeState } | null>(null);
	// The console lives in the URL (?console=<tab>), so a link opens it on a tab and Back closes it. Old ?settings= links still open it.
	const consoleTab = consoleTabFrom(searchParams);
	const consoleAgent = consoleTab === "agents" ? searchParams.get("agent") : null;
	const openConsole = (tab: ConsoleTab = "home", agent: string | null = null) => setSearchParams((cur) => {
		const next = new URLSearchParams(cur);
		next.delete("settings");
		next.set("console", tab);
		if (agent) next.set("agent", agent);
		else next.delete("agent");
		return next;
	}, { replace: !!consoleTab && !agent && !consoleAgent });
	const closeConsole = () => setSearchParams((cur) => {
		const next = new URLSearchParams(cur);
		next.delete("console");
		next.delete("settings");
		next.delete("agent");
		return next;
	});
	// Opening and closing the console moves like the side columns (postal.css, Moving between mail and the console).
	// data-arrive is set before paint on the switch only, never on first load, and cleared once the move is done.
	const shellRef = useRef<HTMLDivElement>(null);
	const inConsole = !!consoleTab;
	const wasConsole = useRef(inConsole);
	useLayoutEffect(() => {
		const el = shellRef.current;
		if (!el || wasConsole.current === inConsole) return;
		wasConsole.current = inConsole;
		el.dataset.arrive = inConsole ? "console" : "mail";
		const t = setTimeout(() => { delete el.dataset.arrive; }, ARRIVE_MS);
		return () => clearTimeout(t);
	}, [inConsole]);
	const [prefill, setPrefill] = useState<{ text: string; id: number } | null>(null);
	const [agentBusy, setAgentBusy] = useState(false);
	const [replyRequest, setReplyRequest] = useState<{ mode: Exclude<ComposeMode, "new">; id: number } | null>(null);
	const { draftWithAgent, cancel: stopAgent, runner: draftRunner } = useDraftWithAgent();
	const searchRef = useRef<HTMLInputElement>(null);

	const showToast = useCallback((t: Omit<ToastState, "id">) => setToast({ ...t, id: Date.now() }), []);
	const closeToast = useCallback(() => setToast(null), []);

	// A column that closes with focus inside hands it to its rail. On a phone it lets go.
	const handOffFocus = (side: "left" | "right") => {
		const column = document.querySelector(`.pg-side[data-side="${side}"] > ${side === "left" ? ".pg-nav" : ".pg-agent"}`);
		if (!column?.contains(document.activeElement)) return;
		// After the commit: until then the rail is inert and can't take focus.
		requestAnimationFrame(() => {
			const rail = document.querySelector<HTMLElement>(`.pg-side[data-side="${side}"] ${side === "left" ? ".pg-navrail .pg-rail-head" : ".pg-agentrail"}`);
			// Phones have no rails. Focusing search there would open its full-screen window and the keyboard, so just let go.
			if (rail?.offsetParent) rail.focus({ preventScroll: true });
			else if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
		});
	};
	const toggleNav = () => {
		markLayoutMoving(SIDE_MS);
		if (navOpen) handOffFocus("left");
		if (mobile || narrow) setNavTemp((v) => !v);
		else setLayout({ nav: !navOpen });
	};
	const togglePanel = () => {
		markLayoutMoving(SIDE_MS);
		if (panelOpen) handOffFocus("right");
		if (mobile || narrow) setPanelTemp((v) => !v);
		else setLayout({ panel: !panelOpen });
	};
	// Both side columns: closes both when either is open, else opens both. Below 1300px they overlay, so it only closes.
	const toggleBoth = () => {
		markLayoutMoving(SIDE_MS);
		handOffFocus("left");
		handOffFocus("right");
		if (mobile || narrow) {
			setNavTemp(false);
			setPanelTemp(false);
		} else {
			const open = !(navOpen || panelOpen);
			setLayout({ nav: open, panel: open });
		}
	};

	// Reset inline composer when the open conversation changes.
	useEffect(() => setInline(null), [open?.mailboxId, open?.emailId]);

	// ── Navigation ─────────────────────────────────────────────────
	const go = useCallback(
		(next: MailFilter) => {
			setSearchText("");
			write(next, null, false, "");
			if (mobile) setNavTemp(false);
			else if (narrow) setNavTemp(false);
		},
		[write, mobile, narrow],
	);

	// An address that isn't configured, such as an old /mailbox/ link, goes back to the Inbox.
	useEffect(() => {
		const scope = scopeOf(filter);
		if (!scope?.includes("@") || !addresses.length || addresses.includes(scope.toLowerCase())) return;
		write({ ...HOME, chips: [] }, null, true, "");
		showToast({ text: `${scope} isn't one of your addresses.`, icon: <WarningIcon size={ICON} /> });
	}, [filter, addresses, write, showToast]);

	const openConversation = useCallback(
		(row: Conversation, auto = false) => {
			setCurrentKey(row.thread_key);
			setAutoOpenedKey((prev) => (auto ? row.thread_key : prev === row.thread_key ? null : prev));
			if (!auto && prefs.markRead) setKept((prev) => new Map(prev).set(row.thread_key, { ...row, unread: false, thread_unread_count: 0 }));
			write(filter, { mailboxId: row.mailbox_id, emailId: row.email_id }, true);
		},
		[filter, write, prefs.markRead],
	);

	const closeConversation = () => write(filter, null, true);

	// Two-pane layouts open the first conversation once per filter.
	const autoFor = useRef<string | null>(null);
	useEffect(() => {
		if (mobile || open || !rows.length || autoFor.current === effectiveKey) return;
		autoFor.current = effectiveKey;
		openConversation(rows[0], true);
	}, [mobile, open, rows, effectiveKey, openConversation]);

	const move = (delta: number) => {
		if (!rows.length) return;
		const at = activeKey ? rows.findIndex((r) => r.thread_key === activeKey) : -1;
		const next = rows[Math.min(Math.max(at + delta, 0), rows.length - 1)];
		if (next && next.thread_key !== activeKey) openConversation(next);
	};

	// After an action removes the open conversation, open the next one below, else above.
	const onRemoved = (removed: ReadonlySet<string>) => {
		if (removed.size) {
			setKept((prev) => {
				const copy = new Map(prev);
				for (const k of removed) copy.delete(k);
				return copy;
			});
		}
		if (!activeKey || !removed.has(activeKey)) return;
		const at = rows.findIndex((r) => r.thread_key === activeKey);
		const below = rows.slice(at + 1).find((r) => !removed.has(r.thread_key));
		const above = rows.slice(0, Math.max(at, 0)).reverse().find((r) => !removed.has(r.thread_key));
		const next = at >= 0 ? below ?? above : undefined;
		if (next && !mobile) openConversation(next);
		else closeConversation();
	};

	// ── Actions ────────────────────────────────────────────────────
	const targets = (override?: Conversation[] | null): Conversation[] => {
		if (override?.length) return override.map((o) => rows.find((r) => r.thread_key === o.thread_key) ?? o);
		if (checked.keys.size) return rows.filter((r) => checked.keys.has(r.thread_key));
		return openRow ? [openRow] : [];
	};

	const undoAction = (undoId: string) => {
		setToast(null);
		undo.mutate(undoId, {
			onSuccess: () => showToast({ text: "Undone" }),
			onError: (e) => showToast({ text: `Could not undo. ${(e as Error).message}`, icon: <WarningIcon size={ICON} /> }),
		});
	};

	const run = (action: BulkAction, override?: Conversation[] | null, labelName?: string) => {
		const list = targets(override);
		if (!list.length) return;
		const removed = new Set(list.filter((r) => !applyAction(r, action, effective)).map((r) => r.thread_key));
		const [text, icon] = actionText(action, list.length, labelName);
		bulk.mutate(
			{ target: { threadKeys: list.map((r) => r.thread_key), view: effective.view }, action, patchKeys: list.map((r) => r.thread_key) },
			{
				onSuccess: (result) => {
					const done = result as BulkResult;
					const failed = done.failed?.length ? ` ${done.failed.length} address${done.failed.length === 1 ? "" : "es"} failed.` : "";
					showToast({ text: text + failed, icon, onUndo: done.undoId ? () => undoAction(done.undoId) : undefined });
				},
				onError: (e) => {
					const msg = e instanceof ApiError && e.status === 409 ? "The list changed. Try again." : `Could not update mail. ${(e as Error).message}`;
					showToast({ text: msg, icon: <WarningIcon size={ICON} /> });
				},
			},
		);
		if (!override) setSelection(sel.EMPTY_SELECTION);
		if (removed.size) onRemoved(removed);
	};

	const canTrash = filter.view !== "trash";
	const canSpam = filter.view !== "spam";
	const canRestore = RESTORABLE.has(filter.view);
	const act = (kind: MailAction, override?: Conversation[] | null) => {
		const list = targets(override);
		if (!list.length) return;
		if (kind === "archive") run({ type: "archive" }, override);
		else if (kind === "restore") canRestore && run({ type: "restore" }, override);
		else if (kind === "trash") canTrash && run({ type: "trash" }, override);
		else if (kind === "spam") canSpam && run({ type: "move", folder: "spam" }, override);
		else if (kind === "star") run(starToggle(list), override);
		else run(readToggle(list), override);
	};

	const emptyTrash = async () => {
		try {
			const { messages, conversations: n } = await api.trashCount();
			if (!messages || !window.confirm(`Delete ${n === 1 ? "1 conversation" : conversations(n)} in Trash forever? This can't be undone.`)) return;
			await api.emptyTrash(messages);
			closeConversation();
			showToast({ text: "Trash emptied", icon: <TrashIcon size={ICON} /> });
		} catch (e) {
			const msg = e instanceof ApiError && e.status === 409 ? "Trash changed. Nothing was deleted." : `Could not empty Trash. ${(e as Error).message}`;
			showToast({ text: msg, icon: <WarningIcon size={ICON} /> });
		} finally {
			queryClient.invalidateQueries({ queryKey: ["mail"] });
			queryClient.invalidateQueries({ queryKey: ["mail-facets"] });
		}
	};

	const toggleLabel = (label: Label, add: boolean, rowsFor?: Conversation[]) =>
		run({ type: add ? "label_add" : "label_remove", labelId: label.id }, rowsFor ?? (openRow ? [openRow] : null), label.name);

	const newLabel = (name: string, applyTo?: Conversation[]) =>
		createLabel.mutate(
			{ name, color: LABEL_COLORS[labels.length % LABEL_COLORS.length].bg },
			{
				onSuccess: (label) => (applyTo ? toggleLabel(label, true, applyTo) : showToast({ text: `Created ${label.name}`, icon: <TagIcon size={ICON} /> })),
				onError: (e) => showToast({ text: (e as Error).message, icon: <WarningIcon size={ICON} /> }),
			},
		);

	// ── Compose ────────────────────────────────────────────────────
	const defaultFrom = () => {
		const scope = scopeOf(filter);
		if (scope?.includes("@")) return scope;
		return open?.mailboxId ?? addresses[0] ?? "";
	};

	// One held send at a time (send-hold.ts): opening a composer sends the held one now, so Undo can't write over it.
	const holds = useRef(oneHold()).current;

	const openCompose = (initial?: ComposeState, max = false) => {
		if (cw && !initial) return; // already open; the window keeps its draft
		holds.settle();
		setCw({ key: Date.now(), initial: initial ?? emptyCompose(defaultFrom()), max });
	};

	// Undo send (WON-213): Send holds the message for a few seconds with Undo in the toast. Undo reopens it.
	const heldSender = {
		...sender,
		send: async (state: ComposeState): Promise<boolean> => {
			sender.check(state);
			// The draft being sent leaves the reader, as it did before the hold. Undo reopens it in the composer.
			if (state.draftId && open?.emailId === state.draftId) closeConversation();
			const hold = holds.hold(() => sender.send(state).then(() => undefined));
			showToast({
				text: "Sending",
				icon: <PaperPlaneTiltIcon size={ICON} />,
				onUndo: () => {
					if (!holds.isLatest(hold) || !hold.undo()) return;
					setToast(null);
					openCompose(state);
				},
			});
			hold.done.then(
				(how) => how === "sent" && showToast({ text: sentText(state), icon: <PaperPlaneTiltIcon size={ICON} /> }),
				(e) => showToast({ text: `Could not send. ${(e as Error).message || ""} It is in Drafts.`.replace(/\s+/g, " "), icon: <WarningIcon size={ICON} /> }),
			);
			return true;
		},
	};
	useEffect(() => {
		window.addEventListener("beforeunload", warnBeforeUnload);
		return () => window.removeEventListener("beforeunload", warnBeforeUnload);
	}, []);

	const startReply = (mode: Exclude<ComposeMode, "new">, original: Email, keep?: ComposeState, askAgent?: boolean) => {
		if (!open) return;
		const from = open.mailboxId;
		holds.settle();
		const next = composeFor(mode, original, open.mailboxId, from);
		// Switching mode keeps what was written, attached and saved. The original's files come only with Forward.
		const files = keep ? [...next.files, ...keep.files.filter((f) => !f.attachmentId)] : next.files;
		const carried = keep ? { html: keep.html, files, draftId: keep.draftId, from: keep.from, signature: keep.signature } : {};
		setInline({ key: Date.now(), initial: { ...next, ...carried, askAgent } });
	};

	const draftState = (mailboxId: string, draft: Email) => {
		const state = composeFromDraft(draft, mailboxId);
		// A scheduled draft holds the sent body, signature included; the composer adds it back on send.
		const sig = info.get(mailboxId)?.signatureHtml;
		if (sig && state.html.includes(sig)) state.html = state.html.replace(sig, "");
		return state;
	};

	const editDraft = async (mailboxId: string, draftId: string, cached?: Email, askAgent?: boolean) => {
		try {
			openCompose({ ...draftState(mailboxId, cached ?? (await api.getEmail(mailboxId, draftId))), askAgent });
		} catch {
			showToast({ text: "Could not open the draft.", icon: <WarningIcon size={ICON} /> });
		}
	};

	// ── Unsubscribe and blocked senders (WON-217) ─────────────────
	const blockedQuery = useQuery({ queryKey: ["blocked-senders"], queryFn: () => api.getBlockedSenders() });
	const blockedSet = useMemo(() => new Set((blockedQuery.data ?? []).map((b) => `${b.mailboxId}\u001f${b.address}`)), [blockedQuery.data]);
	const isBlocked = (mailboxId: string, address: string) => blockedSet.has(`${mailboxId.toLowerCase()}\u001f${address.toLowerCase()}`);

	/** The Worker posts one-click itself. A page opens in a new tab and a mailto in the composer, from the address the mail came to. */
	const unsubscribeFrom = async (email: Email, method: UnsubscribeMethod) => {
		if (!open) return;
		const mailboxId = open.mailboxId;
		// Opened now, while the click still counts, so the page isn't blocked as a popup.
		const tab = method === "link" ? window.open("", "_blank") : null;
		try {
			const result = await api.unsubscribe(mailboxId, email.id);
			if (result.method === "one-click") {
				showToast({ text: `Unsubscribed from ${email.sender}`, icon: <BellSlashIcon size={ICON} /> });
			} else if (result.method === "link") {
				if (tab) {
					tab.opener = null;
					tab.location.href = result.url;
				} else {
					window.open(result.url, "_blank", "noopener,noreferrer");
				}
				showToast({ text: "Opened the list's unsubscribe page", icon: <BellSlashIcon size={ICON} /> });
			} else {
				openCompose({
					...emptyCompose(mailboxId),
					to: [{ addr: result.mailto.to }],
					subject: result.mailto.subject || "Unsubscribe",
					html: result.mailto.body ? textToParagraphs(result.mailto.body) : "",
					signature: false,
				});
			}
		} catch (e) {
			tab?.close();
			showToast({ text: `Could not unsubscribe. ${(e as Error).message}`, icon: <WarningIcon size={ICON} /> });
		}
	};

	const blockSender = async (email: Email, block: boolean) => {
		if (!open) return;
		const mailboxId = open.mailboxId;
		const address = email.sender.toLowerCase();
		try {
			if (block) {
				await api.blockSender(mailboxId, email.id);
				showToast({
					text: `Blocked ${address}. New mail from them goes to Trash.`,
					icon: <ProhibitIcon size={ICON} />,
					onUndo: () => {
						setToast(null);
						void blockSender(email, false);
					},
				});
			} else {
				await api.unblockSender(mailboxId, address);
				showToast({ text: `Unblocked ${address}`, icon: <ProhibitIcon size={ICON} /> });
			}
		} catch (e) {
			showToast({ text: (e as Error).message, icon: <WarningIcon size={ICON} /> });
		} finally {
			queryClient.invalidateQueries({ queryKey: ["blocked-senders"] });
		}
	};

	// One-click send from Draft review: the draft goes out as the agent wrote it, signature included.
	const sendDraft = async (mailboxId: string, draftId: string) => {
		const state = draftState(mailboxId, await api.getEmail(mailboxId, draftId));
		await sender.send(state);
		showToast({ text: `Sent to ${state.to.map((r) => r.addr).join(", ")}`, icon: <PaperPlaneTiltIcon size={ICON} /> });
	};

	const popOut = (state: ComposeState, fallback: () => void) => {
		if (handOff(state)) {
			showToast({ text: "Opened in a new window", icon: <PaperPlaneTiltIcon size={ICON} /> });
			return true;
		}
		try {
			window.localStorage.removeItem(HANDOFF_KEY);
		} catch {
			// nothing to clean
		}
		fallback();
		return false;
	};

	// ── Keyboard ───────────────────────────────────────────────────
	// Keys come from shared/shortcuts.ts, rebound by Settings > Shortcuts.
	const bindings = useMemo(() => resolveBindings(prefs.shortcuts), [prefs.shortcuts]);
	const matcher = useMemo(() => new KeyMatcher(bindings), [bindings]);
	const matcherRef = useRef(matcher);
	matcherRef.current = matcher;
	const consoleSearchRef = useRef<ConsoleSearchHandle>(null);
	const runShortcut = useRef<(id: MailShortcutId, shift: boolean) => boolean>(() => false);
	runShortcut.current = (id, shift) => {
		// In the console only the keys that don't act on mail work, and search searches the console.
		if (consoleTab) {
			if (id === "search") return (consoleSearchRef.current?.focus(), true);
			if (!CONSOLE_KEYS.has(id)) return false;
		}
		const reply = (mode: Exclude<ComposeMode, "new">) => {
			if (!open) return false;
			setReplyRequest({ mode, id: Date.now() });
			return true;
		};
		const goTo = (view: MailFilter["view"]) => {
			go({ ...HOME, view, chips: [] });
			return true;
		};
		const actions: Record<MailShortcutId, () => boolean> = {
			next: () => (move(1), true),
			prev: () => (move(-1), true),
			search: () => (searchRef.current?.focus(), true),
			goInbox: () => goTo("inbox"),
			goStarred: () => goTo("starred"),
			goDrafts: () => goTo("drafts"),
			goSent: () => goTo("sent"),
			goAll: () => goTo("all"),
			nextView: () => (go(scoped(cycleView(labelOf(filter) ? "all" : filter.view, 1), scopeOf(filter), HOME)), true),
			prevView: () => (go(scoped(cycleView(labelOf(filter) ? "all" : filter.view, -1), scopeOf(filter), HOME)), true),
			back: () => {
				if (checked.keys.size) setSelection(sel.EMPTY_SELECTION);
				else if (mobile && navTemp) setNavTemp(false);
				else if ((mobile || narrow) && panelTemp) setPanelTemp(false);
				else if (mobile && open) closeConversation();
				else return false;
				return true;
			},
			archive: () => (act("archive"), true),
			trash: () => (act("trash"), true),
			spam: () => (act("spam"), true),
			star: () => (act("star"), true),
			markRead: () => (run({ type: "read" }), true),
			markUnread: () => (run({ type: "unread" }), true),
			label: () => {
				if (!openRow) return false;
				setLabelRequest(Date.now());
				return true;
			},
			select: () => {
				if (activeKey && rowKeys.includes(activeKey)) setSelection((s) => (shift ? sel.range(s, activeKey, rowKeys) : sel.toggle(s, activeKey)));
				return true;
			},
			undo: () => {
				if (!toast?.onUndo) return false;
				toast.onUndo();
				return true;
			},
			compose: () => (openCompose(), true),
			reply: () => reply("reply"),
			replyAll: () => reply("reply-all"),
			forward: () => reply("forward"),
			agent: () => (togglePanelRef.current(), true),
			sidebar: () => (toggleNav(), true),
			panels: () => (toggleBoth(), true),
			help: () => (setHelpOpen(true), true),
		};
		return actions[id]();
	};
	const togglePanelRef = useRef(togglePanel);
	togglePanelRef.current = togglePanel;
	const [helpOpen, setHelpOpen] = useState(false);

	// Keys rebound elsewhere (the agent, MCP, another browser), now or since this browser last looked, get a toast
	// with Undo. Edits in Settings don't.
	const [seenAtLoad] = useState<ShortcutOverrides>(() => {
		const stored = readJson<object | null>(SEEN_SHORTCUTS_KEY, null);
		return stored ? cleanOverrides(stored) : prefs.shortcuts;
	});
	const seenShortcuts = useRef(seenAtLoad);
	useEffect(() => {
		const before = seenShortcuts.current;
		seenShortcuts.current = prefs.shortcuts;
		writeJson(SEEN_SHORTCUTS_KEY, prefs.shortcuts);
		if (consoleTab || before === prefs.shortcuts) return;
		const lines = describeChanges(before, prefs.shortcuts, isMac());
		if (!lines.length) return;
		const text = lines.length > 2 ? `${lines.slice(0, 2).join(". ")}, and ${lines.length - 2} more` : lines.join(". ");
		showToast({ text, icon: <KeyboardIcon size={ICON} />, onUndo: () => {
			setToast(null);
			seenShortcuts.current = before;
			writeJson(SEEN_SHORTCUTS_KEY, before);
			void setPrefs({ shortcuts: before });
		} });
	}, [prefs.shortcuts]); // eslint-disable-line react-hooks/exhaustive-deps
	const [labelRequest, setLabelRequest] = useState(0);

	useEffect(() => {
		const onKey = (e: KeyboardEvent) => {
			if (e.defaultPrevented || e.isComposing) return;
			const step = stepOf(e);
			if (!step || document.querySelector(".pg-modal-scrim")) return;
			const target = e.target as Element | null;
			const inCompose = !!target?.closest?.(".pg-cw");
			const typing = inCompose || !!target?.closest?.(EDITABLE) || !!target?.closest?.("[data-mail-popover]");
			// While typing only ⌘ keys count, and in the composer not the ones it uses itself (⌘K is a link there).
			if (typing && !step.startsWith("Mod+")) return;
			if (inCompose && ownerOf(bindings, step, "compose")) return;
			const hit = matcherRef.current.match(step);
			if (hit === "pending") e.preventDefault();
			else if (hit && runShortcut.current(hit.id, hit.shift)) e.preventDefault();
		};
		// A message frame passes its keys up; the parent accepts them only from its own frames.
		const onMessage = (event: MessageEvent) => {
			const data = event.data as ({ __emailIframeKey?: boolean } & KeyLike) | null;
			if (!data || data.__emailIframeKey !== true || typeof data.key !== "string") return;
			if (![...document.querySelectorAll("iframe")].some((f) => f.contentWindow === event.source)) return;
			if (document.querySelector(".pg-modal-scrim")) return;
			const step = stepOf(data);
			const hit = step ? matcherRef.current.match(step) : null;
			if (hit && hit !== "pending") runShortcut.current(hit.id, hit.shift);
		};
		document.addEventListener("keydown", onKey);
		window.addEventListener("message", onMessage);
		return () => {
			document.removeEventListener("keydown", onKey);
			window.removeEventListener("message", onMessage);
		};
	}, [bindings]);
	// ── Derived display ────────────────────────────────────────────
	const searching = !!debounced.trim();
	const status = listFacets.data?.status;
	const topLabels = [...labels].sort((a, b) => b.count - a.count).slice(0, 2);
	const topFrom = (listFacets.data?.from.domains ?? []).slice(0, 2);
	const suggestions: FilterSuggestion[] = [
		{ token: "is:unread", desc: "Unread", icon: "unread", count: status?.unread },
		{ token: "is:starred", desc: "Starred", icon: "starred", count: status?.starred },
		{ token: "has:attachment", desc: "Has attachment", icon: "attachment", count: status?.attachment },
		// TODO(roadmap): an "is:waiting" (Needs you) suggestion returns with the Needs you view.
		...topLabels.map((l) => ({ token: `label:${/\s/.test(l.name) ? `"${l.name}"` : l.name.toLowerCase()}`, desc: l.name, icon: "label" as const, count: l.count })),
		...topFrom.map((f) => ({ token: `from:${f.value}`, desc: `From ${f.value}`, icon: "from" as const, count: f.count })),
	];
	const addressFacet = new Map((listFacets.data?.address ?? []).map((f) => [f.value.toLowerCase(), f.count]));

	const sidebarProps = {
		identities, filter, go, allUnread: counts.unread, unreadByAddress, labels,
		onCreateLabel: (name: string) => newLabel(name),
		saved: saved.data ?? [],
		search,
		onSavedSearch: (s: SavedSearch) => {
			setSearchText(`${s.query} `);
			if (mobile || narrow) setNavTemp(false);
		},
		onAskLabel: (label: Label) => {
			if (!panelOpen) togglePanel();
			setPrefill({ text: `Which conversations did you label ${label.name}, and why?`, id: Date.now() });
			if (mobile) setNavTemp(false);
		},
		mailboxesOpen: layout.mailboxesOpen,
		labelsOpen: layout.labelsOpen,
		setLayout,
		onCollapse: toggleNav,
		onConsole: () => openConsole(),
		onManageLabels: () => openConsole("labels"),
		onLogout: demo ? undefined : () => setModal("logout"),
		onShortcuts: () => setHelpOpen(true),
	};

	return (
		<ShortcutsProvider overrides={prefs.shortcuts}>
			<div ref={shellRef} className="postal" data-theme={theme} data-keys={prefs.keys ? "on" : "off"} data-pane={mobile && open ? "reader" : "list"}>
				<TooltipLayer />
				<div className="pg-body">
					{consoleTab ? (
						<ConsolePage
							tab={consoleTab}
							agentId={consoleAgent}
							onTab={(tab) => openConsole(tab)}
							onAgent={(id) => openConsole("agents", id)}
							onClose={closeConsole}
							onOpenDraft={(mailboxId, draftId) => editDraft(mailboxId, draftId)}
							onSendDraft={sendDraft}
							// A link can open the console before each address's settings load; its forms start again as they arrive so they compare against them.
							settingsKey={`${addresses.length}:${[...info.values()].filter((i) => i.mailbox).length}`}
							prefs={prefs}
							setPrefs={setPrefs}
							addresses={addresses}
							identities={identities}
							info={info}
							autoDraft={autoDraft}
							onSaved={(text) => showToast({ text })}
							searchRef={consoleSearchRef}
							onAgentPanel={togglePanel}
						/>
					) : (
						<>
						{/* At 1300px and up each side is a dock whose width moves between rail and column. Below it the rail stays in place and the column overlays it. */}
						<div className="pg-side" data-side="left" data-mode={sideMode} data-open={navOpen}>
							{!mobile && (
								<NavRail
									{...sidebarProps}
									inert={navOpen && !narrow}
									onExpand={toggleNav}
									onLabels={() => {
										setLayout({ labelsOpen: true });
										toggleNav();
									}}
								/>
							)}
							<Sidebar {...sidebarProps} inert={!navOpen} overlay={!mobile && narrow} drawer={mobile ? (navTemp ? "open" : "closed") : undefined} />
						</div>
						{(mobile || narrow) && <div className="pg-drawer-scrim" data-side="left" data-open={navOpen} onClick={() => setNavTemp(false)} aria-hidden />}
						<div className="pg-center">
							<SearchBar
								ref={searchRef}
								value={search}
								onChange={setSearchText}
								// Before the results for this text arrive, rows are the previous list's: Enter only runs the search.
								onOpenFirst={() => debounced.trim() === search.trim() && !list.isPlaceholderData && rows[0] && openConversation(rows[0])}
								onOpenResult={(row) => openConversation(row)}
								onMove={move}
								resultCount={searching && !list.isPending ? total : null}
								results={searching ? serverRows : []}
								resultsFor={debounced}
								resultsLoading={list.isFetching}
								terms={terms}
								error={searchError}
								filters={suggestions}
								suggest={suggest.data}
								suggestFor={suggestText}
								onCursor={setSuggestAt}
								saved={saved.data ?? []}
								onSave={(text) =>
									saveSearch.mutate({ query: text }, {
										onSuccess: () => showToast({ text: "Search saved", icon: <BookmarkSimpleIcon size={ICON} /> }),
										onError: (e) => showToast({ text: (e as Error).message, icon: <WarningIcon size={ICON} /> }),
									})
								}
								onDeleteSaved={(s) =>
									deleteSaved.mutate(s.id, { onError: (e) => showToast({ text: (e as Error).message, icon: <WarningIcon size={ICON} /> }) })
								}
								labels={labels.map((l) => ({ name: l.name, count: l.count }))}
								onInterpret={(text) => api.interpretSearch(text)}
								onAsk={(text) => {
									if (!panelOpen) togglePanel();
									if (text) setPrefill({ text, id: Date.now() });
								}}
								addresses={addresses.map((a) => ({ address: a, count: addressFacet.get(a) }))}
								identities={identities}
								onMenu={() => setNavTemp(true)}
								onAgent={togglePanel}
								onFocusChange={setSearchFocus}
							/>
							<main className="pg-panes">
								<ListPane
									identities={identities}
									filter={filter}
									go={go}
									searching={searching}
									search={debounced}
									allUnread={counts.unread}
									unreadByAddress={unreadByAddress}
									onNew={() => openCompose()}
									onRefresh={() => {
										queryClient.invalidateQueries({ queryKey: ["mail"] });
										queryClient.invalidateQueries({ queryKey: ["mail-facets"] });
									}}
									refreshing={list.isFetching && !list.isFetchingNextPage}
									facets={listFacets.data}
									onFacets={setFacetsWanted}
									labels={labels}
									labelsById={labelsById}
									rows={rows}
									total={total}
									loading={list.isPending}
									error={list.error}
									onRetry={() => list.refetch()}
									hasNextPage={!!list.hasNextPage}
									fetchingNext={list.isFetchingNextPage}
									fetchNext={() => list.fetchNextPage()}
									currentKey={activeKey}
									onOpen={(row) => openConversation(row)}
									checked={checked.keys}
									onCheck={(row, range) => setSelection((s) => (range ? sel.range(s, row.thread_key, rowKeys) : sel.toggle(s, row.thread_key)))}
									onSelectAll={() => setSelection((s) => sel.selectAll(s, rowKeys))}
									onClearSelection={() => setSelection(sel.EMPTY_SELECTION)}
									onRowAction={(row, action) => act(action, [row])}
									onBulk={(action) => act(action)}
									onEmptyTrash={emptyTrash}
									terms={terms}
									order={rankable ? (pages[0]?.order === "relevance" ? "relevance" : "date") : undefined}
									rankSkipped={!!pages[0]?.rankSkipped}
									onOrder={(next) => setSearchText(withOrder(search, next, next === "relevance" && !!pages[0]?.rankSkipped))}
									scheduled={scheduled}
									onCancelScheduled={async (s) => {
										try {
											await api.cancelScheduled(s.mailboxId, s.emailId);
											queryClient.invalidateQueries({ queryKey: ["scheduled"] });
											showToast({ text: "Schedule canceled. The draft stays in Drafts.", icon: <ClockIcon size={ICON} /> });
										} catch (e) {
											showToast({ text: `Could not cancel. ${(e as Error).message}`, icon: <WarningIcon size={ICON} /> });
										}
									}}
									onClearSearch={() => setSearchText("")}
									onHome={() => go({ ...HOME, chips: [] })}
								/>
								<Reader
									row={openRow}
									open={open}
									autoOpened={!!openRow && openRow.thread_key === autoOpenedKey}
									identities={identities}
									info={info}
									addresses={addresses}
									prefs={prefs}
									labels={labels}
									labelsById={labelsById}
									canTrash={canTrash}
									canSpam={canSpam}
									canRestore={canRestore}
									onBack={closeConversation}
									onAction={(a) => act(a, openRow ? [openRow] : null)}
									onLabel={(label, add) => toggleLabel(label, add)}
									onCreateLabel={(name) => newLabel(name, openRow ? [openRow] : undefined)}
									inline={inline}
									onInlineClosed={(message) => {
										setInline(null);
										if (message) showToast({ text: message, icon: message.startsWith("Draft") ? <FileIcon size={ICON} /> : message.startsWith("Scheduled") ? <ClockIcon size={ICON} /> : <PaperPlaneTiltIcon size={ICON} /> });
									}}
									startReply={startReply}
									sender={heldSender}
									onPopOut={(state) => {
										popOut(state, () => openCompose(state));
										setInline(null);
									}}
									onEditSignatures={() => openConsole("signatures")}
									onEditDraft={(draft, askAgent) => open && editDraft(open.mailboxId, draft.id, draft, askAgent)}
									draftWithAgent={draftWithAgent}
									stopAgent={stopAgent}
									replyRequest={replyRequest}
									labelRequest={labelRequest}
									onUnsubscribe={unsubscribeFrom}
									isBlocked={isBlocked}
									onBlock={blockSender}
								/>
							</main>
						</div>
						</>
					)}
					{mobile && <div className="pg-drawer-scrim" data-side="right" data-open={panelShown} onClick={() => setPanelTemp(false)} aria-hidden />}
					<div className="pg-side" data-side="right" data-mode={sideMode} data-open={panelShown}>
						{!mobile && <AgentRail onOpen={togglePanel} busy={agentBusy} inert={panelShown && !narrow} />}
						{agentMounted && (
							<AgentPanel
								open={open}
								reading={open ? openRow?.subject ?? openEmail?.subject ?? "" : null}
								onCollapse={togglePanel}
								overlay={!mobile && narrow}
								inert={!panelShown}
								prefill={prefill}
								onOpenDraft={(mailboxId, draftId) => editDraft(mailboxId, draftId)}
								onBusy={setAgentBusy}
							/>
						)}
					</div>
				</div>
				{cw && (
					<Composer
						key={cw.key}
						variant="floating"
						initial={cw.initial}
						maximised={cw.max}
						lockFrom={prefs.replyFrom}
						onEditSignatures={() => openConsole("signatures")}
						addresses={addresses}
						identities={identities}
						info={info}
						sender={heldSender}
						draftWithAgent={draftWithAgent}
						stopAgent={stopAgent}
						onClosed={(message) => {
							// The open draft is gone once it is sent, scheduled anew or discarded.
							if (open && cw.initial.draftId === open.emailId && message && !message.startsWith("Draft saved")) closeConversation();
							setCw(null);
							if (message) showToast({ text: message, icon: message.startsWith("Scheduled") ? <ClockIcon size={ICON} /> : message.startsWith("Draft") ? <FileIcon size={ICON} /> : <PaperPlaneTiltIcon size={ICON} /> });
						}}
						onPopOut={(state) => {
							if (popOut(state, () => setCw({ key: Date.now(), initial: state }))) setCw(null);
						}}
					/>
				)}
				{draftRunner}
				<Toast toast={toast} onClose={closeToast} />
				{modal === "logout" && <LogoutModal onClose={() => setModal(null)} />}
				{helpOpen && (
					<ShortcutsModal
						onClose={() => setHelpOpen(false)}
						onEdit={() => {
							setHelpOpen(false);
							openConsole("shortcuts");
						}}
					/>
				)}
			</div>
		</ShortcutsProvider>
	);
}
