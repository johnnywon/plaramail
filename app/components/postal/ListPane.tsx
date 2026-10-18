// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import {
	ArchiveIcon, ArrowsClockwiseIcon, CaretDownIcon, CaretRightIcon, CheckIcon, ClockIcon, EnvelopeOpenIcon, EnvelopeSimpleIcon,
	FileIcon, FunnelSimpleIcon, MagnifyingGlassIcon, PaperclipIcon, PaperPlaneTiltIcon, PencilSimpleLineIcon, SortAscendingIcon,
	SortDescendingIcon, StarIcon, TrashIcon, TrayArrowUpIcon, TrayIcon, WarningIcon, WarningOctagonIcon, XIcon,
} from "@phosphor-icons/react";
import { Fragment, useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { MailFilter } from "~/lib/mail-filter";
import type { Conversation, Label, MailFacets, ScheduledSend } from "~/services/api";
import { AddressText, type Identities, LabelTag, Swatch } from "./identity";
import { toSearch, VIEW_LABELS } from "~/lib/mail-filter";
import { ADDRESS_FOLDERS, ALL_FOLDERS, AllAddressesIcon, InboxIcon, VIEW_ICONS } from "./NavIcons";
import { Keys, useShortcuts } from "./shortcuts";
import { marks, snippetMarkup } from "./search-window";
import { rowSender } from "./row-sender";
import { dayKey, dayLabel, filterCount, hasChip, labelOf, type MailAction, RESTORABLE, scoped, scopeOf, sendTimeLabel, timeLabel, toggleChip, withoutKinds } from "./model";

export interface ListPaneProps {
	identities: Identities;
	filter: MailFilter;
	go: (filter: MailFilter) => void;
	searching: boolean;
	/** The search in the URL, kept in each row's link. */
	search: string;
	allUnread?: number;
	unreadByAddress: ReadonlyMap<string, number>;
	onNew: () => void;
	onRefresh: () => void;
	refreshing: boolean;
	facets?: MailFacets;
	onFacets: (open: boolean) => void;
	labels: Label[];
	labelsById: ReadonlyMap<string, Label>;
	rows: Conversation[];
	total: number;
	loading: boolean;
	error: Error | null;
	onRetry: () => void;
	hasNextPage: boolean;
	fetchingNext: boolean;
	fetchNext: () => void;
	currentKey: string | null;
	onOpen: (row: Conversation) => void;
	checked: ReadonlySet<string>;
	onCheck: (row: Conversation, range: boolean) => void;
	onSelectAll: () => void;
	onClearSelection: () => void;
	onRowAction: (row: Conversation, action: MailAction) => void;
	onBulk: (action: MailAction) => void;
	onEmptyTrash: () => void;
	terms: string[];
	/** How the server ordered a search, when it can rank (D1); else undefined. */
	order?: "relevance" | "date";
	rankSkipped?: boolean;
	onOrder: (order: "relevance" | "date") => void;
	scheduled: ReadonlyMap<string, ScheduledSend>;
	onCancelScheduled: (s: ScheduledSend) => void;
	onClearSearch: () => void;
	onHome: () => void;
}

const EMPTY: Record<string, { Icon: typeof TrayIcon; title: string }> = {
	drafts: { Icon: FileIcon, title: "No drafts" },
	sent: { Icon: PaperPlaneTiltIcon, title: "Nothing sent yet" },
	archive: { Icon: ArchiveIcon, title: "Archive is empty" },
	spam: { Icon: WarningIcon, title: "No spam" },
	trash: { Icon: TrashIcon, title: "Trash is empty" },
	starred: { Icon: StarIcon, title: "No starred mail" },
};

/** Whether the main pointer can hover. Then the row toolbar waits for it and the selecting check is only a picture. */
function useCanHover(): boolean {
	return useSyncExternalStore(
		(change) => {
			const query = window.matchMedia("(hover: hover)");
			query.addEventListener("change", change);
			return () => query.removeEventListener("change", change);
		},
		() => window.matchMedia("(hover: hover)").matches,
		() => false,
	);
}

function Highlighted({ text, terms }: { text: string; terms: string[] }) {
	return <>{marks(text, terms).map((p, i) => (p.mark ? <mark key={i}>{p.text}</mark> : p.text))}</>;
}

export function ListPane(props: ListPaneProps) {
	const { identities, filter, go, rows } = props;
	const { tip } = useShortcuts();
	const canHover = useCanHover();
	const scope = scopeOf(filter);
	const labelView = labelOf(filter);
	const [scopeOpen, setScopeOpen] = useState(false);
	const [folderOpen, setFolderOpen] = useState(false);
	const [fltOpen, setFltOpen] = useState(false);
	const sentinel = useRef<HTMLDivElement>(null);
	const listRef = useRef<HTMLDivElement>(null);
	const unreadOnly = hasChip(filter, "is", "unread");
	const nFilters = filterCount(filter);

	useEffect(() => props.onFacets(fltOpen), [fltOpen]); // eslint-disable-line react-hooks/exhaustive-deps

	// Load the next page when the end of the list scrolls into view.
	useEffect(() => {
		const el = sentinel.current;
		if (!el || !props.hasNextPage) return;
		const io = new IntersectionObserver((entries) => {
			if (entries.some((e) => e.isIntersecting) && !props.fetchingNext) props.fetchNext();
		}, { root: listRef.current, rootMargin: "400px" });
		io.observe(el);
		return () => io.disconnect();
	}, [props.hasNextPage, props.fetchingNext, props.fetchNext]); // eslint-disable-line react-hooks/exhaustive-deps

	// Keep the open row in view as j/k move.
	useEffect(() => {
		if (!props.currentKey || !listRef.current) return;
		const el = listRef.current.querySelector<HTMLElement>(`[data-key="${CSS.escape(props.currentKey)}"]`);
		el?.scrollIntoView({ block: "nearest" });
	}, [props.currentKey]);

	// The address and the folder are one unit: the folder menu lists what the sidebar shows under
	// the picked address, and switching address keeps the folder when the new one has it.
	const foldersOf = (value: string | null) => (value ? ADDRESS_FOLDERS : ALL_FOLDERS);
	const pickScope = (value: string | null) => {
		setScopeOpen(false);
		const keep = !labelView && foldersOf(value).some((f) => f.view === filter.view);
		go(scoped(keep ? filter.view : "inbox", value, filter));
	};

	// The header reads which addresses (as a mark), then which folder (or label), each with its own icon.
	const scopeIcon = scope ? <Swatch identity={identities.of(scope)} /> : <AllAddressesIcon size={14} />;
	const FolderIcon = VIEW_ICONS[filter.view] ?? InboxIcon;
	const folderIcon = labelView ? <LabelTag id={labelView} /> : <FolderIcon size={14} />;
	const folderName = labelView ? props.labelsById.get(labelView)?.name ?? "Label" : VIEW_LABELS[filter.view] ?? filter.view;

	const status = props.facets?.status;
	const labelFacet = new Map((props.facets?.label ?? []).map((f) => [f.value, f.count]));
	const dateChip = filter.chips.find((c) => c.kind === "date")?.value ?? "any";
	const setDate = (value: string) => {
		const base = withoutKinds(filter, ["date"]);
		go(value === "any" ? base : { ...base, chips: [...base.chips, { kind: "date", value }] });
	};
	const clearFilters = () => {
		const keep = filter.chips.filter((c, i) => {
			if (c.kind === "is" && c.value === "unread") return true;
			if (c.kind === "label" && labelView === c.value && i === 0) return true;
			return !["is", "has", "label", "date"].includes(c.kind);
		});
		go({ ...filter, chips: keep });
	};

	const empty = props.searching
		? { Icon: MagnifyingGlassIcon, title: "No results" }
		: EMPTY[filter.view] ?? (unreadOnly
			? { Icon: TrayIcon, title: "No unread mail" }
			: { Icon: TrayIcon, title: "Nothing here" });

	let lastDay: string | null = null;
	const groupByDay = filter.sort === "date";
	const selecting = props.checked.size > 0;

	return (
		<section className="pg-list-col" aria-label="Conversations">
			<div className="pg-list-head">
				<button type="button" className="pg-scope-btn" onClick={() => setScopeOpen((v) => !v)} title={`Switch address · ${scope ?? "All addresses"}`} aria-label={`Address, ${scope ?? "All addresses"}`} aria-expanded={scopeOpen} aria-haspopup="listbox">
					<span className="pg-scope-icon">{scopeIcon}</span>
					<CaretDownIcon size={10} weight="bold" color="var(--pg-text-6)" style={{ flex: "none" }} />
				</button>
				<CaretRightIcon className="pg-crumb-sep" size={10} weight="bold" aria-hidden />
				{/* The folder is also a menu of its peers: every folder for this address, then the labels. No caret. */}
				<button type="button" className="pg-folder" onClick={() => setFolderOpen((v) => !v)} title="Switch folder" aria-expanded={folderOpen} aria-haspopup="listbox">
					<span className="pg-scope-icon">{folderIcon}</span>
					<span className="pg-title">{folderName}{props.searching && <span className="pg-title-note"> · search</span>}</span>
				</button>
				{folderOpen && (
					<>
						<div className="pg-scrim-click" onClick={() => setFolderOpen(false)} />
						<div className="pg-popover pg-scope-menu pg-folder-menu" role="listbox" aria-label="Folder">
							{foldersOf(scope).map(({ view, label, Icon }) => {
								const on = !labelView && filter.view === view;
								return (
									<button key={view} type="button" role="option" aria-selected={on} aria-current={on || undefined} className="pg-menu-item" onClick={() => { setFolderOpen(false); go(scoped(view, scope, filter)); }}>
										<Icon size={14} />
										<span className="pg-flex pg-ellipsis">{label}</span>
										{on && <CheckIcon size={12} weight="bold" />}
									</button>
								);
							})}
							{/* Labels sit under All addresses in the sidebar, so only its menu lists them. */}
							{!scope && props.labels.length > 0 && <div className="pg-menu-rule" />}
							{!scope && props.labels.map((label) => {
								const on = labelView === label.id;
								return (
									<button key={label.id} type="button" role="option" aria-selected={on} aria-current={on || undefined} className="pg-menu-item" onClick={() => { setFolderOpen(false); go({ view: "all", chips: [{ kind: "label", value: label.id }], sort: filter.sort, dir: filter.dir }); }}>
										<LabelTag id={label.id} />
										<span className="pg-flex pg-ellipsis">{label.name}</span>
										{on && <CheckIcon size={12} weight="bold" />}
									</button>
								);
							})}
						</div>
					</>
				)}
				{scopeOpen && (
					<>
						<div className="pg-scrim-click" onClick={() => setScopeOpen(false)} />
						<div className="pg-popover pg-scope-menu" role="listbox" aria-label="Address">
							<button type="button" role="option" aria-selected={!scope} className="pg-menu-item" aria-current={!scope || undefined} onClick={() => pickScope(null)}>
								<AllAddressesIcon size={14} />
								<span className="pg-flex pg-ellipsis" style={{ fontWeight: 500, color: "var(--pg-text-2)" }}>All addresses</span>
								<span className="pg-count" style={{ fontWeight: 400 }}>{props.allUnread || ""}</span>
								{!scope && <CheckIcon size={12} weight="bold" />}
							</button>
							{identities.groups.map(({ identity, addresses }) => (
								<Fragment key={identity.domain}>
									<button type="button" role="option" aria-selected={scope === identity.domain} className="pg-menu-item" aria-current={scope === identity.domain || undefined} onClick={() => pickScope(identity.domain)}>
										<Swatch identity={identity} />
										<span className="pg-flex pg-ellipsis" style={{ fontWeight: 500, color: "var(--pg-text-3)" }}>{identity.domain}</span>
										<span className="pg-count" style={{ fontWeight: 400 }}>
											{[...props.unreadByAddress.entries()].reduce((s, [a, n]) => (a.endsWith(`@${identity.domain}`) ? s + n : s), 0) || ""}
										</span>
										{scope === identity.domain && <CheckIcon size={12} weight="bold" />}
									</button>
									{addresses.map((address) => (
										<button key={address} type="button" role="option" aria-selected={scope === address} className="pg-menu-item" style={{ paddingLeft: 27 }} aria-current={scope === address || undefined} onClick={() => pickScope(address)}>
											<span className="pg-flex pg-ellipsis"><AddressText address={address} identity={identity} bold={false} /></span>
											<span className="pg-count" style={{ fontWeight: 400 }}>{props.unreadByAddress.get(address) || ""}</span>
											{scope === address && <CheckIcon size={12} weight="bold" />}
										</button>
									))}
								</Fragment>
							))}
						</div>
					</>
				)}
				<div style={{ flex: 1, minWidth: 4 }} />
				{filter.view === "trash" && props.rows.length > 0 && (
					<button type="button" className="pg-btn pg-btn-sm pg-btn-outline" onClick={props.onEmptyTrash} title="Delete everything in Trash forever">Empty Trash</button>
				)}
				<button type="button" className="pg-new-btn" onClick={props.onNew} title={tip("compose", "New message")} aria-label="New message">
					<PencilSimpleLineIcon size={16} />
				</button>
				<div className="pg-group">
					<button
						type="button"
						className="pg-icon-btn"
						aria-pressed={unreadOnly}
						title={unreadOnly ? "Showing unread only — show all" : "Show unread only"}
						onClick={() => go(toggleChip(filter, { kind: "is", value: "unread" }))}
					>
						<EnvelopeSimpleIcon size={16} weight={unreadOnly ? "fill" : "regular"} />
					</button>
					<button type="button" className="pg-icon-btn" style={{ position: "relative" }} aria-pressed={nFilters > 0} aria-expanded={fltOpen} aria-label={nFilters ? `Filter, ${nFilters} on` : "Filter"} title="Filter" onClick={() => setFltOpen((v) => !v)}>
						<FunnelSimpleIcon size={16} weight={nFilters ? "fill" : "regular"} />
						{nFilters > 0 && <span className="pg-flt-badge">{nFilters}</span>}
					</button>
					<button
						type="button"
						className="pg-icon-btn pg-wide-only"
						title={filter.dir === "asc" ? "Oldest first" : "Newest first"}
						onClick={() => go({ ...filter, sort: "date", dir: filter.dir === "asc" ? "desc" : "asc" })}
					>
						{filter.dir === "asc" ? <SortAscendingIcon size={16} /> : <SortDescendingIcon size={16} />}
					</button>
					<button type="button" className="pg-icon-btn pg-wide-only" title="Refresh" aria-label="Refresh" onClick={props.onRefresh} disabled={props.refreshing}>
						<ArrowsClockwiseIcon size={16} />
					</button>
				</div>
				{fltOpen && (
					<>
						<div className="pg-scrim-click" onClick={() => setFltOpen(false)} />
						<div className="pg-popover pg-flt-menu" role="dialog" aria-label="Filter" data-mail-popover>
							<div className="pg-flt-scroll">
								<span className="pg-caption">STATUS</span>
								{([
									["is", "unread", "Unread", EnvelopeSimpleIcon, status?.unread],
									["is", "starred", "Starred", StarIcon, status?.starred],
									["has", "attachment", "Has attachment", PaperclipIcon, status?.attachment],
								] as const).map(([kind, value, label, Icon, n]) => {
									const on = hasChip(filter, kind, value);
									return (
										<button key={value} type="button" role="menuitemcheckbox" aria-checked={on} aria-label={n == null ? label : `${label}, ${n}`} className="pg-menu-item" onClick={() => go(toggleChip(filter, { kind, value }))}>
											<span className="pg-check pg-check-neutral" data-on={on}>{on && <CheckIcon size={10} weight="bold" />}</span>
											<Icon size={14} color="var(--pg-text-6)" style={{ flex: "none" }} />
											<span className="pg-flex pg-ellipsis">{label}</span>
											<span className="pg-count" style={{ fontWeight: 400 }}>{n ?? ""}</span>
										</button>
									);
								})}
								{/* TODO(roadmap): "Needs you" status and the "Handled by rule" section return with rules. */}
								{props.labels.length > 0 && <span className="pg-caption">LABELS</span>}
								{props.labels.map((label) => {
									const on = hasChip(filter, "label", label.id);
									return (
										<button key={label.id} type="button" role="menuitemcheckbox" aria-checked={on} aria-label={labelFacet.has(label.id) ? `${label.name}, ${labelFacet.get(label.id)}` : label.name} className="pg-menu-item" onClick={() => go(toggleChip(filter, { kind: "label", value: label.id }))}>
											<span className="pg-check pg-check-neutral" data-on={on}>{on && <CheckIcon size={10} weight="bold" />}</span>
											<LabelTag id={label.id} />
											<span className="pg-flex pg-ellipsis">{label.name}</span>
											<span className="pg-count" style={{ fontWeight: 400 }}>{labelFacet.get(label.id) ?? ""}</span>
										</button>
									);
								})}
								<span className="pg-caption">RECEIVED</span>
								<div className="pg-flt-dates" role="radiogroup" aria-label="Received">
									{([["any", "Any"], ["today", "Today"], ["7d", "7 days"], ["30d", "30 days"]] as const).map(([value, label]) => (
										<button key={value} type="button" role="radio" aria-checked={dateChip === value} onClick={() => setDate(value)}>{label}</button>
									))}
								</div>
							</div>
							<div className="pg-flt-foot">
								<span className="pg-match">{props.total.toLocaleString()} match{props.total === 1 ? "" : "es"}</span>
								<button type="button" className="pg-btn pg-btn-sm pg-btn-quiet" onClick={clearFilters}>Clear</button>
								<button type="button" className="pg-btn pg-btn-sm" style={{ fontWeight: 600, background: "var(--pg-hover-raised)" }} onClick={() => setFltOpen(false)}>Done</button>
							</div>
						</div>
					</>
				)}
			</div>
			{props.searching && props.order && !props.loading && rows.length > 0 && (
				<div className="pg-order">
					<span>{props.rankSkipped ? "Too many matches to rank. Newest first." : props.order === "relevance" ? "Best match first" : "Newest first"}</span>
					<span className="pg-flex" />
					<div className="pg-segmented" role="radiogroup" aria-label="Order">
						<button type="button" role="radio" aria-checked={props.order === "relevance"} onClick={() => props.onOrder("relevance")}>Relevance</button>
						<button type="button" role="radio" aria-checked={props.order === "date"} onClick={() => props.onOrder("date")}>Newest</button>
					</div>
				</div>
			)}
			<div className="pg-list" ref={listRef} data-selecting={selecting}>
				{props.loading && Array.from({ length: 6 }, (_, i) => (
					<div key={i} className="pg-skel" aria-hidden>
						<div style={{ width: 64, flex: "none", display: "flex", flexDirection: "column", gap: 6 }}>
							<span className="pg-pulse" style={{ width: 40 }} />
							<span style={{ width: 30 }} />
						</div>
						<div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 7 }}>
							<span className="pg-pulse" style={{ width: "45%" }} />
							<span className="pg-pulse" style={{ width: "80%", height: 9 }} />
							<span style={{ width: "95%" }} />
						</div>
					</div>
				))}
				{!props.loading && props.error && (
					<div className="pg-empty">
						<div className="pg-empty-icon"><WarningIcon size={20} /></div>
						<h2>Could not load mail</h2>
						<p>{props.error.message}</p>
						<button type="button" className="pg-btn" onClick={props.onRetry}>Retry</button>
					</div>
				)}
				{!props.loading && !props.error && rows.length === 0 && (
					<div className="pg-empty">
						<div className="pg-empty-icon"><empty.Icon size={20} /></div>
						<h2>{empty.title}</h2>
						<button type="button" className="pg-btn" onClick={props.searching ? props.onClearSearch : props.onHome}>
							{props.searching ? "Clear search" : "Back to Inbox"}
							{!props.searching && <Keys id="goInbox" className="pg-keyhint pg-mono" style={{ fontSize: 10, color: "var(--pg-text-8)" }} />}
						</button>
					</div>
				)}
				{/* Each conversation is a list item whose subject links to it, so agents read its parts and its URL. The whole row still opens it. */}
				{!props.loading && rows.length > 0 && <div role="list">{rows.map((row) => {
					const day = dayKey(row.date);
					const dayStart = day !== lastDay;
					const gap = groupByDay && dayStart && lastDay !== null;
					lastDay = day;
					const checked = props.checked.has(row.thread_key);
					const sched = row.state === "draft" ? props.scheduled.get(row.email_id) : undefined;
					const identity = identities.of(row.mailbox_id);
					const rowLabels = row.labels.map((id) => props.labelsById.get(id)).filter((l): l is Label => !!l);
					const unread = row.unread && row.state !== "draft";
					const open = (e: React.MouseEvent) => {
						if (e.shiftKey && selecting) props.onCheck(row, true);
						else props.onOpen(row);
					};
					return (
						<Fragment key={row.thread_key}>
							{gap && <div className="pg-gap" aria-hidden />}
							<div
								className="pg-row"
								role="listitem"
								data-key={row.thread_key}
								data-unread={unread}
								data-checked={checked || undefined}
								aria-current={props.currentKey === row.thread_key || undefined}
								onClick={(e) => {
									if (!(e.target as Element).closest("a, button")) open(e);
								}}
							>
								{unread && <span className="pg-sr">Unread</span>}
								<div className="pg-row-when">
									<span className={groupByDay && dayStart ? "pg-day-first" : undefined}>{dayLabel(row.date)}</span>
									<span>{timeLabel(row.date)}</span>
									{(row.match_count ?? 0) > 1 && <span className="pg-row-matches" title={`${row.match_count} messages in this conversation match`}>{row.match_count} matches</span>}
									<div className="pg-spacer" />
									<div className="pg-row-glyphs">
										{row.starred && <StarIcon size={12} weight="fill" className="pg-star" aria-label="Starred" />}
										{row.has_attachment && <PaperclipIcon size={12} aria-label="Attachment" />}
										{rowLabels.map((l) => (
											<span key={l.id} className="pg-row-label" title={l.name} role="img" aria-label={`${l.name} label`}><LabelTag id={l.id} size={12} /></span>
										))}
									</div>
								</div>
								<div className="pg-row-main">
									{/* Inside one address every row would repeat it, so the To line only shows when it tells rows apart. */}
									{(scope !== row.mailbox_id || row.also_in.length > 0) && (
										<div className="pg-row-to" title={`Delivered to ${row.mailbox_id} · Replies send from here`}>
											<Swatch identity={identity} />
											<AddressText address={row.mailbox_id} identity={identity} />
											{row.also_in.length > 0 && <span className="pg-also">+{row.also_in.length}</span>}
										</div>
									)}
									<RowSenderLine row={row} />
									<div className="pg-row-subject">
										<a
											className="pg-row-link"
											href={toSearch(filter, { mailboxId: row.mailbox_id, emailId: row.email_id }, props.search)}
											onClick={(e) => {
												// Cmd or Ctrl opens it in a new tab like any link.
												if (e.metaKey || e.ctrlKey || e.altKey) return;
												e.preventDefault();
												open(e);
											}}
										>
											<Highlighted text={row.subject || "(no subject)"} terms={props.terms} />
										</a>
									</div>
									{snippetMarkup(row.snippet_html) !== null
										? <div className="pg-row-preview" dangerouslySetInnerHTML={{ __html: snippetMarkup(row.snippet_html)! }} />
										: row.snippet && <div className="pg-row-preview"><Highlighted text={row.snippet} terms={props.terms} /></div>}
									{/* TODO(roadmap): rule chips on rows (Inquiry, Receipts, DMARC, Triage with their icons) return with rules. */}
									{sched && (
										<div className="pg-row-labels">
											{sched && (
												<span className="pg-row-badge" data-error={!!sched.error || undefined} title={sched.error ?? undefined} onClick={(e) => e.stopPropagation()}>
													<ClockIcon size={10} />
													{sched.error ? "Send failed" : `Scheduled · ${sendTimeLabel(new Date(sched.sendAt))}`}
													<button type="button" aria-label="Cancel scheduled send" onClick={() => props.onCancelScheduled(sched)}>Cancel</button>
												</span>
											)}
										</div>
									)}
								</div>
								{/* Select stays first: with a mouse, it's the one button kept in the accessibility tree while the toolbar waits for hover. */}
								<div className="pg-row-tools" onClick={(e) => e.stopPropagation()}>
									<button type="button" title={tip("select", "Select", "shift-click for a range")} aria-label="Select" role="checkbox" aria-checked={checked} onClick={(e) => props.onCheck(row, e.shiftKey)}>
										<span className="pg-check" data-on={checked}>{checked && <CheckIcon size={10} weight="bold" />}</span>
									</button>
									<span className="pg-sep" />
									{RESTORABLE.has(filter.view) && (
										<button type="button" title="Move to Inbox" aria-label="Move to Inbox" onClick={() => props.onRowAction(row, "restore")}><TrayArrowUpIcon size={15} /></button>
									)}
									<button type="button" title={tip("archive", "Archive")} aria-label="Archive" onClick={() => props.onRowAction(row, "archive")}><ArchiveIcon size={15} /></button>
									<button type="button" title={row.starred ? "Unstar" : "Star"} aria-label={row.starred ? "Unstar" : "Star"} onClick={() => props.onRowAction(row, "star")}>
										<StarIcon size={15} weight={row.starred ? "fill" : "regular"} />
									</button>
									<button type="button" title={row.unread ? "Mark read" : "Mark unread"} aria-label={row.unread ? "Mark read" : "Mark unread"} onClick={() => props.onRowAction(row, "read")}>
										{row.unread ? <EnvelopeOpenIcon size={15} /> : <EnvelopeSimpleIcon size={15} />}
									</button>
									{filter.view !== "trash" && (
										<button type="button" title="Move to Trash" aria-label="Move to Trash" onClick={() => props.onRowAction(row, "trash")}><TrashIcon size={15} /></button>
									)}
								</div>
								{/* With a mouse, hover always brings up the toolbar's Select first, so this check is only a picture. */}
								<div className="pg-row-checkonly" aria-hidden={canHover || undefined} onClick={(e) => e.stopPropagation()}>
									<button type="button" tabIndex={canHover ? -1 : undefined} title={tip("select", "Select", "shift-click for a range")} aria-label="Select" role="checkbox" aria-checked={checked} onClick={(e) => props.onCheck(row, e.shiftKey)}>
										<span className="pg-check" data-on={checked}>{checked && <CheckIcon size={10} weight="bold" />}</span>
									</button>
								</div>
							</div>
						</Fragment>
					);
				})}</div>}
				{props.hasNextPage && <div ref={sentinel} className="pg-more">{props.fetchingNext ? <span className="pg-count">Loading…</span> : null}</div>}
				{selecting && (
					<div className="pg-bulk">
						<div className="pg-bulk-bar" role="toolbar" aria-label="Selected conversations">
							<span className="pg-sel-count">{props.checked.size} selected</span>
							<button type="button" className="pg-all" onClick={props.onSelectAll}>All</button>
							<div style={{ flex: 1 }} />
							{RESTORABLE.has(filter.view) && <button type="button" className="pg-tool" title="Move to Inbox" aria-label="Move to Inbox" onClick={() => props.onBulk("restore")}><TrayArrowUpIcon size={15} /></button>}
							<button type="button" className="pg-tool" title={tip("archive", "Archive")} aria-label="Archive" onClick={() => props.onBulk("archive")}><ArchiveIcon size={15} /></button>
							<button type="button" className="pg-tool" title={tip("markRead", "Mark read")} aria-label="Mark read" onClick={() => props.onBulk("read")}><EnvelopeOpenIcon size={15} /></button>
							<button type="button" className="pg-tool" title={tip("star", "Star")} aria-label="Star" onClick={() => props.onBulk("star")}><StarIcon size={15} /></button>
							{filter.view !== "trash" && <button type="button" className="pg-tool" title={tip("trash", "Move to Trash")} aria-label="Move to Trash" onClick={() => props.onBulk("trash")}><TrashIcon size={15} /></button>}
							{filter.view !== "spam" && <button type="button" className="pg-tool" title={tip("spam", "Report spam")} aria-label="Report spam" onClick={() => props.onBulk("spam")}><WarningOctagonIcon size={15} /></button>}
							<span className="pg-sep" />
							<button type="button" className="pg-tool" title={tip("back", "Clear selection")} aria-label="Clear selection" onClick={props.onClearSelection} style={{ color: "var(--pg-text-6)" }}><XIcon size={14} /></button>
						</div>
					</div>
				)}
			</div>
		</section>
	);
}

/** The sender, or for sent mail "To" and the first recipient. */
function RowSenderLine({ row }: { row: Conversation }) {
	const who = rowSender(row);
	return (
		<div className="pg-row-sender">
			{who.to && <span className="pg-row-sender-to">To </span>}
			{who.text}
			{who.more ? <span className="pg-row-sender-more"> +{who.more}</span> : null}
		</div>
	);
}
