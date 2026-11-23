// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

/**
 * The MCP server's tools, by what they can do. The server registers exactly these names
 * (`workers/mcp/index.ts` takes an `McpToolName`), and Console > MCP lists them.
 * `tests/mcp-tools.test.mjs` checks the two match.
 */

export type McpToolGroup = "read" | "write" | "send" | "app";

export const MCP_GROUPS: { id: McpToolGroup; label: string }[] = [
	{ id: "read", label: "Read" },
	{ id: "write", label: "Organize and draft" },
	{ id: "send", label: "Send and delete" },
	{ id: "app", label: "App" },
];

export const MCP_TOOLS = [
	{ name: "list_mailboxes", group: "read", summary: "List all mailboxes" },
	{ name: "list_emails", group: "read", summary: "List emails in a folder" },
	{ name: "get_email", group: "read", summary: "Read a full email with body" },
	{ name: "get_thread", group: "read", summary: "Load a conversation thread" },
	{ name: "search_emails", group: "read", summary: "Search one address" },
	{ name: "search_all_mail", group: "read", summary: "Search every address at once" },
	{ name: "list_labels", group: "read", summary: "List labels with counts" },
	{ name: "draft_reply", group: "write", summary: "Draft a reply to an email" },
	{ name: "create_draft", group: "write", summary: "Create a new draft" },
	{ name: "update_draft", group: "write", summary: "Edit a saved draft" },
	{ name: "mark_email_read", group: "write", summary: "Mark read or unread" },
	{ name: "move_email", group: "write", summary: "Move to a system folder" },
	{ name: "create_label", group: "write", summary: "Create a label" },
	{ name: "rename_label", group: "write", summary: "Rename a label" },
	{ name: "label_conversation", group: "write", summary: "Add or remove labels on a conversation" },
	{ name: "label_matching", group: "write", summary: "Label everything a search matches" },
	{ name: "star_conversation", group: "write", summary: "Star or unstar a conversation" },
	{ name: "send_draft", group: "send", summary: "Send a saved draft" },
	{ name: "reply_to_email", group: "send", summary: "Reply to an email now" },
	{ name: "send_email", group: "send", summary: "Send a new email now" },
	{ name: "delete_email", group: "send", summary: "Move an email to Trash" },
	{ name: "delete_label", group: "send", summary: "Delete a label everywhere" },
	{ name: "list_shortcuts", group: "app", summary: "List keyboard shortcuts" },
	{ name: "set_shortcut", group: "app", summary: "Rebind a shortcut" },
	{ name: "reset_shortcuts", group: "app", summary: "Restore default keys" },
] as const satisfies readonly { name: string; group: McpToolGroup; summary: string }[];

export type McpToolName = (typeof MCP_TOOLS)[number]["name"];
