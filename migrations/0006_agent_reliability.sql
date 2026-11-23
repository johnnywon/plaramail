-- 0.7 Agent reliability. Append-only once applied.

-- Send attempts (workers/lib/send-keys.ts). A key moves pending -> sending
-- when delivery starts -> sent or failed. content_hash refuses a key reused
-- for a different message; provider_id is saved before the Sent copy.
ALTER TABLE send_keys ADD COLUMN content_hash TEXT;
ALTER TABLE send_keys ADD COLUMN provider_id TEXT;
ALTER TABLE send_keys ADD COLUMN error TEXT;
ALTER TABLE send_keys ADD COLUMN updated_at TEXT;

-- Send limits (workers/lib/send-budget.ts). One row per send, inserted by
-- the statement that checks the limits, so two sends can't share a slot.
CREATE TABLE send_budget (
	id INTEGER PRIMARY KEY,
	mailbox_id TEXT NOT NULL,
	actor TEXT NOT NULL,                 -- person | agent | mcp
	recipients INTEGER NOT NULL,
	at TEXT NOT NULL
);
CREATE INDEX send_budget_mailbox_at ON send_budget (mailbox_id, at);

-- Auto-draft runs (workers/agent/runs.ts), one per inbound message.
CREATE TABLE auto_draft_runs (
	email_id TEXT PRIMARY KEY,           -- the inbound message
	mailbox_id TEXT NOT NULL,
	thread_id TEXT NOT NULL,
	sender TEXT NOT NULL,
	state TEXT NOT NULL,                 -- queued | running | drafted | skipped | superseded | failed
	attempts INTEGER NOT NULL DEFAULT 0,
	reason TEXT,                         -- why it was skipped, or the last error
	draft_id TEXT,
	created_at TEXT NOT NULL,
	updated_at TEXT NOT NULL
);
CREATE INDEX auto_draft_runs_thread ON auto_draft_runs (mailbox_id, thread_id);
CREATE INDEX auto_draft_runs_sender ON auto_draft_runs (mailbox_id, sender, created_at);

-- What agents and MCP clients did (workers/lib/activity.ts). The cron
-- prunes rows past the retention in Settings > Activity.
CREATE TABLE agent_activity (
	id INTEGER PRIMARY KEY,
	at TEXT NOT NULL,
	mailbox_id TEXT,                     -- NULL for actions across addresses
	actor TEXT NOT NULL,                 -- chat | auto-draft | mcp
	client TEXT,                         -- the MCP client's name and version
	action TEXT NOT NULL,                -- read | draft | send | delete | label | move | settings
	tool TEXT NOT NULL,
	target TEXT,                         -- email, draft, thread or label
	summary TEXT,
	ok INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX agent_activity_at ON agent_activity (at);
CREATE INDEX agent_activity_mailbox_at ON agent_activity (mailbox_id, at);

-- How an agent draft was made. Leaves with the draft.
CREATE TABLE draft_notes (
	email_id TEXT PRIMARY KEY REFERENCES messages(email_id) ON DELETE CASCADE,
	origin TEXT NOT NULL,                -- auto-draft | chat | mcp
	instructions TEXT NOT NULL DEFAULT '[]', -- JSON: redraft instructions, oldest first
	created_at TEXT NOT NULL
);
