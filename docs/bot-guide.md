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
4. After publication, the bot posts an editable card in `General` and turns the creator's preview into a private panel with `Матч будет` and `Отменить`.
5. Users select `Участвую`, `Под вопросом`, or `Не смогу`.
6. The card is edited after each change and lists current names by option.
7. External participants can be added privately as a quantity with an optional source name.

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

### Vote from the card

Users press one of these buttons:

1. `Участвую` — counts toward the required number;
2. `Под вопросом` — does not count;
3. `Не смогу` — does not count.

Pressing another button changes the current choice. Callback actions are deduplicated by Telegram update ID.

### Manage a match

The creator receives a private admin panel. The creator must still be a group administrator to use it.

- `Матч будет` changes the status to `confirmed`, keeps voting and external-player changes available, and replaces the panel with `Завершить` and `Отменить`;
- `Завершить` changes the status to `completed`, removes all buttons, and freezes the match;
- `Отменить` asks for a reason: `Недостаточно игроков` or `Плохая погода`. The selected reason changes the status to `cancelled`, is shown on the frozen card, and is included in the notification to `Chat`.

The creator can recreate the panel by sending `/matchinfo #v32` privately.

### Match information

```text
/matchinfo
/matchinfo #v32
```

The response includes the match status, schedule, venue type, current names grouped by choice, confirmed total, external-player count and sources, and cancellation reason when applicable.

### External participants

```text
@ballimus_bot +2 для #v32
@ballimus_bot -1 для #v32
@ballimus_bot от Никиты +3 игрока для #v32
@ballimus_bot от Никиты -1 игрока для #v32
```

The legacy command without a name remains supported, and it can remove only players previously added without an attribution. A named command records and displays who the additional players are from; a named removal can only remove players previously added under that same name. The total quantity cannot become negative. Successful changes update the card and may trigger the threshold notification.

The current operating model assumes that one organizer manages external-player changes at a time. The bot does not coordinate simultaneous changes from several administrators.

## Card behavior

The card displays the schedule, location, venue type, field price, status, confirmed count, and names grouped by response. Usernames are included when available; users without usernames are represented by clickable Telegram mentions. The external-player total and its sources are shown only when the total is greater than zero. A cancelled card also displays its cancellation reason.

The required-player value is a minimum threshold, not a capacity. The card displays an informational target range ending two players above that minimum (for example, `10-12 человек`). It does not close the roster or create a waitlist: more than the stated number of players may vote `Участвую`, and voting remains available while the match is `active` or `confirmed`.

Once a card is completed or cancelled, it stays available as history but no longer contains action buttons.

## Notifications

The bot sends an idempotent notification to `Chat` every time confirmed users plus external participants cross the threshold upward. If the count falls below the threshold, it sends a neutral threshold-lost warning. A later upward crossing sends a fresh availability notification. Confirmation sends a `Матч состоится` notification, and cancellation sends a notification that includes the selected reason.

For the first eligible outdoor `active` or `confirmed` match on each Minsk calendar day, the scheduler sends one weather forecast to `Chat` about 16 hours before kick-off. Indoor matches do not trigger a forecast, and a second outdoor match on the same day does not duplicate it.

The bot also announces startup and shutdown in the configured administrator's private dialog (`TELEGRAM_STATUS_USER_ID`). That user must have opened the bot's private chat first. Pending Telegram updates are discarded when long polling starts, so messages and callbacks received while the bot was offline are ignored.

The editable card remains the source of truth; notifications are reserved for important transitions.
