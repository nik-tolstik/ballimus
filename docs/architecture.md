# Architecture

## Runtime composition

The application is assembled in `src/main.ts`:

1. configuration is loaded and validated;
2. SQLite is opened and the baseline Drizzle schema is applied;
3. repositories are created;
4. card creation, card updates, match actions, external participants, and match information services are constructed;
5. grammY handlers are wired to those services;
6. Telegram long polling starts after pending updates are discarded; lifecycle notifications are sent to the configured administrator's private dialog on startup and shutdown.

Telegram handlers are an integration boundary. Business rules live in application and domain modules so they can be tested without a Telegram connection.

## Component flow

```text
Telegram update
      |
      v
grammY handlers, private authorization, and topic routing
      |
      +--> /match --> parser --> OpenRouter --> Zod
      |                 |
      |                 +--> public card in General
      |                 +--> creator admin panel in private chat
      |
      +--> callback_query --> MatchActionService
      |                         |
      |                         +--> atomic vote/status persistence
      |                         +--> callback idempotency
      |                         +--> card refresh
      |                         +--> important notifications
      |
      +--> external-player command --> persistence --> card refresh
```

## Topic routing

- `/match`, `/help`, `/matchinfo`, and external-player commands are accepted only in private conversations from authorized group administrators;
- public match cards are sent to the configured `General` topic;
- status notifications are sent to the configured `Chat` topic;
- creator admin panels are sent to the creator's private Telegram chat.

When `General` has topic ID `1`, the runtime omits `message_thread_id`, because Telegram represents the general topic specially.

## Match creation

The match-creation service:

1. stores a draft match;
2. renders and sends the public card;
3. stores the public message reference;
4. renders and sends the creator's admin panel;
5. stores the admin-panel reference;
6. activates the match;
7. edits both messages to reflect the active status.

If publication or persistence fails, the draft match and already-sent messages are cleaned up on a best-effort basis.

## Callback actions

Callback data is parsed into one of:

```text
vote:<matchId>:going
vote:<matchId>:maybe
vote:<matchId>:not_going
match:<matchId>:complete
match:<matchId>:cancel
match:<matchId>:confirm
```

The service validates the source message, match reference, status, user identity, and administrator permissions. User votes and status changes are written atomically with a durable `processed_updates` record keyed by Telegram `update_id`. Status transitions are `active → confirmed → completed`, with cancellation allowed from `active` or `confirmed`.

The public card is rendered from persisted votes and external-player quantities after every successful action. Telegram message-edit failures do not roll back already-persisted state; they are logged and the next action retries the refresh.

## Notifications

Threshold, withdrawal, and cancellation notifications are sent to `Chat`; startup and shutdown notifications are sent to the configured `TELEGRAM_STATUS_USER_ID` private dialog. Match notifications use idempotent transition keys. A failed notification send releases its claim so a later attempt can retry it. Long polling starts with `drop_pending_updates`, so updates received while the process was offline are not dispatched to handlers.

## Persistence model

- `chat_settings` — chat IDs, topic IDs, timezone, and threshold;
- `matches` — schedule, title, location, price, status, threshold, and creator;
- `match_messages` — public-card and private-panel message references;
- `processed_updates` — callback action deduplication;
- `votes` — one current choice per Telegram user and match;
- `external_participants` — signed quantity changes;
- `notifications` — important transition idempotency.

The project currently uses a clean baseline migration for the inline-card MVP. Native poll records are intentionally not migrated.
