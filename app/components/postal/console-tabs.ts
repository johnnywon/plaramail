// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

/** The console's pages: the agents' work, tools and models, then the mail client's settings. */
export const AGENT_PAGES = ["home", "agents", "review", "logs"] as const;
export const SETUP_PAGES = ["mcp", "models", "mailroom"] as const;
export const SETTINGS_TABS = ["general", "addresses", "signatures", "labels", "shortcuts", "storage"] as const;
export const CONSOLE_TABS = [...AGENT_PAGES, ...SETUP_PAGES, ...SETTINGS_TABS] as const;
export type ConsoleTab = (typeof CONSOLE_TABS)[number];
export type SettingsTab = (typeof SETTINGS_TABS)[number];

/** Each page's name, on the rail, its page head and in console search. */
export const CONSOLE_LABELS: Record<ConsoleTab, string> = {
	home: "Overview", agents: "Your agents", review: "Draft review", logs: "Activity log",
	models: "AI models", mcp: "MCP", mailroom: "PluraMail Agent",
	addresses: "Addresses", signatures: "Signatures", labels: "Labels",
	general: "Preferences", shortcuts: "Keyboard shortcuts", storage: "Mail storage",
};

/** The rail, top to bottom. The PluraMail Agent page sits under Your agents. */
export const CONSOLE_RAIL: { group: string | null; tabs: ConsoleTab[] }[] = [
	{ group: null, tabs: ["home"] },
	{ group: "Agents", tabs: ["agents", "review", "logs"] },
	{ group: "Connections", tabs: ["models", "mcp"] },
	{ group: "Mail", tabs: ["addresses", "signatures", "labels"] },
	{ group: "App", tabs: ["general", "shortcuts", "storage"] },
];

export const isSettingsTab = (tab: ConsoleTab): tab is SettingsTab => (SETTINGS_TABS as readonly string[]).includes(tab);

/** Names from before (0.7's console tabs, ?settings=agent, ?settings=index, the MCP dialog) and other words for a page. */
const RENAMED: Record<string, ConsoleTab> = {
	overview: "home", activity: "logs", limits: "mailroom", drafting: "mailroom", model: "models", connections: "mcp",
	agent: "mailroom", index: "storage", tools: "mcp", preferences: "general", settings: "general", prefs: "general",
};

/** A page by its slug or another name for it. Any other non-empty name opens Overview, so the console never closes on a typo. */
function tabNamed(raw: string | null): ConsoleTab | null {
	const value = raw?.trim().toLowerCase();
	if (!value) return null;
	if (Object.hasOwn(RENAMED, value)) return RENAMED[value];
	return (CONSOLE_TABS as readonly string[]).includes(value) ? (value as ConsoleTab) : "home";
}

/** The page named by ?console=, or by the older ?settings=. Null when the console is closed. */
export function consoleTabFrom(params: URLSearchParams): ConsoleTab | null {
	return tabNamed(params.get("console")) ?? tabNamed(params.get("settings"));
}
