# Football Bot Documentation

This index describes the maintained Telegram Mini App platform. The current implementation lives under `apps/api`, `apps/web`, `packages/domain`, `packages/db`, and `packages/api-client`.

## Documents

- [Application guide](application-guide.md) — complete product behavior, time modes, owner/member flows, first-time setup, local launch, ngrok launch, verification, jobs, and troubleshooting.
- [Bot and Mini App guide](bot-guide.md) — information cards, venue catalog, current weather, and owner flow.
- [Architecture](architecture.md) — runtime boundaries, authentication, REST contract, persistence, outbox, and jobs.
- [Development guide](development.md) — local PostgreSQL setup, environment variables, exact pnpm commands, quality gates, and acceptance checks.
- [Match card design QA](match-card-design-qa.md) — visual-fidelity review, spacing rules, and verification evidence for the owner match-list card.
- [Local PostgreSQL](local-postgres.md) — the local-only database lifecycle and separation rules.
- [Project structure](project-structure.md) — the maintained workspace tree and module responsibilities.
- [Vercel and Railway production runbook](railway.md) — deployment topology, test-group validation, clean database cutover, verification checklist, and authorization gates.
- [Linear workflow](linear.md) — the canonical tracker, team and project links, and status rules for contributors and coding agents.

Production deployment is not asserted by these documents. Production deployment, migration, disabling a legacy webhook, Mini App URL changes, and BotFather changes require explicit owner authorization.
