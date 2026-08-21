# Production Release Runbook

Production changes require separate, explicit owner authorization. This document describes the release procedure; it never authorizes a deployment, migration, Telegram change, or outgoing message by itself.

This personal project deliberately has no database-backup step. A release can therefore be destructive when its approved migration requires it.

## One-time setup

Copy `.env.production.local.example` to the ignored `.env.production.local` and populate its public values. Do not add Telegram or PostgreSQL secrets.

The repository pins Railway CLI v5. Its required postinstall binary is explicitly allowed in `pnpm-workspace.yaml`, so a normal `pnpm install --frozen-lockfile` is non-interactive.

Keep Railway API, Railway jobs, and Vercel connected to the GitHub `main` branch. Configure the GitHub `Production` environment with the six public variables listed in `.env.production.local.example`, plus a workspace-scoped `RAILWAY_API_TOKEN` and a dedicated `RAILWAY_SSH_PRIVATE_KEY` secret. Register the corresponding public SSH key in the Railway workspace. These credentials can access every project in that workspace, so use them only for this protected environment and rotate them independently from personal credentials.

## Release procedure

1. Finish the release PR: green GitHub CI, green Vercel preview, and no unresolved review comments.
2. Obtain authorization for this specific production release.
3. Merge the approved PR into `main`. This push is the production trigger: Railway deploys API and jobs, while Vercel deploys the Mini App.
4. The `Production verification` GitHub Actions workflow waits for green CI, Vercel, Railway API, and Railway jobs records for the exact merge SHA. A Railway `SKIPPED` record is accepted when that commit does not change the service's watch paths.
5. After every provider is ready, CI runs `pnpm release:verify-production`. This read-only verifier checks GitHub CI, Vercel status and URL, Railway services, API health, CORS, the migration ledger, and the exact production poll webhook URL. The Telegram token stays inside the API container and is never printed.

`pnpm release:verify-production` remains available for local read-only diagnosis. Automatic release CI never changes BotFather settings, registers or deletes a Telegram webhook, or sends Telegram messages.

If a merge or deployment step fails or behaves differently from this runbook, stop and report the problem to the owner before attempting a workaround.

## Compatibility requirement

Vercel and Railway deploy independently, so every release must tolerate a short mixed-version window. Add database structures before using them, keep old API fields while the new frontend rolls out, and ensure jobs support both schema versions. Remove or rename structures only in a later expand/contract release.

Native polls require one separately authorized Telegram operation after the API deployment. Run the bundled command inside the Railway API service with the exact production API URL and explicit confirmation flag:

```sh
node apps/api/dist/telegram/webhook-config-cli.js --url https://<production-api>/v1/telegram/webhook --confirm-telegram-webhook
```

Do not run this step without authorization for that production webhook change. The command registers only `poll` and `poll_answer` updates and never prints the bot token or derived secret.

## Normal releases after FBOT-20

The FBOT-20 legacy-card migration and cleanup were one-time work. Do not rerun legacy-card cleanup or restore the removed legacy callback webhook. The maintained webhook accepts native poll updates only.

If Railway CLI or its API is temporarily unavailable, do not substitute a global v4 CLI or an internal region ID. Retry after the service recovers, preserving the same checked-out commit and release order.

Do not create smoke-test matches in the real group. An extended create/edit/delete/weather test requires separate authorization and must use `Футбол тест`.
