# Vercel and Railway Production Runbook

This document describes the intended production deployment and the validation-to-production cutover. It is not evidence that production is deployed.

## Authorization boundary

The repository owner must explicitly authorize production infrastructure changes, PostgreSQL migrations, Telegram webhook changes, and BotFather Mini App changes. Production secrets must stay in provider variables or ignored local files and must never be committed.

The initial validation uses a separate production bot in the existing `Футбол тест` forum group. The local dev bot, local PostgreSQL, ngrok webhook, and `.env.local` remain unchanged. Copy `.env.production.local.example` to `.env.production.local` for the production Telegram inputs; the populated file is ignored by Git.

## Topology

```text
Telegram Bot API -- HTTPS webhook --> Railway API service --+--> Railway PostgreSQL
                                                          |
Railway Cron service -- compiled jobs CLI -----------------+

Telegram owner -- Main Mini App --> Vercel Web -- HTTPS /v1 --> Railway API
```

The stack contains these resources:

1. **Vercel Web** — the static React/Vite build from `apps/web`.
2. **Railway API** — a persistent NestJS process listening on `0.0.0.0:$PORT`, with `/health`, `/v1/*`, and `/telegram/webhook`.
3. **Railway Jobs** — a five-minute cron service that drains outbox work, runs weather work, and exits.
4. **Railway PostgreSQL** — `Postgres-validation` during the test-group smoke test, then a new clean `Postgres` service for the real group.

API and Jobs use the repository root because they share `packages/db` and `packages/domain`. Their service-specific Railway configuration files are:

- API: `/apps/api/railway.api.json`
- Jobs: `/apps/api/railway.jobs.json`

## Required variables

API and Jobs require the same application values:

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

Use a Railway reference variable for `DATABASE_URL`. During validation it points to `${{Postgres-validation.DATABASE_URL}}`; after cutover it points to `${{Postgres.DATABASE_URL}}`. Railway provides `PORT` to the API.

Vercel receives only this public build-time variable, scoped to Production:

```text
VITE_API_BASE_URL=https://<railway-api-domain>
```

`WEB_ORIGIN` and `TELEGRAM_MINI_APP_URL` must both equal the exact Vercel production origin without a path. Never expose Telegram or PostgreSQL secrets to the Vercel build.

## Release preparation

Run the local quality gate from the repository root:

```bash
pnpm install --frozen-lockfile
pnpm lint
pnpm test
pnpm typecheck
pnpm db:check
pnpm api:contracts:check
pnpm build
```

The GitHub `main` workflow runs the same checks against PostgreSQL 18. Railway API and Jobs autodeploy from `main` only after that workflow succeeds.

## Initial validation deployment

1. Create the Vercel project with `apps/web` as its Root Directory, enable source files outside the Root Directory, set the build command to `pnpm --filter @football/web... build`, and set the output directory to `dist`.
2. Create a Railway project in EU West with `Postgres-validation`, `api`, and `jobs`. Link API and Jobs to the GitHub repository and select their separate config file paths.
3. Add the production bot to `Футбол тест` as an administrator. Configure API and Jobs with the production bot token and the existing test group/topic IDs.
4. Generate the Railway API domain, set the reciprocal Vercel and Railway origins, and deploy API first. The API pre-deploy command applies the committed migrations before `/health` can pass.
5. Deploy Vercel Web, then deploy Jobs. Confirm that one scheduled invocation completes and exits.
6. Register `https://<railway-api-domain>/telegram/webhook` with the production bot token, the configured secret token, and `allowed_updates=["callback_query"]`.
7. Set the Vercel origin as the bot's Main Mini App/menu URL in BotFather.

## Test-group smoke test

1. Verify API health, exact-origin CORS, the Vercel production build, owner Mini App authentication, bot administrator rights, and `getWebhookInfo`.
2. Create `[TEST] Deployment smoke` in the Mini App and wait for Jobs to publish the card in the test General topic.
3. Cast one Telegram vote, repeat the callback once, and verify that the vote and card remain idempotent.
4. Cancel the test match and wait until the final card update is delivered and retryable outbox work is empty.
5. Disable the Jobs cron before the real-group cutover.

## Clean real-group cutover

1. Add the production bot as an administrator in the real forum group and collect the group ID plus the General and notification topic IDs.
2. Create a new `Postgres` service in EU West and enable daily backups. Do not reuse or truncate `Postgres-validation` in place.
3. Stage the new database reference and all three real group/topic IDs for both API and Jobs before triggering either deployment.
4. Deploy API first. Its pre-deploy migration must succeed against the clean database and `/health` must pass.
5. Deploy Jobs, restore the five-minute cron schedule, and confirm that an empty run exits successfully.
6. Recheck the Mini App bootstrap and webhook without publishing a test card in the real group.
7. Remove the production bot from `Футбол тест` and delete `Postgres-validation` only after the new stack is verified.

## Acceptance checklist

- [ ] GitHub CI passes for the deployed commit.
- [ ] Vercel serves the production Mini App with only `VITE_API_BASE_URL` exposed.
- [ ] Railway API health and exact-origin CORS pass.
- [ ] All seven migrations are present in the active database ledger.
- [ ] Jobs completes, exits, and respects the database lease.
- [ ] The Telegram webhook uses the Railway API URL and secret-token validation.
- [ ] The full publish/vote/idempotency/cancel flow passes in `Футбол тест`.
- [ ] The real group uses a new clean PostgreSQL service and receives no smoke-test messages.
- [ ] No local URL, dev bot, local database, or ngrok URL appears in production configuration.

## Incident notes

If initial card publication is marked `uncertain`, do not publish again blindly. Inspect the configured General topic. Attach the existing Telegram message ID if the card exists; retry only after confirming that it does not.

If Jobs reports `busy`, another invocation holds the lease. Wait for the next schedule instead of deleting job-claim rows.
