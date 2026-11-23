// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { createContext, useContext } from "react";

/** True on a demo build (PLARAMAIL_DEMO=1, /api/v1/config says so): no agent and no sign-in, so their controls are hidden. */
export const DemoContext = createContext(false);

/** What the agent panel and Draft buttons say on a demo, where the agent doesn't run. */
export const DEMO_AGENT_NOTICE = "The agent is off in the demo. On your own deployment it reads, searches, labels, drafts and sends your mail.";

export function useDemo(): boolean {
	return useContext(DemoContext);
}
