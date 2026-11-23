// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

/** The resolved shortcut keys for the mail view, so tooltips and key hints show the keys that work. */

import { createContext, useContext, useMemo } from "react";
import { keycaps, keyText, resolveBindings, type ShortcutId, type ShortcutOverrides } from "shared/shortcuts";

export function isMac(): boolean {
	if (typeof navigator === "undefined") return true;
	const platform = (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData?.platform ?? navigator.platform ?? "";
	return /mac|iphone|ipad|ipod/i.test(platform);
}

interface Bindings {
	bindings: Map<ShortcutId, string[]>;
	mac: boolean;
}

const DEFAULT: Bindings = { bindings: resolveBindings(), mac: isMac() };
const ShortcutsContext = createContext<Bindings>(DEFAULT);

export function ShortcutsProvider({ overrides, children }: { overrides: ShortcutOverrides; children: React.ReactNode }) {
	const value = useMemo(() => ({ bindings: resolveBindings(overrides), mac: DEFAULT.mac }), [overrides]);
	return <ShortcutsContext.Provider value={value}>{children}</ShortcutsContext.Provider>;
}

export function useShortcuts() {
	const { bindings, mac } = useContext(ShortcutsContext);
	return useMemo(() => {
		const first = (id: ShortcutId) => bindings.get(id)?.[0];
		return {
			bindings,
			mac,
			/** The first key as text ("E", "⌘K"), or "" when the shortcut has none. */
			text: (id: ShortcutId) => {
				const k = first(id);
				return k ? keyText(k, mac) : "";
			},
			/** Keycaps for the first key. */
			caps: (id: ShortcutId) => {
				const k = first(id);
				return k ? keycaps(k, mac) : [];
			},
			/** A title in the tooltip's "Label (Key) · hint" form. */
			tip: (id: ShortcutId, label: string, hint?: string) => {
				const k = first(id);
				return `${label}${k ? ` (${keyText(k, mac)})` : ""}${hint ? ` · ${hint}` : ""}`;
			},
		};
	}, [bindings, mac]);
}

/** A shortcut's first key as a key hint, or nothing when it has none. */
export function Keys({ id, className = "pg-kbd", style }: { id: ShortcutId; className?: string; style?: React.CSSProperties }) {
	const text = useShortcuts().text(id);
	return text ? <span className={className} style={style}>{text}</span> : null;
}
