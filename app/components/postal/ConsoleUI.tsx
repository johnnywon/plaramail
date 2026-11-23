// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

/**
 * The console's design system. Every console page is built from these elements and their
 * `.pg-ui-*` styles in postal.css; DESIGN.md (Console) lists them and the few one-offs that
 * earn their place. A new kind of element goes here first, then into a page.
 */

import { CheckIcon, CopyIcon, MagnifyingGlassIcon, PencilSimpleIcon, XIcon } from "@phosphor-icons/react";
import type { UseQueryResult } from "@tanstack/react-query";
import { type ButtonHTMLAttributes, type ReactNode, useEffect, useRef, useState } from "react";

export { Modal, Head as DialogHead, Switch } from "./Dialog";
export { Segmented } from "./Segmented";

// ── Page structure ─────────────────────────────────────────────────

/** A page: an optional trail back, the title with its one line, actions on the right, then the content. */
export function Page({ title, icon, sub, trail, actions, children }: {
	title: ReactNode;
	icon?: ReactNode;
	sub?: ReactNode;
	trail?: { label: string; onClick: () => void };
	actions?: ReactNode;
	children: ReactNode;
}) {
	return (
		<div className="pg-ui-page">
			<header className="pg-ui-page-head">
				{trail && <button type="button" className="pg-ui-trail" onClick={trail.onClick}>{trail.label} /</button>}
				<div className="pg-ui-page-row">
					<div className="pg-ui-page-title">
						<h1>{icon}{title}</h1>
						{sub && <p>{sub}</p>}
					</div>
					{actions && <div className="pg-ui-actions">{actions}</div>}
				</div>
			</header>
			{children}
		</div>
	);
}

/** A titled group on a page. The title is the only heading level below the page's. */
export function Section({ title, sub, actions, children }: { title?: ReactNode; sub?: ReactNode; actions?: ReactNode; children: ReactNode }) {
	return (
		<section className="pg-ui-section">
			{(title || actions) && (
				<div className="pg-ui-section-head">
					{title && <h2>{title}</h2>}
					{actions && <div className="pg-ui-actions">{actions}</div>}
				</div>
			)}
			{sub && <p className="pg-ui-lede">{sub}</p>}
			{children}
		</section>
	);
}

/** A sentence of explanation, or a state: loading, empty, an error, a warning, or good news (`ok`, such as zero retention). */
export function Note({ tone = "muted", children }: { tone?: "muted" | "ok" | "error" | "warn"; children: ReactNode }) {
	return <p className="pg-ui-note" data-tone={tone} role={tone === "error" ? "alert" : undefined}>{children}</p>;
}

/** Loading, error and empty for a query, then the content. */
export function Async<T>({ query, empty, isEmpty, children }: {
	query: Pick<UseQueryResult<T>, "isPending" | "error" | "data">;
	empty: string;
	isEmpty?: (data: T) => boolean;
	children: (data: T) => ReactNode;
}) {
	if (query.isPending) return <Note>Loading</Note>;
	if (query.error) return <Note tone="error">{query.error.message}</Note>;
	const data = query.data as T;
	if (data == null || (isEmpty ? isEmpty(data) : Array.isArray(data) && data.length === 0)) return <Note>{empty}</Note>;
	return <>{children(data)}</>;
}

/** The raised, bordered surface that tables, lists and forms sit on. */
export function Panel({ children }: { children: ReactNode }) {
	return <div className="pg-ui-panel">{children}</div>;
}

// ── List and detail ────────────────────────────────────────────────

/**
 * A list column beside a detail column, like mail's list and reader. `picked` says the detail
 * shows something the person chose; below 760px one column shows: the list until a row is picked.
 */
export function Split({ label, title, count, actions, rows, foot, picked, children }: {
	label: string;
	title: ReactNode;
	count?: number;
	actions?: ReactNode;
	rows: ReactNode;
	foot?: ReactNode;
	picked?: boolean;
	children: ReactNode;
}) {
	return (
		<div className="pg-ui-split" data-picked={picked || undefined}>
			<section className="pg-ui-split-list" aria-label={label}>
				<header className="pg-ui-split-head"><b>{title}</b>{count != null && <em>{count}</em>}<span className="pg-flex" />{actions}</header>
				<ul className="pg-ui-rows">{rows}</ul>
				{foot && <div className="pg-ui-split-foot">{foot}</div>}
			</section>
			<div className="pg-ui-split-detail"><div className="pg-ui-split-page">{children}</div></div>
		</div>
	);
}

/** One row of a `Split` list: icon, title and tags, a mark on the right, a second line and a quiet meta line. */
export function Row({ icon, title, tag, aside, sub, meta, current, off, onClick, liProps, tools }: {
	icon?: ReactNode;
	title: ReactNode;
	tag?: ReactNode;
	aside?: ReactNode;
	sub?: ReactNode;
	meta?: ReactNode;
	current?: boolean;
	off?: boolean;
	onClick: () => void;
	liProps?: React.LiHTMLAttributes<HTMLLIElement> & Record<`data-${string}`, unknown>;
	/** Buttons beside the row, such as Move up and Move down. */
	tools?: ReactNode;
}) {
	return (
		<li className="pg-ui-row" data-off={off || undefined} {...liProps}>
			<button type="button" aria-current={current || undefined} onClick={onClick}>
				<span className="pg-ui-row-top">{icon}<b>{title}</b>{tag}{aside && <span className="pg-ui-row-aside">{aside}</span>}</span>
				{sub && <span className="pg-ui-row-sub">{sub}</span>}
				{meta && <span className="pg-ui-row-meta">{meta}</span>}
			</button>
			{tools && <span className="pg-ui-row-tools">{tools}</span>}
		</li>
	);
}

// ── Data ───────────────────────────────────────────────────────────

export interface Column<T> {
	key: string;
	label: ReactNode;
	/** The cell. A column marked `head` is the row's header. */
	cell: (row: T) => ReactNode;
	head?: boolean;
	num?: boolean;
	/** Hidden below 760px. */
	wide?: boolean;
	/** Dims the cell, for zeros and dashes. */
	quiet?: (row: T) => boolean;
	/** Marks the cell in danger, for a limit reached. */
	bad?: (row: T) => boolean;
	/** Clips long text to one line with the full text as a tooltip. */
	clip?: (row: T) => string | null;
}

/** A table on a panel. Rows open with `onRow`; `rowProps` adds state such as `data-off`. */
export function Table<T>({ columns, rows, rowKey, onRow, rowProps, label }: {
	columns: Column<T>[];
	rows: T[];
	rowKey: (row: T) => string;
	onRow?: (row: T) => void;
	rowProps?: (row: T) => React.HTMLAttributes<HTMLTableRowElement> & Record<`data-${string}`, unknown>;
	label?: string;
}) {
	const cls = (c: Column<T>, row?: T) =>
		[c.num && "is-num", c.wide && "pg-hide-sm", row && c.quiet?.(row) && "is-zero", row && c.bad?.(row) && "is-full", c.clip && "pg-ui-clip"].filter(Boolean).join(" ") || undefined;
	return (
		<div className="pg-ui-panel pg-ui-table">
			<table className="pg-table" aria-label={label}>
				<thead><tr>{columns.map((c) => <th key={c.key} scope="col" className={cls(c)}>{c.label}</th>)}</tr></thead>
				<tbody>
					{rows.map((row) => (
						<tr key={rowKey(row)} className={onRow ? "is-link" : undefined} onClick={onRow ? () => onRow(row) : undefined} {...rowProps?.(row)}>
							{columns.map((c) => {
								const Cell = c.head ? "th" : "td";
								return <Cell key={c.key} scope={c.head ? "row" : undefined} className={cls(c, row)} title={c.clip?.(row) ?? undefined}>{c.cell(row)}</Cell>;
							})}
						</tr>
					))}
				</tbody>
			</table>
		</div>
	);
}

/** A name with an optional icon, tag and second line, for the first cell of a row. */
export function Name({ icon, children, tag, sub }: { icon?: ReactNode; children: ReactNode; tag?: ReactNode; sub?: ReactNode }) {
	return (
		<>
			<span className="pg-ui-name">{icon}{children}{tag}</span>
			{sub && <span className="pg-ui-name-sub">{sub}</span>}
		</>
	);
}

/** A stack of rows on a panel: drafts, log entries, tools. Each row is an `Item`. */
/** `busy`: the rows are from before a new filter and its rows are on the way. */
export function List({ label, busy, children }: { label?: string; busy?: boolean; children: ReactNode }) {
	return <ul className="pg-ui-panel pg-ui-list" aria-label={label} aria-busy={busy || undefined}>{children}</ul>;
}

/**
 * One row of a `List`: a top line (badge, title, time or an aside), a meta line, and an optional quote.
 * With `children`, the row opens in place: `open` shows them under the top line.
 */
export function Item({ badge, title, time, aside, meta, quote, bad, open, onClick, children }: {
	badge?: ReactNode;
	title: ReactNode;
	time?: string;
	aside?: ReactNode;
	meta?: ReactNode;
	quote?: ReactNode;
	bad?: boolean;
	open?: boolean;
	onClick?: () => void;
	children?: ReactNode;
}) {
	const body = (
		<>
			<span className="pg-ui-item-top">{badge}<b>{title}</b>{time && <time className="pg-mono">{time}</time>}{aside}</span>
			{meta && <span className="pg-ui-item-meta">{meta}</span>}
			{quote && <span className="pg-ui-item-quote">{quote}</span>}
		</>
	);
	const expands = children != null;
	return (
		<li className="pg-ui-item" data-bad={bad || undefined} data-open={(expands && open) || undefined}>
			{onClick ? <button type="button" aria-expanded={expands ? !!open : undefined} onClick={onClick}>{body}</button> : <div>{body}</div>}
			{expands && open && <div className="pg-ui-item-body">{children}</div>}
		</li>
	);
}

/** Numbers in a row of tiles. A tile with `onClick` opens where the number comes from. */
export function Stats({ children }: { children: ReactNode }) {
	return <div className="pg-ui-stats">{children}</div>;
}

export function Stat({ label, value, note, bad, onClick }: { label: string; value: ReactNode; note?: ReactNode; bad?: boolean; onClick?: () => void }) {
	const body = <><span>{label}</span><b>{value}</b>{note && <em>{note}</em>}</>;
	return onClick
		? <button type="button" className="pg-ui-stat" data-bad={bad || undefined} onClick={onClick}>{body}</button>
		: <div className="pg-ui-stat" data-bad={bad || undefined}>{body}</div>;
}

// ── Forms ──────────────────────────────────────────────────────────

/** Settings rows. Each row is a `Field`: what it is on the left, the control on the right. */
export function Fields({ children }: { children: ReactNode }) {
	return <div className="pg-ui-fields">{children}</div>;
}

/**
 * One setting. `inline` keeps a small control (switch, segmented, number) on the label's line;
 * otherwise the control gets its own column for inputs and text areas.
 */
export function Field({ label, hint, error, inline, children }: { label: ReactNode; hint?: ReactNode; error?: string | null; inline?: boolean; children: ReactNode }) {
	return (
		<div className="pg-ui-field" data-inline={inline || undefined}>
			<div className="pg-ui-field-text">
				<b>{label}</b>
				{hint && <span>{hint}</span>}
				{error && <span className="pg-ui-field-error" role="alert">{error}</span>}
			</div>
			<div className="pg-ui-field-control">{children}</div>
		</div>
	);
}

/** Toggle chips for picking several from a short list. A picked chip shows a check and a ring. */
export function Chips({ label, children }: { label: string; children: ReactNode }) {
	return <div className="pg-ui-chips" role="group" aria-label={label}>{children}</div>;
}

export function Chip({ on, onClick, children }: { on: boolean; onClick: () => void; children: ReactNode }) {
	return (
		<button type="button" className="pg-ui-chip" aria-pressed={on} onClick={onClick}>
			<span className="pg-ui-chip-box" aria-hidden>{on && <CheckIcon size={10} weight="bold" />}</span>
			{children}
		</button>
	);
}

/**
 * Steps in order, left to right, with the current one filled and the ones before it checked: a new
 * agent's Job, Addresses, Name, or an agent's Watch, Draft, Send. `onPick` makes them buttons.
 */
export function Track({ label, steps, current, onPick }: {
	label: string;
	steps: { label: string; disabled?: boolean; title?: string }[];
	current: number;
	onPick?: (i: number) => void;
}) {
	return (
		<ol className="pg-ui-track" aria-label={label}>
			{steps.map((s, i) => (
				<li key={s.label} data-state={i === current ? "now" : i < current ? "done" : undefined}>
					<button type="button" disabled={s.disabled || !onPick} title={s.title} aria-current={i === current ? "step" : undefined} onClick={() => onPick?.(i)}>
						<span className="pg-ui-track-n" aria-hidden>{i < current ? <CheckIcon size={10} weight="bold" /> : i + 1}</span>
						<span className="pg-ui-track-label">{s.label}</span>
					</button>
				</li>
			))}
		</ol>
	);
}

/** Label, value and Edit, one row each: what something is set to, at a glance. */
export function Summary({ children }: { children: ReactNode }) {
	return <dl className="pg-ui-sum">{children}</dl>;
}

/** A Summary row. With `editor`, Edit opens it in place under the value and Done closes it. */
export function SummaryRow({ label, children, onEdit, editLabel = "Edit", open, editor }: {
	label: ReactNode;
	editLabel?: string;
	children: ReactNode;
	onEdit?: () => void;
	open?: boolean;
	editor?: ReactNode;
}) {
	const ref = useRef<HTMLDivElement>(null);
	useEffect(() => {
		if (open) ref.current?.querySelector<HTMLElement>(".pg-ui-sum-editor :is(textarea, input:not([type=checkbox]))")?.focus({ preventScroll: true });
	}, [open]);
	return (
		<div ref={ref} className="pg-ui-sum-row" data-open={open || undefined}>
			<dt>{label}</dt>
			<dd>{children}</dd>
			{onEdit && (
				<Button size="sm" variant={open ? "primary" : "default"} className="pg-ui-sum-edit" aria-expanded={editor ? !!open : undefined} onClick={onEdit}
					icon={open ? <CheckIcon size={12} weight="bold" /> : <PencilSimpleIcon size={12} />}>
					{open ? "Done" : editLabel}
				</Button>
			)}
			{open && editor && <div className="pg-ui-sum-editor">{editor}</div>}
		</div>
	);
}

/** Text that edits where it sits: reads as the value, a click puts the cursor in it. Enter or Escape leaves a one-line field. */
export function InlineText({ value, onChange, label, placeholder, multiline, invalid }: {
	value: string;
	onChange: (value: string) => void;
	label: string;
	placeholder?: string;
	multiline?: boolean;
	invalid?: boolean;
}) {
	const props = {
		className: "pg-ui-inline", value, placeholder, "aria-label": label, "aria-invalid": invalid || undefined, spellCheck: multiline,
	};
	return multiline
		? <textarea {...props} rows={1} onChange={(e) => onChange(e.target.value)} onKeyDown={(e) => { if (e.key === "Escape") e.currentTarget.blur(); }} />
		: <input {...props} onChange={(e) => onChange(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" || e.key === "Escape") e.currentTarget.blur(); }} />;
}

/** Two to four big options, one picked: a radio group as cards. `meta` sits at the right edge, in mono. */
export function Choices<T extends string>({ value, options, onChange, labelledBy }: {
	value: T;
	options: { value: T; label: ReactNode; meta?: ReactNode }[];
	onChange: (value: T) => void;
	labelledBy?: string;
}) {
	return (
		<div className="pg-ui-choices" role="radiogroup" aria-labelledby={labelledBy} data-n={options.length}>
			{options.map((o) => (
				<button key={o.value} type="button" role="radio" aria-checked={value === o.value} className="pg-ui-choice" onClick={() => onChange(o.value)}>
					<span className="pg-ui-choice-mark" aria-hidden />
					<b>{o.label}</b>
					{o.meta != null && <span>{o.meta}</span>}
				</button>
			))}
		</div>
	);
}

export type PickerItem = { value: string; label: ReactNode; text: string };
export type PickerGroup = { key: string; label: string; mark?: ReactNode; items: PickerItem[] };

/**
 * A checklist in groups, with search. Each group heads with its mark, a count and Pick all or Clear
 * for what's showing; search matches an item's text or its group's label. Reads the same with three
 * items or sixty.
 */
export function Picker({ groups, value, onChange, noun }: {
	groups: PickerGroup[];
	value: string[];
	onChange: (value: string[]) => void;
	noun: string;
}) {
	const [q, setQ] = useState("");
	const term = q.trim().toLowerCase();
	const total = groups.reduce((n, g) => n + g.items.length, 0);
	const shown = groups
		.map((g) => ({ ...g, items: !term || g.label.toLowerCase().includes(term) ? g.items : g.items.filter((i) => i.text.toLowerCase().includes(term)) }))
		.filter((g) => g.items.length);
	const has = new Set(value);
	const toggle = (list: string[], on: boolean) => onChange(on ? [...new Set([...value, ...list])] : value.filter((v) => !list.includes(v)));
	return (
		<div className="pg-ui-picker">
			<div className="pg-ui-picker-search">
				<MagnifyingGlassIcon size={14} aria-hidden />
				<input
					type="search" value={q} placeholder={`Search ${total} ${noun}`} aria-label={`Search ${noun}`}
					onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { if (e.key === "Escape" && q) { e.stopPropagation(); setQ(""); } }}
				/>
				{q && <button type="button" className="pg-icon-btn" aria-label="Clear search" onClick={() => setQ("")}><XIcon size={12} /></button>}
				{value.length > 0 && <button type="button" className="pg-ui-picker-link" onClick={() => onChange([])}>Clear {value.length}</button>}
			</div>
			<div className="pg-ui-picker-list">
				{shown.length === 0 && <p className="pg-ui-picker-none">No match for “{q.trim()}”</p>}
				{shown.map((g) => {
					const n = g.items.filter((i) => has.has(i.value)).length;
					const all = n === g.items.length;
					return (
						<div key={g.key} className="pg-ui-picker-group" role="group" aria-label={g.label}>
							<div className="pg-ui-picker-head">
								{g.mark}
								<b>{g.label}</b>
								<span>{n ? `${n} of ${g.items.length}` : g.items.length}</span>
								{g.items.length > 1 && (
									<button type="button" className="pg-ui-picker-link" onClick={() => toggle(g.items.map((i) => i.value), !all)}>{all ? "Clear" : "Pick all"}</button>
								)}
							</div>
							{g.items.map((i) => (
								<label key={i.value} className="pg-ui-picker-row" data-on={has.has(i.value) || undefined}>
									<input type="checkbox" checked={has.has(i.value)} onChange={(e) => toggle([i.value], e.target.checked)} />
									{i.label}
								</label>
							))}
						</div>
					);
				})}
			</div>
		</div>
	);
}

/** A number box with its unit. */
export function NumberInput({ value, onChange, min, max, unit, label, invalid, disabled }: {
	value: string | number;
	onChange: (value: string) => void;
	min?: number;
	max?: number;
	unit?: string;
	label: string;
	invalid?: boolean;
	disabled?: boolean;
}) {
	return (
		<label className="pg-ui-number">
			<input className="pg-input" type="number" inputMode="numeric" step={1} min={min} max={max} value={value} disabled={disabled} aria-label={label} aria-invalid={invalid || undefined} onChange={(e) => onChange(e.target.value)} />
			{unit && <span>{unit}</span>}
		</label>
	);
}

/** A failed autosave: sticks to the bottom of the page until a retry or the next edit saves. */
export function SaveBar({ error, saving, onSave, onDiscard, disabled }: { error?: string | null; saving?: boolean; onSave: () => void; onDiscard?: () => void; disabled?: boolean }) {
	return (
		<div className="pg-ui-savebar">
			<span className="pg-ui-savebar-msg" role="status" data-tone={error ? "error" : undefined}>{error ?? "Unsaved changes"}</span>
			{onDiscard && <Button onClick={onDiscard}>Discard</Button>}
			<Button variant="primary" onClick={onSave} disabled={saving || disabled}>Save changes</Button>
		</div>
	);
}

/** Copies text and says so for two seconds. Clipboard blocked: the text stays selectable. */
function useCopy(): [boolean, (text: string) => void] {
	const [copied, setCopied] = useState(false);
	return [copied, async (text) => {
		try {
			await navigator.clipboard.writeText(text);
			setCopied(true);
			setTimeout(() => setCopied(false), 2000);
		} catch {
			// Clipboard blocked.
		}
	}];
}

function CopyButton({ value, label }: { value: string; label?: string }) {
	const [copied, copy] = useCopy();
	return (
		<Button size="sm" aria-label={label} icon={copied ? <CheckIcon size={12} weight="bold" /> : <CopyIcon size={12} />} onClick={() => copy(value)}>
			{copied ? "Copied" : "Copy"}
		</Button>
	);
}

/** A value to copy, such as a server URL. */
export function CopyField({ value, label }: { value: string; label: string }) {
	return (
		<div className="pg-ui-copy">
			<span className="pg-ui-copy-value" aria-label={label}>{value}</span>
			<CopyButton value={value} />
		</div>
	);
}

type Token = { kind: "key" | "str" | "flag" | "cmd" | "var" | "punct" | null; text: string };

/** Light tints for shell and JSON: commands, flags, keys, strings and $VARIABLES. */
export function tokenize(lang: "sh" | "json", src: string): Token[] {
	const out: Token[] = [];
	const re = lang === "json"
		? /("(?:[^"\\]|\\.)*")(\s*:)?|([{}[\],])/g
		: /("(?:[^"\\]|\\.)*"|'[^']*')|(--?[A-Za-z][\w-]*)|(\$\{?\w+\}?)|(^|\n)(\s*)([A-Za-z][\w.-]*)/g;
	let at = 0;
	for (const m of src.matchAll(re)) {
		const i = m.index ?? 0;
		if (i > at) out.push({ kind: null, text: src.slice(at, i) });
		if (lang === "json") {
			if (m[1]) out.push({ kind: m[2] ? "key" : "str", text: m[1] }, ...(m[2] ? [{ kind: "punct" as const, text: m[2] }] : []));
			else out.push({ kind: "punct", text: m[3] });
		} else if (m[1]) out.push({ kind: "str", text: m[1] });
		else if (m[2]) out.push({ kind: "flag", text: m[2] });
		else if (m[3]) out.push({ kind: "var", text: m[3] });
		else out.push({ kind: null, text: m[4] + m[5] }, { kind: "cmd", text: m[6] });
		at = i + m[0].length;
	}
	if (at < src.length) out.push({ kind: null, text: src.slice(at) });
	return out;
}

/** A block of code to copy: a file name or language on top, then the code with light tints. */
export function Code({ lang, title, children }: { lang: "sh" | "json"; title?: ReactNode; children: string }) {
	return (
		<div className="pg-ui-code">
			<div className="pg-ui-code-head">
				<span>{title ?? (lang === "sh" ? "terminal" : "json")}</span>
				<CopyButton value={children} label={`Copy ${typeof title === "string" ? title : lang}`} />
			</div>
			<pre><code>{tokenize(lang, children).map((t, i) => t.kind ? <span key={i} data-tok={t.kind}>{t.text}</span> : t.text)}</code></pre>
		</div>
	);
}

// ── Controls and marks ─────────────────────────────────────────────

/** Buttons: default, primary (one per view), quiet (no frame), danger (only after a confirm). */
export function Button({ variant = "default", size, icon, children, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & {
	variant?: "default" | "primary" | "quiet" | "danger";
	size?: "sm";
	icon?: ReactNode;
}) {
	const cls = ["pg-btn", variant !== "default" && `pg-btn-${variant}`, size === "sm" && "pg-btn-sm", rest.className].filter(Boolean).join(" ");
	return <button type="button" {...rest} className={cls}>{icon}{children}</button>;
}

/**
 * A short label. Tones carry one meaning each: `watch`, `draft` (purple) and `send` (orange) are
 * an agent's mode; `ok`, `warn` and `danger` are status; `neutral` is a plain tag.
 */
export function Badge({ tone = "neutral", dot, live, children }: { tone?: "neutral" | "watch" | "draft" | "send" | "ok" | "warn" | "danger"; dot?: boolean; live?: boolean; children: ReactNode }) {
	return <span className="pg-ui-badge" data-tone={tone} data-dot={dot || live || undefined} data-live={live || undefined}>{children}</span>;
}

/** Tabs inside a page. */
export function Tabs<T extends string>({ value, options, onChange }: { value: T; options: { value: T; label: string }[]; onChange: (value: T) => void }) {
	return (
		<div className="pg-ui-tabs" role="tablist">
			{options.map((o) => (
				<button key={o.value} type="button" role="tab" aria-selected={value === o.value} onClick={() => onChange(o.value)}>{o.label}</button>
			))}
		</div>
	);
}

/** Small controls on one line, such as filters above a list. */
export function Toolbar({ children }: { children: ReactNode }) {
	return <div className="pg-ui-toolbar">{children}</div>;
}
