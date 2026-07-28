# Football Bot

See the [project documentation](docs/README.md) for the architecture, source structure, bot behavior, and development guide.

Football Bot organizes matches inside a Telegram forum group with two topics:

- `general` — the live match card and inline voting buttons;
- `chat` — important status notifications.

Administrators create matches from a private conversation with the bot. By default, the bot first shows a private draft for review; after publication, it maintains one editable match card in `general` while the match is active or confirmed. Users vote with inline buttons and the card is refreshed after every change.

## Product behavior

### `/match`

An administrator sends `/match` in a private conversation with the bot. For predictable parsing, use this canonical multiline format:

```text
/match
Дата: 03.08.2026
Время: 20:00
Место: Ракета
Формат: на улице
Нужно игроков: 10
Цена поля: 100 рублей
```

`Формат` must be either `на улице` or `в здании`. The `Цена поля` line is optional. The 16-hour weather forecast is sent only for outdoor matches with an exact 24-hour `HH:MM` start time, for example `20:00`. The bot also accepts natural Russian descriptions as a fallback, but the labelled form is the recommended organizer workflow.

The parser extracts the date, exact local time when supplied, location, venue type, optional total field price, and required player count. The default player count is `10`. The labelled form is parsed deterministically; for a natural-language fallback, the bot uses `openai/gpt-4.1-mini` through OpenRouter and validates its strict structured JSON before creating Telegram messages. The model never calls Telegram APIs directly.

With `CONFIRM_MATCH_CREATION=true` (the default), successful parsing creates a private draft. The creator reviews the parsed details and chooses `Опубликовать`, `Исправить`, or `Отменить`. No card is sent to `General` until `Опубликовать` is chosen. Setting the flag to `false` skips the review and publishes immediately.

After publication, the bot turns that private preview into the creator's admin panel:

```text
Матч создан: #v32.
Карточка опубликована в General.
```

The public card contains the match reference, schedule, location, venue type, field price, current status, participant names, and inline buttons:

- `Участвую`;
- `Под вопросом`;
- `Не смогу`;
- `Доп. игроки`.

The creator's private panel contains `Редактировать`, `Матч будет`, and `Отменить`. After confirmation it contains `Редактировать`, `Завершить`, and `Отменить`. The creator must still be a group administrator to use them.

### `/editmatch`

For an `active` or `confirmed` match, the creator can press `Редактировать` in the private panel. The bot sends a copyable full-replacement template, for example:

```text
/editmatch #v32
Дата: 03.08.2026
Время: 20:00
Место: Ракета
Формат: на улице
Нужно игроков: 10
Цена поля: 100 рублей
```

The creator edits the fields and sends the complete form back to the bot privately. It is parsed using the same labelled format as `/match` and updates the existing match and its public card: the `#v` ID, votes, external participants, and current lifecycle status are retained. The optional `Цена поля` line may be omitted to clear the field price. Only the match creator, while still a group administrator, can edit a match; completed and cancelled matches cannot be edited.

### `/remove_vote`

The match creator can remove a player's current vote from a private administrator chat while the match is `active` or `confirmed`:

```text
/remove_vote #v32 @username
/remove_vote #v32 123456789
```

Use the Telegram ID when the player has no username or when a username matches more than one stored vote. Removing a vote completely withdraws the player's response, refreshes the public card and administrator panel, and can send the normal threshold-lost notification when a `Участвую` vote was removed. Completed and cancelled matches cannot be changed.

### Match card

The card is a regular Telegram message, not a native poll. It is edited in place after every vote or external-player change. Participants are grouped by their current choice. Telegram usernames are displayed when available; otherwise the name is rendered as a clickable Telegram mention.

When the external-player total is greater than zero, the card shows that quantity and each user's contribution, such as `От Вани: 2`. Historical source labels, such as `от Никиты`, remain visible. The total confirmed count is `Участвую` votes plus external participants.

The required-player value is a threshold, not a capacity. The card shows an informational target range ending two players above that minimum, but there is no roster lock or waitlist: an eleventh player can vote for a 10-player match, and participants can continue changing their votes while the match is `active` or `confirmed`.

When the creator completes or cancels a match, its public card is deleted from `General`. This is an explicit lifecycle action, not an automatic time-based cleanup. The match record, votes, external participants, and cancellation reason remain available as history through `/matchinfo #v32`.

### Match lifecycle

- `draft` — a private, unpublished review state;
- `active` — users may vote and manage their own additional-player contribution;
- `confirmed` — the match is confirmed, but the roster may still change;
- `completed` — the match is frozen, its public card is removed, and its record is kept for history;
- `cancelled` — the match is frozen, its public card is removed, the cancellation reason is retained, and the group is notified.

The creator can restore the private admin panel by sending `/matchinfo #v32` in the private chat.

### `/matchinfo`

Send `/matchinfo` in a private conversation to see the only active match. Use `/matchinfo #v32` to inspect a specific match, including a completed or cancelled match whose public card was removed. The response includes the status, schedule, current participants grouped by choice, external players, and the creator's admin panel when applicable.

### `/rename_user`

An authorized administrator can assign a readable name to a Telegram username from the private conversation:

```text
/rename_user @chocolate Ваня Петров
```

The alias is stored in SQLite, applied to new votes, and propagated to existing vote lists and match history. The username remains visible next to the alias when available.

### External participants

The public match card has a `Доп. игроки` button. Pressing it sends a private menu with `➕ Добавить игрока` and `➖ Убрать игрока`. Each press changes the current user's contribution by exactly one player; a user can remove only players previously added by that user. The bot requires the user to open its private chat first.

The card and `/matchinfo` show the total and the current contribution of each user, for example `От Вани: 2`. New button entries keep a display-name snapshot, including a name configured with `/rename_user`. Historical entries without a snapshot fall back to their Telegram ID, and historical source labels remain unchanged. The same Telegram update is processed only once, and successful changes refresh the public card.

## Notifications

Every time confirmed participants cross the configured threshold upward, the bot sends an idempotent notification in `chat`:

```text
#v32 «27.07.2026 20:00 — Ракета» — Набралось 10/10 игроков — можно играть!
```

If the count then falls below the threshold, the bot sends a neutral warning. A later upward crossing sends a new availability notification. The creator can explicitly confirm that the match will happen. Cancellation requires the creator to choose `Недостаточно игроков` or `Плохая погода`; the reason is retained in match history and included in the cancellation notification.

For the first eligible outdoor `active` or `confirmed` match on each Minsk calendar day, the in-process scheduler sends one Minsk weather forecast to `Chat` about 16 hours before kick-off. Indoor matches do not trigger it, and additional outdoor matches on the same day do not duplicate it. Card edits remain the source of truth; notifications are reserved for important events.

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
      +--> /editmatch --> shared parser --> same-match update --> card refresh
      |
      +--> /rename_user --> user alias and vote snapshot update --> card refresh
      |
      +--> callback_query --> atomic match action
                                  |
                                  +--> vote/status persistence
                                  +--> card refresh
                                  +--> threshold reached/lost/cancellation notification
      |
      +--> external-player callbacks --> private menu --> persistence --> card refresh
      |
      +--> scheduler --> one Minsk forecast per day for outdoor exact-time matches
```

Business rules live in application and domain modules, not inside Telegram handlers. Callback actions are durably deduplicated by Telegram `update_id` and vote/status changes are persisted atomically.

## Data model

- `chat_settings`: Telegram chat and topic settings, timezone, and default threshold;
- `matches`: schedule, location, venue type, field price, threshold, lifecycle status, cancellation reason, and creator;
- `match_messages`: public card and private admin-panel message references;
- `processed_updates`: durable callback and match-edit idempotency records;
- `votes`: one current choice per Telegram user and match;
- `user_aliases`: administrator-defined readable names keyed by Telegram username;
- `external_participants`: signed external-player changes, historical source labels, and display-name snapshots;
- `notifications`: idempotency claims for important status and forecast notifications.

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
CONFIRM_MATCH_CREATION=true
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
- creator-only editing of published active and confirmed matches;
- three response buttons with revoting and a per-user additional-player menu;
- creator-only completion and cancellation controls;
- durable callback idempotency;
- threshold-reached, threshold-lost, and cancellation notifications;
- external-player additions and removals;
- private match-preview drafts and cancellation reasons;
- one daily Minsk weather forecast before outdoor exact-time matches;
- match information and topic routing;
- administrator-defined user aliases in voting lists and match history.

Not included yet:

- waitlists;
- payments;
- general reminders;
- recurring matches;
- statistics;
- web dashboards;
- multiple independent groups.
