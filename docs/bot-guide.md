# Bot Guide

## Purpose

Football Bot helps a Telegram forum group organize football matches. An administrator creates a match in a private conversation. The bot publishes one editable match card in the `General` topic and users select their availability with inline buttons.

The group uses two topics:

- `General` — public match cards and voting buttons;
- `Chat` — important status notifications.

## User flow

1. An administrator sends `/match` to the bot privately.
2. The bot parses the Russian match description.
3. The bot publishes an editable card in `General`.
4. The creator receives a private panel with `Матч будет` and `Отменить`.
5. Users select `Участвую`, `Под вопросом`, or `Не смогу`.
6. The card is edited after each change and lists current names by option.
7. External participants can be added privately as a quantity.

## Commands

### Create a match

```text
/match 28 июля 20:00 на Ракета. 10 человек
```

The parser accepts Russian dates, relative dates, exact or approximate times, locations, total field prices, and player counts. Approximate times remain visible in the title but are not stored as false exact schedules.

The public card contains a reference such as:

```text
⚽ #v32 28.07.2026 20:00 — Ракета
```

### Vote from the card

Users press one of these buttons:

1. `✅ Участвую` — counts toward the required number;
2. `❓ Под вопросом` — does not count;
3. `❌ Не смогу` — does not count.

Pressing another button changes the current choice. Callback actions are deduplicated by Telegram update ID.

### Manage a match

The creator receives a private admin panel. The creator must still be a group administrator to use it.

- `Матч будет` changes the status to `confirmed`, keeps voting and external-player changes available, and replaces the panel with `Завершить` and `Отменить`;
- `Завершить` changes the status to `completed`, removes all buttons, and freezes the match;
- `Отменить` changes the status to `cancelled`, removes all buttons, freezes the match, and notifies `Chat`.

The creator can recreate the panel by sending `/matchinfo #v32` privately.

### Match information

```text
/matchinfo
/matchinfo #v32
```

The response includes the match status, schedule, current names grouped by choice, confirmed total, and external-player count.

### External participants

```text
@ballimus_bot +2 для #v32
@ballimus_bot -1 для #v32
```

The quantity cannot become negative. Successful changes update the card and may trigger the threshold notification.

## Card behavior

The card displays the schedule, location, field price, status, confirmed count, external count, and names grouped by response. Usernames are included when available; users without usernames are represented by clickable Telegram mentions.

Once a card is completed or cancelled, it stays available as history but no longer contains action buttons.

## Notifications

The bot sends an idempotent notification to `Chat` when confirmed users plus external participants reach the threshold. Confirmation sends a `Матч состоится` notification. After the threshold is reached, moving from `Участвую` to another option sends a withdrawal warning. Cancellation sends a cancellation notification.

The bot also announces startup and shutdown in the configured administrator's private dialog (`TELEGRAM_STATUS_USER_ID`). That user must have opened the bot's private chat first. Pending Telegram updates are discarded when long polling starts, so messages and callbacks received while the bot was offline are ignored.

The editable card remains the source of truth; notifications are reserved for important transitions.
