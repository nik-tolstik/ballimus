# Architecture

## System boundary

The maintained runtime is split into an HTTP API, a static Mini App, a PostgreSQL database, and a separately invoked jobs process:

```text
Telegram Mini App (owner) -- HTTPS + X-Telegram-Init-Data --> apps/api
Telegram Bot API --------- HTTPS webhook ------------------> apps/api
apps/web ----------------- generated client ----------------> apps/api /v1/*
apps/api <-------------- PostgreSQL ------------------------> packages/db
Railway Cron or local job command -------------------------> apps/api jobs:run
```

`apps/api` is a NestJS application. It listens on `0.0.0.0:$PORT`, exposes a public health endpoint, serves the owner REST API under `/v1`, receives Telegram updates at `POST /telegram/webhook`, and composes the Telegram card and callback services. It does not start a Telegram long-polling loop and it does not own a permanent scheduler.

`apps/web` is a React/Vite application. It initializes the Telegram Web App API, applies Telegram theme and safe-area values, sends the raw Mini App `initData` through the generated client's `X-Telegram-Init-Data` header, and uses TanStack Query for API state.

`packages/domain` has no adapter imports. It owns lifecycle transitions, roster counts, vote transitions, HTML-safe card rendering, notification text, weather eligibility, and validation. `packages/db` owns PostgreSQL access and durable state. `packages/api-client` is generated from Nest Swagger/OpenAPI; handwritten REST contracts do not belong in the frontend.

## Authentication and authorization

The global `MiniAppAuthGuard` protects the REST API. For `/v1` requests it:

1. reads `X-Telegram-Init-Data`;
2. validates Telegram's HMAC signature with `TELEGRAM_BOT_TOKEN`;
3. validates `auth_date` freshness (24 hours by default);
4. requires the Telegram `user.id` to equal `TELEGRAM_OWNER_USER_ID`.

Invalid or expired init data is rejected with `401`; a valid Telegram user who is not the configured owner is rejected with `403`. CORS accepts only the exact `WEB_ORIGIN` for the environment. The non-Mini-App HTTP boundaries are `/health` and `/telegram/webhook`; the API has no public `/cron` route. Railway Cron invokes the CLI command `pnpm --filter @football/api jobs:run` instead of calling the API over HTTP.

## Owner REST flow

The public contract is generated from `apps/api/openapi.json` and includes:

- bootstrap, match listing, match details, and player listing;
- structured draft creation, optimistic-concurrency edits, server-rendered card preview, publication, confirmation, completion, cancellation, refresh, and reconciliation;
- owner vote correction/removal and external-participant management;
- player aliases and readable-name updates.

Mutations require an `Idempotency-Key`. Match edits additionally require `If-Match` with the current match version. The API stores idempotency responses in PostgreSQL and returns a conflict instead of silently overwriting a newer version. The generated client adds the Mini App header and mutation key through `packages/api-client/src/mutator.ts`; `apps/web` consumes generated hooks rather than making raw HTTP calls.

The normal owner flow is:

```text
Open Mini App in Telegram
        |
        v
Validate signed owner session
        |
        v
Load bootstrap, matches, and players
        |
        +--> create structured draft
        |        |
        |        +--> preview server-rendered public card
        |        +--> publish -> durable outbox event
        |
        +--> edit with If-Match -> transaction -> card refresh event
        +--> manage roster/lifecycle -> transaction -> notification/card events
        +--> history and player aliases
```

The API is the source of truth for match details, roster state, lifecycle state, and card publication state. The Telegram card is a projection of that state.

## Telegram webhook and voting

Telegram is configured to call `POST /telegram/webhook`. The controller requires the `X-Telegram-Bot-Api-Secret-Token` header to equal `TELEGRAM_WEBHOOK_SECRET`, validates the update envelope, passes it to grammY, and returns `204 No Content` on success. The current callback path handles public-card vote buttons; callback source validation requires the configured group, `General` topic, and stored card message.

Each callback claims its Telegram `update_id` in `telegram_updates`. The vote transaction updates the player's current choice and queues a card-refresh outbox event atomically. Replayed updates are treated as duplicates. Telegram API calls are bounded and best effort after commit; a durable outbox event remains available for recovery when a card edit or notification fails.

After an applied vote, the API also refreshes the player's Telegram profile photo when the cache is older than seven days. It downloads the smallest available image with a 256 KiB limit, stores the validated JPEG/PNG/WebP copy in PostgreSQL, and exposes it only inside authenticated REST responses as a `data:` URL. Telegram bot tokens and temporary Bot API file URLs never reach the browser. Missing or unavailable photos remain a normal initials fallback.

An exact-time public card uses `going`, `maybe`, and `not_going` buttons. An availability poll instead offers choices such as `after 19:00` and `after 20:00` until the player threshold is reached. The bot then asks the owner to book a field and enter the exact time, location, venue type, and price in the Mini App. Finalization confirms the match atomically, refreshes the card, switches it to exact-attendance buttons, and queues the confirmation notification. A confirmed count is eligible going votes plus external participants. The required-player value is a threshold, not a hard roster capacity.

## Persistence and consistency

`packages/db` uses Drizzle ORM with PostgreSQL. Migrations live in `packages/db/migrations` and are run explicitly; API startup does not migrate the database.

The baseline model includes:

- `telegram_updates` — webhook update claims and processing status;
- `players` and `player_usernames` — late-bound Telegram identities, readable names, aliases, and the bounded profile-photo cache;
- `matches` — schedule, location, venue, threshold, lifecycle, owner, and optimistic version;
- `match_messages` — Telegram public-card reference and publication/reconciliation state;
- `votes` — one current choice per player and match;
- `external_participants` — individually editable owner-managed players; each row represents one person;
- `http_idempotency_keys` — replay-safe REST mutation responses;
- `notifications` — threshold, lifecycle, and weather delivery state;
- `outbox` — post-commit Telegram effects and retry state;
- `job_claims` — the lease preventing overlapping job runs.

Business state and its outbox event are committed together. Ordinary delivery failures retry with backoff. An uncertain initial publication is not blindly retried because it may have created a Telegram message; it is marked for operator reconciliation, which the Mini App can request through the reconciliation endpoint.

## Jobs and webhook timing

`apps/api/src/jobs/cli.ts` runs one bounded `jobs:run` invocation and exits. `JobsRunner` acquires the PostgreSQL job lease, claims a bounded outbox batch, dispatches Telegram effects, runs due weather work, releases the lease, and reports a summary. It does not use `setInterval`, `node-cron`, or an in-process scheduler.

The weather runner sends at most one forecast per configured chat and Minsk calendar day for an eligible outdoor match. Repeated or overlapping Cron invocations are safe because the day claim is durable. A Railway Cron service should invoke `pnpm --filter @football/api jobs:run` on a schedule such as every five minutes; local developers can invoke the same command manually.

## Environment topology

There are exactly two supported environments:

- local — developer machine, Docker Compose PostgreSQL, test Telegram group/non-production bot, local API, local Vite server, and manually invoked jobs;
- production — independently configured Railway API, PostgreSQL, Cron, and web services using the production Telegram group and bot.

There is no Railway staging environment. Local secrets, database URLs, group/topic IDs, webhook URLs, and Mini App origins must never be shared with production. See [Local PostgreSQL](local-postgres.md), [Development](development.md), and [the Railway runbook](railway.md) for the operational boundaries.

Production deployment and Telegram configuration are pending owner authorization; this repository does not claim that production is deployed or that a production webhook is registered.
