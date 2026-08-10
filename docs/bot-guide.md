# Bot and Mini App Guide

Football Bot is an owner-only Telegram Mini App for publishing match information. It does not run polls, collect players, maintain rosters, or process Telegram updates.

## Telegram card

Creating a match publishes one read-only Telegram card in the configured General topic. The card contains:

- date and exact local time;
- a required catalog venue with a map link;
- venue type (indoor or outdoor);
- optional field price.

The card has no inline keyboard, vote status, player list, threshold, or lifecycle controls. The organizer creates any poll through Telegram's native interface when it is needed.

Editing a match updates the same Telegram message. Deleting a match marks it unavailable in the Mini App and queues deletion of the Telegram message. A jobs invocation retries transient Telegram failures. There is no match history.

## Owner Mini App

The configured owner opens the Mini App from Telegram. Signed Telegram `initData` is required; an ordinary browser tab or another Telegram user cannot access the API.

The Mini App has two sections:

- **Matches** — create, edit, and delete information cards;
- **Venues** — maintain the reusable venue catalog.

The global **Weather** action sends the current Minsk weather to the configured Telegram chat/topic. It is independent of matches, has no daily cap, and can be pressed repeatedly.

All mutations use idempotency keys. Updating or deleting a match and editing a venue use `If-Match` versions to prevent silent overwrites.

## Operational boundary

The API never accepts Telegram webhooks or callbacks. Telegram is used only through bounded outbound Bot API calls for cards and manual weather messages.

Local and production bots, chats, databases, origins, and secrets must remain separate. Production deployment, migration, card cleanup, and disabling a legacy webhook require separate explicit owner authorization.
