// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { bytesFigure, countFigure, durationFigure, type Figure, figureLabel, secondsSince } from "shared/figures";
import { queryKeys } from "~/queries/keys";
import api from "~/services/api";

/** The source the GitHub glyph links to. The repo is public, so every deployment points here. */
const REPO_URL = "https://github.com/johnnywon/pluramail";

type Kind = "msg" | "sto" | "adr" | "upt";

/** The unit glyphs: the colophon icons cut for 8px, on the 2–22 box of a 24 grid, stroke 3. */
function UnitGlyph({ kind }: { kind: Kind }) {
	return (
		<svg width="8" height="8" viewBox="2 2 20 20" fill="none" stroke="currentColor" strokeWidth="3" strokeLinejoin="miter" strokeLinecap="butt" aria-hidden="true">
			{kind === "msg" && <><polygon points="6,5 21,5 21,16.5 18.5,19 3,19 3,8" /><polyline points="6,5 12,8.9 18,5" /></>}
			{kind === "sto" && <><polygon points="3,6 7.6,3 16.4,3 21,6 16.4,9 7.6,9" /><polyline points="3,11.5 7.6,14.5 16.4,14.5 21,11.5" /><polyline points="3,17 7.6,20 16.4,20 21,17" /></>}
			{kind === "adr" && <><polygon points="10,8.5 15.5,8.5 15.5,15.5 10,15.5 8.5,14 8.5,10" /><polyline points="15.5,8.5 15.5,14.5 17,16 18.8,16 20.3,14.5 20.3,8.56 15.44,3.7 8.56,3.7 3.7,8.56 3.7,15.44 8.56,20.3 16,20.3" /></>}
			{kind === "upt" && <><polygon points="20.3,8.56 20.3,15.44 15.44,20.3 8.56,20.3 3.7,15.44 3.7,8.56 8.56,3.7 15.44,3.7" /><line x1="12" y1="12" x2="16.6" y2="9.03" /></>}
		</svg>
	);
}

/** One figure: the number, or a grey dash while it's unknown, over its unit. The unit stays put either way. */
function Cell({ kind, label, figure, unit }: { kind: Kind; label: string; figure: Figure | null; unit: string }) {
	return (
		<div className="pg-console-colophon-cell" role="group" aria-label={figureLabel(label, figure)}>
			<b data-unknown={figure ? undefined : true} aria-hidden="true">{figure ? figure.fig : "—"}</b>
			<span aria-hidden="true"><UnitGlyph kind={kind} />{figure ? figure.unit : unit}</span>
		</div>
	);
}

/** Uptime counts on its own clock, once a minute, so the figure moves without a refetch. */
function useNow(everyMs: number) {
	const [now, setNow] = useState(() => Date.now());
	useEffect(() => {
		const id = setInterval(() => setNow(Date.now()), everyMs);
		return () => clearInterval(id);
	}, [everyMs]);
	return now;
}

/**
 * The colophon closes the console rail: what this instance holds and how long it has been up,
 * then the mark and the version. Four figures in a fixed order; the source link is its only link.
 */
export function ConsoleColophon() {
	const config = useQuery({ queryKey: queryKeys.config, queryFn: () => api.getConfig(), staleTime: Infinity });
	const status = useQuery({ queryKey: ["storage-status"], queryFn: () => api.getStorageStatus(), staleTime: 5 * 60_000 });
	const now = useNow(60_000);
	const version = config.data?.version;
	return (
		<footer className="pg-console-colophon" aria-label="PluraMail status">
			<div className="pg-console-colophon-figures">
				<Cell kind="msg" label="Messages" figure={countFigure(status.data?.messages, "EMAIL", "EMAILS")} unit="EMAILS" />
				<Cell kind="sto" label="Storage" figure={bytesFigure(status.data?.bytes)} unit="GB" />
				<Cell kind="adr" label="Addresses" figure={countFigure(config.data?.emailAddresses.length, "ADDR", "ADDRS")} unit="ADDRS" />
				<Cell kind="upt" label="Uptime" figure={durationFigure(secondsSince(config.data?.deployedAt, now))} unit="DAYS" />
			</div>
			<div className="pg-console-colophon-imprint">
				<span className="pg-console-colophon-mark">
					{/* The logo lockup from public/brand: Paper on the dark console, Ink on the light one. Each has a grey
					    copy under it, the watermark the colour sweeps in over when the console opens. */}
					<img className="pg-console-colophon-logo" data-ground="dark" data-layer="ghost" src="/brand/lockup-dark.png" alt="" aria-hidden="true" width={103} height={21} />
					<img className="pg-console-colophon-logo" data-ground="dark" src="/brand/lockup-dark.png" alt="PluraMail" width={103} height={21} />
					<img className="pg-console-colophon-logo" data-ground="light" data-layer="ghost" src="/brand/lockup-light.png" alt="" aria-hidden="true" width={103} height={21} />
					<img className="pg-console-colophon-logo" data-ground="light" src="/brand/lockup-light.png" alt="PluraMail" width={103} height={21} />
				</span>
				<span className="pg-console-colophon-version">
					{version && <span>v{version}</span>}
					<a href={REPO_URL} target="_blank" rel="noopener noreferrer" aria-label="PluraMail on GitHub" title="Source on GitHub">
						<svg width="10" height="10" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" /></svg>
					</a>
				</span>
			</div>
		</footer>
	);
}
