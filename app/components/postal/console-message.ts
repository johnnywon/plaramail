// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { createContext, useContext } from "react";

export interface MessageRef { mailboxId: string; emailId: string }

/** Opens a message over the console. Null outside it, where rows stay plain. */
export const ConsoleMessageContext = createContext<((ref: MessageRef) => void) | null>(null);
export const useOpenMessage = () => useContext(ConsoleMessageContext);
