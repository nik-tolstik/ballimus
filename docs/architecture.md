# Architecture

## Runtime boundary

```text
Telegram Mini App (owner) -- HTTPS + X-Telegram-Init-Data --> apps/api
apps/web ----------------- generated client ----------------> apps/api /v1/*
Telegram ----------------- secret poll webhook ------------> apps/api /v1/telegram/webhook
apps/api ----------------- outbound Bot API ---------------> Telegram
apps/api <-------------- PostgreSQL ------------------------> packages/db
Railway Cron or local command ------------------------------> apps/api jobs:run
```

`apps/api` is a NestJS API. It exposes `/health`, the owner REST API under `/v1`, a secret-authenticated poll webhook, and one bounded jobs command. It has no callback handler, long-polling loop, or in-process scheduler.

`apps/web` is a React/Vite Mini App. It sends signed Telegram `initData` through the generated client and uses TanStack Query for current cards, polls, and venues. `packages/domain` owns static card, poll-notification, and weather formatting. `packages/db` owns PostgreSQL, migrations, idempotency, and the durable outbox.

## Owner REST API

The generated OpenAPI contract exposes only:

- match information-card CRUD;
- venue catalog CRUD/archive/restore;
- native poll creation, listing, manual republishing, and archiving;
- `POST /v1/weather/current`.

Match creation requires an exact date/time and an active venue. It writes the match, a pending public-card reference, and a `publish_public_card` outbox event in one transaction. A best-effort delivery is attempted after commit; the jobs process provides retry recovery.

Edits enqueue a refresh of the existing message. Deletes mark the match as deletion-requested and queue `delete_public_card`. Repeating the deletion is safe. Poll creation writes an independent `telegram_polls` row and makes one bounded Telegram publication attempt after the transaction commits. There are no player, roster, match-vote, forecast, history, or lifecycle endpoints.

## Telegram delivery

The Telegram card is a read-only projection. It is rendered as HTML text with no reply markup or callback data. The outbox supports publishing, refreshing, and deleting cards. Refresh and delete failures retry with backoff; an ambiguous first send is marked uncertain rather than blindly resent.

New polls are non-anonymous and target the configured General topic. Creation performs one bounded Bot API call and records `published`, `failed`, or `uncertain` immediately; it does not queue automatic publication retries. Failed and uncertain polls expose a manual republish action, with uncertain results requiring the owner to check General first because Telegram may have accepted a request without confirming it. Telegram `poll` updates refresh ordered option counts, and the visible Polls screen periodically reloads those persisted counts. A poll can have one notification threshold, and every option stores a direct notification-enabled flag. Crossing the threshold on an enabled option atomically marks that option notification as queued and creates a deduplicated `send_poll_threshold_notification` event for the configured Chat topic; disabled options never trigger it. Archiving a poll hides it immediately, suppresses threshold work, and queues an idempotent `delete_poll` event for its Telegram message. Polls and notifications never reference a match.

Current weather is fetched from Open-Meteo for Minsk only when the owner invokes the endpoint. The formatted result is sent directly to the configured Telegram topic and is neither persisted nor rate limited.

## Persistence

The current application tables are:

- `venues` — owner-maintained venue catalog;
- `matches` — exact schedule, required venue, price, owner, version, and deletion marker;
- `match_messages` — durable Telegram card references and publication state;
- `telegram_polls` — independent native poll settings, Telegram references, option counts, and queued threshold markers;
- `http_idempotency_keys` — replay-safe owner mutations;
- `outbox` — Telegram delivery queue;
- `job_claims` — jobs lease.

Migration `0010_information_cards` queues deletion of legacy Telegram card messages before deleting legacy match, player, vote, roster, notification, webhook-update, and old-outbox data. Migration `0014_native_telegram_polls` adds the new isolated poll store and outbox event types. Migration `0016_non_anonymous_general_polls` changes the default for newly created poll records without rewriting already published Telegram polls. Migration `0017_archive_native_polls` adds poll archival state, cancellable pending publication, and durable Telegram deletion. Migration `0018_manual_poll_publication` converts incomplete legacy poll sends into terminal states and retires their publication events so the owner can republish explicitly. `pnpm db:cleanup-legacy-cards` removes only delivered migration-only deletion events.

## Security and environments

The Mini App guard verifies Telegram HMAC signatures, session freshness, and the configured owner ID. CORS allows only the configured web origin. The webhook requires Telegram's secret-token header, whose expected value is derived from the bot token, and only applies updates for known Telegram poll IDs. `/health`, the poll webhook, and the jobs CLI are the only non-Mini-App boundaries.

Local and production configurations are isolated. No production deployment, migration, Telegram configuration, or messages are implied by code changes.
