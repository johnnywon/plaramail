-- 0.9.5: errors the Worker records for the hourly alert mail (WON-220).
-- The cron mails the unsent ones to ALERT_TO and deletes rows after 30 days.

CREATE TABLE error_log (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	at TEXT NOT NULL,                    -- ISO time
	source TEXT NOT NULL,                -- where it failed: fetch, email, cron, scheduled-send, ...
	message TEXT NOT NULL,
	alerted_at TEXT                      -- when the alert mail went; NULL until then
);
CREATE INDEX error_log_unalerted ON error_log (id) WHERE alerted_at IS NULL;
