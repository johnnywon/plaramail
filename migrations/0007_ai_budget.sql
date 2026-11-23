-- One row per model call a demo build allowed, for its daily cap (workers/lib/demo.ts).
CREATE TABLE ai_budget (
	id INTEGER PRIMARY KEY,
	at TEXT NOT NULL
);
CREATE INDEX ai_budget_at ON ai_budget (at);
