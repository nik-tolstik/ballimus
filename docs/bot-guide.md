# Bot Guide

## Purpose

Football Bot helps a Telegram forum group organize football matches. An administrator creates a match in a private conversation. The bot publishes one editable match card in the `General` topic and users select their availability with inline buttons.

The group uses two topics:

- `General` — public match cards and voting buttons;
- `Chat` — important status notifications.

## User flow

1. An administrator sends `/match` to the bot privately.
2. The bot parses the match details and shows a private draft to the creator.
3. The creator chooses `Опубликовать`, `Исправить`, or `Отменить`.
4. After publication, the bot posts an editable card in `General` and turns the creator's preview into a private panel with `Редактировать`, `Матч будет`, and `Отменить`.
5. Users select `Участвую`, `Под вопросом`, or `Не смогу`.
6. The card is edited after each change and lists current names by option.
7. External participants can be added privately as a quantity with an optional source name.
8. An administrator can assign readable names to Telegram usernames for participant lists.
9. The creator can update the details of an active or confirmed match without replacing its card, votes, or ID.
10. The creator can remove a stale vote from an active or confirmed match.

## Commands

### Create a match

```text
/match
Дата: 03.08.2026
Время: 20:00
Место: Ракета
Формат: на улице
Нужно игроков: 10
Цена поля: 100 рублей
```

Use `Формат: на улице` or `Формат: в здании`. The field-price line is optional. This labelled form is the canonical organizer format; natural Russian descriptions remain a fallback. The scheduled weather forecast applies only to `на улице` matches with an exact 24-hour `Время`, for example `20:00`.

By default (`CONFIRM_MATCH_CREATION=true`), the parsed match remains private as a `draft` until its creator presses `Опубликовать`. `Исправить` keeps the match unpublished so the creator can correct the request, and `Отменить` discards the draft. Setting the flag to `false` publishes a successfully parsed match immediately.

The public card keeps the date and time at the top. When the match is on the current Minsk date, it uses `Сегодня` instead of the numeric date. Location, venue type, player target, and field price are grouped into a compact details block:

```text
#v32
Сегодня 20:00

Статус: Голосуем

📍 Место: Ракета
🏠 Формат: на улице, 10-12 человек
🫰 Сумма: 100 рублей

👯 Состав 0/10

Участвуют (0)
Под вопросом (0)
Не смогут (0)
```

### Edit a published match

For an `active` or `confirmed` match, the creator presses `Редактировать` in the private admin panel. The bot sends a full, copyable template:

```text
/editmatch #v32
Дата: 03.08.2026
Время: 20:00
Место: Ракета
Формат: на улице
Нужно игроков: 10
Цена поля: 100 рублей
```

The creator sends the updated full form in a private chat. The command is parsed like `/match` and updates the same `#v32` record and public card. It preserves votes, external participants, and the current `active` or `confirmed` status. The field-price line is optional and can be omitted to clear the price. Editing is limited to the match creator who is still a group administrator; completed and cancelled matches cannot be edited.

### Remove a stale vote

The creator can completely withdraw a player's current vote from a private administrator chat:

```text
/remove_vote #v32 @username
/remove_vote #v32 123456789
```

The command accepts a stored vote username or an exact Telegram user ID. If a username is ambiguous, use the ID shown by `/matchinfo #v32`. The operation is available only while the match is `active` or `confirmed`, refreshes the public card and administrator panel, and sends the usual threshold-lost notification when removing a `Участвую` vote takes the confirmed count below the minimum.

### Vote from the card

Users press one of these buttons:

1. `Участвую` — counts toward the required number;
2. `Под вопросом` — does not count;
3. `Не смогу` — does not count.

Pressing another button changes the current choice. Callback actions are deduplicated by Telegram update ID.

### Manage a match

The creator receives a private admin panel. The creator must still be a group administrator to use it.

- `Редактировать` sends the creator a private full `/editmatch #v<ID>` template. Submitting it updates the same active or confirmed match without resetting votes, external participants, or its status;
- `Матч будет` changes the status to `confirmed`, keeps voting and external-player changes available, and replaces the panel with `Редактировать`, `Завершить`, and `Отменить`;
- `Завершить` changes the status to `completed`, deletes the public card from `General`, and freezes the match record;
- `Отменить` asks for a reason: `Недостаточно игроков` or `Плохая погода`. The selected reason changes the status to `cancelled`, deletes the public card from `General`, and is included in the notification to `Chat`.
- `/remove_vote #v32 @username` or `/remove_vote #v32 123456789` removes one current player vote. Only the match creator, who must still be a group administrator, can use it.

The creator can recreate the panel by sending `/matchinfo #v32` privately. It is also the private history view for completed and cancelled matches after their public cards have been removed.

### Match information

```text
/matchinfo
/matchinfo #v32
```

The response includes the match status, schedule, venue type, current names grouped by choice, confirmed total, external-player count and per-user contributions, and the cancellation reason when applicable. It can inspect a completed or cancelled match after its public card has been removed.

### User aliases

An authorized administrator can assign a readable name to a Telegram username from the private conversation:

```text
/rename_user @chocolate Ваня Петров
```

The alias is stored persistently. Existing vote snapshots for that username are updated and their open cards are refreshed; future votes use the alias automatically. The username is still shown next to the readable name when available. If the user has not voted yet, the alias is applied when the bot first sees that username in a vote.

### External participants

The public card contains `Доп. игроки`. Press it to receive a private menu with `➕ Добавить игрока` and `➖ Убрать игрока`. Every press changes the current user's contribution by one. A user can remove only their own button-added players, and the match must still be `active` or `confirmed`.

The public card and `/matchinfo` group contributions by user, for example `От Вани: 2`. New entries store the display-name snapshot resolved at the time of the press; historical entries without a snapshot use the Telegram ID, while historical source labels remain intact. If Telegram cannot deliver the private menu, the user must open the bot's private chat and send `/start` before pressing the card button again. Successful changes update the card and may trigger the threshold notification.

## Card behavior

The card displays the schedule, location, venue type, field price, status, confirmed count, and names grouped by response. Administrator-defined aliases replace Telegram display names in those lists. Usernames are included when available; users without usernames are represented by clickable Telegram mentions. The external-player total and per-user contributions are shown only when the total is greater than zero.

The required-player value is a minimum threshold, not a capacity. The card displays an informational target range ending two players above that minimum (for example, `10-12 человек`). It does not close the roster or create a waitlist: more than the stated number of players may vote `Участвую`, and voting remains available while the match is `active` or `confirmed`.

When the creator completes or cancels a match, its public card is deleted from `General`. The bot does not automatically delete cards on a timer. Match history stays in the database and is available privately through `/matchinfo #v<ID>`.

## Notifications

The bot sends an idempotent notification to `Chat` every time confirmed users plus external participants cross the threshold upward. If the count falls below the threshold, it sends a neutral threshold-lost warning. A later upward crossing sends a fresh availability notification. Confirmation sends a `Матч состоится` notification, and cancellation sends a notification that includes the selected reason.

For the first eligible outdoor `active` or `confirmed` match on each Minsk calendar day, the scheduler sends one weather forecast to `Chat` about 16 hours before kick-off. Indoor matches do not trigger a forecast, and a second outdoor match on the same day does not duplicate it.

The bot also announces startup and shutdown in the configured administrator's private dialog (`TELEGRAM_STATUS_USER_ID`). That user must have opened the bot's private chat first. Pending Telegram updates are discarded when long polling starts, so messages and callbacks received while the bot was offline are ignored.

The editable card remains the source of truth; notifications are reserved for important transitions.
