# Project Structure

    football-bot/
    ├── src/
    │   ├── main.ts
    │   ├── config.ts
    │   ├── application/
    │   │   ├── match-creation.ts
    │   │   ├── match-card.ts
    │   │   ├── match-card-updater.ts
    │   │   ├── match-actions.ts
    │   │   ├── external-participants.ts
    │   │   ├── match-info.ts
    │   │   └── weather-forecast.ts
    │   ├── bot/
    │   │   └── create-bot.ts
    │   ├── domain/
    │   │   ├── match-card.ts
    │   │   ├── matches.ts
    │   │   ├── notifications.ts
    │   │   └── votes.ts
    │   ├── parser/
    │   ├── db/
    │   │   ├── client.ts
    │   │   ├── migrate.ts
    │   │   ├── schema.ts
    │   │   └── repositories/
    │   └── scheduler/
    │       ├── weather-forecast-scheduler.ts
    │       └── worker.ts
    ├── tests/
    │   ├── unit/
    │   └── integration/
    ├── drizzle/
    └── docs/

## Source modules

### `src/main.ts`

Composition root. Loads configuration, initializes SQLite and repositories, wires Telegram API calls, constructs application services, and starts long polling.

### `src/bot/create-bot.ts`

Creates the grammY bot, enforces private command authorization, routes commands, and forwards `callback_query:data` updates. It does not contain match business rules.

### `src/application/`

- `match-creation.ts` creates private match drafts, publishes approved drafts, and creates the public card and creator panel;
- `match-card.ts` defines voting, lifecycle, draft-review, cancellation-reason callback actions, and inline keyboards;
- `match-card-updater.ts` re-renders public and admin messages;
- `match-actions.ts` processes votes, creator status actions, and reasoned cancellations;
- `external-participants.ts` processes legacy `@bot +/-N для #v<ID>` commands and attributed commands such as `@bot от Никиты +3 игрока для #v<ID>`;
- `match-info.ts` formats private match details;
- `weather-forecast.ts` retrieves the Minsk forecast and formats the notification.

### `src/domain/`

Contains pure rules and formatting for cards, vote transitions, mentions, and notifications.

### `src/db/`

Owns the SQLite client, baseline migration, Drizzle schema, and repositories. The persistence layer contains match drafts and publication references, venue and cancellation metadata, votes, attributed external participants, notifications, and processed callback updates.

### `src/scheduler/`

`weather-forecast-scheduler.ts` runs the in-process check that sends one Minsk weather forecast around 16 hours before the first eligible outdoor exact-time active or confirmed match each day; `worker.ts` re-exports the scheduler boundary.

## Tests

- unit tests cover configuration, parser behavior, draft and lifecycle transitions, notifications, weather formatting, and card rendering;
- integration tests cover draft publication, callback actions, repositories, external participants, scheduled forecasts, and routing;
- the smoke test verifies that the application entry point exists.
