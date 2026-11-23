// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import type { CSSProperties } from "react";

/**
 * The agent: a robot with cursor blocks for eyes and an @ on its
 * antenna. The shell takes the current color; the eyes are always agent green.
 * Takes Phosphor's props so it can stand in for a Phosphor icon; weight is ignored.
 */
export function AgentIcon({ size = 16, color, className, style }: {
	size?: number;
	weight?: string;
	color?: string;
	className?: string;
	style?: CSSProperties;
}) {
	return (
		<svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className} style={{ color, flex: "none", ...style }} aria-hidden="true">
			<circle cx="12" cy="4.4" r="1.1" stroke="currentColor" strokeWidth="1.2" />
			<path d="M13.1 3.7v1.3a.9.9 0 0 0 1.8 0v-.6a2.9 2.9 0 1 0-1.2 2.3" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
			<path d="M12 7.8V10" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
			<rect x="4" y="10" width="16" height="11" rx="3" stroke="currentColor" strokeWidth="2" />
			<rect x="8" y="13" width="2.4" height="4.5" fill="var(--pg-green)" />
			<rect x="13.6" y="13" width="2.4" height="4.5" fill="var(--pg-green)" />
		</svg>
	);
}

const STROKE = { stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round" } as const;

/** The agent's motion, from Plara Design's css/motion.css: waiting, reading, writing (looped), landed (once). */
export type AgentAnim = "agent-ready" | "agent-think" | "agent-write" | "agent-done";

/**
 * The agent writes: a solid spark in front of Write's three lines and cursor
 * block, 1.5 wide on a 36 × 24 grid. The agent key's only drawing, so the shape
 * says what it does. Ported from Plara Design (react/icons.tsx, AgentDraftIcon).
 * `anim` runs one of the four presets in postal.css.
 */
export function AgentDraftIcon({ size = 16, color, className, style, anim }: {
	size?: number;
	color?: string;
	className?: string;
	style?: CSSProperties;
	anim?: AgentAnim;
}) {
	return (
		<svg width={(size * 36) / 24} height={size} viewBox="0 0 36 24" fill="none" className={className} style={{ color, flex: "none", ...style }} aria-hidden="true" data-anim={anim}>
			<path d="M8 3.5Q8.9 11.1 15.5 12Q8.9 12.9 8 20.5Q7.1 12.9 0.5 12Q7.1 11.1 8 3.5Z" className="pg-agent-spark" fill="currentColor" />
			<path d="M19 6.5h15" className="pg-agent-line" pathLength="1" style={{ "--i": 0 } as CSSProperties} {...STROKE} />
			<path d="M19 12h15" className="pg-agent-line" pathLength="1" style={{ "--i": 1 } as CSSProperties} {...STROKE} />
			<path d="M19 17.5h7" className="pg-agent-line" pathLength="1" style={{ "--i": 2 } as CSSProperties} {...STROKE} />
			<rect x="28.4" y="15.25" width="2.4" height="4.5" className="pg-agent-cursor" fill="var(--pg-green)" />
		</svg>
	);
}
