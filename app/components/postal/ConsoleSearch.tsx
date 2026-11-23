// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { ListIcon, MagnifyingGlassIcon, XIcon } from "@phosphor-icons/react";
import { forwardRef, useImperativeHandle, useRef, useState } from "react";
import { AgentIcon } from "./AgentIcon";
import { Keys } from "./shortcuts";

/** Something the console search can open: a page, an agent or a draft waiting for review. */
export interface ConsoleHit {
	id: string;
	section: "Pages" | "Agents" | "Review";
	label: string;
	detail?: string;
	/** Other words that find it, such as "api key" for Tools. */
	words?: string;
	icon: React.ReactNode;
	run: () => void;
}

const SECTIONS = ["Pages", "Agents", "Review"] as const;
const LIMIT = 6;

function rank(hit: ConsoleHit, q: string): number {
	const label = hit.label.toLowerCase();
	if (label.startsWith(q)) return 0;
	if (label.includes(q)) return 1;
	if (hit.words?.toLowerCase().includes(q)) return 2;
	if (hit.detail?.toLowerCase().includes(q)) return 3;
	return -1;
}

export interface ConsoleSearchHandle { focus: () => void }

/** The console's search bar: the same bar as mail's, searching pages, agents and drafts instead of mail. */
export const ConsoleSearch = forwardRef<ConsoleSearchHandle, { hits: ConsoleHit[]; onMenu: () => void; onAgent: () => void }>(
	function ConsoleSearch({ hits, onMenu, onAgent }, ref) {
		const box = useRef<HTMLInputElement>(null);
		const [text, setText] = useState("");
		const [open, setOpen] = useState(false);
		const [active, setActive] = useState(0);
		useImperativeHandle(ref, () => ({ focus: () => box.current?.focus() }), []);

		const q = text.trim().toLowerCase();
		const found = q
			? hits.map((h) => ({ h, r: rank(h, q) })).filter((x) => x.r >= 0).sort((a, b) => a.r - b.r).map((x) => x.h)
			: hits.filter((h) => h.section === "Pages");
		const sections = SECTIONS.map((s) => ({ name: s, rows: found.filter((h) => h.section === s).slice(0, q ? LIMIT : 20) })).filter((s) => s.rows.length);
		const rows = sections.flatMap((s) => s.rows);
		const at = Math.min(active, Math.max(rows.length - 1, 0));

		const pick = (hit: ConsoleHit | undefined) => {
			if (!hit) return;
			hit.run();
			setText("");
			setOpen(false);
			box.current?.blur();
		};
		const onKey = (e: React.KeyboardEvent) => {
			if (e.key === "ArrowDown" || e.key === "ArrowUp") {
				e.preventDefault();
				setOpen(true);
				setActive((at + (e.key === "ArrowDown" ? 1 : -1) + rows.length) % Math.max(rows.length, 1));
			} else if (e.key === "Enter") {
				e.preventDefault();
				pick(rows[at]);
			} else if (e.key === "Escape") {
				e.preventDefault();
				if (text) setText("");
				else box.current?.blur();
			}
		};

		return (
			<div className="pg-search-wrap pg-console-search">
				<div className="pg-search" data-suggest={open} data-active={!!text || open} role="search">
					<button type="button" className="pg-icon-btn pg-mobile-only" onClick={onMenu} aria-label="Open menu">
						<ListIcon size={16} />
					</button>
					<MagnifyingGlassIcon size={14} className="pg-search-icon" aria-hidden />
					<input
						ref={box}
						value={text}
						onChange={(e) => { setText(e.target.value); setActive(0); setOpen(true); }}
						onFocus={() => setOpen(true)}
						onBlur={() => setOpen(false)}
						onKeyDown={onKey}
						placeholder="Search the console"
						aria-label="Search the console"
						role="combobox"
						aria-expanded={open}
						aria-controls="pg-console-sw"
						aria-activedescendant={open && rows[at] ? `pg-csw-${rows[at].id}` : undefined}
						autoComplete="off"
						spellCheck={false}
					/>
					{text && (
						<button type="button" className="pg-clear" aria-label="Clear search" onMouseDown={(e) => { e.preventDefault(); setText(""); }}>
							<XIcon size={14} />
						</button>
					)}
					<Keys id="search" className="pg-kbd pg-desktop-only" />
					<button type="button" className="pg-icon-btn pg-mobile-only" onClick={onAgent} aria-label="Open agent">
						<AgentIcon size={16} weight="fill" />
					</button>
				</div>
				{open && (
					<div className="pg-popover pg-sw" id="pg-console-sw" role="listbox" aria-label="Console results" onMouseDown={(e) => e.preventDefault()}>
						<div className="pg-sw-body">
							{rows.length === 0 && <p className="pg-ui-note pg-console-sw-none">Nothing in the console matches “{text.trim()}”.</p>}
							{sections.map((s) => (
								<div key={s.name} className="pg-sw-section">
									<span className="pg-caption">{q ? s.name : "Go to"}</span>
									{s.rows.map((h) => (
										<button
											key={h.id}
											id={`pg-csw-${h.id}`}
											type="button"
											role="option"
											aria-selected={rows[at] === h}
											className="pg-menu-item pg-sw-row"
											data-active={rows[at] === h}
											onMouseEnter={() => setActive(rows.indexOf(h))}
											onClick={() => pick(h)}
										>
											<span className="pg-sw-icon">{h.icon}</span>
											<span className="pg-flex pg-ellipsis">
												<span className="pg-sw-name">{h.label}</span>
												{h.detail && <span className="pg-sw-detail">{h.detail}</span>}
											</span>
										</button>
									))}
								</div>
							))}
						</div>
					</div>
				)}
			</div>
		);
	},
);
