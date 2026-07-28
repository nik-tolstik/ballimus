# Architecture

## Runtime composition

The application is assembled in `src/main.ts`:

1. configuration is loaded and validated;
2. SQLite is opened and the baseline Drizzle schema is applied;
3. repositories are created;
4. card creation, card updates, match actions, external participants, match information, and scheduled forecast services are constructed;
5. grammY handlers are wired to those services;
6. the in-process scheduler is started;
7. Telegram long polling starts after pending updates are discarded; lifecycle notifications are sent to the configured administrator's private dialog on startup and shutdown.

Telegram handlers are an integration boundary. Business rules live in application and domain modules so they can be tested without a Telegram connection.

## Component flow

```text
Telegram update
      |
      v
grammY handlers, private authorization, and topic routing
      |
      +--> /match --> parser --> validated draft in private chat
      |                 |
      |                 +--> publish --> public card in General
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
      |
      +--> in-process scheduler --> Minsk forecast --> Chat
```

## Topic routing

- `/match`, `/help`, `/matchinfo`, and external-player commands are accepted only in private conversations from authorized group administrators;
- public match cards are sent to the configured `General` topic;
- status notifications are sent to the configured `Chat` topic;
- creator admin panels are sent to the creator's private Telegram chat.

When `General` has topic ID `1`, the runtime omits `message_thread_id`, because Telegram represents the general topic specially.

## Match creation

The match-creation service normally uses a private review step (`CONFIRM_MATCH_CREATION=true` by default):

1. stores a draft match;
2. sends the creator the parsed draft with `Опубликовать`, `Исправить`, and `Отменить` actions;
3. leaves the match unpublished until the creator chooses `Опубликовать`;
4. renders and sends the public card;
5. stores the public message reference;
6. activates the match and converts the stored preview message into the creator's admin panel;
7. stores the public-card reference while retaining the admin-panel reference;
8. edits the preview message to reflect the active status.

When confirmation is disabled, successful parsing continues directly with publication. If publication or persistence fails, the draft match and already-sent messages are cleaned up on a best-effort basis.

## Callback actions

Callback data represents one of four intents: a vote on a public card, a creator lifecycle action, a private draft action, or a cancellation-reason choice. The service validates the source message, match reference, status, user identity, and administrator permissions. User votes and status changes are written atomically with a durable `processed_updates` record keyed by Telegram `update_id`.

The lifecycle is `draft → active → confirmed → completed`; cancellation is allowed from `active` or `confirmed` after the creator chooses `Недостаточно игроков` or `Плохая погода`. The reason is persisted and rendered on the final card and notification. `confirmed` does not lock the roster: voting and external-player changes remain available, and the required-player value is a threshold rather than a capacity.

The public card is rendered from persisted votes and external-player quantities after every successful action. Telegram message-edit failures do not roll back already-persisted state; they are logged and the next action retries the refresh.

## Notifications and scheduled forecasts

Threshold-reached, threshold-lost, and cancellation notifications are sent to `Chat`; cancellation notifications include the selected reason. Startup and shutdown notifications are sent to the configured `TELEGRAM_STATUS_USER_ID` private dialog. Threshold notifications use update-specific idempotent transition keys, so a later threshold crossing can be announced again.

The in-process scheduler checks only `outdoor` `active` and `confirmed` matches with an exact start time. Around 16 hours before the first eligible kick-off on a Minsk calendar day, it sends one weather forecast to `Chat`. A persistent day-level idempotency key prevents a second outdoor match on that day from duplicating the notification. Long polling starts with `drop_pending_updates`, so updates received while the process was offline are not dispatched to handlers.

## External participants

External-player commands are stored as signed quantity changes. They can include an optional source label, for example `от Никиты`; the card and match information render that attribution. A named removal is limited to entries with the same source label, while legacy unnamed commands operate on unnamed entries.

The current operating model assumes one organizer changes external participants at a time. The application does not coordinate simultaneous edits by multiple administrators.

## Persistence model

- `chat_settings` — chat IDs, topic IDs, timezone, and threshold;
- `matches` — schedule, title, location, venue type, price, status, threshold, cancellation reason, and creator;
- `match_messages` — public-card and private-panel message references;
- `processed_updates` — callback action deduplication;
- `votes` — one current choice per Telegram user and match;
- `external_participants` — signed quantity changes and optional source labels;
- `notifications` — important transition and forecast idempotency.

The project currently uses a clean baseline migration for the inline-card MVP. Native poll records are intentionally not migrated.
