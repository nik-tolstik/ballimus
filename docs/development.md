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
CLOUDFLARE_TUNNEL_URL=https://football-dev.example.com
GROUP_TIMEZONE=Europe/Minsk
LOG_LEVEL=debug
```

Start the local PostgreSQL container in Docker Desktop, then apply migrations explicitly:

```bash
pnpm db:migrate
pnpm db:check
```

Telegram Mini App is the only supported local development mode. First ensure that the remotely managed Cloudflare Tunnel connector is healthy, then run `pnpm dev`. It starts the API and Vite behind the persistent `CLOUDFLARE_TUNNEL_URL` origin with real Telegram authentication. It does not change Telegram configuration by default. Open the Mini App from the configured local test bot; the loopback ports are internal tunnel targets and do not contain a Telegram session.

The optional `pnpm dev -- --set-menu-button` command sets the menu button for the local test bot only. Use `pnpm dev -- --set-webhook` only with that bot to register `${CLOUDFLARE_TUNNEL_URL}/v1/telegram/webhook` for aggregate `poll` and individual `poll_answer` updates and exercise threshold notifications. The Cloudflare route targets Vite on port `6173`; Vite proxies `/v1` to the loopback API on port `6000`.

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

Testing requirements and the local Telegram acceptance workflow live in the [testing guide](testing.md).

## Production boundary

See [Railway](railway.md). Production migration, deployment, webhook registration, and Telegram messages require separate explicit owner authorization.
