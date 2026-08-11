# Project Structure

```text
apps/
  api/       NestJS owner API, outbound Telegram delivery, jobs
  web/       Telegram Mini App
packages/
  api-client/ generated OpenAPI React Query client
  db/        Drizzle schema, migrations, repositories, outbox
  domain/    card, poll-notification, and weather formatting
scripts/     local PostgreSQL, Cloudflare Tunnel, contract, and release verification helpers
docs/        product and operational documentation
```

`apps/api/src/rest` contains the owner REST boundary. `apps/api/src/telegram` owns outbound Bot API effects, card and poll publication, and the authenticated poll-update webhook. `apps/api/src/weather` fetches and sends current Minsk weather. `apps/api/src/jobs` drains the durable outbox.

Native polls are isolated in `telegram_polls`; there is intentionally no callback, player, roster, match-vote, or forecast module in the maintained runtime.
