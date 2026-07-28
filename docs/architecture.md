# Architecture

## Runtime composition

The application is assembled in `src/main.ts`:

1. configuration is loaded and validated;
2. SQLite is opened and the baseline Drizzle schema is applied;
3. repositories are created;
4. card creation, card updates, published-match editing, match actions, external participants, match information, and scheduled forecast services are constructed;
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
      +--> /editmatch --> shared parser --> atomic same-match update --> card refresh
      |
      +--> /rename_user --> user alias and vote snapshot update --> card refresh
      |
      +--> callback_query --> MatchActionService or external-player flow
      |                         |
      |                         +--> atomic vote/status persistence
      |                         +--> callback idempotency
      |                         +--> card refresh
      |                         +--> important notifications
      |
      +--> external-player callbacks --> private menu --> persistence --> card refresh
      |
      +--> in-process scheduler --> Minsk forecast --> Chat
```

## Topic routing

- `/match`, `/editmatch`, `/help`, `/matchinfo`, and `/rename_user` are accepted only in private conversations from authorized group administrators;
- public match cards are sent to the configured `General` topic;
- the `Доп. игроки` card callback opens a private menu; add/remove callbacks are accepted only from that private menu;
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

## Published-match editing

The creator can request a copyable `/editmatch #v<ID>` full-replacement template from the private admin panel. The command is accepted only from that creator in a private conversation, after the creator's current group-administrator permission has been checked. It is available only while the match is `active` or `confirmed`.

The command body is adapted to the same parser used by `/match`. A successful atomic update replaces the schedule, location, venue type, field price, required-player threshold, and derived title on the same match row, then refreshes the existing public card. The match ID, current lifecycle status, votes, and external-participant entries are not replaced. The Telegram update ID is stored with the edit so repeated delivery is idempotent.

## Callback actions

Callback data represents votes, creator lifecycle actions, private draft actions, cancellation-reason choices, and external-player menu actions. The services validate the source message, match reference, status, user identity, and administrator permissions. User votes and status changes are written atomically with a durable `processed_updates` record keyed by Telegram `update_id`; external-player entries use a unique source update ID.

The lifecycle is `draft → active → confirmed → completed`; cancellation is allowed from `active` or `confirmed` after the creator chooses `Недостаточно игроков` or `Плохая погода`. The reason is persisted and included in the cancellation notification. `confirmed` does not lock the roster: voting and external-player changes remain available, and the required-player value is a threshold rather than a capacity.

The public card is rendered from persisted votes and external-player quantities after every successful active or confirmed action. When the creator completes or cancels a match, the updater deletes its public card from `General`; it does not delete the persisted match history. There is no automatic time-based card deletion. Telegram message-edit failures do not roll back already-persisted state; they are logged and the next action retries the refresh.

## User aliases

An administrator can send `/rename_user @username Readable Name` in the private conversation. The command stores a normalized username alias in `user_aliases`. If the username is already present in vote snapshots, the service also updates all known snapshots for that Telegram user and refreshes the affected match cards. New callback votes resolve the alias before persistence, so `/matchinfo` and historical match views use the same readable name.

## Notifications and scheduled forecasts

Threshold-reached, threshold-lost, and cancellation notifications are sent to `Chat`; cancellation notifications include the selected reason. Startup and shutdown notifications are sent to the configured `TELEGRAM_STATUS_USER_ID` private dialog. Threshold notifications use update-specific idempotent transition keys, so a later threshold crossing can be announced again.

The in-process scheduler checks only `outdoor` `active` and `confirmed` matches with an exact start time. Around 16 hours before the first eligible kick-off on a Minsk calendar day, it sends one weather forecast to `Chat`. A persistent day-level idempotency key prevents a second outdoor match on that day from duplicating the notification. Long polling starts with `drop_pending_updates`, so updates received while the process was offline are not dispatched to handlers.

## External participants

The public card's external-player button opens a private menu. Each add/remove callback stores a signed change of exactly one player with a nullable display-name snapshot and no source label. Removal checks the contribution owned by the clicking Telegram user. The card and match information group these entries by user; historical entries without a snapshot fall back to the Telegram ID, and historical source labels remain displayable.

The current operating model assumes one organizer changes external participants at a time. The application does not coordinate simultaneous edits by multiple administrators.

## Persistence model

- `chat_settings` — chat IDs, topic IDs, timezone, and threshold;
- `matches` — schedule, title, location, venue type, price, status, threshold, cancellation reason, and creator;
- `match_messages` — public-card and private-panel message references;
- `processed_updates` — callback-action and match-edit command deduplication;
- `votes` — one current choice per Telegram user and match;
- `user_aliases` — administrator-defined readable names keyed by normalized Telegram username;
- `external_participants` — signed quantity changes, optional historical source labels, and nullable display-name snapshots;
- `notifications` — important transition and forecast idempotency.

The project currently uses a clean baseline migration for the inline-card MVP. Native poll records are intentionally not migrated.
