// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

/**
 * One tooltip for every button in the postal view.
 *
 * Buttons keep using `title` (or `data-tip`). On first hover the title moves
 * to `data-tip` so the browser's own tooltip never shows. Titles follow
 * "Label (Key) · hint": the key becomes keycaps, the hint a second line.
 * With key hints off (data-keys="off" on .postal) the keycaps are left out.
 * `data-tip-hint` adds a hint without touching the title. Icon-only buttons
 * with only an `aria-label` get a tooltip from that.
 */

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

const BUTTONS = "button, a[href], [role='button'], [role='switch'], [role='tab']";
const TARGETS = `${BUTTONS}, [data-tip]`;
const DELAY_MS = 450;
const WARM_MS = 500;
const GAP = 8;
const EDGE = 8;

export interface TipContent {
	label: string;
	keys: string[];
	hint?: string;
}

const MODIFIERS = new Set(["⌘", "⇧", "⌥", "⌃"]);

/** Split "⌘↵" into ["⌘", "↵"], "Ctrl+K" into ["Ctrl", "K"], "G I" into ["G", "I"] and "Esc" into ["Esc"]. */
export function splitKeys(keys: string): string[] {
	return keys.trim().split(/\s+/).flatMap((step) => {
		const out: string[] = [];
		let rest = step;
		for (;;) {
			const word = /^(Ctrl|Alt|Shift)\+(.+)$/.exec(rest);
			if (word) {
				out.push(word[1]);
				rest = word[2];
			} else if (rest.length > 1 && MODIFIERS.has(rest[0])) {
				out.push(rest[0]);
				rest = rest.slice(1);
			} else break;
		}
		if (rest) out.push(rest);
		return out;
	});
}

/** "Select (X) · shift-click for a range" → label, keycaps, hint. */
export function parseTip(text: string, extraHint?: string | null): TipContent | null {
	const [head, ...rest] = text.split(" · ");
	const main = head.trim();
	if (!main) return null;
	const match = /^(.*\S)\s*\(([^()]{1,12})\)$/.exec(main);
	const hint = [rest.join(" · ").trim(), extraHint?.trim()].filter(Boolean).join(". ");
	return {
		label: match ? match[1] : main,
		keys: match ? splitKeys(match[2]) : [],
		hint: hint || undefined,
	};
}

/** Move a title to data-tip so the browser's own tooltip never shows. */
function adoptTitle(el: Element) {
	// A frame's title is its accessible name, not a tooltip.
	if (el.tagName === "IFRAME") return;
	const title = el.getAttribute("title");
	if (title === null) return;
	el.removeAttribute("title");
	if (!title) return;
	el.setAttribute("data-tip", title);
	// The title was the accessible name of an icon-only button; keep it.
	if (el.matches(BUTTONS) && !el.hasAttribute("aria-label") && !el.textContent?.trim()) el.setAttribute("aria-label", title.split(" · ")[0]);
}

function adoptAll(node: Node) {
	if (!(node instanceof Element)) return;
	adoptTitle(node);
	for (const el of node.querySelectorAll("[title]")) adoptTitle(el);
}

function tipFor(el: HTMLElement): TipContent | null {
	adoptTitle(el);
	const text = el.getAttribute("data-tip") ?? (!el.textContent?.trim() ? el.getAttribute("aria-label") : null);
	if (!text) return null;
	const tip = parseTip(text, el.getAttribute("data-tip-hint"));
	if (!tip) return null;
	if (el.closest(".postal")?.getAttribute("data-keys") === "off") tip.keys = [];
	// A tooltip that repeats the button's own text adds nothing.
	const visible = el.textContent?.trim().toLowerCase() ?? "";
	if (!tip.keys.length && !tip.hint && visible === tip.label.toLowerCase()) return null;
	return tip;
}

interface Shown {
	anchor: HTMLElement;
	tip: TipContent;
}

export function TooltipLayer() {
	const ref = useRef<HTMLDivElement>(null);
	const [shown, setShown] = useState<Shown | null>(null);
	const [place, setPlace] = useState<{ left: number; top: number; side: "above" | "below" } | null>(null);
	const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
	const lastHide = useRef(0);
	const current = useRef<HTMLElement | null>(null);
	const suppressed = useRef<HTMLElement | null>(null);
	const shownRef = useRef<Shown | null>(null);
	shownRef.current = shown;

	const hide = useCallback(() => {
		clearTimeout(timer.current);
		if (current.current) lastHide.current = Date.now();
		current.current = null;
		setShown(null);
		setPlace(null);
	}, []);

	useEffect(() => {
		const root = ref.current?.closest<HTMLElement>(".postal");
		if (!root) return;

		const targetOf = (node: EventTarget | null) => {
			const el = node instanceof Element ? node.closest<HTMLElement>(TARGETS) : null;
			return el && root.contains(el) && !el.closest(".pg-tip") ? el : null;
		};

		const show = (el: HTMLElement, immediate: boolean) => {
			if (current.current === el) return;
			clearTimeout(timer.current);
			const tip = tipFor(el);
			if (!tip) {
				if (current.current) hide();
				return;
			}
			current.current = el;
			const open = () => {
				if (current.current !== el || !el.isConnected) return;
				setPlace(null);
				setShown({ anchor: el, tip });
			};
			if (immediate || Date.now() - lastHide.current < WARM_MS || shownRef.current) open();
			else timer.current = setTimeout(open, DELAY_MS);
		};

		const onOver = (e: PointerEvent) => {
			if (e.pointerType === "touch") return;
			const el = targetOf(e.target);
			if (!el) return;
			if (suppressed.current === el) return;
			suppressed.current = null;
			show(el, false);
		};
		const onOut = (e: PointerEvent) => {
			const el = current.current ?? suppressed.current;
			if (!el) return;
			const next = e.relatedTarget instanceof Node ? e.relatedTarget : null;
			if (next && el.contains(next)) return;
			if (suppressed.current === el) suppressed.current = null;
			if (current.current === el) hide();
		};
		const onDown = () => {
			if (current.current) suppressed.current = current.current;
			hide();
		};
		const onFocus = (e: FocusEvent) => {
			const el = targetOf(e.target);
			if (el && el.matches(":focus-visible")) show(el, true);
		};
		const onBlur = () => {
			if (current.current && !current.current.matches(":hover")) hide();
		};
		const onKey = (e: KeyboardEvent) => {
			if (e.key === "Escape" && current.current) hide();
		};

		// Titles set now or later (a Star button that becomes Unstar) become data-tip at once.
		adoptAll(root);
		const observer = new MutationObserver((records) => {
			for (const r of records) {
				if (r.type === "attributes") adoptTitle(r.target as Element);
				else r.addedNodes.forEach(adoptAll);
				if (r.type === "attributes" && r.target === current.current && shownRef.current) {
					const tip = tipFor(current.current);
					if (tip) setShown({ anchor: current.current, tip });
				}
			}
		});
		observer.observe(root, { subtree: true, childList: true, attributes: true, attributeFilter: ["title"] });

		root.addEventListener("pointerover", onOver);
		root.addEventListener("pointerout", onOut);
		root.addEventListener("pointerdown", onDown, true);
		root.addEventListener("focusin", onFocus);
		root.addEventListener("focusout", onBlur);
		window.addEventListener("keydown", onKey, true);
		window.addEventListener("scroll", hide, true);
		window.addEventListener("resize", hide);
		window.addEventListener("blur", hide);
		return () => {
			clearTimeout(timer.current);
			observer.disconnect();
			root.removeEventListener("pointerover", onOver);
			root.removeEventListener("pointerout", onOut);
			root.removeEventListener("pointerdown", onDown, true);
			root.removeEventListener("focusin", onFocus);
			root.removeEventListener("focusout", onBlur);
			window.removeEventListener("keydown", onKey, true);
			window.removeEventListener("scroll", hide, true);
			window.removeEventListener("resize", hide);
			window.removeEventListener("blur", hide);
		};
	}, [hide]);

	// Above the button, or below when there is no room; kept inside the window.
	useLayoutEffect(() => {
		const tipEl = ref.current?.querySelector<HTMLElement>(".pg-tip");
		if (!shown || !tipEl) return;
		if (!shown.anchor.isConnected) {
			hide();
			return;
		}
		const r = shown.anchor.getBoundingClientRect();
		const w = tipEl.offsetWidth;
		const h = tipEl.offsetHeight;
		const above = r.top - GAP - h >= EDGE;
		const left = Math.min(Math.max(EDGE, r.left + r.width / 2 - w / 2), window.innerWidth - w - EDGE);
		setPlace({ left, top: above ? r.top - GAP - h : r.bottom + GAP, side: above ? "above" : "below" });
	}, [shown, hide]);

	// A button that disappears (closed menu, removed row) takes its tooltip with it.
	useEffect(() => {
		if (!shown) return;
		const id = setInterval(() => {
			if (!shown.anchor.isConnected) hide();
		}, 250);
		return () => clearInterval(id);
	}, [shown, hide]);

	return (
		<div ref={ref} className="pg-tip-layer" aria-hidden>
			{shown && (
				<div
					className="pg-tip"
					data-side={place?.side ?? "above"}
					data-ready={place ? "" : undefined}
					style={place ? { left: place.left, top: place.top } : { left: -9999, top: -9999 }}
				>
					<div className="pg-tip-main">
						<span className="pg-tip-label">{shown.tip.label}</span>
						{shown.tip.keys.length > 0 && (
							<span className="pg-tip-keys">
								{shown.tip.keys.map((k, i) => <kbd key={i} className="pg-kbd">{k}</kbd>)}
							</span>
						)}
					</div>
					{shown.tip.hint && <div className="pg-tip-hint">{shown.tip.hint}</div>}
				</div>
			)}
		</div>
	);
}
