// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { type ReactNode, useEffect, useState } from "react";
import { DEFAULT_PREFS, readPrefs, useResolvedTheme } from "~/components/postal/prefs";

/**
 * The one layout for every error the app renders: the postal surface and theme,
 * a mono status code, a heading, one line and a way back to mail.
 */
export default function ErrorPage({ status, title, children, detail, reload }: {
	status?: number;
	title: string;
	children?: ReactNode;
	/** Developer detail, such as a stack trace. Shown only when given. */
	detail?: string;
	/** Offer Reload next to Back to mail, for errors a retry can clear. */
	reload?: boolean;
}) {
	// Server-rendered, so it starts on the default theme and applies the stored one after hydration.
	const [stored, setStored] = useState(DEFAULT_PREFS.theme);
	useEffect(() => setStored(readPrefs().theme), []);
	const theme = useResolvedTheme(stored);
	return (
		<div className="postal pg-fault" data-theme={theme}>
			<main className="pg-fault-main">
				{status ? <p className="pg-fault-code">{status}</p> : null}
				<h1>{title}</h1>
				{children ? <p className="pg-fault-text">{children}</p> : null}
				{detail ? <pre className="pg-fault-detail">{detail}</pre> : null}
				<div className="pg-fault-actions">
					<a href="/" className="pg-btn pg-btn-primary pg-btn-sm">Back to mail</a>
					{reload ? (
						<button type="button" className="pg-btn pg-btn-outline pg-btn-sm" onClick={() => window.location.reload()}>Reload</button>
					) : null}
				</div>
			</main>
		</div>
	);
}
