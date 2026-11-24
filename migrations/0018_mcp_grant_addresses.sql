-- The addresses an MCP grant may reach, as narrowed in Console > MCP (WON-533). Append-only once applied.

-- A grant made on the consent page carries its chosen addresses in its OAuth
-- props. A row here narrows a grant further; it never widens one. A grant
-- with neither (connected before address limits) reaches every address.
-- addresses is a JSON array of lowercase addresses.
CREATE TABLE mcp_grant_addresses (
	grant_id TEXT PRIMARY KEY,
	addresses TEXT NOT NULL,
	updated_at TEXT NOT NULL
);
