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

`apps/api` is a NestJS API. It exposes `/health`, the owner REST API under `/v1`, a secret-authenticated poll and poll-answer webhook, and one bounded jobs command. It has no callback handler, long-polling loop, or in-process scheduler.

`apps/web` is a React/Vite Mini App. It sends signed Telegram `initData` through the generated client and uses TanStack Query for current cards, polls, and venues. `packages/domain` owns static card, poll-notification, and weather formatting. `packages/db` owns PostgreSQL, migrations, idempotency, and the information-card outbox.

## Owner REST API

The generated OpenAPI contract exposes only:

- match information-card CRUD;
- venue catalog CRUD and permanent deletion;
- native poll creation, listing, manual republishing, and archiving;
- `POST /v1/weather/current`.

Match creation requires an exact date/time and an active venue. It writes the match, a pending public-card reference, and a `publish_public_card` outbox event in one transaction. A best-effort delivery is attempted after commit; the jobs process provides retry recovery. Manual archival marks the match archived, removes it from active lists, and queues deletion of its Telegram card while retaining the match as repeatable history. Archived records are listed newest first and can be permanently removed; that removal preserves a matchless deletion event when a Telegram message still needs deleting.

Edits enqueue a refresh of the existing message. Active-card deletes mark the match as deletion-requested and queue `delete_public_card`. Archiving never restores a match or runs automatically. Repeating an archived match creates a separate new card from its saved schedule, duration, venue, and price. Poll creation writes an independent `telegram_polls` row and makes one bounded Telegram publication attempt after the transaction commits. A venue can be permanently deleted only when no match references it; referenced venues and existing matches are preserved. There are no player, roster, match-vote, or forecast endpoints.

## Telegram delivery

The Telegram card is a read-only projection. It is rendered as HTML text with no reply markup or callback data. The outbox supports publishing, refreshing, and deleting cards. Refresh and delete failures retry with backoff; an ambiguous first send is marked uncertain rather than blindly resent.

New polls are non-anonymous and target the configured General topic. Creation performs one bounded Bot API call and records `published`, `failed`, or `uncertain` immediately; it does not queue automatic publication retries. Failed and uncertain polls expose a manual republish action, with uncertain results requiring the owner to check General first because Telegram may have accepted a request without confirming it. Telegram `poll` updates refresh ordered option counts, and the visible Polls screen periodically reloads those persisted counts. A poll can have one notification threshold, and every option stores a direct notification-enabled flag. Each upward crossing of the threshold on an enabled option atomically marks that crossing and makes one bounded send to the configured Chat topic; falling below the threshold rearms the option for a later crossing. Individual voter answers detect downward crossings, wait for a 10-second grace period, and recheck both the current total and the voter's latest answer before making one direct alert attempt. Disabled options never trigger either transition, and failures are not retried. Archiving a poll hides it immediately, suppresses threshold work, and makes one bounded attempt to delete its Telegram message. Polls and notifications never reference a match or use the durable outbox.

Current weather is fetched from Open-Meteo for Minsk only when the owner invokes the endpoint. The formatted result is sent directly to the configured Telegram topic and is neither persisted nor rate limited.

## Persistence

The current application tables are:

- `venues` — owner-maintained venue catalog;
- `matches` — exact schedule, required venue, price, owner, version, archival state, and deletion marker;
- `match_messages` — durable Telegram card references and publication state;
- `telegram_polls` — independent native poll settings, Telegram references, option counts, and queued threshold markers;
- `http_idempotency_keys` — replay-safe owner mutations;
- `outbox` — durable information-card delivery queue;
- `job_claims` — jobs lease.

Migration `0010_information_cards` queues deletion of legacy Telegram card messages before deleting legacy match, player, vote, roster, notification, webhook-update, and old-outbox data. Migration `0014_native_telegram_polls` adds the isolated poll store. Migration `0016_non_anonymous_general_polls` changes the default for newly created poll records without rewriting already published Telegram polls. Migration `0017_archive_native_polls` adds poll archival state. Migration `0018_manual_poll_publication` converts incomplete legacy poll sends into terminal states so the owner can republish explicitly. Migration `0019_remove_poll_outbox` deletes legacy poll events and restricts the outbox to information-card work. Migration `0020_poll_voter_answers` retains the latest answer per voter for active polls and supports idempotent below-threshold withdrawal alerts. Migration `0021_remove_venue_archiving` removes the obsolete venue archive marker and deletes only archived venues that are not referenced by a match; referenced venues and their matches are preserved. `pnpm db:cleanup-legacy-cards` removes only delivered migration-only card deletion events.

## Security and environments

The Mini App guard verifies Telegram HMAC signatures, session freshness, and the configured owner ID. CORS allows only the configured web origin. The webhook requires Telegram's secret-token header, whose expected value is derived from the bot token, and only applies updates for known Telegram poll IDs. `/health`, the poll webhook, and the jobs CLI are the only non-Mini-App boundaries.

Local and production configurations are isolated. No production deployment, migration, Telegram configuration, or messages are implied by code changes.
