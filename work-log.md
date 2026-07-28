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
| Overall state | Planning complete; Phase 0 decisions are recorded and implementation has not started. |
| Active phase | Phase 1 — workspace and quality gates, pending orchestrator start. |
| Next action | Assign the Phase 1 workspace-scaffolding subagents. |
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
- The visual direction in the implementation plan is approved.
- There are only local and production environments. Local uses the test Telegram group and local services; production uses Railway and the original group. No Railway staging/test environment will be created.

## Phase board

| Phase | Status | Required outcome | Verification / exit criterion | Owner action needed |
| --- | --- | --- | --- | --- |
| 0. Scope and preparation | Complete | Confirm target scope, approved visual direction, local/production model, and migration boundary. | Decisions are recorded; no legacy data export is needed. | None. |
| 1. Workspace and quality gates | Pending | pnpm monorepo, strict TypeScript, local PostgreSQL test path, root scripts. | Install, lint, typecheck, and builds succeed. | None unless a dependency choice needs approval. |
| 2. Domain and PostgreSQL | Pending | Async PostgreSQL persistence, baseline migration, outbox, idempotency, late-bound player aliases. | Fresh DB migration and concurrency tests pass. | None. |
| 3. API, webhook, and jobs | Pending | Nest API, Mini App guard, Telegram webhook, Cron jobs, Swagger. | Webhook/security/idempotency tests pass. | A non-production bot/token and temporary HTTPS tunnel only if manual local webhook testing is required. |
| 4. Contracts and Mini App | Pending | Orval client and owner-facing React/Vite app. | Generated-contract check and frontend tests/build pass. | None. |
| 5. Local acceptance and cutover | Pending | Local acceptance, then production Railway deployment. | Full local test matrix and production acceptance recorded. | Explicit authorization for production deployment, webhook, and Mini App URL changes. |

## History

| Date | Phase | Event | Evidence / result | Next action |
| --- | --- | --- | --- | --- |
| 2026-07-29 | Planning | Created the migration handoff plan and orchestration package. | `97fdf36` documents the Mini App plan; this documentation commit adds `prompt.md` and the work log. | Confirm Phase 0 scope and start delegated Phase 1 work. |
| 2026-07-29 | Legacy baseline | Preserved the existing vote-removal feature before the migration. | `b23ccbc`; `pnpm test` passed 137 tests and `pnpm lint` passed. | Keep this commit as the pre-migration baseline. |
| 2026-07-29 | Phase 0 | Owner approved the visual direction and selected local plus production only. | Local uses the test group; production uses the original group and Railway. No Railway staging environment. | Begin delegated Phase 1 work. |

## Open decisions and blockers

- If a manual local Telegram webhook check is required, identify a non-production bot configuration and temporary HTTPS tunnel. Otherwise use mocks locally. Never record its secrets in this file or point the production bot at a local tunnel.
