# Project Structure

```text
apps/
  api/       NestJS owner API, outbound Telegram delivery, jobs
  web/       Telegram Mini App
packages/
  api-client/ generated OpenAPI React Query client
  db/        Drizzle schema, migrations, repositories, outbox
  domain/    card and weather formatting
scripts/     local PostgreSQL, ngrok, contract, and release verification helpers
docs/        product and operational documentation
```

`apps/api/src/rest` contains the owner REST boundary. `apps/api/src/telegram` owns outbound Bot API effects and static card publication only. `apps/api/src/weather` fetches and sends current Minsk weather. `apps/api/src/jobs` drains the durable outbox.

There is intentionally no webhook, callback, player, vote, roster, notification, or forecast module in the maintained runtime.
