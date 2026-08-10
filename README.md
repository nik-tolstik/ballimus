# Football Bot

Football Bot coordinates football matches through a Telegram public match card and an owner-only Telegram Mini App. The maintained application is a pnpm workspace with a NestJS API, a React/Vite frontend, PostgreSQL persistence, generated OpenAPI client code, and short-lived background jobs.

Production is not claimed to be deployed. The Vercel/Railway topology, test-group validation, and clean production cutover are documented in [the production runbook](docs/railway.md). Deployment, migration, legacy webhook removal, Mini App URL changes, and BotFather changes require explicit owner authorization.

## Current architecture

- `apps/api` — NestJS HTTP API, Mini App authentication, REST operations, Telegram card effects, current-weather delivery, and job composition.
- `apps/web` — React/Vite Telegram Mini App for the configured owner.
- `packages/domain` — pure information-card, venue, weather, and Telegram-card rules.
- `packages/db` — PostgreSQL Drizzle schema, migrations, repositories, transactions, idempotency, outbox, and job leases.
- `packages/api-client` — generated OpenAPI models and TanStack Query hooks plus the transport mutator.

The owner uses the Mini App to create, edit, and delete information cards. Each Telegram card has an exact date and time, a catalog venue with a map link and type, and an optional price. It has no inline keyboard, votes, players, roster, lifecycle, or history. The owner can also send the current Minsk weather to the configured chat topic.

## Start here

- [How the application works and how to run it](docs/application-guide.md)
- [Documentation index](docs/README.md)
- [Architecture](docs/architecture.md)
- [Bot and Mini App guide](docs/bot-guide.md)
- [Development guide](docs/development.md)
- [Project structure](docs/project-structure.md)
- [Local PostgreSQL](docs/local-postgres.md)
- [Vercel and Railway production runbook](docs/railway.md)

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

## Quick local Telegram launch

For the first setup, create a test-only `.env.local`, fill in the Telegram values described in the [application guide](docs/application-guide.md), and authenticate ngrok:

```bash
pnpm install --frozen-lockfile
cp .env.local.example .env.local
ngrok config add-authtoken <ngrok-authtoken>
```

Then start each development session with:

```bash
pnpm dev
```

Before the first launch, start the local PostgreSQL container in Docker Desktop and apply migrations separately:

```bash
set -a
source .env.local
set +a
pnpm db:migrate
```

Run the migration again whenever the schema changes. `pnpm dev` opens the API and Web tunnels and starts NestJS and Vite. It prints the Mini App URL to open from the configured test bot. Background work is intentionally one-shot and can be run from another terminal:

```bash
set -a
source .env.local
set +a
pnpm --filter @football/api jobs:run
```
