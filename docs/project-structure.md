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
    │   │   └── match-info.ts
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

- `match-creation.ts` creates the match, public card, and creator panel;
- `match-card.ts` defines callback actions and inline keyboards;
- `match-card-updater.ts` re-renders public and admin messages;
- `match-actions.ts` processes votes and creator status actions;
- `external-participants.ts` processes `@bot +/-N для #v<ID>`;
- `match-info.ts` formats private match details.

### `src/domain/`

Contains pure rules and formatting for cards, vote transitions, mentions, and notifications.

### `src/db/`

Owns the SQLite client, baseline migration, Drizzle schema, and repositories. The persistence layer contains match messages, votes, external participants, notifications, and processed callback updates.

### `src/scheduler/`

Reserved for future reminders.

## Tests

- unit tests cover configuration, parser behavior, domain transitions, notifications, and card rendering;
- integration tests cover card creation, callback actions, repositories, external participants, and routing;
- the smoke test verifies that the application entry point exists.
