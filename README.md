# Football Bot

See the [project documentation](docs/README.md) for the architecture, source structure, bot behavior, and development guide.

Football Bot organizes matches inside a Telegram forum group with two topics:

- `general` — the live match card and inline voting buttons;
- `chat` — important status notifications.

Administrators create matches from a private conversation with the bot. The bot publishes one editable match card in `general`; users vote with inline buttons and the card is refreshed after every change.

## Product behavior

### `/match`

The bot accepts Russian-language commands in a private conversation with a group administrator:

```text
/match 27 июля 20:00 СОК Олимпийский. 10 человек
```

The parser extracts the date, optional local time, optional location, optional total field price, and required player count. The default player count is `10`.

The parser uses `openai/gpt-4.1-mini` through OpenRouter and returns strict structured JSON. The application validates the result before creating Telegram messages. The model never calls Telegram APIs directly.

After successful creation, the bot confirms the match and sends the creator a private admin panel:

```text
✅ Матч создан: #v32.
Карточка опубликована в General.
```

The public card contains the match reference, schedule, location, field price, current status, participant names, and three inline buttons:

- `✅ Участвую`;
- `❓ Под вопросом`;
- `❌ Не смогу`.

The creator's private panel initially contains `✅ Матч будет` and `🚫 Отменить`. After confirmation it changes to `🏁 Завершить` and `🚫 Отменить`. The creator must still be a group administrator to use them.

### Match card

The card is a regular Telegram message, not a native poll. It is edited in place after every vote or external-player change. Participants are grouped by their current choice. Telegram usernames are displayed when available; otherwise the name is rendered as a clickable Telegram mention.

The card shows external participants as a quantity. The total confirmed count is `Участвую` votes plus external participants.

Once a match is completed or cancelled, the card remains available as history and all buttons are removed.

### Match lifecycle

- `active` — users may vote and administrators may update external players;
- `confirmed` — the match is confirmed, but the roster may still change;
- `completed` — the match is frozen and kept for history;
- `cancelled` — the match is frozen, marked as cancelled, and the group is notified.

The creator can restore the private admin panel by sending `/matchinfo #v32` in the private chat.

### `/matchinfo`

Send `/matchinfo` in a private conversation to see the only active match. Use `/matchinfo #v32` to inspect a specific match. The response includes the status, schedule, current participants grouped by choice, external players, and the creator's admin panel when applicable.

### External participants

Additional participants can be managed from the private conversation:

```text
@ballimus_bot +2 для #v32
@ballimus_bot -1 для #v32
```

A plus sign adds participants and a minus sign removes previously added participants. The count cannot become negative, and the same Telegram update is processed only once. Successful changes refresh the public card.

## Notifications

When confirmed participants cross the configured threshold, the bot sends an idempotent notification in `chat`:

```text
⚽ #v32 «27.07.2026 20:00 — Ракета» — Набралось 10 игроков — можно играть!
```

The creator can explicitly confirm that the match will happen. After the threshold has been reached, a participant moving from `Участвую` to another option triggers a withdrawal warning. Confirmation and cancellation send status notifications. Card edits remain the source of truth; notifications are reserved for important events.

### Bot lifecycle

The bot sends `🤖 Бот запущен и готов к работе.` and `🤖 Бот остановлен.` to the configured administrator's private dialog. Set `TELEGRAM_STATUS_USER_ID` to that Telegram user ID; the user must have opened the bot's private chat first. Long polling starts with pending Telegram updates discarded, so messages and button presses received while the bot was offline are not processed after restart.

## Technical decisions

| Area | Choice |
| --- | --- |
| Runtime | Node.js current LTS |
| Language | TypeScript with strict checks |
| Package manager | pnpm |
| Telegram framework | grammY |
| AI gateway | OpenRouter |
| AI model | `openai/gpt-4.1-mini` |
| Date/time | Luxon with a configurable group timezone |
| Database | SQLite through Drizzle ORM |
| Tests | Vitest |
| Telegram transport | Long polling |

## Architecture

```text
Telegram update
      |
      v
grammY handlers, authorization, and topic routing
      |
      +--> /match parser --> OpenRouter --> JSON Schema --> Zod
      |                         |
      |                         v
      |                  match card publisher
      |                         |
      |                         +--> public card in General
      |                         +--> private creator panel
      |
      +--> callback_query --> atomic match action
                                  |
                                  +--> vote/status persistence
                                  +--> card refresh
                                  +--> threshold/withdrawal/cancellation notification
      |
      +--> external-player command --> persistence --> card refresh
```

Business rules live in application and domain modules, not inside Telegram handlers. Callback actions are durably deduplicated by Telegram `update_id` and vote/status changes are persisted atomically.

## Data model

- `chat_settings`: Telegram chat and topic settings, timezone, and default threshold;
- `matches`: schedule, location, field price, threshold, lifecycle status, and creator;
- `match_messages`: public card and private admin-panel message references;
- `processed_updates`: durable callback-action idempotency records;
- `votes`: one current choice per Telegram user and match;
- `external_participants`: signed external-player changes;
- `notifications`: idempotency claims for important status notifications.

The MVP uses a clean database baseline for the inline-card model. Native poll data is not migrated.

## Configuration

```text
TELEGRAM_BOT_TOKEN=
TELEGRAM_CHAT_ID=
TELEGRAM_CHAT_TOPIC_ID=
TELEGRAM_GENERAL_TOPIC_ID=
TELEGRAM_STATUS_USER_ID=
OPENROUTER_API_KEY=
OPENROUTER_MODEL=openai/gpt-4.1-mini
DATABASE_URL=file:./data/football-bot.db
GROUP_TIMEZONE=Europe/Minsk
DEFAULT_PLAYERS_NEEDED=10
CONFIRM_MATCH_CREATION=false
LOG_LEVEL=info
```

Keep secrets in `.env`, excluded from Git.

## Development commands

```bash
pnpm install
pnpm dev
pnpm test
pnpm lint
pnpm typecheck
pnpm db:generate
pnpm db:migrate
```

Use a separate bot token, private test supergroup, and SQLite database for manual Telegram testing.

## MVP scope

Included:

- natural-language `/match` parsing;
- editable inline match cards;
- three response buttons with revoting;
- creator-only completion and cancellation controls;
- durable callback idempotency;
- threshold, withdrawal, and cancellation notifications;
- external-player additions and removals;
- match information and topic routing.

Not included yet:

- waitlists;
- payments;
- reminders;
- recurring matches;
- statistics;
- web dashboards;
- multiple independent groups.
