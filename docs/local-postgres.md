# Local PostgreSQL

PostgreSQL is the only database path for the maintained API and packages. Local development uses Docker Compose; production uses an independently provisioned Railway PostgreSQL service. The API never applies migrations during startup.

## Local-only boundary

The Compose service:

- uses `postgres:18.4-alpine`;
- binds only to `127.0.0.1:54329`;
- uses the local database and role `football_local`;
- stores data in the named volume `football-bot-local-postgres`;
- has no connection to Railway or any production resource.

Use `.env.local` for these settings. Keep production URLs, passwords, bot tokens, IDs, and webhook values out of the file:

```text
POSTGRES_DB=football_local
POSTGRES_USER=football_local
POSTGRES_PASSWORD=football_local_dev_password
POSTGRES_HOST_PORT=54329
DATABASE_URL=postgresql://football_local:football_local_dev_password@127.0.0.1:54329/football_local
```

## Lifecycle

From the repository root:

```bash
cp .env.local.example .env.local
node scripts/postgres-local.mjs
node scripts/postgres-local.mjs status
node scripts/postgres-local.mjs logs
node scripts/postgres-local.mjs stop
node scripts/postgres-local.mjs down
```

`stop` and `down` preserve the named volume. The helper's reset operation is destructive and requires an explicit flag:

```bash
node scripts/postgres-local.mjs reset --confirm-reset
```

Use reset only when local data can be recreated or a clean migration test is required.

For an interactive SQL session with the default local settings:

```bash
docker compose --project-name football-bot-local --file docker-compose.yml --env-file .env.local exec postgres psql --username=football_local --dbname=football_local
```

## Apply and check migrations

Starting Compose does not migrate the schema. Export the local environment and run the package migration explicitly:

```bash
set -a
source .env.local
set +a
pnpm --filter @football/db db:check
pnpm --filter @football/db db:migrate
```

The same `DATABASE_URL` must be available when starting the API or running the PostgreSQL integration tests. The maintained repository has no SQLite migration command.

## Separation rules

- local API and jobs use `.env.local`, the loopback database, the local/test Telegram bot, and the test group;
- production uses Railway services and separately managed variables;
- there is no local-to-production database promotion or SQLite data migration;
- a local tunnel, if used for a manual test, must terminate at the local API and local Telegram webhook only;
- local commands must never register or replace the production webhook.

Production database migrations are release operations and require explicit owner authorization. See [the Railway runbook](railway.md).
