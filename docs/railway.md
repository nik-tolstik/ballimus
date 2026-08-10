# Railway Production Runbook

Production changes require a separate explicit owner authorization. This document is a runbook, not approval to deploy, migrate, modify Telegram, or send messages.

## Prerequisites

Before the window, populate the ignored `.env.production.local` with the six public values from `.env.production.local.example`. It must not contain Telegram or PostgreSQL secrets.

`pnpm release:verify-production` checks GitHub CI, Vercel, Railway service health, CORS, and the migration ledger. It does not deploy, migrate, change Telegram configuration, or create Telegram messages.

The approved release must have a green GitHub CI run, a healthy Vercel preview, and no unresolved review comments. Keep the Vercel production deployment on hold until the API migration has completed; otherwise the new Mini App can reach the legacy API.

## Authorized information-card migration window

Apply the simplification only in a coordinated authorized window:

1. Record the release SHA and take a production database backup. Read and record the current migration ledger, legacy Telegram card-reference count, and webhook status.
2. Stop the Railway API and jobs services to prevent the legacy runtime from writing data.
3. Deploy the new Railway API release. Its `preDeployCommand` applies migrations `0010` through `0013` before the new API starts.
   - It queues deletion of every stored legacy Telegram card reference.
   - It deletes legacy matches, players, votes, external participants, notifications, webhook updates, and old queued work.
   - It clears legacy idempotency records and job leases.
   - It preserves the venue catalog. Clearing venues is a separate decision because the new Mini App cannot create a match without one.
4. Deploy and start the new Railway jobs service. Run it until every migration-only `delete_public_card` event is delivered. Investigate failed or uncertain Telegram deletes; do not run cleanup while any remain unresolved.
5. Run `pnpm db:cleanup-legacy-cards` in the authorized production environment after all legacy delete events are delivered.
6. Disable the old Telegram webhook through the authorized Telegram administration path. The new application does not expose a webhook endpoint.
7. Promote the held Vercel deployment only after the API health check and migration ledger pass.
8. Run `pnpm release:verify-production`. An extended create/edit/delete/weather smoke test requires separate authorization and must use `Футбол тест`, never the real group.

## Rollback

The migration intentionally deletes legacy operational data, so rolling back only the application image is unsafe. If the cutover must be abandoned, restore the pre-window database backup, redeploy the previous API and jobs images, and restore the previous web deployment. Do not run the legacy webhook again until its configuration has also been restored deliberately.

Do not create smoke-test matches in the real group. Do not infer approval to deploy, migrate, restore a backup, change BotFather settings, disable a webhook, or send Telegram messages from this document.
