# Telegram Mini App Migration Work Log

This file is the durable execution record for the migration. The orchestrator updates it at every handoff and phase gate. Keep entries factual, dated, and concise; do not store secrets, tokens, personally identifiable Telegram data, or raw Mini App `initData`.

## Operating rules

- Read this log before assigning a subagent or resuming a phase.
- Add an entry after each material decision, completed subagent task, verification result, commit, deployment action, or blocker.
- Include evidence such as a commit hash, command result, PR/branch reference, or test-environment result.
- Only the orchestrator edits this file directly. Implementation changes belong to subagents.

## Current status

| Field | Value |
| --- | --- |
| Overall state | Planning complete; implementation has not started. |
| Active phase | Phase 0 — scope confirmation and branch preparation. |
| Next action | Confirm Phase 0 decisions, then assign the Phase 1 workspace-scaffolding subagents. |
| Production changes | None authorized. |
| Worktree baseline | Clean after the commits listed below. |

## Established decisions

- One Telegram owner and one configured group per environment.
- NestJS backend on Railway with PostgreSQL, Telegram webhook, and separate Cron service.
- React + Vite Mini App with TanStack Query, shadcn/ui, and Framer Motion.
- pnpm workspaces: `apps/api`, `apps/web`, `packages/domain`, `packages/db`, and `packages/api-client`.
- Nest Swagger/OpenAPI plus Orval is the only REST-contract pipeline.
- No SQLite data migration; create a clean PostgreSQL baseline migration.
- No OpenRouter or natural-language match parser.
- An owner can create `@username -> readable name` before the player votes; Telegram ID is bound later on the first update.
- Private command/admin-panel and private external-player flows are removed in the target architecture. The owner manages external participants in the Mini App.

## Phase board

| Phase | Status | Required outcome | Verification / exit criterion | Owner action needed |
| --- | --- | --- | --- | --- |
| 0. Scope and preparation | In progress | Confirm target scope, visual direction, test resources, and migration boundary. | Decisions in the plan are accepted; no legacy data export is needed. | Confirm visual direction and provision/identify test resources. |
| 1. Workspace and quality gates | Pending | pnpm monorepo, strict TypeScript, local PostgreSQL test path, root scripts. | Install, lint, typecheck, and builds succeed. | None unless a dependency choice needs approval. |
| 2. Domain and PostgreSQL | Pending | Async PostgreSQL persistence, baseline migration, outbox, idempotency, late-bound player aliases. | Fresh DB migration and concurrency tests pass. | None. |
| 3. API, webhook, and jobs | Pending | Nest API, Mini App guard, Telegram webhook, Cron jobs, Swagger. | Webhook/security/idempotency tests pass. | Test bot and Railway test credentials when deployment starts. |
| 4. Contracts and Mini App | Pending | Orval client and owner-facing React/Vite app. | Generated-contract check and frontend tests/build pass. | Visual approval before detailed styling. |
| 5. Test deployment and cutover | Pending | Railway test acceptance, then production deployment. | Full Telegram test matrix and production acceptance recorded. | Explicit authorization for every external deployment/webhook change. |

## History

| Date | Phase | Event | Evidence / result | Next action |
| --- | --- | --- | --- | --- |
| 2026-07-29 | Planning | Created the migration handoff plan and orchestration package. | `97fdf36` documents the Mini App plan; this documentation commit adds `prompt.md` and the work log. | Confirm Phase 0 scope and start delegated Phase 1 work. |
| 2026-07-29 | Legacy baseline | Preserved the existing vote-removal feature before the migration. | `b23ccbc`; `pnpm test` passed 137 tests and `pnpm lint` passed. | Keep this commit as the pre-migration baseline. |

## Open decisions and blockers

- Confirm the visual direction before pixel-level frontend implementation. This does not block backend, database, API, or contract work.
- Supply or identify test-only Telegram/Railway resources before Phase 5. Never record their secrets in this file.
