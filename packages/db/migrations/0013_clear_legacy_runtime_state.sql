-- Old owner mutations cannot be replayed against the information-card API.
DELETE FROM "http_idempotency_keys";
--> statement-breakpoint
-- The replacement jobs runner must acquire a fresh lease after cutover.
DELETE FROM "job_claims";
