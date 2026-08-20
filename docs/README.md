# Football Bot Documentation

This index describes the maintained Telegram Mini App platform. The current implementation lives under `apps/api`, `apps/web`, `packages/domain`, `packages/db`, and `packages/api-client`.

## Documents

- [Bot and Mini App guide](bot-guide.md) — information cards, native polls, venue catalog, weather, and owner flow.
- [Architecture](architecture.md) — runtime boundaries, authentication, REST contract, persistence, outbox, and jobs.
- [Development guide](development.md) — local PostgreSQL setup, environment variables, and development commands.
- [Testing guide](testing.md) — required automated checks and safe Chrome verification in the local Telegram Mini App.
- [Local PostgreSQL](local-postgres.md) — the local-only database lifecycle and separation rules.
- [Project structure](project-structure.md) — the maintained workspace tree and module responsibilities.
- [Vercel and Railway production runbook](railway.md) — automatic `main` deployments, post-deploy verification, compatibility, and authorization gates.
- [Linear workflow](linear.md) — the canonical tracker, team and project links, and status rules for contributors and coding agents.

Production deployment is not asserted by these documents. Production deployment, migration, Telegram webhook changes, Mini App URL changes, and BotFather changes require explicit owner authorization.
