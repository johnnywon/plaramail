-- 0.9 Agents. Append-only once applied.

-- An agent does one job on the addresses it watches (workers/lib/agents.ts).
-- Rules narrow inbound mail down, then the model checks the job. Watch
-- records what it would do, Draft writes a draft, Send sends it.
CREATE TABLE agents (
	id TEXT PRIMARY KEY,
	name TEXT NOT NULL,
	job TEXT NOT NULL,
	addresses TEXT NOT NULL DEFAULT '[]',    -- JSON: addresses it watches; empty means all
	rules TEXT NOT NULL DEFAULT '[]',        -- JSON: [{ field, op, value }], all must pass
	instructions TEXT NOT NULL DEFAULT '',
	example_reply TEXT NOT NULL DEFAULT '',
	mode TEXT NOT NULL DEFAULT 'watch',      -- watch | draft | send
	enabled INTEGER NOT NULL DEFAULT 1,
	position INTEGER NOT NULL DEFAULT 0,     -- lower takes a message first
	daily_limit INTEGER NOT NULL DEFAULT 25,
	per_sender_limit INTEGER NOT NULL DEFAULT 2,
	created_at TEXT NOT NULL,
	updated_at TEXT NOT NULL
);

-- Which agent a run belongs to. Runs can now end watched or sent.
ALTER TABLE auto_draft_runs ADD COLUMN agent_id TEXT;
CREATE INDEX auto_draft_runs_agent ON auto_draft_runs (agent_id, created_at);

-- The agent whose job a draft was for (shared/draft-notes.ts).
ALTER TABLE draft_notes ADD COLUMN agent TEXT;
