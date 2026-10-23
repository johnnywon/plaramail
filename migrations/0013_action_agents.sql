-- 0.9.6: action agents (WON-453). Append-only once applied.

-- What an agent does with mail it takes: reply | star | label | archive | mark_read.
-- Reply is the 0.9 behaviour. An action agent's mode is watch or on.
ALTER TABLE agents ADD COLUMN does TEXT NOT NULL DEFAULT 'reply';
-- The one label a Label agent adds.
ALTER TABLE agents ADD COLUMN label_id TEXT;

-- One row per action agent per message (workers/lib/agent-actions.ts), so a
-- second run on the same message does nothing. Undo reverses a done action.
CREATE TABLE agent_actions (
	id TEXT PRIMARY KEY,
	agent_id TEXT NOT NULL,
	agent_name TEXT NOT NULL,
	mailbox_id TEXT NOT NULL,
	email_id TEXT NOT NULL,
	does TEXT NOT NULL,                  -- star | label | archive | mark_read
	label_id TEXT,
	state TEXT NOT NULL,                 -- watched | done | undone | limited | failed
	reason TEXT,
	created_at TEXT NOT NULL,
	undone_at TEXT,
	UNIQUE (agent_id, email_id)
);
CREATE INDEX agent_actions_agent ON agent_actions (agent_id, created_at);

-- The action an Activity entry records, for Undo in Console > Activity.
ALTER TABLE agent_activity ADD COLUMN action_id TEXT;
