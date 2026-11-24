-- 0.10 Promotion evidence (WON-531). Append-only once applied.

-- What an agent's move to Send reads (workers/lib/agent-evidence.ts):
-- each agent draft a person sent, and whether they changed it first, and
-- each safety check that stopped the agent's mail or reply.
CREATE TABLE agent_events (
	id INTEGER PRIMARY KEY,
	agent_id TEXT NOT NULL,
	kind TEXT NOT NULL,                  -- sent | safety
	email_id TEXT NOT NULL,              -- sent: the message sent; safety: the inbound message
	edited INTEGER,                      -- sent: 1 when the reply was changed before it went
	reason TEXT,                         -- safety: what the check found
	at TEXT NOT NULL,
	UNIQUE (agent_id, kind, email_id)
);
CREATE INDEX agent_events_agent_at ON agent_events (agent_id, kind, at);

-- A fingerprint of the reply an agent wrote, kept with its draft through
-- edits and redrafts, so a send can tell whether it went as written.
ALTER TABLE draft_notes ADD COLUMN written TEXT;
