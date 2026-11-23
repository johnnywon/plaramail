// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import {
	ArrowCounterClockwiseIcon,
	BookmarkSimpleIcon,
	CalendarBlankIcon,
	ClockCounterClockwiseIcon,
	EnvelopeSimpleIcon,
	GlobeIcon,
	MagnifyingGlassIcon,
	PaperclipIcon,
	StarIcon,
	TagIcon,
	TextAaIcon,
	UserIcon,
	XIcon,
} from "@phosphor-icons/react";
import { AgentIcon } from "./AgentIcon";
import { useShortcuts } from "./shortcuts";
import { OPERATOR_HELP, OPERATORS } from "../../../shared/search-query";
import type { Conversation } from "~/services/api";
import { AddressText, type Identities, Swatch } from "./identity";
import { dayLabel, timeLabel } from "./model";
import { marks, snippetMarkup } from "./search-window";
import type { Completion } from "./search-window";

export interface FilterSuggestion {
	token: string;
	desc: string;
	icon: "unread" | "starred" | "attachment" | "label" | "from";
	count?: number;
}

const FILTER_ICONS = { unread: EnvelopeSimpleIcon, starred: StarIcon, attachment: PaperclipIcon, label: TagIcon, from: UserIcon };
const ACTION_ICONS = { ask: AgentIcon, everywhere: GlobeIcon, remove: ArrowCounterClockwiseIcon, search: MagnifyingGlassIcon, spell: TextAaIcon };

/** One row of the window. `choose` runs on ↵ or a click. */
export type WindowRow = { id: string; choose: () => void } & (
	| { kind: "completion"; completion: Completion }
	| { kind: "result"; row: Conversation }
	| { kind: "filter"; filter: FilterSuggestion }
	| { kind: "address"; address: string; count?: number }
	| { kind: "person"; address: string; name?: string; count: number }
	| { kind: "recent"; text: string; remove: () => void }
	| { kind: "saved"; name: string; query: string; count?: number | null; remove: () => void }
	| { kind: "date"; label: string; onPick: (day: string) => void; onCancel: () => void }
	| { kind: "action"; icon: keyof typeof ACTION_ICONS; label: string; detail?: string }
);

export interface WindowSection {
	id: string;
	title: string;
	rows: WindowRow[];
	/** The wide column, or the narrow one beside it. Below 768px there is one column. */
	side?: boolean;
}

export const rowDomId = (id: string) => `pg-sw-${id.replace(/[^\w-]/g, "_")}`;

export interface SearchWindowProps {
	/** Closed, the window stays mounted for its motion, inert. */
	open: boolean;
	sections: WindowSection[];
	active: string | null;
	terms: string[];
	identities: Identities;
	/** Results are for an older version of the text. */
	stale: boolean;
	help: boolean;
	onHelp: (open: boolean) => void;
	/** Save the search in the box; null when there is nothing to save, "saved" when it already is. */
	save: (() => void) | "saved" | null;
	onHover: (id: string) => void;
}

function Marked({ text, terms }: { text: string; terms: string[] }) {
	return <>{marks(text, terms).map((p, i) => (p.mark ? <mark key={i}>{p.text}</mark> : p.text))}</>;
}

/** A row's accessible name: its parts joined with ", ", so agents and screen readers don't read "Inkwell Print Co.1". */
export function rowLabel(row: WindowRow): string {
	const n = (count: number | null | undefined) => (count == null ? "" : count.toLocaleString());
	const parts = (() => {
		switch (row.kind) {
			case "completion": return [row.completion.label, row.completion.detail, n(row.completion.count)];
			case "result": {
				const r = row.row;
				const today = new Date(r.date).toDateString() === new Date().toDateString();
				return [r.sender_name || r.sender_addr, today ? timeLabel(r.date) : dayLabel(r.date), r.subject || "(no subject)"];
			}
			case "filter": return [row.filter.desc, row.filter.token, n(row.filter.count)];
			case "address": return [row.address, row.count ? n(row.count) : ""];
			case "person": return [row.name, row.address, n(row.count)];
			case "recent": return [row.text];
			case "saved": return [row.name, row.name !== row.query ? row.query : "", n(row.count)];
			case "date": return [row.label];
			case "action": return [row.label, row.detail];
		}
	})();
	return parts.filter((p) => p && String(p).trim()).join(", ");
}

function RowBody({ row, terms, identities }: { row: WindowRow; terms: string[]; identities: Identities }) {
	switch (row.kind) {
		case "completion":
			return (
				<>
					<span className="pg-sw-token pg-ellipsis">{row.completion.label}</span>
					<span className="pg-flex pg-ellipsis pg-sw-detail">{row.completion.detail ?? ""}</span>
					{row.completion.count !== undefined && <span className="pg-count">{row.completion.count.toLocaleString()}</span>}
				</>
			);
		case "result": {
			const r = row.row;
			const today = new Date(r.date).toDateString() === new Date().toDateString();
			return (
				<>
					<Swatch identity={identities.of(r.mailbox_id)} />
					<span className="pg-sw-result">
						<span className="pg-sw-result-top">
							<span className="pg-sw-sender pg-ellipsis" data-unread={r.unread}><Marked text={r.sender_name || r.sender_addr} terms={terms} /></span>
							<span className="pg-sw-date">{today ? timeLabel(r.date) : dayLabel(r.date)}</span>
						</span>
						<span className="pg-sw-subject pg-ellipsis"><Marked text={r.subject || "(no subject)"} terms={terms} /></span>
						{snippetMarkup(r.snippet_html) !== null
							? <span className="pg-sw-snippet pg-ellipsis" dangerouslySetInnerHTML={{ __html: snippetMarkup(r.snippet_html)! }} />
							: <span className="pg-sw-snippet pg-ellipsis"><Marked text={r.snippet} terms={terms} /></span>}
					</span>
				</>
			);
		}
		case "filter": {
			const Icon = FILTER_ICONS[row.filter.icon];
			return (
				<>
					<Icon size={14} className="pg-sw-icon" />
					<span className="pg-flex pg-ellipsis">{row.filter.desc}</span>
					<span className="pg-token">{row.filter.token}</span>
					<span className="pg-count">{row.filter.count === undefined ? "" : row.filter.count.toLocaleString()}</span>
				</>
			);
		}
		case "address": {
			const identity = identities.of(row.address);
			return (
				<>
					<Swatch identity={identity} />
					<span className="pg-flex pg-ellipsis pg-sw-mono"><AddressText address={row.address} identity={identity} bold={false} /></span>
					<span className="pg-count">{row.count ? row.count.toLocaleString() : ""}</span>
				</>
			);
		}
		case "person":
			return (
				<>
					<UserIcon size={14} className="pg-sw-icon" />
					<span className="pg-flex pg-ellipsis">
						{row.name && <span className="pg-sw-name">{row.name}</span>}
						<span className="pg-sw-mono pg-sw-detail">{row.address}</span>
					</span>
					<span className="pg-count">{row.count.toLocaleString()}</span>
				</>
			);
		case "recent":
			return (
				<>
					<ClockCounterClockwiseIcon size={14} className="pg-sw-icon" />
					<span className="pg-flex pg-ellipsis pg-sw-mono">{row.text}</span>
					<button
						type="button"
						className="pg-sw-remove"
						aria-label={`Remove ${row.text} from recent searches`}
						onMouseDown={(e) => {
							e.preventDefault();
							e.stopPropagation();
							row.remove();
						}}
					>
						<XIcon size={12} />
					</button>
				</>
			);
		case "saved":
			return (
				<>
					<BookmarkSimpleIcon size={14} className="pg-sw-icon" />
					<span className="pg-flex pg-ellipsis">
						<span className="pg-sw-name">{row.name}</span>
						{row.name !== row.query && <span className="pg-sw-mono pg-sw-detail">{row.query}</span>}
					</span>
					<span className="pg-count">{row.count == null ? "" : row.count.toLocaleString()}</span>
					<button
						type="button"
						className="pg-sw-remove"
						aria-label={`Delete saved search ${row.name}`}
						onMouseDown={(e) => {
							e.preventDefault();
							e.stopPropagation();
							row.remove();
						}}
					>
						<XIcon size={12} />
					</button>
				</>
			);
		case "date":
			return (
				<>
					<CalendarBlankIcon size={14} className="pg-sw-icon" />
					<span className="pg-flex pg-ellipsis">{row.label}</span>
					<input
						type="date"
						className="pg-sw-date-input"
						id={`${rowDomId(row.id)}-input`}
						aria-label={row.label}
						onMouseDown={(e) => e.stopPropagation()}
						onKeyDown={(e) => {
							if (e.key === "Escape") {
								e.preventDefault();
								e.stopPropagation();
								row.onCancel();
							} else if (e.key === "Enter" && e.currentTarget.value) {
								e.preventDefault();
								row.onPick(e.currentTarget.value);
							}
						}}
						onChange={(e) => {
							// Typing a year digit by digit passes through years like 0202; wait for a real one.
							const v = e.currentTarget.value;
							if (/^\d{4}-\d{2}-\d{2}$/.test(v) && Number(v.slice(0, 4)) >= 1970) row.onPick(v);
						}}
					/>
				</>
			);
		case "action": {
			const Icon = ACTION_ICONS[row.icon];
			return (
				<>
					<Icon size={14} className="pg-sw-icon" weight={row.icon === "ask" ? "fill" : "regular"} />
					<span className="pg-flex pg-ellipsis">{row.label}</span>
					{row.detail && <span className="pg-token pg-ellipsis">{row.detail}</span>}
				</>
			);
		}
	}
}

function Section({ section, props }: { section: WindowSection; props: SearchWindowProps }) {
	const head = `pg-sw-h-${section.id}`;
	return (
		<div className="pg-sw-section" role="group" aria-labelledby={head} data-kind={section.id}>
			<span className="pg-caption" id={head}>{section.title}</span>
			{section.rows.map((row) => (
				<div
					key={row.id}
					id={rowDomId(row.id)}
					role="option"
					aria-label={rowLabel(row)}
					aria-selected={props.active === row.id}
					data-active={props.active === row.id}
					data-kind={row.kind}
					data-stale={row.kind === "result" && props.stale}
					className="pg-menu-item pg-sw-row"
					onMouseMove={() => props.active !== row.id && props.onHover(row.id)}
					onMouseDown={(e) => {
						e.preventDefault();
						row.choose();
					}}
				>
					<RowBody row={row} terms={props.terms} identities={props.identities} />
				</div>
			))}
		</div>
	);
}

/** The window under the search box. Sections follow what is typed; SearchBar decides which. */
export function SearchWindow(props: SearchWindowProps) {
	const keys = useShortcuts();
	const main = props.sections.filter((s) => !s.side);
	const side = props.sections.filter((s) => s.side);
	return (
		<div className="pg-popover pg-sw" id="pg-sw" role="listbox" aria-label="Search suggestions" data-open={props.open} inert={!props.open}>
			{props.help ? (
				<div className="pg-sw-body pg-sw-help" role="group" aria-label="Search operators">
					<span className="pg-caption">Operators</span>
					<dl>
						{OPERATORS.map((op) => (
							<div key={op}>
								<dt>{op}:</dt>
								<dd>{OPERATOR_HELP[op]}</dd>
							</div>
						))}
						<div><dt>"…"</dt><dd>Exact phrase</dd></div>
						<div><dt>-word</dt><dd>Leave out, also -from:… and other operators</dd></div>
						<div><dt>a OR b</dt><dd>Either one</dd></div>
					</dl>
				</div>
			) : (
				<div className="pg-sw-body" data-columns={side.length > 0 && main.length > 0 ? 2 : 1}>
					{main.length > 0 && <div className="pg-sw-col">{main.map((s) => <Section key={s.id} section={s} props={props} />)}</div>}
					{side.length > 0 && <div className="pg-sw-col">{side.map((s) => <Section key={s.id} section={s} props={props} />)}</div>}
				</div>
			)}
			<div className="pg-sw-foot">
				<span className="pg-keyhint pg-ellipsis">↑↓ move · {keys.text("searchComplete")} complete · {keys.text("searchOpen")} open · {keys.text("searchRun")} search · {keys.text("searchClose")} close</span>
				<span className="pg-flex" />
				{props.save === "saved" && <span className="pg-sw-saved">Saved</span>}
				{typeof props.save === "function" && (
					<button type="button" className="pg-sw-help-btn" onMouseDown={(e) => { e.preventDefault(); (props.save as () => void)(); }}>
						Save search <span className="pg-keyhint">{keys.text("searchSave")}</span>
					</button>
				)}
				<button type="button" className="pg-sw-help-btn" aria-pressed={props.help} onMouseDown={(e) => { e.preventDefault(); props.onHelp(!props.help); }}>
					{props.help ? "Back" : "? Operators"}
				</button>
			</div>
		</div>
	);
}
