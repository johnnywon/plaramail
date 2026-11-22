-- A saved forward draft (WON-1198). Append-only once applied.

-- A row marks the draft as a forward of the message in its in_reply_to.
-- attachment_ids lists the original's attachments the forward carries, as
-- a JSON array, so the draft reopens and sends as a forward with them.
CREATE TABLE draft_forwards (
	email_id TEXT PRIMARY KEY REFERENCES messages(email_id) ON DELETE CASCADE,
	attachment_ids TEXT NOT NULL DEFAULT '[]'
);
