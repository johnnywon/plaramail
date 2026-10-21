// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import type { ReactNode } from "react";

/**
 * Content that eases open and shut: rail groups, an address's folders, a panel under a control
 * (postal.css, Reveal). It stays mounted, so a click mid-move reverses from where it is; closed,
 * it is inert.
 */
export function Reveal({ open, kind, className, children }: { open: boolean; kind: "group" | "folders" | "panel"; className?: string; children: ReactNode }) {
	return (
		<div className="pg-reveal" data-kind={kind} data-open={open} inert={!open}>
			<div className={className ? `pg-reveal-in ${className}` : "pg-reveal-in"}>{children}</div>
		</div>
	);
}
