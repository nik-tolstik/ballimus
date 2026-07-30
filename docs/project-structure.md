# Project Structure

```text
football-bot/
├── apps/
│   ├── api/
│   │   ├── src/
│   │   │   ├── auth/       Mini App init-data guard and owner identity
│   │   │   ├── config/     validated API environment
│   │   │   ├── database/   Nest database wiring
│   │   │   ├── health/     unauthenticated process health endpoint
│   │   │   ├── jobs/       one-shot outbox and weather runner
│   │   │   ├── rest/       owner REST controllers, DTOs, and service
│   │   │   ├── telegram/   webhook, callback validation, cards, and effects
│   │   │   ├── bootstrap.ts Nest application composition
│   │   │   ├── main.ts     HTTP process entry point
│   │   │   └── openapi.ts  Swagger/OpenAPI document generation
│   │   └── openapi.json    generated API contract source for Orval
│   └── web/
│       ├── src/
│       │   ├── App.tsx     owner dashboard and match workflows
│       │   ├── main.tsx    React/TanStack Query entry point
│       │   ├── normalize.ts API response normalization for the UI
│       │   ├── telegram.ts Telegram Web App session, theme, and safe area
│       │   └── styles.css  Mini App presentation
│       └── index.html
├── packages/
│   ├── api-client/
│   │   ├── src/mutator.ts  API base URL, init data, idempotency, errors
│   │   ├── src/generated/  Orval models and TanStack Query hooks
│   │   └── orval.config.ts generated-client configuration
│   ├── db/
│   │   ├── src/schema.ts   PostgreSQL Drizzle schema
│   │   ├── src/migrate.ts  explicit migration entry point
│   │   ├── src/repositories/ matches, players, votes, outbox, and claims
│   │   ├── src/transactions.ts atomic domain transactions
│   │   └── migrations/     versioned PostgreSQL baseline and future migrations
│   └── domain/
│       └── src/            pure lifecycle, roster, card, notification, and weather rules
├── docs/                   maintained documentation and preserved migration plan
├── scripts/
│   ├── generate-init-data.mjs signed local Mini App authentication fixture
│   └── postgres-local.mjs     safe local PostgreSQL lifecycle helper
├── docker-compose.yml      loopback-only local PostgreSQL service
├── package.json            root quality gates and generation commands
└── pnpm-workspace.yaml     apps/* and packages/* workspace definition
```

## Dependency direction

`apps/web` depends on the generated `@football/api-client`. `apps/api` depends on `@football/domain` and `@football/db`. The API client is generated from the API's Swagger document; it is not a second hand-maintained contract. The domain package stays independent of Telegram, Nest, PostgreSQL, and browser APIs.

The API composition root creates the Nest modules for configuration, authentication, health, REST, Telegram effects, database access, and jobs. API startup opens PostgreSQL but deliberately does not apply migrations. The jobs entry point creates the same module graph as a short-lived application context and exits after one run.

## Important boundaries

- `apps/api/src/auth` is the only place that validates Telegram Mini App identity and owner access.
- `apps/api/src/rest` exposes owner operations under `/v1`; controllers translate HTTP inputs, while `OwnerRestService` coordinates repositories and domain rules.
- `apps/api/src/telegram` owns the webhook envelope, callback source validation, Telegram API effects, public-card publication, and card refresh.
- `apps/api/src/jobs` owns bounded outbox delivery, retry classification, weather work, and the PostgreSQL job lease.
- `packages/db/src/repositories` owns persistence operations; API and domain code do not open SQLite or issue ad hoc SQL.
- `packages/api-client/src/generated` is generated output. Change API decorators/schema first, then regenerate with `pnpm api:contracts:check`.

## Preserved migration artifacts

The ignored local `data/database.db`, if present on a developer machine, is not part of the maintained runtime and is never read by the workspace applications. The migration plan, orchestration prompt, and work log remain as historical and operational handoff documents.
