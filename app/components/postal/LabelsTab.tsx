// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { MagnifyingGlassIcon, PlusIcon, TrashIcon } from "@phosphor-icons/react";
import { type FormEvent, useState } from "react";
import { useSearchParams } from "react-router";
import { LABEL_COLORS } from "shared/label-colors";
import { LabelSwatch } from "~/components/LabelChip";
import { filterToParams } from "~/lib/mail-filter";
import { type Label, useCreateLabel, useDeleteLabel, useLabels, useUpdateLabel } from "~/queries/labels";
import api from "~/services/api";
import { Button, Note, Table } from "./ConsoleUI";

/** Lists with more labels than this get a filter. */
const FILTER_AT = 10;

/** One-click names for the empty state. */
const STARTERS = ["Receipts", "Travel", "Follow up", "Newsletters"];

/** The first palette colour no label uses yet, so new labels stay apart without opening the picker. */
function nextColor(labels: Label[]): string {
	const used = new Set(labels.map((l) => l.color.toLowerCase()));
	return (LABEL_COLORS.find((c) => !used.has(c.bg)) ?? LABEL_COLORS[labels.length % LABEL_COLORS.length]).bg;
}

function ColorPicker({ value, onChange, name }: { value: string; onChange: (color: string) => void; name: string }) {
	return (
		<div className="pg-colors" role="radiogroup" aria-label={`Color for ${name}`}>
			{LABEL_COLORS.map((c) => (
				<button key={c.bg} type="button" role="radio" aria-checked={value === c.bg} aria-label={c.name} title={c.name} className="pg-color" onClick={() => onChange(c.bg)}>
					<LabelSwatch color={c.bg} />
				</button>
			))}
		</div>
	);
}

function LabelRow({ label }: { label: Label }) {
	const [, setSearchParams] = useSearchParams();
	const update = useUpdateLabel();
	const remove = useDeleteLabel();
	const [name, setName] = useState(label.name);
	const [color, setColor] = useState(false);
	const [confirming, setConfirming] = useState(false);
	const save = (event?: FormEvent) => {
		event?.preventDefault();
		const next = name.trim();
		if (next && next !== label.name) update.mutate({ id: label.id, name: next });
		else setName(label.name);
	};
	const error = update.error ?? remove.error;
	return (
		<li className="pg-label-row">
			<div className="pg-label-main">
				<button type="button" className="pg-color pg-label-color" aria-expanded={color} aria-label={`Change color of ${label.name}`} title="Color" onClick={() => setColor(!color)}>
					<LabelSwatch color={label.color} />
				</button>
				<form onSubmit={save} className="pg-flex">
					<input className="pg-input pg-label-name" value={name} onChange={(e) => setName(e.target.value)} onBlur={() => save()} aria-label={`Name of ${label.name}`} maxLength={60} />
				</form>
				{label.count > 0 ? (
					// Leaves the console for every conversation with this label.
					<button type="button" className="pg-label-count pg-label-open" title={`Show conversations labeled ${label.name}`} onClick={() => setSearchParams(filterToParams({ view: "all", chips: [{ kind: "label", value: label.id }], sort: "date", dir: "desc" }))}>
						{label.count.toLocaleString()}
					</button>
				) : <span className="pg-label-count">0</span>}
				{confirming ? (
					<span className="pg-ui-toolbar">
						<Button size="sm" onClick={() => setConfirming(false)}>Cancel</Button>
						<Button size="sm" variant="danger" onClick={() => remove.mutate(label.id)} disabled={remove.isPending}>Delete</Button>
					</span>
				) : (
					<button type="button" className="pg-icon-btn" aria-label={`Delete ${label.name}`} title="Delete label" onClick={() => setConfirming(true)}>
						<TrashIcon size={14} />
					</button>
				)}
			</div>
			{confirming && <Note>Removes {label.name} from {label.count.toLocaleString()} {label.count === 1 ? "conversation" : "conversations"}. The mail stays.</Note>}
			{color && <ColorPicker name={label.name} value={label.color} onChange={(c) => { update.mutate({ id: label.id, color: c }); setColor(false); }} />}
			{error && <Note tone="error">{error.message}</Note>}
		</li>
	);
}

/** Convert custom folders to labels. Counts on load and shows nothing without custom folders; converting backs up to R2, labels each folder's mail and archives it. Folders are kept. */
function FolderImport() {
	const queryClient = useQueryClient();
	const dryRun = useQuery({ queryKey: ["folder-import"], queryFn: () => api.importFoldersDryRun(), staleTime: 60_000 });
	const run = useMutation({
		mutationFn: () => api.importFolders(),
		onSettled: () => {
			for (const key of [["labels"], ["mail"], ["mail-facets"], ["folders"]]) queryClient.invalidateQueries({ queryKey: key });
		},
	});
	const [confirming, setConfirming] = useState(false);
	const [open, setOpen] = useState(false);
	const plan = run.data?.plan ?? dryRun.data;
	const results = run.data?.results;
	if (!plan || plan.totals.folders === 0) return dryRun.error ? <Note tone="error">{dryRun.error.message}</Note> : null;
	const { folders, messages } = plan.totals;
	return (
		<section className="pg-ui-panel pg-labels-import" aria-label="Folders to labels">
			<div className="pg-labels-import-head">
				<div className="pg-flex">
					<b>{run.data ? "Folders converted" : `${folders} custom ${folders === 1 ? "folder" : "folders"}, ${messages.toLocaleString()} messages`}</b>
					<span>{run.data ? <>Backup <span className="pg-mono">{run.data.backup}</span></> : "Convert each folder to a label of the same name. Its mail gets the label and moves to Archive. Folders are kept."}</span>
				</div>
				<Button size="sm" variant="quiet" aria-expanded={open} onClick={() => setOpen(!open)}>{open ? "Hide" : "Details"}</Button>
				{!run.data && (confirming ? (
					<>
						<Button size="sm" onClick={() => setConfirming(false)}>Cancel</Button>
						<Button size="sm" variant="primary" onClick={() => { setConfirming(false); run.mutate(); }}>Convert {messages.toLocaleString()}</Button>
					</>
				) : (
					<Button size="sm" onClick={() => setConfirming(true)} disabled={run.isPending}>{run.isPending ? "Converting" : "Convert to labels"}</Button>
				))}
			</div>
			{run.error && <Note tone="error">{run.error.message}</Note>}
			{(open || results) && (
				<Table
					label="Folders"
					rows={plan.mailboxes.flatMap((m) => m.folders.map((f) => ({ m, f })))}
					rowKey={({ m, f }) => `${m.mailboxId}/${f.folderId}`}
					columns={[
						{ key: "address", label: "Address", cell: ({ m }) => m.mailboxId },
						{ key: "folder", label: "Folder", cell: ({ f }) => f.name },
						{ key: "label", label: "Label", cell: ({ f }) => { const l = plan.labels.find((x) => x.id === f.labelId); return `${l?.name ?? f.labelId}${l?.exists ? " (exists)" : ""}`; } },
						{ key: "count", label: "Messages", num: true, cell: ({ f }) => f.count.toLocaleString() },
						...(results ? [{ key: "result", label: "Result", cell: ({ m, f }: { m: (typeof plan.mailboxes)[number]; f: (typeof plan.mailboxes)[number]["folders"][number] }) => {
							const r = results.find((x) => x.mailboxId === m.mailboxId && x.folderId === f.folderId);
							return r?.error ? `Failed: ${r.error}` : `${r?.labeled ?? 0} labeled, ${r?.archived ?? 0} archived`;
						} }] : []),
					]}
				/>
			)}
		</section>
	);
}

/** Labels shared by every address. Changes save as they are made. */
export function LabelsTab() {
	const { labels, isPending } = useLabels();
	const create = useCreateLabel();
	const [name, setName] = useState("");
	const [picked, setPicked] = useState<string | null>(null);
	const [picking, setPicking] = useState(false);
	const [query, setQuery] = useState("");
	const shown = labels.length > FILTER_AT && query.trim() ? labels.filter((l) => l.name.toLowerCase().includes(query.trim().toLowerCase())) : labels;
	const color = picked ?? nextColor(labels);
	const add = (label: string, fill = color) => create.mutate({ name: label, color: fill }, { onSuccess: () => { setName(""); setPicked(null); } });
	const submit = (event: FormEvent) => {
		event.preventDefault();
		if (name.trim()) add(name.trim());
	};
	return (
		<div className="pg-labels">
			<form className="pg-label-new" onSubmit={submit}>
				<div className="pg-label-main">
					<button type="button" className="pg-color pg-label-color" aria-expanded={picking} aria-label="Color for the new label" title="Color" onClick={() => setPicking(!picking)}>
						<LabelSwatch color={color} />
					</button>
					<input className="pg-input pg-flex" value={name} onChange={(e) => setName(e.target.value)} placeholder="New label" aria-label="New label name" maxLength={60} />
					<Button type="submit" size="sm" variant="primary" icon={<PlusIcon size={12} />} disabled={!name.trim() || create.isPending}>Create</Button>
				</div>
				{picking && <ColorPicker name="the new label" value={color} onChange={(c) => { setPicked(c); setPicking(false); }} />}
				{create.error && <Note tone="error">{create.error.message}</Note>}
			</form>
			{isPending ? <Note>Loading labels</Note> : labels.length === 0 ? (
				<div className="pg-labels-empty">
					<b>No labels yet</b>
					<span>A conversation can carry several labels and stays in its folder. Start with one of these or name your own.</span>
					<div className="pg-labels-starters">
						{STARTERS.map((s, i) => (
							<button key={s} type="button" className="pg-btn pg-btn-sm" disabled={create.isPending} onClick={() => add(s, LABEL_COLORS[(i * 3) % LABEL_COLORS.length].bg)}>
								<LabelSwatch color={LABEL_COLORS[(i * 3) % LABEL_COLORS.length].bg} />{s}
							</button>
						))}
					</div>
				</div>
			) : (
				<div>
					{labels.length > FILTER_AT && (
						<label className="pg-labels-filter">
							<MagnifyingGlassIcon size={14} aria-hidden />
							<input className="pg-input pg-flex" type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={`Filter ${labels.length} labels`} aria-label="Filter labels" />
						</label>
					)}
					<div className="pg-label-head"><span>Label</span><span>Conversations</span></div>
					{shown.length === 0 ? <Note>No label matches {query.trim()}.</Note> : (
						<ul className="pg-label-list">{shown.map((l) => <LabelRow key={`${l.id}:${l.name}`} label={l} />)}</ul>
					)}
				</div>
			)}
			<FolderImport />
		</div>
	);
}
