-- 0.10: approval queue (WON-532). Append-only once applied.

-- Hold for approval, set per agent or per MCP client (workers/lib/approvals.ts).
-- No row means the default: on for an agent's first 7 days in Send, off otherwise.
CREATE TABLE approval_holds (
	kind TEXT NOT NULL,                  -- agent | mcp
	subject_id TEXT NOT NULL,            -- the agent's id, or the MCP client's id
	hold INTEGER NOT NULL,
	updated_at TEXT NOT NULL,
	PRIMARY KEY (kind, subject_id)
);

-- When an agent last moved into Send, for the 7-day default.
ALTER TABLE agents ADD COLUMN send_since TEXT;

-- A send or bulk change waiting for one-click approval. It waits 24 hours,
-- then is dropped. payload is the call's arguments as JSON, run on approval.
CREATE TABLE approval_queue (
	id TEXT PRIMARY KEY,
	kind TEXT NOT NULL,                  -- send | bulk
	actor TEXT NOT NULL,                 -- agent | mcp
	source_id TEXT NOT NULL,             -- the agent's id, or the MCP client's id
	source_name TEXT,
	tool TEXT NOT NULL,
	mailbox_id TEXT,
	summary TEXT NOT NULL,
	messages INTEGER,                    -- messages a bulk change covers
	payload TEXT NOT NULL,
	dedupe_key TEXT UNIQUE,              -- a retried call finds its item instead of queueing again
	state TEXT NOT NULL,                 -- waiting | running | approved | failed | dropped
	result TEXT,
	created_at TEXT NOT NULL,
	expires_at TEXT NOT NULL,
	decided_at TEXT
);
CREATE INDEX approval_queue_state ON approval_queue (state, created_at);
