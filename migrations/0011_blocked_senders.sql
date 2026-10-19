-- 0.9.4: senders blocked per address (WON-217). New mail from a blocked
-- address goes straight to Trash, marked read. Unblock in Console > Addresses.

CREATE TABLE blocked_senders (
	mailbox_id TEXT NOT NULL REFERENCES mailboxes(id) ON DELETE CASCADE,
	address TEXT NOT NULL,               -- the sender's address, lowercase
	created_at TEXT NOT NULL,
	PRIMARY KEY (mailbox_id, address)
);
