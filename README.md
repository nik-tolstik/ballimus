# Football Bot

Football Bot coordinates football matches through a Telegram public match card and an owner-only Telegram Mini App. The maintained application is a pnpm workspace with a NestJS API, a React/Vite frontend, PostgreSQL persistence, generated OpenAPI client code, and short-lived background jobs.

Production is not claimed to be deployed. Railway topology and the production handoff are documented in [the Railway runbook](docs/railway.md). Deployment, Telegram webhook registration, Mini App URL changes, and BotFather changes require explicit owner authorization.

## Current architecture

- `apps/api` — NestJS HTTP API, Telegram webhook, Mini App authentication, REST operations, Telegram card effects, and job composition.
- `apps/web` — React/Vite Telegram Mini App for the configured owner.
- `packages/domain` — pure match, roster, lifecycle, notification, weather, and Telegram-card rules.
- `packages/db` — PostgreSQL Drizzle schema, migrations, repositories, transactions, idempotency, outbox, and job leases.
- `packages/api-client` — generated OpenAPI models and TanStack Query hooks plus the transport mutator.

Telegram members vote on buttons in the public card in the configured `General` topic. The owner opens the Mini App from Telegram to create and edit structured drafts, preview and publish cards, manage lifecycle and roster data, maintain player aliases, and inspect history. The owner flow does not depend on private bot commands or private participant-management menus.

## Start here

- [Documentation index](docs/README.md)
- [Architecture](docs/architecture.md)
- [Bot and Mini App guide](docs/bot-guide.md)
- [Development guide](docs/development.md)
- [Project structure](docs/project-structure.md)
- [Local PostgreSQL](docs/local-postgres.md)
- [Railway topology and runbook](docs/railway.md)

## Quality gates

Use Node.js `>=22.18.0` and pnpm `11.10.0` or a compatible pnpm version. From the repository root:

```bash
pnpm install --frozen-lockfile
pnpm lint
pnpm test
pnpm typecheck
pnpm build
pnpm api:contracts:check
```

Use the API, web, PostgreSQL, authentication-fixture, and jobs commands in the [development guide](docs/development.md) for the maintained platform.
