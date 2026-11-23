// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

/** Synchronous SQL, as node:sqlite gives it in tests. `runSync` drives the query generators over it. */
export type Exec = (sql: string, ...params: unknown[]) => Record<string, unknown>[];
