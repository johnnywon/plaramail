-- 0.9.3: when a message last changed folder, so Trash and Spam can be purged a set number of
-- days after mail went there (WON-212). A trigger sets it on every folder change. Mail
-- already in Trash or Spam counts from this migration; mail that arrives straight in Spam
-- counts from its date (folder_changed_at stays NULL).

ALTER TABLE messages ADD COLUMN folder_changed_at TEXT;
UPDATE messages SET folder_changed_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE state IN ('trash', 'spam');
CREATE TRIGGER messages_folder_changed AFTER UPDATE OF folder_id ON messages WHEN NEW.folder_id IS NOT OLD.folder_id BEGIN
	UPDATE messages SET folder_changed_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE rowid = NEW.rowid;
END;
