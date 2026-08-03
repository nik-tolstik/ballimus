# Application Guide

This document explains the product from a user and operator perspective and provides the shortest reliable paths for running it locally. For implementation details, see [Architecture](architecture.md). For production deployment, see the [Railway runbook](railway.md).

## What the application does

Football Bot coordinates a football match through two connected surfaces:

- a public Telegram match card where group members vote;
- an owner-only Telegram Mini App where the configured owner creates matches, edits details, manages the roster, and changes the match lifecycle.

PostgreSQL is the source of truth. The Telegram card is a public projection of the current match and roster state. The Mini App never trusts a browser identity by itself: it forwards Telegram's signed `initData` to the API, which validates the signature, session age, and configured owner ID.

## Roles and Telegram topics

The application expects one Telegram group with topics enabled:

- `TELEGRAM_GENERAL_TOPIC_ID` is where public match cards are published and updated;
- `TELEGRAM_CHAT_TOPIC_ID` is where service notifications are sent;
- `TELEGRAM_OWNER_USER_ID` is the only account allowed to use the Mini App management API;
- ordinary group members interact only with buttons on the public card.

The bot must be a member of the configured group and must be able to send and edit messages in the configured topics.

## End-to-end match flow

1. The owner opens the Mini App from Telegram.
2. The Mini App loads matches, players, history, roster state, and public-card delivery state from the API.
3. The owner creates a match with a date, a time format, an optional location, a venue type, a player threshold, and an optional field price.
4. The API creates an `active` match and queues publication of its public Telegram card.
5. Members vote on the card. Each Telegram update is claimed once, the current vote is stored in PostgreSQL, and the card is refreshed.
6. When enough players are available, the bot sends a threshold notification. The threshold is not a capacity: more players may continue to join.
7. The owner can correct votes, add external players, choose the final time and place, and confirm the match.
8. After the match, the owner marks it completed or cancelled. The public card is removed, while the match remains in History.

## Time modes and voting

| Mode | Owner configuration | Member behavior | Stored roster behavior |
| --- | --- | --- | --- |
| Fixed exact time | One time, for example `21:00` | Chooses `going`, `maybe`, or `not going` | Every `going` vote belongs to the one fixed roster |
| Exact-time options | Several exact times, for example `19:00` and `20:00` | May select multiple exact times; each button toggles independently | The card groups players under every selected exact time |
| After-time availability | One or more thresholds, for example `after 19:00` and `after 20:00` | Selects one earliest time after which they can arrive | Eligibility is cumulative: `after 19:00` is also eligible for a later final time |

An active time poll may be changed to one fixed exact time even after votes exist. All current `going` players are kept and moved to the fixed roster. The owner may choose a time earlier than the previous availability threshold; this is intentionally treated as the owner's decision. The old `availableAfter` or exact-option selections are cleared in the same database transaction.

Changing a voted poll into another ambiguous poll configuration remains blocked when existing selections cannot be mapped safely. A confirmed match also locks its time mode and poll options.

## Owner Mini App

The Mini App has three primary areas:

- **Matches** — create, edit, confirm, complete, cancel, refresh, and repair Telegram publication;
- **Players** — view known Telegram identities and assign readable names or aliases;
- **History** — view completed and cancelled matches.

Inside a match, the owner can move known players between roster groups, remove a vote, add or edit external participants, and inspect the current Telegram publication state. External participants count toward the player threshold.

Opening the public Web URL in a normal browser does not authenticate the owner. The application must normally be opened through the configured Telegram bot so Telegram supplies signed Mini App data.

## Match lifecycle

- `active` — published and accepting votes and roster changes;
- `confirmed` — the exact time and venue have been confirmed; roster updates remain possible;
- `completed` — finished and retained in history;
- `cancelled` — cancelled with a retained reason;
- `draft` — supported only for legacy records; the current creation flow creates an active match directly.

## Cards, notifications, and background jobs

Telegram effects are written to a durable outbox in the same transaction as the business change. A short jobs process claims pending work, sends or edits Telegram messages, records the outcome, and exits. The API does not run a permanent timer.

Run one jobs pass with:

```bash
set -a
source .env.local
set +a
pnpm --filter @football/api jobs:run
```

The summary reports outbox delivery and weather results, for example:

```text
Jobs run completed: claimed=1 delivered=1 failed=0 uncertain=0 weatherSent=0 weatherFailed=0
```

Weather notifications are eligible only for `active` or `confirmed` outdoor matches with one scheduled exact time between now and approximately 16 hours from now. The job uses Open-Meteo and sends at most one forecast per configured chat and local calendar day. A provider failure is safe to retry on the next jobs pass. An uncertain Telegram send is not retried automatically because the message may already have been delivered.

## Prerequisites

- Node.js `>=22.18.0`;
- pnpm `11.10.0` or a compatible version;
- Docker Engine with Docker Compose;
- ngrok for Telegram Mini App and webhook testing;
- a non-production Telegram bot and test group.

Run all commands from the repository root.

## First-time local configuration

Install dependencies and create the local environment file:

```bash
pnpm install --frozen-lockfile
cp .env.local.example .env.local
```

Keep the PostgreSQL values from the example and add the Telegram values:

```dotenv
DATABASE_URL=postgresql://football_local:football_local_dev_password@127.0.0.1:55432/football_local
TELEGRAM_BOT_TOKEN=<test-bot-token>
TELEGRAM_WEBHOOK_SECRET=<letters-numbers-underscores-or-hyphens>
TELEGRAM_OWNER_USER_ID=<owner-telegram-user-id>
TELEGRAM_CHAT_ID=<test-group-chat-id>
TELEGRAM_GENERAL_TOPIC_ID=<public-card-topic-id>
TELEGRAM_CHAT_TOPIC_ID=<notification-topic-id>
TELEGRAM_MINI_APP_URL=http://localhost:6173
TELEGRAM_MINI_APP_INIT_DATA_MAX_AGE_SECONDS=86400
WEB_ORIGIN=http://localhost:6173
GROUP_TIMEZONE=Europe/Minsk
LOG_LEVEL=debug
```

`.env.local` is ignored by Git. Never put production credentials in it.

Start the local PostgreSQL container in Docker Desktop. Before the first application launch, and whenever the schema changes, apply migrations explicitly:

```bash
set -a
source .env.local
set +a
pnpm db:migrate
```

## Recommended launch: Telegram and ngrok

This is the normal development path when the Mini App must work inside Telegram.

Authenticate ngrok once:

```bash
ngrok config add-authtoken <ngrok-authtoken>
```

Check `ngrok.local.yml`. The Web tunnel may use a reserved stable domain; the API webhook tunnel may remain dynamic.

Open both tunnels, start the API and Vite, and register the webhook:

```bash
pnpm dev
```

For the first setup, the same command can also set the owner's Telegram menu button:

```bash
pnpm dev -- --set-menu-button
```

The command prints output similar to:

```text
Local Telegram development is ready.
  Mini App: https://<web-domain>
  API:      https://<dynamic-api-domain>
  Webhook:  https://<dynamic-api-domain>/telegram/webhook
  ngrok UI: http://127.0.0.1:4040
```

Keep this process running. Open the Mini App from the test bot as the configured owner. The Web domain can remain stable, while the API tunnel normally changes on restart; `pnpm dev` registers the webhook for every new ngrok session.

`pnpm dev` does not start a permanent jobs loop. Run `jobs:run` from another terminal whenever pending outbox work or a weather check must be processed.

Stop the API, Web server, and both ngrok tunnels with `Ctrl+C`. The PostgreSQL container remains managed separately in Docker Desktop.

## Verify a running environment

Check the local API:

```bash
curl --fail --silent --show-error http://127.0.0.1:6000/health
```

Expected response:

```json
{"status":"ok","service":"api","timestamp":"..."}
```

For ngrok, also check the printed public API URL and open `http://127.0.0.1:4040` to inspect incoming webhook requests. A successful health check proves that the HTTP process is running; it does not prove that PostgreSQL, Telegram delivery, or weather delivery has completed.

Useful PostgreSQL commands are:

```bash
node scripts/postgres-local.mjs status
node scripts/postgres-local.mjs logs
node scripts/postgres-local.mjs stop
```

`stop` preserves local data. The destructive reset command is documented separately in [Local PostgreSQL](local-postgres.md).

## Daily development workflow

1. Start with `pnpm dev` for Telegram testing.
2. Open the Mini App from the test bot, not from a normal browser tab.
3. Create or edit a match in the Mini App.
4. Vote from group accounts on the public card.
5. Run `pnpm --filter @football/api jobs:run` if a durable card event, notification, or weather check is pending.
6. Before handoff, run the quality gates:

```bash
pnpm lint
pnpm test
pnpm typecheck
pnpm build
pnpm api:contracts:check
```

## Troubleshooting

### The Mini App says to open it in Telegram

This is expected for a normal browser tab. Open it from the bot menu button so Telegram provides signed `initData`. Close and reopen the Mini App after restarting tunnels or changing its URL.

### The time mode cannot be changed after votes

Converting an active poll to one fixed exact time is supported and keeps all `going` players. Converting a voted poll into another poll mode can still be rejected when existing choices cannot be mapped safely. Confirmed matches keep their time configuration locked.

### A match was saved but the Telegram card is stale

Run one jobs pass. If the initial publication state is `uncertain`, inspect the General topic before retrying: the message may already exist. Attach the existing Telegram message ID in the Mini App, or explicitly confirm that the card is absent before requesting another initial publication.

### `weatherFailed=1`

Confirm that the match is outdoor, `active` or `confirmed`, has an exact scheduled time, and falls inside the weather window. Provider failures are marked retryable; run the jobs command again. An `uncertain` Telegram outcome is deliberately not retried automatically.

### ngrok reports that a domain or session is already active

Stop the other ngrok process or session using the reserved domain, then start this project again. Only one live tunnel can own the same reserved domain.

### The API fails during startup

Check every required variable in `.env.local`, the local PostgreSQL health status, and whether port `6000` is already in use. `WEB_ORIGIN` must contain only an HTTP(S) origin without a path.

## Production boundary

Local development must use a test bot, test group, local PostgreSQL, and local ngrok configuration. Do not reuse production bot tokens, database URLs, group IDs, web origins, or webhooks. Production migration, deployment, webhook registration, and BotFather changes follow the separately authorized [Railway runbook](railway.md).
