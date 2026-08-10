# Production Release Runbook

Production changes require separate, explicit owner authorization. This document describes the release procedure; it never authorizes a deployment, migration, Telegram change, or outgoing message by itself.

This personal project deliberately has no database-backup step. A release can therefore be destructive when its approved migration requires it.

## One-time setup

Copy `.env.production.local.example` to the ignored `.env.production.local` and populate its public values. Do not add Telegram or PostgreSQL secrets.

`RAILWAY_PRODUCTION_REGION_ALIAS` must be one of Railway CLI's scale aliases: `us-west`, `us-east`, `eu-west`, or `southeast-asia`. Use `eu-west` for the current production deployment. Do not pass Railway's internal region ID to `railway service scale`: Railway CLI can silently create an unwanted fallback deployment in another region.

The repository pins Railway CLI v5. Its required postinstall binary is explicitly allowed in `pnpm-workspace.yaml`, so a normal `pnpm install --frozen-lockfile` is non-interactive.

## Release procedure

1. Finish the release PR: green GitHub CI, green Vercel preview, and no unresolved review comments.
2. Obtain authorization for this specific production release.
3. Pause automatic production deployments in Railway and Vercel. Keep the Vercel production deployment held while the API migration is applied; the new Mini App must not reach an older API.
4. Merge the approved PR, check out a clean and current local `main`, then run:

   ```sh
   pnpm release:preflight
   pnpm release:cutover -- --confirm-production-cutover
   ```

   Preflight fails before production is changed unless the checkout exactly matches `origin/main`, the worktree is clean, Railway CLI is v5, and the configured scale region is a supported alias. Cutover stops API and jobs using that alias, deploys API (including its pre-deploy migration), deploys jobs, then verifies Railway service status, API health, and the migration ledger.
5. Promote the held Vercel production deployment only after cutover passes.
6. Run:

   ```sh
   pnpm release:verify-production
   ```

   This read-only verifier checks GitHub CI, Vercel status and URL, Railway services, API health, CORS, the migration ledger, and that no Telegram webhook URL is configured. It reads only public settings from `.env.production.local`; the Telegram token stays inside the API container and is never printed.

The Railway cutover command never deploys Vercel, changes BotFather settings, registers or deletes a Telegram webhook, or sends Telegram messages. The Vercel promotion remains a deliberate provider action because it controls the public Mini App entry point.

## Normal releases after FBOT-20

The FBOT-20 legacy-card migration, cleanup, and webhook removal were one-time work. Do not rerun legacy-card cleanup or webhook removal as part of a normal release. The current application has no webhook endpoint and no incoming Telegram update handling.

If Railway CLI or its API is temporarily unavailable, do not substitute a global v4 CLI or an internal region ID. Retry after the service recovers, preserving the same checked-out commit and release order.

Do not create smoke-test matches in the real group. An extended create/edit/delete/weather test requires separate authorization and must use `Футбол тест`.
