# Railway Topology and Runbook

This document describes the intended production shape. It is not evidence that production is deployed. The migration work log records that production changes are currently unauthorized.

## Authorization gate

The following actions require explicit owner authorization immediately before they are performed:

- creating or changing Railway production services, variables, domains, or deployments;
- applying a production PostgreSQL migration;
- registering, changing, or deleting the production Telegram webhook;
- setting the production Mini App URL, menu button, or Main Mini App in BotFather.

Do not use a local tunnel, test bot, local database, or local web origin as a production substitute. Do not infer authorization from a successful local quality gate.

## Intended topology

```text
Telegram Bot API -- HTTPS webhook --> Railway API service --+--> Railway PostgreSQL
                                                          |
Railway Cron service -- `pnpm --filter @football/api jobs:run` --> API job process

Telegram owner -- Mini App URL --> Railway Web service -- HTTPS /v1 --> API service
```

The production environment has four services/resources and no Railway staging environment:

1. **API service** — persistent NestJS process, built from `apps/api`, listening on `0.0.0.0:$PORT`. It serves `/health`, `/v1/*`, and `/telegram/webhook`; `/health` and `/telegram/webhook` are the relevant non-Mini-App HTTP boundaries, and the API has no public `/cron` route.
2. **PostgreSQL service** — Railway-managed PostgreSQL. Its connection string is supplied to the API and Cron as `DATABASE_URL`.
3. **Cron service** — the same repository and API package, invoking `pnpm --filter @football/api jobs:run` on a short schedule such as every five minutes. Each invocation acquires a database lease, drains retryable outbox work, runs weather work, and exits.
4. **Web service** — the Vite production build from `apps/web`, exposed at a stable HTTPS origin. `VITE_API_BASE_URL` is public build-time configuration; it must not contain bot credentials.

## Required configuration

API and Cron need the same production values:

```text
DATABASE_URL
TELEGRAM_BOT_TOKEN
TELEGRAM_WEBHOOK_SECRET
TELEGRAM_OWNER_USER_ID
TELEGRAM_CHAT_ID
TELEGRAM_GENERAL_TOPIC_ID
TELEGRAM_CHAT_TOPIC_ID
TELEGRAM_MINI_APP_URL
TELEGRAM_MINI_APP_INIT_DATA_MAX_AGE_SECONDS=86400
WEB_ORIGIN
GROUP_TIMEZONE=Europe/Minsk
LOG_LEVEL=info
```

The web build needs:

```text
VITE_API_BASE_URL=https://<production-api-domain>
```

Use Railway-provided `PORT` for the API. Keep the API `WEB_ORIGIN` exactly equal to the web service origin, with no path. Never expose `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET`, or `DATABASE_URL` to the web build.

## Release runbook

Perform these steps only after the authorization gate is satisfied:

1. Run the local quality gates from the repository root:

   ```bash
   pnpm install --frozen-lockfile
   pnpm lint
   pnpm test
   pnpm typecheck
   pnpm build
   pnpm api:contracts:check
   ```

2. Provision or verify the production PostgreSQL, API, Cron, and Web resources in the same Railway production environment. Confirm that the API and Cron point to the production `DATABASE_URL` and that Web has only `VITE_API_BASE_URL` as its API connection setting.
3. Build the API and web artifacts using the repository commands:

   ```bash
   pnpm --filter @football/api build
   pnpm --filter @football/web build
   ```

   The API entry point is `apps/api/dist/main.js`; the web static output is `apps/web/dist`.
4. Run the explicit production migration as the release step, before sending traffic to the API:

   ```bash
   pnpm --filter @football/db db:migrate
   ```

   The API does not run migrations on startup. Verify the migration command used the intended production `DATABASE_URL` and did not use a local shell environment.
5. Deploy the API and verify `GET https://<production-api-domain>/health` returns `{"status":"ok","service":"api",...}`. Verify CORS from the exact web origin and confirm API logs do not print secret values.
6. Deploy the Web service with `VITE_API_BASE_URL=https://<production-api-domain>`. Open the resulting URL only for a read-only smoke check until the Mini App URL is authorized and configured.
7. Configure the Cron service with the same API/database environment and the command `pnpm --filter @football/api jobs:run`. Confirm one invocation exits and reports its summary; do not run the API as a scheduler.
8. After the API has a stable HTTPS domain, register the production webhook using the production bot token and secret. This is an owner-authorized operation; the following is a template, not a command to run automatically:

   ```bash
   curl --fail-with-body --silent --show-error --request POST \
     "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/setWebhook" \
     --data-urlencode "url=https://<production-api-domain>/telegram/webhook" \
     --data-urlencode "secret_token=${TELEGRAM_WEBHOOK_SECRET}" \
     --data-urlencode 'allowed_updates=["callback_query"]'
   ```

9. Verify the webhook with `getWebhookInfo`, then perform the authorized BotFather configuration: set the production Mini App URL and configure the menu/Main Mini App entry point. The owner must open the app from Telegram, not from a private command flow.
10. Run the production smoke checklist below with the owner and record the deployment, migration, webhook, and BotFather results outside secrets.

## Production checklist

- [ ] Owner authorization is recorded for the release and each Telegram configuration change.
- [ ] API, PostgreSQL, Cron, and Web are separate production resources; no staging resource is assumed.
- [ ] API and Cron use production-only secrets and the intended Railway PostgreSQL URL.
- [ ] Web exposes only the public API base URL and has the exact API CORS origin.
- [ ] PostgreSQL migration completed explicitly before API traffic.
- [ ] API `/health` is reachable and API startup succeeds without applying migrations.
- [ ] Cron runs once, exits, respects the PostgreSQL lease, and reports outbox/weather results.
- [ ] Webhook URL is the production API `/telegram/webhook`, and Telegram secret-token validation is enabled.
- [ ] `getWebhookInfo` reports the intended webhook and allowed update set.
- [ ] BotFather Mini App URL and menu/Main Mini App point to the production Web origin.
- [ ] The owner can open the Mini App, pass signed init-data validation, create a draft, preview, and publish one test match.
- [ ] A group member can vote on the public card and the API refreshes the card through webhook/outbox handling.
- [ ] A repeated callback or job run does not duplicate votes, notifications, or forecasts.
- [ ] No local URL, local bot, local database, or temporary tunnel appears in production configuration.

Until this checklist is authorized and completed, production status is **not deployed / not verified**.

## Incident and reconciliation notes

If a public-card publication is marked `uncertain`, do not publish again blindly: Telegram may already contain the card. Inspect the configured General topic. If the card exists, use the Mini App repair action to attach its Telegram message ID; the API then refreshes it or deletes it when the match has already ended. Only after confirming that no card exists may the operator choose the retry action, which resets the reference to `pending` and queues one new initial publication. Record that decision during production acceptance.

If Cron reports `busy`, another invocation owns the lease; wait for the next schedule instead of deleting job-claim rows.
