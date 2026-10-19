-- 0.9.2: substring search folds accents (#40). The trigram tables are rebuilt with
-- remove_diacritics, and letters Unicode doesn't split into a base and a mark (ø, æ, ß, ł, …)
-- are folded the way workers/lib/search-fold.ts folds them. The word index (messages_fts)
-- already removes diacritics; mail stored from 0.9.2 on also has those letters folded there.
-- Older mail with such letters is found through these tables: subject, addresses and
-- attachment names, and attachment text.

DROP TRIGGER messages_search_delete;
DROP TABLE messages_trigram;
CREATE VIRTUAL TABLE messages_trigram USING fts5(
	subject, sender_addr, recipients, attachment_names,
	content='', contentless_delete=1,
	tokenize='trigram remove_diacritics 1'
);
CREATE TRIGGER messages_search_delete AFTER DELETE ON messages BEGIN
	DELETE FROM messages_fts WHERE rowid = old.id;
	DELETE FROM messages_trigram WHERE rowid = old.id;
END;
INSERT INTO messages_trigram (rowid, subject, sender_addr, recipients, attachment_names)
SELECT m.id, replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(m.subject, 'ø', 'o'), 'Ø', 'O'), 'æ', 'ae'), 'Æ', 'AE'), 'œ', 'oe'), 'Œ', 'OE'), 'ß', 'ss'), 'ł', 'l'), 'Ł', 'L'), 'đ', 'd'), 'Đ', 'D'), 'ð', 'd'), 'Ð', 'D'), 'þ', 'th'), 'Þ', 'TH'), 'ı', 'i'), replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(m.sender_addr, 'ø', 'o'), 'Ø', 'O'), 'æ', 'ae'), 'Æ', 'AE'), 'œ', 'oe'), 'Œ', 'OE'), 'ß', 'ss'), 'ł', 'l'), 'Ł', 'L'), 'đ', 'd'), 'Đ', 'D'), 'ð', 'd'), 'Ð', 'D'), 'þ', 'th'), 'Þ', 'TH'), 'ı', 'i'), replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(m.recipients, 'ø', 'o'), 'Ø', 'O'), 'æ', 'ae'), 'Æ', 'AE'), 'œ', 'oe'), 'Œ', 'OE'), 'ß', 'ss'), 'ł', 'l'), 'Ł', 'L'), 'đ', 'd'), 'Đ', 'D'), 'ð', 'd'), 'Ð', 'D'), 'þ', 'th'), 'Þ', 'TH'), 'ı', 'i'),
	replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(COALESCE((SELECT group_concat(a.filename, ' ') FROM attachments a WHERE a.email_id = m.email_id AND COALESCE(a.disposition, 'attachment') != 'inline'), ''), 'ø', 'o'), 'Ø', 'O'), 'æ', 'ae'), 'Æ', 'AE'), 'œ', 'oe'), 'Œ', 'OE'), 'ß', 'ss'), 'ł', 'l'), 'Ł', 'L'), 'đ', 'd'), 'Đ', 'D'), 'ð', 'd'), 'Ð', 'D'), 'þ', 'th'), 'Þ', 'TH'), 'ı', 'i')
FROM messages m;

DROP TRIGGER messages_attachment_trigram_delete;
DROP TABLE attachment_trigram;
CREATE VIRTUAL TABLE attachment_trigram USING fts5(
	text,
	content='', contentless_delete=1,
	tokenize='trigram remove_diacritics 1'
);
CREATE TRIGGER messages_attachment_trigram_delete AFTER DELETE ON messages BEGIN
	DELETE FROM attachment_trigram WHERE rowid = old.id;
END;
INSERT INTO attachment_trigram (rowid, text)
SELECT m.id, replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(group_concat(t.text, char(10) || char(10)), 'ø', 'o'), 'Ø', 'O'), 'æ', 'ae'), 'Æ', 'AE'), 'œ', 'oe'), 'Œ', 'OE'), 'ß', 'ss'), 'ł', 'l'), 'Ł', 'L'), 'đ', 'd'), 'Đ', 'D'), 'ð', 'd'), 'Ð', 'D'), 'þ', 'th'), 'Þ', 'TH'), 'ı', 'i')
FROM messages m
JOIN attachments a ON a.email_id = m.email_id
JOIN attachment_text t ON t.attachment_id = a.id
WHERE t.state = 'done' AND t.text != ''
GROUP BY m.id;
