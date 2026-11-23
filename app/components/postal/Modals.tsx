// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { hasText, withSignatureText } from "./signature-state";
import { ArrowCounterClockwiseIcon, DesktopIcon, KeyboardIcon, MoonIcon, SignOutIcon, SunIcon, XIcon } from "@phosphor-icons/react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { queryKeys } from "~/queries/keys";
import api from "~/services/api";
import { AgentModelSection, modelName, useAgentModelDraft, useModelCatalog } from "./ModelTab";
import { Segmented } from "./Segmented";
import { type AddressInfo, textToParagraphs } from "./compose";
import { Editor } from "./Editor";
import { getSignatureBlock, htmlToPlainText } from "~/lib/utils";
import { AddressText, handleOf, type Identities, Swatch } from "./identity";
import { LabelsTab } from "./LabelsTab";
import type { ConsoleTab } from "./console-tabs";
import { useDemo } from "~/lib/demo";
import { LimitsTab, useAgentLimitsDraft } from "./LimitsTab";
import { ActivityTab } from "./ActivityTab";
import { StorageTab } from "./StorageTab";
import { BlockedSenders } from "./BlockedSenders";
import { receivedCount, ROUTING_URL } from "./routing-guide";
import type { Prefs } from "./prefs";
import { ShortcutMap } from "./ShortcutMap";
import { samePrefs, TRASH_DAYS, type TrashDays } from "shared/prefs";
import { Keys } from "./shortcuts";
import { ShortcutsPage } from "./ShortcutsTab";
import { Badge, Button, CopyField, Field, Fields, Item, List, Note, SaveBar, Section, Summary, SummaryRow, Table } from "./ConsoleUI";
import { SEND_LIMITS } from "shared/send-limits";

export { Head, Modal, Switch } from "./Dialog";
import { Head, Modal, Switch } from "./Dialog";

/** Whether signature HTML has any text in it. */

/** A setting on one line: the console's inline `Field`. */
function Setting({ title, sub, children }: { title: string; sub?: React.ReactNode; children: React.ReactNode }) {
	return <Field inline label={title} hint={sub}>{children}</Field>;
}

/**
 * The console pages that edit saved settings: the mail client's settings, the
 * PlaraMail Agent, Models and Logs. Changes save on their own: switches and choices
 * at once, typing once it pauses.
 */
export function ConsoleSettings({ tab, onTab, prefs, setPrefs, addresses, identities, info, autoDraft }: {
	tab: ConsoleTab;
	onTab: (tab: ConsoleTab) => void;
	prefs: Prefs;
	setPrefs: (p: Partial<Prefs>) => Promise<unknown>;
	addresses: string[];
	identities: Identities;
	info: ReadonlyMap<string, AddressInfo>;
	autoDraft: boolean;
}) {
	// A demo's settings are read-only apart from Labels: the server refuses every other save.
	const readOnly = useDemo() && READ_ONLY_IN_DEMO.has(tab);
	const loadedSigs = Object.fromEntries(addresses.map((a) => {
		const sig = info.get(a)?.mailbox?.settings?.signature;
		const html = sig?.html || (sig?.text ? textToParagraphs(sig.text) : "");
		return [a, { html, enabled: !!sig?.enabled && !!html }];
	}));
	const [sigs, setSigs] = useState<Record<string, { html: string; enabled: boolean }>>(loadedSigs);
	// What the server holds. Moves forward after each save, ahead of the mailbox refetch.
	const [initialSigs, setInitialSigs] = useState(loadedSigs);
	// With no signatures anywhere, open the first address so there is somewhere to start.
	const [sigOpen, setSigOpen] = useState<string | null>(() => addresses.some((a) => loadedSigs[a]?.html) ? null : addresses[0] ?? null);
	const [sigFocus, setSigFocus] = useState(false);
	/** Sets these addresses' signature. Writing a first signature turns it on; clearing one turns it off. */
	const writeSigs = (to: string[], html: string) => setSigs((cur) => {
		const next = { ...cur };
		for (const a of to) {
			next[a] = withSignatureText(cur[a] ?? { html: "", enabled: false }, html);
		}
		return next;
	});
	const sigChanged = (a: string) => (sigs[a]?.html ?? "") !== (initialSigs[a]?.html ?? "") || !!sigs[a]?.enabled !== !!initialSigs[a]?.enabled;
	const [draft, setDraft] = useState<Prefs>(prefs);
	const [initialNames, setInitialNames] = useState(() => Object.fromEntries(addresses.map((a) => [a, info.get(a)?.mailbox?.settings?.fromName ?? info.get(a)?.name ?? ""])));
	const [names, setNames] = useState<Record<string, string>>(initialNames);
	// The same counts as Mail storage; an address with nothing received shows how to route mail to it (WON-228).
	const storage = useQuery({ queryKey: ["storage-status"], queryFn: () => api.getStorageStatus(), enabled: tab === "addresses" });
	const [initialPrompts, setInitialPrompts] = useState(() => Object.fromEntries(addresses.map((a) => [a, info.get(a)?.mailbox?.settings?.agentSystemPrompt ?? ""])));
	const [prompts, setPrompts] = useState<Record<string, string>>(initialPrompts);
	const promptChanged = (a: string) => (prompts[a] ?? "").trim() !== (initialPrompts[a] ?? "").trim();
	const [promptFor, setPromptFor] = useState(addresses[0] ?? "");
	const prompt = prompts[promptFor] ?? "";
	const setPrompt = (value: string) => setPrompts({ ...prompts, [promptFor]: value });
	const [saving, setSaving] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const queryClient = useQueryClient();
	const agentModel = useAgentModelDraft();
	const limits = useAgentLimitsDraft();
	const { data: catalog } = useModelCatalog(tab === "mailroom");

	const prefsDirty = !samePrefs(draft, prefs);
	// Typed fields wait for a pause; switches and choices save at once.
	const typedDirty = addresses.some((a) => (names[a] ?? "") !== (initialNames[a] ?? ""))
		|| addresses.some(promptChanged)
		|| addresses.some(sigChanged)
		|| Object.keys(agentModel.keys).length > 0
		|| (limits.dirty && limits.valid);
	const dirty = prefsDirty || typedDirty || agentModel.dirty;

	const save = async () => {
		// Limits are the one tab that can refuse a save; check them before anything is written.
		const limitsError = limits.dirty ? limits.check() : null;
		if (limitsError) {
			setError(limitsError);
			return;
		}
		setSaving(true);
		setError(null);
		try {
			const writes: Promise<unknown>[] = addresses.flatMap((a) => {
				const mailbox = info.get(a)?.mailbox;
				if (!mailbox) return [];
				const name = (names[a] ?? "").trim();
				const nameChanged = name !== (initialNames[a] ?? "").trim();
				const signatureChanged = sigChanged(a);
				if (!nameChanged && !promptChanged(a) && !signatureChanged) return [];
				const sig = sigs[a];
				const empty = !hasText(sig?.html ?? "");
				const settings = {
					...mailbox.settings,
					...(nameChanged ? { fromName: name } : {}),
					agentSystemPrompt: (prompts[a] ?? "").trim() || undefined,
					...(signatureChanged ? { signature: empty ? { enabled: false, text: "" } : { enabled: sig.enabled, text: htmlToPlainText(sig.html), html: sig.html } } : {}),
				};
				return [api.updateMailbox(a, settings)];
			});
			if (!samePrefs(draft, prefs)) writes.push(setPrefs(draft));
			if (agentModel.dirty) writes.push(agentModel.save());
			if (limits.dirty && limits.valid) writes.push(limits.save());
			await Promise.all(writes);
			setInitialNames(names);
			setInitialPrompts(prompts);
			setInitialSigs(sigs);
			for (const a of addresses) queryClient.invalidateQueries({ queryKey: queryKeys.mailboxes.detail(a) });
		} catch (e) {
			setError((e as Error).message || "Could not save settings.");
		} finally {
			setSaving(false);
		}
	};

	// A failed save waits for the next edit instead of retrying in a loop.
	useEffect(() => setError(null), [draft, names, prompts, sigs, agentModel.selected, agentModel.keys, limits.edits]);
	useEffect(() => {
		if (!dirty || saving || error) return;
		const t = setTimeout(() => void save(), typedDirty ? 700 : 0);
		return () => clearTimeout(t);
	}, [dirty, saving, error, prefs, draft, names, prompts, sigs, agentModel.selected, agentModel.keys, limits.edits]); // eslint-disable-line react-hooks/exhaustive-deps

	const [openRow, setOpenRow] = useState<"prompt" | "limits" | null>(null);
	const custom = addresses.filter((a) => (prompts[a] ?? "").trim());
	const mailroom = (
		<Section title="How it works">
			<Summary>
				<SummaryRow
					label="Prompt" open={openRow === "prompt"} onEdit={() => setOpenRow(openRow === "prompt" ? null : "prompt")}
					editor={<>
						{addresses.length > 1 && (
							<select className="pg-select" value={promptFor} aria-label="Address this prompt is for" onChange={(e) => setPromptFor(e.target.value)}>
								{addresses.map((a) => <option key={a} value={a}>{a}</option>)}
							</select>
						)}
						<textarea
							className="pg-textarea pg-ui-ask-input"
							rows={8}
							value={prompt}
							aria-label={`Agent prompt for ${promptFor}`}
							onChange={(e) => setPrompt(e.target.value)}
							placeholder="You are an email assistant that helps manage this inbox. You read emails, draft replies, and help organize conversations. Write like a real person. Short, direct, flowing prose. Plain text only. (Leave empty to use the built-in default prompt)"
						/>
						<div className="pg-ui-toolbar">
							{addresses.length > 1 && addresses.some((a) => (prompts[a] ?? "").trim() !== prompt.trim()) && (
								<Button size="sm" variant="quiet" onClick={() => setPrompts(Object.fromEntries(addresses.map((a) => [a, prompt])))}>Use for every address</Button>
							)}
							{prompt.trim() && <Button size="sm" variant="quiet" icon={<ArrowCounterClockwiseIcon size={12} />} onClick={() => setPrompt("")}>Reset to default</Button>}
						</div>
					</>}
				>
					{custom.length === 0 ? "Default" : custom.length === addresses.length ? "Custom" : `Custom for ${custom.length} of ${addresses.length} addresses`}
					<span className="pg-ui-sum-sub">Draft reply, the fallback draft, and chat while a message is open</span>
				</SummaryRow>
				<SummaryRow label="Model" editLabel="Change" onEdit={() => onTab("models")}>
					{agentModel.stored ? modelName(catalog, agentModel.stored.active) : "Not set"}
				</SummaryRow>
				<SummaryRow
					label="Limits" open={openRow === "limits"} onEdit={() => setOpenRow(openRow === "limits" ? null : "limits")}
					editor={<Fields><LimitsTab draft={limits} /></Fields>}
				>
					{limits.text("agentDay")} sends a day · {limits.text("agentRecipients")} recipients · {limits.text("autoDraftPerSender")} drafts per sender
					<span className="pg-ui-sum-sub">Per address, inside {SEND_LIMITS.day} a day for everyone</span>
				</SummaryRow>
			</Summary>
		</Section>
	);

	if (tab === "mailroom") return <>{mailroom}{error && <SaveBar error={error} saving={saving} onSave={() => void save()} />}</>;
	return (
		<fieldset className="pg-plain-fieldset" disabled={readOnly}>
			<Fields>
					{tab === "general" && (
						<>
							<Setting title="Theme">
								<Segmented
									label="Theme"
									value={draft.theme}
									onChange={(theme) => setDraft({ ...draft, theme })}
									options={[
										{ value: "dark", label: "Dark", icon: <MoonIcon size={12} /> },
										{ value: "light", label: "Light", icon: <SunIcon size={12} /> },
										{ value: "system", label: "System", icon: <DesktopIcon size={12} /> },
									]}
								/>
							</Setting>
							<Setting title="Show key hints">
								<Switch label="Show key hints" on={draft.keys} onChange={(keys) => setDraft({ ...draft, keys })} />
							</Setting>
							<Setting title="Mark as read when opened">
								<Switch label="Mark as read when opened" on={draft.markRead} onChange={(markRead) => setDraft({ ...draft, markRead })} />
							</Setting>
							<Setting title="Remote images">
								<Segmented
									label="Remote images"
									value={draft.images}
									onChange={(images) => setDraft({ ...draft, images })}
									options={[{ value: "ask", label: "Ask" }, { value: "always", label: "Always" }, { value: "never", label: "Never" }]}
								/>
							</Setting>
							<Setting title="Reply from receiving address">
								<Switch label="Reply from receiving address" on={draft.replyFrom} onChange={(replyFrom) => setDraft({ ...draft, replyFrom })} />
							</Setting>
							<Setting title="Keep Trash and Spam">
								<Segmented
									label="Keep Trash and Spam"
									value={String(draft.trashDays)}
									onChange={(v) => setDraft({ ...draft, trashDays: Number(v) as TrashDays })}
									options={TRASH_DAYS.map((d) => ({ value: String(d), label: d ? `${d} days` : "Forever" }))}
								/>
							</Setting>
						</>
					)}
					{tab === "addresses" && (
						<>
							{identities.groups.map(({ identity, addresses: group }) => {
								const list = group.filter((a) => addresses.includes(a));
								if (!list.length) return null;
								return (
									<div key={identity.domain} className="pg-ui-addr-group">
										<h3 className="pg-ui-addr-domain"><Swatch identity={identity} />{identity.domain}</h3>
										{list.map((a) => {
											const loaded = !!info.get(a)?.mailbox;
											const silent = receivedCount(storage.data, a) === 0;
											const name = (names[a] ?? "").trim();
											const edited = name !== (initialNames[a] ?? "").trim();
											return (
												<Field
													key={a}
													label={<AddressText address={a} identity={identity} bold={false} />}
													hint={loaded ? (edited ? <Badge tone="draft">Edited</Badge> : undefined) : "Mailbox didn’t load. Reload to retry."}
												>
													<div className="pg-ui-addr-row">
														<input className="pg-input" value={names[a] ?? ""} placeholder={handleOf(a)} aria-label={`Display name for ${a}`} onChange={(e) => setNames({ ...names, [a]: e.target.value })} disabled={!loaded} />
														<span className="pg-ui-addr-preview" aria-label={`Recipients see ${name || handleOf(a)} <${a}>`}>
															<b>{name || handleOf(a)}</b> &lt;{a}&gt;
														</span>
													</div>
													{silent && (
														<Note tone="warn">
															No mail yet. In <a href={ROUTING_URL} target="_blank" rel="noreferrer">Email Routing</a> for {identity.domain}, send mail to this Worker with a catch-all rule: it covers every address on the domain, and the Worker turns away any not in <span className="pg-mono">EMAIL_ADDRESSES</span>. To reply, run <span className="pg-mono">npx wrangler email sending enable {identity.domain}</span>.
														</Note>
													)}
												</Field>
											);
										})}
									</div>
								);
							})}
							<Field label="Add an address" hint={<>Add it to <span className="pg-mono">EMAIL_ADDRESSES</span> in your Worker config and deploy. Its domain must be in <span className="pg-mono">DOMAINS</span>.</>}>
								<CopyField label="EMAIL_ADDRESSES config line" value={`"EMAIL_ADDRESSES": ${JSON.stringify(addresses)}`} />
							</Field>
							<Field label="Blocked senders">
								<BlockedSenders identities={identities} />
							</Field>
						</>
					)}
					{tab === "signatures" && (
						<>
							<List label="Signatures">
								{addresses.map((a) => {
									const id = identities.of(a);
									const sig = sigs[a] ?? { html: "", enabled: false };
									const has = hasText(sig.html);
									const on = sig.enabled && has;
									const domain = a.split("@")[1] ?? "";
									const sources = addresses.filter((b) => b !== a && hasText(sigs[b]?.html ?? ""));
									// Only addresses without a signature, so copying never overwrites one.
									const siblings = addresses.filter((b) => b !== a && b.split("@")[1] === domain && !hasText(sigs[b]?.html ?? ""));
									const fromName = (names[a] ?? "").trim() || handleOf(a);
									return (
										<Item
											key={a}
											title={<span className="pg-ui-name"><Swatch identity={id} /><AddressText address={a} identity={id} bold={false} /></span>}
											aside={<Badge tone={on ? "ok" : "neutral"} dot={on}>{on ? "Added by default" : has ? "Off" : "None"}</Badge>}
											quote={sigOpen === a ? undefined : has ? htmlToPlainText(sig.html).replace(/\s+/g, " ").trim() : "No signature"}
											open={sigOpen === a}
											onClick={() => { setSigOpen(sigOpen === a ? null : a); setSigFocus(true); }}
										>
											<div className="pg-sig-editor">
												<Editor
													value={sig.html}
													onChange={(html) => writeSigs([a], html)}
													placeholder="Write a signature"
													label={`Signature for ${a}`}
													autoFocus={sigFocus}
												/>
											</div>
											{(sources.length > 0 || (has && siblings.length > 0)) && (
												<div className="pg-ui-toolbar">
													{sources.length > 0 && (
														<select
															className="pg-select"
															value=""
															aria-label={`Copy a signature into ${a}`}
															onChange={(e) => e.target.value && writeSigs([a], sigs[e.target.value]?.html ?? "")}
														>
															<option value="">{has ? "Replace with…" : "Copy from…"}</option>
															{sources.map((b) => <option key={b} value={b}>{b}</option>)}
														</select>
													)}
													{has && siblings.length > 0 && (
														<Button size="sm" onClick={() => writeSigs(siblings, sig.html)}>
															{siblings.length === 1 ? `Copy to ${siblings[0]}` : `Copy to ${siblings.length} more @${domain} addresses`}
														</Button>
													)}
												</div>
											)}
											{has && (
												<div className="pg-sig-preview" aria-label="How it looks to the recipient">
													<span className="pg-sig-preview-from"><b>{fromName}</b> &lt;{a}&gt;</span>
													<span className="pg-sig-preview-body">Your message</span>
													<div className="pg-sig-preview-sig" dangerouslySetInnerHTML={{ __html: getSignatureBlock({ signature: { enabled: true, html: sig.html } }) }} />
												</div>
											)}
											<span className="pg-ui-switch-line">
												<Switch
													label={`Add the signature for ${a} by default`}
													on={on}
													disabled={!has}
													onChange={(enabled) => setSigs({ ...sigs, [a]: { ...sig, enabled } })}
												/>
												{has ? "Add to new messages by default" : "Write a signature to add it by default"}
											</span>
										</Item>
									);
								})}
							</List>
						</>
					)}
					{tab === "models" && <AgentModelSection draft={agentModel} />}
					{tab === "labels" && <LabelsTab />}
					{tab === "shortcuts" && (
						<>
							{/* The same switch as Preferences: key hints beside buttons and keys in tooltips. */}
							<Setting title="Show key hints">
								<Switch label="Show key hints" on={draft.keys} onChange={(keys) => setDraft({ ...draft, keys })} />
							</Setting>
							<ShortcutsPage overrides={draft.shortcuts} onChange={(shortcuts) => setDraft({ ...draft, shortcuts })} />
						</>
					)}
					{tab === "logs" && (
						<ActivityTab
							addresses={addresses}
							identities={identities}
							days={draft.activityDays}
							onDays={(activityDays) => setDraft({ ...draft, activityDays })}
							autoDraft={autoDraft}
						/>
					)}
					{tab === "storage" && <StorageTab identities={identities} />}
			</Fields>
			{error && <SaveBar error={error} saving={saving} onSave={() => void save()} />}
		</fieldset>
	);
}

/** Pages whose changes a demo refuses. Labels save through their own route, which a demo allows. */
const READ_ONLY_IN_DEMO = new Set<ConsoleTab>(["general", "addresses", "signatures", "shortcuts"]);

export function ShortcutsModal({ onClose, onEdit }: { onClose: () => void; onEdit: () => void }) {
	return (
		<Modal className="is-shortcuts" label="Keyboard shortcuts" onClose={onClose}>
			<Head icon={<KeyboardIcon size={16} />} title="Keyboard shortcuts" onClose={onClose} />
			<div className="pg-keys-scroll">
				<ShortcutMap onAll={onEdit} />
			</div>
			<div className="pg-modal-foot">
				<div className="pg-flex" />
				<button type="button" className="pg-btn" onClick={onEdit}>Change keys</button>
				<button type="button" className="pg-btn pg-btn-primary" onClick={onClose} data-autofocus>Done</button>
			</div>
		</Modal>
	);
}

export function LogoutModal({ onClose }: { onClose: () => void }) {
	return (
		<Modal className="is-small" label="Log out" onClose={onClose}>
			<Head icon={<SignOutIcon size={16} />} title="Log out?" sub="Cloudflare Access session" onClose={onClose} danger />
			<div style={{ padding: "16px 18px", display: "flex", flexDirection: "column", gap: 10, fontSize: 13, color: "var(--pg-text-5)", textWrap: "pretty" }}>
				<span>You’ll be signed out of Cloudflare Access on this device and returned to the login page.</span>
				<span>Mail keeps arriving. Scheduled mail still sends.</span>
			</div>
			<div className="pg-modal-foot">
				<div className="pg-flex" />
				<button type="button" className="pg-btn" onClick={onClose} data-autofocus>Cancel</button>
				<button type="button" className="pg-btn pg-btn-danger" onClick={() => { window.location.href = "/cdn-cgi/access/logout"; }}>
					<SignOutIcon size={14} weight="bold" />Log out
				</button>
			</div>
		</Modal>
	);
}

export interface ToastState {
	id: number;
	text: string;
	icon?: React.ReactNode;
	onUndo?: () => void;
}

export function Toast({ toast, onClose }: { toast: ToastState | null; onClose: () => void }) {
	useEffect(() => {
		if (!toast) return;
		const t = setTimeout(onClose, toast.onUndo ? 7000 : 5000);
		return () => clearTimeout(t);
	}, [toast, onClose]);
	if (!toast) return null;
	return (
		<div className="pg-toast" role="status" aria-live="polite">
			{toast.icon && <span style={{ display: "flex", color: "var(--pg-text-5)", marginRight: 4 }}>{toast.icon}</span>}
			<span className="pg-toast-text">{toast.text}</span>
			{toast.onUndo && (
				<>
					<span className="pg-sep" />
					<button type="button" className="pg-undo" onClick={toast.onUndo}>Undo<Keys id="undo" /></button>
				</>
			)}
			<button type="button" className="pg-x" aria-label="Dismiss" onClick={onClose} style={toast.onUndo ? undefined : { marginLeft: 6 }}><XIcon size={14} /></button>
		</div>
	);
}
