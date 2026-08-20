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

## Local acceptance

1. Create a venue, then create a match with an exact time and venue.
2. Verify Telegram receives one card with a `17:00-18:30`-style time range and no keyboard.
3. Edit the match and confirm the same message changes.
4. Delete the match and run `pnpm --filter @football/api jobs:run` if a retry is needed.
5. Use the global Weather button and verify a current Minsk weather message appears in the configured topic.
6. Create a non-anonymous native poll with one option notification enabled. Verify the poll appears in General, its option counts refresh in the Mini App, the default threshold is 10, and the first upward crossing makes one notification attempt in Chat only. Remove enough tracked votes to fall below the threshold, restore the count, and verify the next upward crossing notifies again. Remove a tracked vote and restore it within 10 seconds to verify the delayed shortage alert is suppressed; remove it again without restoring it and verify the alert appears after the grace period with the voter's `@username` or display-name fallback. If Telegram rejects or does not confirm publication, verify the poll reaches a terminal status and use the manual Republish action after checking General. Open the poll card, archive it, and verify it disappears from the active list; archival makes one direct Telegram deletion attempt and removes retained voter-answer state. Poll effects are never added to the outbox.

Playwright remains the required rendered frontend check because it provides deterministic mocked API and Telegram WebApp fixtures, including native confirmation dialogs and mutation assertions.

## Chrome Telegram Mini App smoke check

When the Chrome plugin is connected and Telegram Web is already signed in, supplement Playwright with a smoke check inside the real local Telegram Mini App:

1. Start `pnpm dev` and wait for the `Local Telegram development is ready` message. Do not use the loopback Vite URL as a standalone session.
2. In the existing Telegram Web session, open the bot profile and verify both `Ballimus Dev` and the exact username `@ballimus_dev_bot`. Never open `Ballimus`, the production bot, or any bot whose exact username differs.
3. Click **Open App** only after the bot identity is verified. Telegram sends signed owner `initData` to the local application during this step.
4. Inspect only the Mini App iframe origin, discard its query and fragment, and require the origin to equal `CLOUDFLARE_TUNNEL_URL`. Never print, save, or copy the full iframe URL or Telegram `initData`.
5. Confirm the app identifies itself as `Ballimus Dev`, owner-only data loads, the Matches, Polls, and Venues sections open, the relevant sheet or editor renders, and the Chrome console has no related errors. Capture a screenshot when visual evidence is useful.
6. Keep this smoke check read-only unless the owner separately authorizes a specific mutation. Opening sheets and changing a control without saving are safe. Creating, saving, archiving, deleting, republishing, voting, or confirming Weather sends may change the local database or send Telegram messages and must target only the local bot and `Футбол тест` group.
7. If Chrome cannot control the Mini App iframe or a native confirmation dialog, record that limitation and use Playwright for the affected interaction. If Chrome is unavailable, Telegram Web is signed out, or the exact test bot cannot be verified, skip this smoke check rather than using any other bot.

## Production boundary

See [Railway](railway.md). Production migration, deployment, webhook registration, and Telegram messages require separate explicit owner authorization.
