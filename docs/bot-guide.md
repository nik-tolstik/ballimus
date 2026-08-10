# Bot and Mini App Guide

Football Bot is an owner-only Telegram Mini App for publishing match information and independent native Telegram polls. It does not collect players or maintain rosters.

## Telegram card

Creating a match publishes one read-only Telegram card in the configured General topic. The card contains:

- date and local time range, for example `17:00-18:30`;
- a required catalog venue with a map link;
- venue type (indoor or outdoor);
- optional field price.

The card has no inline keyboard, vote status, player list, threshold, or lifecycle controls. Polls remain separate from cards and matches.

Editing or republishing a match updates the same Telegram message. Deleting a match marks it unavailable in the Mini App and queues deletion of the Telegram message. A jobs invocation retries transient Telegram failures. There is no match history.

## Owner Mini App

The configured owner opens the Mini App from Telegram. Signed Telegram `initData` is required; an ordinary browser tab or another Telegram user cannot access the API.

The Mini App has three sections:

- **Matches** — create and edit information cards; the actions menu republishes or deletes a card;
- **Polls** — create native regular Telegram polls in the configured Chat topic;
- **Venues** — maintain the reusable venue catalog; the actions menu archives or restores a venue.

A poll has a question, 2–12 ordered options, and an optional multiple-answer setting. Polls are anonymous regular polls and explicitly allow voters to change or retract their choices. Every option is either decision-driving or informational; new options are decision-driving by default.

Count notifications are disabled by default. Enabling the poll-level setting starts at 10 people and lets the organizer change the value before publication. When Telegram reports that a decision-driving option reached the threshold, the bot sends one message to the Chat topic. Informational options never trigger notifications, and further updates never duplicate a notification already sent for an option.

The global **Weather** action sends the current Minsk weather to the configured Telegram chat/topic. It is independent of matches, has no daily cap, and can be pressed repeatedly.

All mutations use idempotency keys. Updating or deleting a match and editing a venue use `If-Match` versions to prevent silent overwrites.

## Operational boundary

The API accepts only authenticated native `poll` updates at `/v1/telegram/webhook`. The endpoint ignores unrelated updates and unknown poll identifiers. It has no callback-query, message, roster, or `poll_answer` handling. Outbound cards, polls, threshold notifications, and weather messages use bounded Bot API calls.

Local and production bots, chats, databases, origins, and secrets must remain separate. Production deployment, migration, webhook registration, and Telegram messages require separate explicit owner authorization.
