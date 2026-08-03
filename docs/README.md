# Football Bot Documentation

This index describes the maintained Telegram Mini App platform. The current implementation lives under `apps/api`, `apps/web`, `packages/domain`, `packages/db`, and `packages/api-client`.

## Documents

- [Application guide](application-guide.md) — complete product behavior, time modes, owner/member flows, first-time setup, local launch, ngrok launch, verification, jobs, and troubleshooting.
- [Bot and Mini App guide](bot-guide.md) — member voting, the owner-only Mini App flow, match lifecycle, cards, and notifications.
- [Architecture](architecture.md) — runtime boundaries, authentication, REST contract, webhook processing, persistence, outbox, and jobs.
- [Development guide](development.md) — local PostgreSQL setup, environment variables, exact pnpm commands, quality gates, and acceptance checks.
- [Local PostgreSQL](local-postgres.md) — the local-only database lifecycle and separation rules.
- [Project structure](project-structure.md) — the maintained workspace tree and module responsibilities.
- [Vercel and Railway production runbook](railway.md) — deployment topology, test-group validation, clean database cutover, verification checklist, and authorization gates.
- [Linear workflow](linear.md) — the canonical tracker, team and project links, and status rules for contributors and coding agents.

The [Mini App implementation plan](mini-app-implementation-plan.md) is the preserved migration plan and is not the operational runbook. The [migration work log](../work-log.md) records phase status and authorization state. The [orchestrator prompt](../prompt.md) contains implementation-agent instructions.

Production deployment is not asserted by these documents. Production deployment, Telegram webhook registration, Mini App URL changes, and BotFather changes require explicit owner authorization.
