// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { ArrowLeftIcon, ArrowSquareOutIcon, CaretRightIcon, CheckIcon, MagnifyingGlassIcon, ShieldCheckIcon, WarningIcon } from "@phosphor-icons/react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import api, { type ModelCatalog } from "~/services/api";
import {
	type CatalogModel, guessProvider, type KeyedProvider, makerOf, type ModelRef, PROVIDER_INFO, PROVIDERS,
	type ProviderId, sameModel, validModelId,
} from "shared/models";
import { Badge, type Column, Name, Note, Table } from "./ConsoleUI";
import { Reveal } from "./Reveal";

export function useModelCatalog(enabled = true) {
	return useQuery({ queryKey: ["agent-model", "catalog"], queryFn: api.getModelCatalog, enabled, staleTime: 3_600_000 });
}

/** "Anthropic, Claude Sonnet 5.5", from the catalog when it has the model. */
export function modelName(catalog: ModelCatalog | undefined, ref: ModelRef): string {
	const found = catalog?.providers[ref.provider]?.models.find((m) => m.id === ref.id);
	return `${PROVIDER_INFO[ref.provider].label}, ${found?.name ?? ref.id}`;
}

/** Key edits: a string replaces the saved key, "" removes it. */
type KeyEdits = Partial<Record<KeyedProvider, string>>;

export function useAgentModelDraft() {
	const queryClient = useQueryClient();
	const { data: stored } = useQuery({ queryKey: ["agent-model"], queryFn: api.getAgentModel });
	// undefined: untouched. null: follow the recommended model.
	const [selected, setSelected] = useState<ModelRef | null | undefined>(undefined);
	const [keys, setKeys] = useState<KeyEdits>({});
	const current = selected === undefined ? stored?.selected ?? null : selected;
	const effective = current ?? stored?.recommended ?? null;
	const keyEdited = Object.values(keys).some((v) => v !== undefined);
	const selectionChanged = !!stored && selected !== undefined && !(
		(selected === null && stored.selected === null) || (selected && stored.selected && sameModel(selected, stored.selected))
	);
	const dirty = !!stored && (selectionChanged || keyEdited);
	/** Whether a provider has a key, counting unsaved edits. */
	const hasKey = (p: ProviderId) => p === "workers-ai" || (keys[p as KeyedProvider] !== undefined ? keys[p as KeyedProvider] !== "" : !!stored?.keys[p as KeyedProvider]?.set);
	const save = async () => {
		const view = await api.updateAgentModel({
			...(selectionChanged ? { selected: current } : {}),
			...(keyEdited ? { keys: Object.fromEntries(Object.entries(keys).map(([p, v]) => [p, v.trim()])) } : {}),
		});
		queryClient.setQueryData(["agent-model"], view);
		if (keyEdited) queryClient.invalidateQueries({ queryKey: ["agent-model", "catalog"] });
		setSelected(undefined);
		setKeys({});
	};
	return {
		stored, selected: current, effective, keys, dirty, hasKey, save,
		select: (ref: ModelRef) => setSelected(stored && sameModel(ref, stored.recommended) ? null : ref),
		setKey: (p: KeyedProvider, value: string | undefined) => setKeys((k) => ({ ...k, [p]: value })),
	};
}

type AgentModelDraft = ReturnType<typeof useAgentModelDraft>;

function formatContext(tokens: number | null): string {
	if (!tokens) return "–";
	if (tokens >= 1_000_000) return `${Math.round(tokens / 100_000) / 10}M`.replace(".0M", "M");
	return `${Math.round(tokens / 1000)}K`;
}

function formatPrice(usd: number): string {
	return usd >= 10 ? `$${usd.toFixed(0)}` : `$${usd.toFixed(2)}`;
}

function hueStyle(hue: number) {
	return { "--pg-h": hue } as React.CSSProperties;
}

/** The provider's color square and name. The only place a provider's hue shows. */
function ProviderMark({ provider }: { provider: ProviderId }) {
	const info = PROVIDER_INFO[provider];
	return <span className="pg-prov-mark" style={hueStyle(info.hue)}><i aria-hidden="true" />{info.label}</span>;
}

/** What a provider does with prompts, ending in a link to its own policy. */
function DataText({ provider }: { provider: ProviderId }) {
	const info = PROVIDER_INFO[provider];
	return (
		<>
			{info.zdr && <ShieldCheckIcon size={14} aria-hidden="true" />}
			{info.data}{" "}
			<a href={info.policyUrl} target="_blank" rel="noreferrer">Policy<ArrowSquareOutIcon size={12} aria-hidden="true" /></a>
		</>
	);
}

function Price({ model }: { model: CatalogModel }) {
	if (!model.price) return <span className="pg-model-price" data-none>–</span>;
	if (model.price.input === 0 && model.price.output === 0) return <span className="pg-model-price"><b>Free</b></span>;
	return (
		<span className="pg-model-price">
			{formatPrice(model.price.input)}<span className="pg-model-slash">/</span><b>{formatPrice(model.price.output)}</b>
		</span>
	);
}

/** Provider, maker when it differs, and what the model is missing. */
function ModelSub({ model, needsKey, provider = true, maker: showMakerLine = true }: { model: CatalogModel; needsKey: boolean; provider?: boolean; maker?: boolean }) {
	const maker = makerOf(model);
	const showMaker = maker.label !== PROVIDER_INFO[model.provider].label;
	return (
		<span className="pg-model-sub">
			{provider && <ProviderMark provider={model.provider} />}
			{showMakerLine && (showMaker || !provider) && <span>{maker.label}</span>}
			{model.zdr && <span className="pg-zdr"><ShieldCheckIcon size={12} aria-hidden="true" />Zero retention</span>}
			{model.tools === false && <span>No tools</span>}
			{needsKey && <span className="pg-model-needs">Needs key</span>}
		</span>
	);
}

function ModelRow({ model, selected, recommended, needsKey, provider, maker = true, onSelect }: {
	model: CatalogModel; selected: boolean; recommended: boolean; needsKey: boolean; provider: boolean; maker?: boolean; onSelect: () => void;
}) {
	return (
		<button type="button" role="radio" aria-checked={selected} className="pg-model-row" onClick={onSelect} title={model.id}>
			<span className="pg-model-check" aria-hidden="true">{selected && <CheckIcon size={12} weight="bold" />}</span>
			<span className="pg-model-name">
				<span className="pg-model-title"><b>{model.name}</b>{recommended && <Badge tone="ok">Recommended</Badge>}</span>
				<ModelSub model={model} needsKey={needsKey} provider={provider} maker={maker} />
			</span>
			<span className="pg-model-ctx">{formatContext(model.context)}</span>
			<Price model={model} />
		</button>
	);
}

/** The providers side by side: what each does with prompts, its models, its key. */
function ProviderTable({ draft, counts, zdrCounts, openKey, highlight, onToggle }: {
	draft: AgentModelDraft; counts: Record<ProviderId, number>; zdrCounts: Record<ProviderId, number>; openKey: ProviderId | null; highlight: ProviderId | null; onToggle: (p: ProviderId) => void;
}) {
	const keyState = (p: ProviderId) => {
		if (p === "workers-ai") return null;
		const saved = draft.stored?.keys[p as KeyedProvider];
		const edit = draft.keys[p as KeyedProvider];
		return { saved, edit, removing: edit === "", pending: !!edit };
	};
	const columns: Column<ProviderId>[] = [
		{
			key: "provider", label: "Provider", head: true,
			cell: (p) => {
				const info = PROVIDER_INFO[p];
				return (
					<Name sub={
						<span className="pg-prov-links">
							{info.modelsUrl && <a href={info.modelsUrl} target="_blank" rel="noreferrer">Models<ArrowSquareOutIcon size={12} aria-hidden="true" /></a>}
							<a href={info.policyUrl} target="_blank" rel="noreferrer">Policy<ArrowSquareOutIcon size={12} aria-hidden="true" /></a>
						</span>
					}><ProviderMark provider={p} /></Name>
				);
			},
		},
		{ key: "training", label: "Training", wide: true, cell: (p) => PROVIDER_INFO[p].trains ? "Yes" : "No" },
		{
			key: "retention", label: "Retention",
			cell: (p) => PROVIDER_INFO[p].zdr
				? <span className="pg-zdr"><ShieldCheckIcon size={14} aria-hidden="true" />Zero retention</span>
				: zdrCounts[p] > 0
					? <span className="pg-zdr"><ShieldCheckIcon size={14} aria-hidden="true" />{zdrCounts[p]} of {counts[p]} models</span>
					: "Not promised",
		},
		{ key: "models", label: "Models", num: true, wide: true, cell: (p) => counts[p] },
		{
			key: "key", label: "Key", num: true,
			cell: (p) => {
				const k = keyState(p);
				if (!k) return <span className="pg-prov-status">Built in</span>;
				const status = k.removing ? "Removing" : k.pending ? "Saving" : k.saved?.set ? `····${k.saved.hint}` : null;
				const open = openKey === p;
				return (
					<span className="pg-prov-key">
						{status && <span key={status} className="pg-prov-status" data-on={!k.removing}>{status}</span>}
						<button type="button" className="pg-btn pg-btn-sm" onClick={() => onToggle(p)} aria-expanded={open}>
							{open ? "Done" : k.saved?.set || k.pending ? "Manage" : "Add key"}
						</button>
					</span>
				);
			},
		},
	];
	// The key row stays mounted and eases open under the table. It keeps the last provider while it
	// closes, and opens a frame after mount, so a key asked for on the way back from the picker slides in too.
	const [ready, setReady] = useState(false);
	useEffect(() => { const id = requestAnimationFrame(() => setReady(true)); return () => cancelAnimationFrame(id); }, []);
	const last = useRef<ProviderId | null>(null);
	if (openKey && openKey !== "workers-ai") last.current = openKey;
	const shown = last.current;
	const open = shown ? keyState(shown) : null;
	const info = shown ? PROVIDER_INFO[shown] : null;
	const input = useRef<HTMLInputElement>(null);
	const isOpen = ready && !!openKey && openKey === shown;
	useEffect(() => { if (isOpen) input.current?.focus({ preventScroll: true }); }, [isOpen, shown]);
	return (
		<>
			<div className="pg-prov-table"><Table label="Providers" columns={columns} rows={[...PROVIDERS]} rowKey={(p) => p} rowProps={(p) => ({ "data-highlight": p === highlight || undefined })} /></div>
			<Reveal open={isOpen} kind="panel">
				{shown && open && info && <div className="pg-prov-row-key">
					<input
						ref={input}
						className="pg-input pg-mono"
						type="password"
						autoComplete="off"
						spellCheck={false}
						value={open.edit ?? ""}
						placeholder={open.saved?.set && !open.removing ? `Replace ····${open.saved.hint}` : info.keyHint ?? ""}
						aria-label={`${info.label} API key`}
						onChange={(e) => draft.setKey(shown as KeyedProvider, e.target.value || undefined)}
					/>
					{open.saved?.set && !open.removing && <button type="button" className="pg-btn pg-btn-sm pg-btn-quiet" onClick={() => draft.setKey(shown as KeyedProvider, "")}>Remove</button>}
					{open.removing && <button type="button" className="pg-btn pg-btn-sm pg-btn-quiet" onClick={() => draft.setKey(shown as KeyedProvider, undefined)}>Undo</button>}
					{info.keyUrl && <a className="pg-btn pg-btn-sm pg-btn-quiet" href={info.keyUrl} target="_blank" rel="noreferrer">Get a key <ArrowSquareOutIcon size={12} /></a>}
				</div>}
			</Reveal>
		</>
	);
}

/** Makers whose models are reached through OpenRouter, as shortcuts. */
const MAKER_FILTERS = ["Anthropic", "OpenAI", "Google", "xAI"] as const;
type MakerFilter = (typeof MAKER_FILTERS)[number];
type Filter = "all" | ProviderId | MakerFilter;
const isMaker = (f: Filter): f is MakerFilter => (MAKER_FILTERS as readonly string[]).includes(f);
/** The provider a filter's models come from. */
const providerOf = (f: Exclude<Filter, "all">): ProviderId => (isMaker(f) ? "openrouter" : f);
type ModelSort = "suggested" | "price" | "context";
const PAGE = 100;

/** Step 2: the full list, opened from Change model. Picking a model returns to the overview. */
function ModelPicker({ catalog, draft, onPick, onBack }: {
	catalog: ModelCatalog; draft: AgentModelDraft; onPick: (ref: ModelRef) => void; onBack: () => void;
}) {
	const [query, setQuery] = useState("");
	const [filter, setFilterState] = useState<Filter>("all");
	const [sort, setSort] = useState<ModelSort>("suggested");
	const [limit, setLimit] = useState(PAGE);
	const [customProvider, setCustomProvider] = useState<ProviderId | null>(null);
	const top = useRef<HTMLDivElement>(null);
	const setFilter = (f: Filter) => {
		setFilterState(f);
		setLimit(PAGE);
		top.current?.scrollIntoView({ block: "start" });
	};

	const all = PROVIDERS.flatMap((p) => catalog.providers[p]?.models ?? []);
	const recommended = catalog.recommended;
	const effective = draft.effective ?? recommended;
	const isSuggested = (m: ModelRef) => catalog.suggested.some((s) => sameModel(s, m));
	const find = (ref: ModelRef) => catalog.providers[ref.provider]?.models.find((m) => m.id === ref.id);

	const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
	const pool = filter === "all" ? all
		: isMaker(filter) ? (catalog.providers.openrouter?.models ?? []).filter((m) => makerOf(m).label === filter)
		: catalog.providers[filter]?.models ?? [];
	const matches = pool.filter((m) => {
		if (!words.length) return true;
		const text = `${m.name} ${m.id} ${PROVIDER_INFO[m.provider].label} ${makerOf(m).label}`.toLowerCase();
		return words.every((w) => text.includes(w));
	});
	const sorter = sort === "price"
		? (a: CatalogModel, b: CatalogModel) => (a.price?.output ?? Infinity) - (b.price?.output ?? Infinity) || (a.price?.input ?? 0) - (b.price?.input ?? 0)
		: sort === "context"
			? (a: CatalogModel, b: CatalogModel) => (b.context ?? 0) - (a.context ?? 0) || (a.price?.output ?? Infinity) - (b.price?.output ?? Infinity)
			: (a: CatalogModel, b: CatalogModel) => Number(isSuggested(b)) - Number(isSuggested(a));

	// Nothing typed and no provider chosen: one card per need, then one row per provider to browse.
	const home = filter === "all" && words.length === 0;
	const picks = catalog.suggested.flatMap((s) => {
		const m = find(s);
		return m ? [{ ...s, model: m }] : [];
	});
	const rows = home ? [] : [...matches].sort(sorter);
	const title = filter !== "all" && !words.length ? (isMaker(filter) ? `${filter} on OpenRouter` : <ProviderMark provider={filter} />)
		: `${rows.length} ${rows.length === 1 ? "match" : "matches"}`;
	const source = filter === "all" ? null : providerOf(filter);
	const error = source ? catalog.providers[source]?.error : undefined;
	// One provider's list says once that its key is missing, not on every row.
	const single = !!source;
	const missingKey = !!source && !draft.hasKey(source);

	const typed = query.trim();
	const customTarget = customProvider ?? (source ?? guessProvider(typed));
	const showCustom = typed.length > 1 && !all.some((m) => m.id === typed) && !/\s/.test(typed);
	const customValid = validModelId(customTarget, typed);

	return (
		<div
			ref={top}
			className="pg-picker"
			data-own-escape
			onKeyDown={(e) => {
				if (e.key !== "Escape") return;
				e.preventDefault();
				if (query) setQuery("");
				else if (filter !== "all") setFilter("all");
				else onBack();
			}}
		>
			<div className="pg-picker-head">
				<button type="button" className="pg-btn pg-btn-sm pg-btn-quiet" onClick={onBack}><ArrowLeftIcon size={14} /> Back</button>
				<b>Choose a model</b>
			</div>
			<label className="pg-models-search">
				<MagnifyingGlassIcon size={16} aria-hidden="true" />
				<input
					type="search"
					autoFocus
					value={query}
					placeholder={`Search ${all.length} models, or paste a model id`}
					aria-label="Search models"
					spellCheck={false}
					onChange={(e) => { setQuery(e.target.value); setCustomProvider(null); setLimit(PAGE); }}
				/>
			</label>
			<div className="pg-models-tools">
				<div className="pg-prov-filter" role="radiogroup" aria-label="Provider">
					<button type="button" role="radio" aria-checked={filter === "all"} onClick={() => setFilter("all")}>All</button>
					{PROVIDERS.map((p) => (
						<button key={p} type="button" role="radio" aria-checked={filter === p} onClick={() => setFilter(p)}>
							<ProviderMark provider={p} />
						</button>
					))}
					{MAKER_FILTERS.map((f) => (
						<button key={f} type="button" role="radio" aria-checked={filter === f} onClick={() => setFilter(f)}>{f}</button>
					))}
				</div>
				{!home && <select className="pg-select" value={sort} aria-label="Sort models" onChange={(e) => setSort(e.target.value as ModelSort)}>
					<option value="suggested">Suggested first</option>
					<option value="price">Cheapest first</option>
					<option value="context">Most context first</option>
				</select>}
			</div>

			{showCustom && (
				<div className="pg-model-custom">
					<button type="button" className="pg-model-row" disabled={!customValid} onClick={() => onPick({ provider: customTarget, id: typed })}>
						<span className="pg-model-check is-custom" aria-hidden="true" />
						<span className="pg-model-name">
							<span className="pg-model-title"><b>Use <code>{typed}</code></b></span>
							<span className="pg-model-sub">{customValid ? `Sent to ${PROVIDER_INFO[customTarget].label} as typed`
								: typed.endsWith(":free") ? "Free models aren't offered. Free endpoints can keep and train on prompts."
								: `${PROVIDER_INFO[customTarget].label} ids look like ${PROVIDER_INFO[customTarget].idExample}`}</span>
						</span>
					</button>
					<select className="pg-select" value={customTarget} aria-label="Provider for this model id" onChange={(e) => setCustomProvider(e.target.value as ProviderId)}>
						{PROVIDERS.map((p) => <option key={p} value={p}>{PROVIDER_INFO[p].label}</option>)}
					</select>
				</div>
			)}

			{home && (
				<div className="pg-picks" role="radiogroup" aria-label="Suggested models">
					{picks.map(({ role, model: m }) => {
						const selected = sameModel(m, effective);
						return (
							<button
								key={`${m.provider}:${m.id}`}
								type="button"
								role="radio"
								aria-checked={selected}
								className="pg-pick"
								data-recommended={sameModel(m, recommended)}
								title={m.id}
								onClick={() => onPick({ provider: m.provider, id: m.id })}
							>
								<span className="pg-pick-role">
									{role}
									{selected && <CheckIcon size={14} weight="bold" />}
								</span>
								<b>{m.name}</b>
								<ModelSub model={m} needsKey={!draft.hasKey(m.provider)} />
								<span className="pg-pick-stats">
									<span>{formatContext(m.context)} <i>context</i></span>
									<span><Price model={m} /> <i>per 1M</i></span>
								</span>
							</button>
						);
					})}
				</div>
			)}

			{!home && (rows.length > 0 || !showCustom) && (
				<div className="pg-models-list" role="radiogroup" aria-label="Agent model">
					<div className="pg-models-cols">
						<span>{title}</span>
						<span>Context</span>
						<span>$ per 1M, in / out</span>
					</div>
					{error && <Note tone="warn">{error}</Note>}
					{source && !words.length && <Note tone={PROVIDER_INFO[source].zdr ? "ok" : "muted"}><DataText provider={source} /></Note>}
					{missingKey && source && <Note tone="warn">No {PROVIDER_INFO[source].label} key yet. Pick a model, then add the key.</Note>}
					{rows.slice(0, limit).map((m) => (
						<ModelRow
							key={`${m.provider}:${m.id}`}
							model={m}
							selected={sameModel(m, effective)}
							recommended={sameModel(m, recommended)}
							needsKey={!single && !draft.hasKey(m.provider)}
							provider={!single}
							maker={!isMaker(filter)}
							onSelect={() => onPick({ provider: m.provider, id: m.id })}
						/>
					))}
					{rows.length > limit && (
						<button type="button" className="pg-models-more" onClick={() => setLimit(rows.length)}>Show all {rows.length}</button>
					)}
					{rows.length === 0 && <Note>No model matches "{typed}".</Note>}
				</div>
			)}

			{home && (
				<div className="pg-models-list">
					<div className="pg-models-cols"><span>Browse</span></div>
					{PROVIDERS.map((p) => (
						<button key={p} type="button" className="pg-browse-row" onClick={() => setFilter(p)}>
							<ProviderMark provider={p} />
							<span className="pg-model-sub">
								{!draft.hasKey(p) && <span className="pg-model-needs">Needs key</span>}
							</span>
							<span className="pg-browse-count">{catalog.providers[p]?.models.length ?? 0} models</span>
							<CaretRightIcon size={14} aria-hidden="true" />
						</button>
					))}
					{MAKER_FILTERS.map((f) => (
						<button key={f} type="button" className="pg-browse-row" onClick={() => setFilter(f)}>
							<span>{f}</span>
							<span className="pg-model-sub"><ProviderMark provider="openrouter" /></span>
							<span className="pg-browse-count">{(catalog.providers.openrouter?.models ?? []).filter((m) => makerOf(m).label === f).length} models</span>
							<CaretRightIcon size={14} aria-hidden="true" />
						</button>
					))}
				</div>
			)}
		</div>
	);
}

/** Step 1: the model in use, its facts before its buttons, then the providers side by side. "Change model" opens the picker. */
export function AgentModelSection({ draft }: { draft: AgentModelDraft }) {
	const { data: catalog, isLoading } = useModelCatalog();
	const [picking, setPicking] = useState(false);
	// Which way the last swap went: the picker comes in from the right, the summary from the left.
	const [enter, setEnter] = useState<"forward" | "back">();
	const [openKey, setOpenKey] = useState<ProviderId | null>(null);
	const [test, setTest] = useState<{ busy: boolean; ok?: boolean; text?: string; n: number }>({ busy: false, n: 0 });
	const change = useRef<HTMLButtonElement>(null);
	useEffect(() => { if (!picking && enter === "back") change.current?.focus({ preventScroll: true }); }, [picking, enter]);
	// The message under the facts keeps its last words while it closes.
	const lastMsg = useRef<{ ok: boolean; text: React.ReactNode; n: number } | null>(null);
	if (isLoading || !catalog || !draft.stored) return <p className="pg-ui-note">Loading</p>;

	const recommended = catalog.recommended;
	const effective = draft.effective ?? recommended;
	const model: CatalogModel = catalog.providers[effective.provider]?.models.find((m) => m.id === effective.id)
		?? { ...effective, name: effective.id, context: null, price: null, tools: null };
	const needsKey = !draft.hasKey(effective.provider);
	const maker = makerOf(model);

	if (picking) {
		return (
			<div key="picker" className="pg-model-view" data-enter={enter}>
				<ModelPicker
					catalog={catalog}
					draft={draft}
					onBack={() => { setEnter("back"); setPicking(false); }}
					onPick={(ref) => {
						// Picking marks the model and keeps the list open; Back returns to the summary.
						draft.select(ref);
						setTest((t) => ({ busy: false, n: t.n }));
						if (!draft.hasKey(ref.provider)) setOpenKey(ref.provider);
					}}
				/>
			</div>
		);
	}

	const runTest = async () => {
		setTest((t) => ({ busy: true, n: t.n }));
		try {
			const key = effective.provider === "workers-ai" ? undefined : draft.keys[effective.provider as KeyedProvider] || undefined;
			const r = await api.testAgentModel({ provider: effective.provider, id: effective.id, key });
			setTest((t) => ({ busy: false, ok: r.ok, text: r.ok ? `Replied "${r.reply || "(empty)"}" in ${((r.ms ?? 0) / 1000).toFixed(1)} s` : r.error, n: t.n + 1 }));
		} catch (e) {
			setTest((t) => ({ busy: false, ok: false, text: (e as Error).message, n: t.n + 1 }));
		}
	};

	const showMsg = needsKey || !!test.text;
	if (needsKey) lastMsg.current = { ok: false, n: -1, text: <><WarningIcon size={12} aria-hidden="true" /> Add your {PROVIDER_INFO[effective.provider].label} key below, or this model won't run.</> };
	else if (test.text) lastMsg.current = { ok: !!test.ok, n: test.n, text: <>{test.ok ? <CheckIcon size={12} weight="bold" aria-hidden="true" /> : <WarningIcon size={12} aria-hidden="true" />} {test.text}</> };
	const msg = lastMsg.current;

	return (
		<div key="card" className="pg-models pg-model-view" data-enter={enter}>
			<div className="pg-model-card">
				<b className="pg-model-card-name">{model.name}</b>
				<dl className="pg-model-facts">
					<div><dt>Provider</dt><dd><ProviderMark provider={effective.provider} /></dd></div>
					{maker.label !== PROVIDER_INFO[effective.provider].label && <div><dt>Maker</dt><dd>{maker.label}</dd></div>}
					<div><dt>Model ID</dt><dd><code>{effective.id}</code></dd></div>
					<div><dt>Retention</dt><dd>{model.zdr || PROVIDER_INFO[effective.provider].zdr
						? <span className="pg-zdr"><ShieldCheckIcon size={14} aria-hidden="true" />Zero retention</span>
						: "Not promised"}</dd></div>
					<div><dt>Context</dt><dd>{formatContext(model.context)}</dd></div>
					<div><dt>Price</dt><dd>{model.price
						? <>{formatPrice(model.price.input)} in <span className="pg-model-slash">/</span> <b>{formatPrice(model.price.output)}</b> out <span className="pg-model-unit">per 1M tokens</span></>
						: "–"}</dd></div>
					{model.tools === false && <div><dt>Tools</dt><dd>None</dd></div>}
				</dl>
				<Reveal open={showMsg} kind="panel">
					{msg && <p className="pg-model-current-msg" data-ok={String(msg.ok)} role="status"><span key={msg.n}>{msg.text}</span></p>}
				</Reveal>
				<div className="pg-model-card-actions">
					<button ref={change} type="button" className="pg-btn pg-btn-sm pg-btn-primary" onClick={() => { setEnter("forward"); setPicking(true); }}>Change model</button>
					{/* Both faces share one cell, so the button keeps its width while it works. */}
					<button type="button" className="pg-btn pg-btn-sm pg-model-test" onClick={runTest} disabled={test.busy || needsKey} aria-busy={test.busy || undefined}>
						<span data-face="idle" aria-hidden={test.busy || undefined}>Test</span>
						<span data-face="busy" aria-hidden={!test.busy || undefined}><i aria-hidden="true" />Testing</span>
					</button>
				</div>
			</div>

			<div className="pg-models-head"><b>Providers</b></div>
			<ProviderTable
				draft={draft}
				counts={Object.fromEntries(PROVIDERS.map((p) => [p, catalog.providers[p]?.models.length ?? 0])) as Record<ProviderId, number>}
				zdrCounts={Object.fromEntries(PROVIDERS.map((p) => [p, catalog.providers[p]?.models.filter((m) => m.zdr).length ?? 0])) as Record<ProviderId, number>}
				openKey={openKey}
				highlight={needsKey ? effective.provider : null}
				onToggle={(p) => setOpenKey(openKey === p ? null : p)}
			/>
			<Note>Free models are turned off. Free endpoints can keep and train on prompts.</Note>
		</div>
	);
}
