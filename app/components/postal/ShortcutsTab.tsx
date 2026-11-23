// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

/**
 * The list of every shortcut, by group. Settings > Shortcuts edits it under the
 * keyboard map (ShortcutsPage): click a shortcut's keys, in the list or on the
 * map, then press the new key. The ? dialog shows it read-only.
 */

import { XIcon } from "@phosphor-icons/react";
import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import {
	cannotBind, isRebindable, keycaps, ownerOf, type RebindableId, rebind, resolveBindings, SHORTCUT_GROUPS, SHORTCUTS,
	type ShortcutDef, type ShortcutId, type ShortcutOverrides, shortcut, stepOf,
} from "shared/shortcuts";
import { ShortcutMap } from "./ShortcutMap";
import { isMac } from "./shortcuts";

const SCOPE_NOTE: Record<ShortcutDef["scope"], string | null> = { mail: null, compose: "In the composer", search: "In the search box" };

function Caps({ binding, mac }: { binding: string; mac: boolean }) {
	return (
		<span className="pg-keys-caps">
			{keycaps(binding, mac).map((cap, i) => <kbd key={i} className="pg-kbd">{cap}</kbd>)}
		</span>
	);
}

/** Settings > Keyboard shortcuts: the keyboard map, live with the keys being edited, over the full list. */
export function ShortcutsPage({ overrides, onChange }: { overrides: ShortcutOverrides; onChange: (next: ShortcutOverrides) => void }) {
	const bindings = useMemo(() => resolveBindings(overrides), [overrides]);
	const [recording, setRecording] = useState<RebindableId | null>(null);
	const [picked, setPicked] = useState(0);
	const pick = (id: RebindableId) => { setRecording(recording === id ? null : id); setPicked((n) => n + 1); };
	return (
		<>
			<ShortcutMap edit={{ bindings, onPick: pick, recording }} />
			<ShortcutList overrides={overrides} onChange={onChange} recording={recording} onRecording={setRecording} reveal={picked} />
		</>
	);
}

export function ShortcutList({ overrides, onChange, recording: heldRecording, onRecording, reveal }: {
	overrides: ShortcutOverrides;
	onChange?: (next: ShortcutOverrides) => void;
	/** Held by ShortcutsPage, so a key picked on the map records here. */
	recording?: RebindableId | null;
	onRecording?: (id: RebindableId | null) => void;
	/** Bumped when the map picks a key: the row being recorded scrolls into view. */
	reveal?: number;
}) {
	const mac = useMemo(isMac, []);
	const bindings = useMemo(() => resolveBindings(overrides), [overrides]);
	const [ownRecording, setOwnRecording] = useState<RebindableId | null>(null);
	const recording = onRecording ? heldRecording ?? null : ownRecording;
	const setRecording = onRecording ?? setOwnRecording;
	const rows = useRef(new Map<ShortcutId, HTMLDivElement>());
	useEffect(() => {
		if (reveal && recording) rows.current.get(recording)?.scrollIntoView({ block: "center", behavior: "smooth" });
	}, [reveal]); // eslint-disable-line react-hooks/exhaustive-deps
	const [note, setNote] = useState<{ id: ShortcutId; text: string; error?: boolean } | null>(null);

	// While recording, the next key is the new binding. Capturing on window runs before the dialog's own Escape and Tab handling.
	useEffect(() => {
		if (!recording || !onChange) return;
		const onKey = (e: KeyboardEvent) => {
			const step = stepOf(e);
			if (!step) return;
			e.preventDefault();
			e.stopPropagation();
			if (step === "Escape") {
				setRecording(null);
				return;
			}
			const reason = cannotBind(step);
			if (reason) {
				setNote({ id: recording, text: reason, error: true });
				return;
			}
			const from = ownerOf(bindings, step);
			onChange(rebind(overrides, recording, [step]));
			setNote(from && from !== recording ? { id: recording, text: `Taken from ${shortcut(from).label}` } : null);
			setRecording(null);
		};
		window.addEventListener("keydown", onKey, true);
		return () => window.removeEventListener("keydown", onKey, true);
	}, [recording, onChange, overrides, bindings]);

	const edited = Object.keys(overrides).length > 0;

	return (
		<div className="pg-keys">
			{onChange && edited && (
				<div className="pg-keys-intro">
					<span className="pg-flex" />
					<button type="button" className="pg-btn pg-btn-sm pg-btn-quiet" onClick={() => { setRecording(null); setNote(null); onChange({}); }}>
						Reset all
					</button>
				</div>
			)}
			{SHORTCUT_GROUPS.map((group) => (
				<section key={group} className="pg-keys-group" aria-label={group}>
					<h3>{group}</h3>
					{SHORTCUTS.filter((s) => s.group === group).map((s: ShortcutDef) => {
						const id = s.id as ShortcutId;
						const keys = bindings.get(id) ?? [];
						const editable = !!onChange && isRebindable(id);
						const isRecording = recording === id;
						const changed = isRebindable(id) && overrides[id] !== undefined;
						const scope = SCOPE_NOTE[s.scope];
						const rowNote = note?.id === id ? note : null;
						const caps = keys.length
							? keys.map((k, i) => <Fragment key={k}>{i > 0 && <span className="pg-keys-or">or</span>}<Caps binding={k} mac={mac} /></Fragment>)
							: <span className="pg-keys-none">None</span>;
						return (
							<div key={id} ref={(el) => { if (el) rows.current.set(id, el); else rows.current.delete(id); }} className="pg-keys-row" data-recording={isRecording || undefined}>
								<div className="pg-keys-text">
									<span>{s.label}</span>
									{(s.hint || scope || rowNote) && (
										<small data-error={rowNote?.error || undefined} role={rowNote ? "status" : undefined}>
											{rowNote?.text ?? [scope, s.hint].filter(Boolean).join(". ")}
										</small>
									)}
								</div>
								{editable ? (
									<>
										{changed && !isRecording && (
											<button
												type="button"
												className="pg-btn pg-btn-sm pg-btn-quiet"
												onClick={() => { setNote(null); onChange!(rebind(overrides, id as RebindableId, [...s.keys])); }}
											>
												Reset
											</button>
										)}
										{keys.length > 0 && !isRecording && (
											<button
												type="button"
												className="pg-keys-off"
												title={`Turn off ${s.label}`}
												aria-label={`Turn off ${s.label}`}
												onClick={() => { setNote(null); onChange!(rebind(overrides, id as RebindableId, [])); }}
											>
												<XIcon size={12} />
											</button>
										)}
										<button
											type="button"
											className="pg-keys-edit"
											aria-label={isRecording ? `Press a key for ${s.label}` : `Change the keys for ${s.label}`}
											aria-pressed={isRecording}
											onClick={() => { setNote(null); setRecording(isRecording ? null : (id as RebindableId)); }}
										>
											{isRecording ? <span className="pg-keys-wait">Press a key</span> : caps}
										</button>
									</>
								) : (
									<span className="pg-keys-fixed">{caps}</span>
								)}
							</div>
						);
					})}
				</section>
			))}
		</div>
	);
}
