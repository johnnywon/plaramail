-- 0.10 workbench (WON-529). Append-only once applied.

-- The agent's setup when the run started (shared/agent-test.ts, setupKey). A run
-- whose setup no longer matches the agent's doesn't count toward Send.
ALTER TABLE agent_tests ADD COLUMN setup TEXT;
