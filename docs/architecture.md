# Architecture

## Runtime boundary

```text
Telegram Mini App (owner) -- HTTPS + X-Telegram-Init-Data --> apps/api
apps/web ----------------- generated client ----------------> apps/api /v1/*
apps/api ----------------- outbound Bot API ---------------> Telegram
apps/api <-------------- PostgreSQL ------------------------> packages/db
Railway Cron or local command ------------------------------> apps/api jobs:run
```

`apps/api` is a NestJS API. It exposes `/health`, the owner REST API under `/v1`, and one bounded jobs command. It has no Telegram webhook controller, callback handler, long-polling loop, or in-process scheduler.

`apps/web` is a React/Vite Mini App. It sends signed Telegram `initData` through the generated client and uses TanStack Query for current cards and venues. `packages/domain` owns static card and weather formatting. `packages/db` owns PostgreSQL, migrations, idempotency, and the durable outbox.

## Owner REST API

The generated OpenAPI contract exposes only:

- match information-card CRUD;
- venue catalog CRUD/archive/restore;
- `POST /v1/weather/current`.

Match creation requires an exact date/time and an active venue. It writes the match, a pending public-card reference, and a `publish_public_card` outbox event in one transaction. A best-effort delivery is attempted after commit; the jobs process provides retry recovery.

Edits enqueue a refresh of the existing message. Deletes mark the match as deletion-requested and queue `delete_public_card`. Repeating the deletion is safe. There are no player, roster, vote, poll, notification, forecast, history, or lifecycle endpoints.

## Telegram delivery

The Telegram card is a read-only projection. It is rendered as HTML text with no reply markup or callback data. The outbox supports publishing, refreshing, and deleting cards. Refresh and delete failures retry with backoff; an ambiguous first send is marked uncertain rather than blindly resent.

Current weather is fetched from Open-Meteo for Minsk only when the owner invokes the endpoint. The formatted result is sent directly to the configured Telegram topic and is neither persisted nor rate limited.

## Persistence

The current application tables are:

- `venues` — owner-maintained venue catalog;
- `matches` — exact schedule, required venue, price, owner, version, and deletion marker;
- `match_messages` — durable Telegram card references and publication state;
- `http_idempotency_keys` — replay-safe owner mutations;
- `outbox` — Telegram delivery queue;
- `job_claims` — jobs lease.

Migration `0010_information_cards` queues deletion of legacy Telegram card messages before deleting legacy match, player, vote, roster, notification, webhook-update, and old-outbox data. Migration `0013_clear_legacy_runtime_state` clears old idempotency records and job leases. The venue catalog remains. `pnpm db:cleanup-legacy-cards` removes only delivered migration-only deletion events.

## Security and environments

The Mini App guard verifies Telegram HMAC signatures, session freshness, and the configured owner ID. CORS allows only the configured web origin. `/health` and the jobs CLI are the only non-Mini-App boundaries.

Local and production configurations are isolated. No production deployment, migration, Telegram configuration, or messages are implied by code changes.
