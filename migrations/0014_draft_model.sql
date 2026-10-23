-- 0.9.6: the model that wrote an agent draft (WON-594). Append-only once applied.

-- The model id the run used, as the provider names it. NULL for drafts
-- saved before 0.9.6 and for MCP drafts, whose model PlaraMail can't know.
ALTER TABLE draft_notes ADD COLUMN model TEXT;
