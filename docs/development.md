# Development Guide

## Prerequisites

- Node.js 22 or newer;
- pnpm;
- a Telegram bot token for a private test supergroup;
- a private Telegram supergroup with Topics enabled;
- an OpenRouter API key for natural-language `/match` parsing.

Use a separate token, chat, and SQLite database for development.

## Setup

```bash
pnpm install
cp .env.example .env
```

Fill in the test token, chat and topic IDs, status recipient user ID, OpenRouter key, database path, and timezone. `CONFIRM_MATCH_CREATION=true` is the default and enables the private match-preview flow. Open the bot's private chat once from the status recipient account. Keep `.env` out of Git.

## Commands

```bash
pnpm dev
pnpm test
pnpm typecheck
pnpm lint
pnpm db:generate
pnpm db:migrate
```

The current MVP uses a clean inline-card baseline. If the local database contains data from the old native-poll implementation, remove the local SQLite file before starting the new version.

## Manual Telegram acceptance

1. Add the test bot as an administrator in the private test group.
2. Confirm Topics are enabled and identify the `Chat` and `General` topic IDs.
3. Start the bot with `pnpm dev`.
4. Verify that the status recipient's private dialog receives the startup notification.
5. In a private conversation, send `/help` and verify the help text.
6. In `General` and `Chat`, send `/help` and verify that the bot does not respond.
7. Create a low-threshold match using the canonical format:

       /match
       Дата: 03.08.2026
       Время: 20:00
       Место: Ракета
       Формат: на улице
       Нужно игроков: 3
       Цена поля: 100 рублей

8. Verify that the creator receives a private draft with `Опубликовать`, `Исправить`, and `Отменить`, and that no public card exists yet.
9. Press `Исправить`, correct the request, then press `Опубликовать`; verify that a public editable card with three inline buttons appears in `General` and the creator receives a private admin panel.
10. Verify that the card displays `на улице` or `в здании` as the chosen venue type.
11. Vote from several Telegram accounts, including one more than the stated minimum, and verify that names and counts update in the same card without a roster lock.
12. Verify a threshold-reached notification at `3/3`.
13. Change one confirmed vote to `Под вопросом` or `Не смогу`, verify a threshold-lost warning at `2/3`, then restore the vote and verify a new threshold-reached notification at `3/3`.
14. Use `@ballimus_bot от Никиты +2 игрока для #v<ID>` and `@ballimus_bot от Никиты -1 игрока для #v<ID>` and verify that the card displays the attribution and updates.
15. Use `/matchinfo #v<ID>` and verify that the creator receives a fresh admin panel with venue, external sources, and current status.
16. Verify that a non-creator cannot use the admin actions.
17. Press `Матч будет`, verify that the card says the match will happen, voting remains available, and the panel changes to `Завершить`.
18. Press `Завершить`, verify that the match is frozen and buttons disappear.
19. Create another match, press `Отменить`, select `Недостаточно игроков` or `Плохая погода`, and verify that the frozen card and cancellation notification show the selected reason.
20. Create an outdoor exact-time active or confirmed match about 16 hours ahead (or use a controlled clock), and verify that the scheduler sends one Minsk weather forecast to `Chat`; verify that an indoor match and a second outdoor match on the same Minsk day do not send duplicates.
21. Stop and restart the bot, verify the shutdown/startup notifications in the status recipient's private dialog, and confirm that messages sent while it was offline are not processed after restart.
22. Repeat callback deliveries in tests and verify that no duplicate vote, cancellation, or notification is created.

## Troubleshooting

### The card does not appear

- Confirm the command was sent privately by a group administrator.
- Confirm the bot can send messages to `General`.
- Check the terminal for match creation errors.
- Verify that the database baseline applied successfully.

### Buttons do not respond

- Confirm the bot is receiving `callback_query` updates.
- Check that the match is still active.
- Check that the callback originated from the stored card message.
- The bot must call `answerCallbackQuery`; otherwise Telegram clients keep showing a progress indicator.

### Notifications are missing

- Match notifications are sent to `Chat`, while lifecycle notifications are sent to the configured status recipient's private dialog.
- Confirm that confirmed votes plus external players crossed the threshold.
- For a weather forecast, confirm that the match is `outdoor`, has an exact start time, is `active` or `confirmed`, and is near the 16-hour forecast window. Only one forecast is sent per Minsk calendar day.
- Check the terminal for Telegram send errors.
