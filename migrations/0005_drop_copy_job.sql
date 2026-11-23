-- The one-time copy from the Durable Object store ended with 0.6, which
-- removes that store. Its job tables go with it.
DROP TABLE IF EXISTS copy_mailboxes;
DROP TABLE IF EXISTS copy_job;
