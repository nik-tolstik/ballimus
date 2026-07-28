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

Fill in the test token, chat and topic IDs, status recipient user ID, OpenRouter key, database path, and timezone. Open the bot's private chat once from the status recipient account. Keep `.env` out of Git.

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
7. Create a low-threshold match:

       /match 28 июля 20:00 на Ракета. 3 человека

8. Verify that a public editable card with three inline buttons appears in `General` and the creator receives a private admin panel.
9. Vote from several Telegram accounts and verify that names and counts update in the same card.
10. Verify exactly one threshold notification at `3/3`.
11. Change one confirmed vote to `Под вопросом` or `Не смогу` and verify the withdrawal warning.
12. Use `@ballimus_bot +2 для #v<ID>` and `-1` and verify that the card updates.
13. Use `/matchinfo #v<ID>` and verify that the creator receives a fresh admin panel.
14. Verify that a non-creator cannot use the admin actions.
15. Press `Матч будет`, verify that the card says the match will happen, voting remains available, and the panel changes to `Завершить`.
16. Press `Завершить`, verify that the match is frozen and buttons disappear.
17. Create another match, press `Отменить`, and verify the cancellation notification and frozen card.
18. Stop and restart the bot, verify the shutdown/startup notifications in the status recipient's private dialog, and confirm that messages sent while it was offline are not processed after restart.
19. Repeat callback deliveries in tests and verify that no duplicate vote or notification is created.

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
- Check the terminal for Telegram send errors.
