# Railway Production Runbook

Production changes require a separate explicit owner authorization. This document is a runbook, not approval to deploy, migrate, modify Telegram, or send messages.

## Read-only verification

`pnpm release:verify-production` checks GitHub CI, Vercel, Railway service health, CORS, and the migration ledger. It does not deploy, migrate, change Telegram configuration, or create Telegram messages.

## Authorized information-card migration window

Apply the simplification only in a coordinated authorized window:

1. Confirm the target release is merged and CI is green.
2. Stop the Railway API and jobs services to prevent the legacy runtime from writing data.
3. Back up according to the production database policy.
4. Apply migration `0010_information_cards`.
   - It queues deletion of every stored legacy Telegram card reference.
   - It deletes legacy matches, players, votes, external participants, notifications, webhook updates, and old queued work.
   - It preserves venues and HTTP idempotency records.
5. Deploy and start the new API and jobs version.
6. Run the jobs service until every migration-only `delete_public_card` event is delivered. Investigate failed or uncertain Telegram deletes; do not run cleanup while any remain unresolved.
7. Run `pnpm db:cleanup-legacy-cards` in the authorized production environment after all legacy delete events are delivered.
8. Disable the old Telegram webhook through the authorized Telegram administration path. The new application does not expose a webhook endpoint.
9. Run `pnpm release:verify-production` and verify a newly created local/test card flow only in the approved test chat.

Do not create smoke-test matches in the real group. Do not infer approval to deploy, migrate, change BotFather settings, disable a webhook, or send Telegram messages from this document.
