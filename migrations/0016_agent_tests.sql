-- 0.10 Test on past mail (WON-530). Append-only once applied.

-- An agent's latest test run (workers/agent/test-run.ts). One per agent:
-- a new run replaces the last one. Nothing is sent and no draft is saved.
CREATE TABLE agent_tests (
	agent_id TEXT PRIMARY KEY,
	id TEXT NOT NULL UNIQUE,
	search TEXT NOT NULL DEFAULT '',     -- the search that narrowed the mail, empty for the latest
	state TEXT NOT NULL,                 -- running | done | stopped
	model TEXT,                          -- the agent model the run used
	input_tokens INTEGER NOT NULL DEFAULT 0,
	output_tokens INTEGER NOT NULL DEFAULT 0,
	cost REAL,                           -- USD, NULL when the model has no listed price
	started_at TEXT NOT NULL,
	finished_at TEXT
);

-- One row per message in a test run, in the order they are tested.
CREATE TABLE agent_test_results (
	test_id TEXT NOT NULL REFERENCES agent_tests(id) ON DELETE CASCADE,
	position INTEGER NOT NULL,
	email_id TEXT NOT NULL,
	mailbox_id TEXT NOT NULL,
	thread_id TEXT NOT NULL,
	sender TEXT NOT NULL DEFAULT '',
	subject TEXT NOT NULL DEFAULT '',
	date TEXT NOT NULL,
	outcome TEXT NOT NULL,               -- pending | running | took | left | skipped | failed
	reason TEXT,                         -- why it was left, skipped or failed; what an action agent would do
	reply TEXT,                          -- the reply it would have written, plain text
	input_tokens INTEGER NOT NULL DEFAULT 0,
	output_tokens INTEGER NOT NULL DEFAULT 0,
	claimed_at TEXT,
	PRIMARY KEY (test_id, position)
);
