# Development Guide

For a single product-and-operations walkthrough, including member voting, owner workflows, and time modes, start with the [Application guide](application-guide.md). This document is the detailed development command reference.

> **Default Telegram launch:** This repository runs an owner-only Telegram Mini App. Start it with `pnpm dev`. Before that, start the local PostgreSQL container in Docker Desktop and apply migrations with `pnpm db:migrate`. The command creates the public API and Web HTTPS tunnels, starts the API and Vite, and registers the local webhook.

## Prerequisites

- Node.js `>=22.18.0`;
- pnpm `11.10.0` or a compatible pnpm version;
- Docker Engine with the Compose plugin for local PostgreSQL;
- a non-production Telegram bot and test group only if live Telegram checks are needed.

Use the local test group and local PostgreSQL for development. Never use a production bot token, production database URL, production group/topic IDs, production webhook, or production Mini App origin locally.

## Local setup

Install dependencies and prepare the local database configuration:

```bash
pnpm install --frozen-lockfile
cp .env.local.example .env.local
```

The local helper starts PostgreSQL on `127.0.0.1:55432` and waits for its health check. Extend `.env.local` with the required local API values:

```text
DATABASE_URL=postgresql://football_local:football_local_dev_password@127.0.0.1:55432/football_local
TELEGRAM_BOT_TOKEN=<local-test-bot-token>
TELEGRAM_WEBHOOK_SECRET=<local-test-webhook-secret>
TELEGRAM_OWNER_USER_ID=<local-owner-telegram-id>
TELEGRAM_CHAT_ID=<local-test-chat-id>
TELEGRAM_GENERAL_TOPIC_ID=<local-general-topic-id>
TELEGRAM_CHAT_TOPIC_ID=<local-chat-topic-id>
TELEGRAM_MINI_APP_URL=http://localhost:6173
TELEGRAM_MINI_APP_INIT_DATA_MAX_AGE_SECONDS=86400
WEB_ORIGIN=http://localhost:6173
GROUP_TIMEZONE=Europe/Minsk
LOG_LEVEL=debug
```

The API validates all of these values at startup. `TELEGRAM_MINI_APP_URL` may be an HTTP URL for local development; `WEB_ORIGIN` must be the exact origin, without a path. The init-data maximum age defaults to 24 hours when omitted.

Generate correctly signed local fixture `initData` without adding an authentication bypass:

```bash
pnpm auth:fixture -- --user-id <local-owner-telegram-id>
```

The command reads the local bot token from the environment or `.env.local`, prints only the signed query string, and never prints the token. Use the result as `X-Telegram-Init-Data` for local API clients. Pass `--auth-date <unix-seconds>` to create deterministic expiry fixtures.

Start the local PostgreSQL container in Docker Desktop. After it is healthy, run the migration explicitly before the first launch and whenever the schema changes. API startup does not run migrations:

```bash
pnpm db:migrate
```

When `DATABASE_URL` is not already present in the shell, the migration runner reads the repository-root `.env.local`. An explicitly provided environment value takes precedence.

## Run locally in Telegram

The project ngrok workflow opens separate API and Web HTTPS tunnels and injects the resulting URLs into the child processes. Mini App API calls stay on the stable Web origin and are proxied by Vite to the local API; the dynamic API tunnel is used for the webhook:

Authenticate ngrok once on the development machine; keep the credential out of Git and chat:

```bash
ngrok config add-authtoken <your-ngrok-authtoken>
```

```bash
pnpm dev
```

The command prints the public Mini App URL, API URL, webhook URL, and the local ngrok inspector at `http://127.0.0.1:4040`. The Web tunnel uses the reserved domain configured in `ngrok.local.yml`, while the API tunnel remains dynamic unless a second reserved domain is added. Each launch registers the local bot webhook for the current API tunnel.

To also set the configured owner's local menu button to the temporary Mini App URL:

```bash
pnpm dev -- --set-menu-button
```

The command calls Telegram's Bot API for the values in `.env.local`. Use only a non-production bot and test group. The Web URL remains stable with the configured reserved domain; the API URL changes between sessions until a second reserved domain is configured, but the Mini App itself continues using the stable Web URL through the local proxy.

## Exact package commands

Useful focused commands are:

```bash
pnpm --filter @football/api lint
pnpm --filter @football/api test
pnpm --filter @football/api typecheck
pnpm --filter @football/api build
pnpm --filter @football/db db:check
pnpm --filter @football/db db:migrate
pnpm --filter @football/domain test
pnpm --filter @football/api-client generate
pnpm --filter @football/web test
pnpm test:e2e
pnpm --filter @football/web build
```

Playwright runs the owner Mini App against a local Vite server with mocked API responses and a Telegram WebApp fixture. It is the supported browser-verification path for this repository and is confirmed to run in desktop and mobile Chromium. Use `pnpm test:e2e` for rendered frontend changes. Install Chromium once with `pnpm --filter @football/web exec playwright install chromium` before the first E2E run.

Codex Browser QA is not available in this repository because of its `sandboxCwd is not a local file URI` runtime blocker. Do not treat that limitation as a Playwright limitation.

Regenerate the API contract and client together:

```bash
pnpm openapi:generate
pnpm api-client:generate
```

The drift check used by CI and handoff is:

```bash
pnpm api:contracts:check
```

## Repository quality gates

Run all gates from the repository root before handing off changes:

```bash
pnpm install --frozen-lockfile
pnpm lint
pnpm test
pnpm typecheck
pnpm build
pnpm api:contracts:check
```

`pnpm test`, `pnpm lint`, `pnpm typecheck`, and `pnpm build` run every maintained workspace package. A generated-client change is incomplete until `pnpm api:contracts:check` passes with no diff.

## Local acceptance checklist

For Telegram acceptance, start with `pnpm dev` and use only the local bot, local group, local database, and the public URL printed by the workflow.

1. Verify that the PostgreSQL container is healthy, required migrations have been applied, the ngrok workflow started the API, and `GET http://localhost:6000/health` returns API status `ok`.
2. Open the Mini App from the local Telegram bot as the configured owner. Verify that an ordinary Telegram account is rejected and that opening the URL outside Telegram shows the Telegram-only state.
3. Create and publish a match from the Mini App, then verify that one transaction created the active match and queued exactly one card for `General`.
4. Vote from Telegram accounts on the public card. Verify callback source checks, one vote per player/match, card refresh, and duplicate-update safety.
5. Edit with the current version, then retry with a stale `If-Match` value and verify a conflict without data loss.
6. Verify confirmation, completion, cancellation, vote correction/removal, external participants, aliases, and retained history through the owner flow.
7. Run `pnpm --filter @football/api jobs:run` repeatedly. Verify outbox retries, reconciliation state, and no duplicate weather notification for a Minsk day.
8. Confirm that no local action changed a production database, webhook, BotFather setting, or production Mini App URL.

## Troubleshooting

### API fails at startup

Check that the shell has all required variables, that `DATABASE_URL` uses `postgres://` or `postgresql://`, that IDs are decimal integers, and that `WEB_ORIGIN` is an exact HTTP(S) origin. The API does not accept SQLite URLs and does not run migrations automatically.

### Mini App shows an access error

Open it from Telegram, not a normal browser tab. Restart `pnpm dev` after configuration changes, close the current Mini App, and open it again so Telegram reloads the client. Check that the Telegram account is the configured local owner. Expired `initData` requires reopening the Mini App.

### Public card is missing or stale

Inspect the match's `publicCard` publication state through the owner API, then run the jobs command. For `uncertain` or `failed` initial publication, inspect the configured General topic first:

1. If the card exists, copy its Telegram message ID into the Mini App repair panel and choose **Attach card**. The API stores that reference and queues a refresh (or deletion for an already ended match).
2. If the card definitely does not exist, choose **Card is absent — retry publication**. This is the only action that resets the uncertain state and allows one new initial send.

Never choose retry merely because the message ID is unknown: Telegram may already contain the card, and an initial `sendMessage` has no idempotency key.

### Jobs report busy

Another invocation holds the PostgreSQL lease. Let that invocation finish; do not delete the lease row or run overlapping manual resets. A later Cron pass can recover retryable work.

## Production boundary

The production sequence is documented in [the Railway runbook](railway.md). No production deployment, database migration, Telegram webhook registration, Mini App URL update, or BotFather change may be performed without explicit owner authorization.
