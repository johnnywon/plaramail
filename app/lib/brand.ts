// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { useRouteLoaderData } from "react-router";

export const DEFAULT_APP_NAME = "PlaraMail";

type RootData = { appName?: string } | undefined;
type Match = { id: string; data?: unknown } | undefined;

/** The deployment's display name, from APP_NAME in wrangler.jsonc. */
export function useAppName(): string {
	return (useRouteLoaderData("root") as RootData)?.appName || DEFAULT_APP_NAME;
}

/** Page title for a route's meta(), suffixed with the app name. */
export function pageTitle(matches: Match[], page?: string): string {
	const name = (matches.find((m) => m?.id === "root")?.data as RootData)?.appName || DEFAULT_APP_NAME;
	return page ? `${page} · ${name}` : name;
}
