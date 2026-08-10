# Development Guide

## Local setup

Use Node.js `>=22.18.0`, pnpm, Docker PostgreSQL, and local-only Telegram values.

```bash
pnpm install --frozen-lockfile
cp .env.local.example .env.local
```

Add local configuration without committing it:

```text
DATABASE_URL=postgresql://football_local:football_local_dev_password@127.0.0.1:55432/football_local
TELEGRAM_BOT_TOKEN=<local-test-bot-token>
TELEGRAM_OWNER_USER_ID=<local-owner-telegram-id>
TELEGRAM_CHAT_ID=<local-test-chat-id>
TELEGRAM_GENERAL_TOPIC_ID=<local-card-topic-id>
TELEGRAM_CHAT_TOPIC_ID=<local-weather-topic-id>
TELEGRAM_MINI_APP_URL=http://localhost:6173
WEB_ORIGIN=http://localhost:6173
GROUP_TIMEZONE=Europe/Minsk
LOG_LEVEL=debug
```

Start the local PostgreSQL container in Docker Desktop, then apply migrations explicitly:

```bash
pnpm db:migrate
pnpm db:check
```

`pnpm dev` opens the configured ngrok tunnels and starts the API and Vite app. It does not register a Telegram webhook. The optional `pnpm dev -- --set-menu-button` command sets the menu button for the local test bot only.

## Useful commands

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm api:contracts:check
pnpm test:e2e
pnpm db:cleanup-legacy-cards
```

The cleanup command is for the migration-only legacy card deletion queue. Run it only after the jobs process has delivered all legacy deletion events.

## Local acceptance

1. Create a venue, then create a match with an exact time and venue.
2. Verify Telegram receives one card with no keyboard, roster, or voting controls.
3. Edit the match and confirm the same message changes.
4. Delete the match and run `pnpm --filter @football/api jobs:run` if a retry is needed.
5. Use the global Weather button and verify a current Minsk weather message appears in the configured topic.

Playwright is the supported rendered frontend check. Codex Browser QA remains unavailable in this repository because of the `sandboxCwd is not a local file URI` runtime limitation; it is not a substitute for Playwright.

## Production boundary

See [Railway](railway.md). Production migration, deployment, legacy cleanup, and disabling a legacy Telegram webhook require separate explicit owner authorization.
