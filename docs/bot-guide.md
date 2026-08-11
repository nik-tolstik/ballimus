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
- **Polls** — create native regular Telegram polls in the configured General topic;
- **Venues** — maintain the reusable venue catalog; the actions menu archives or restores a venue.

A poll has a question, 2–12 ordered options, and an optional multiple-answer setting. The editor starts with a dedicated “New option” draft row that has a plus icon and no option actions. Entering text promotes the draft to a regular option and adds a fresh draft row. A cleared regular option remains visible until the user presses Backspace or Delete again, then it is removed and focus moves to an adjacent row. At least two populated options are required to publish. Polls are non-anonymous regular polls and explicitly allow voters to change or retract their choices. The bell beside an option directly enables or disables count notifications for that option; new options have the bell enabled by default.

Count notifications are enabled by default at 10 people, and the organizer can change or disable the poll-level setting before publication. Bell controls are shown beside the options only while the poll-level setting is enabled. When Telegram reports that an option with an enabled bell reached the threshold, the bot makes one bounded attempt to send a message to the Chat topic even though the poll itself is published in General. Options with a disabled bell never trigger notifications, and later updates never make a second attempt for that option. The Polls screen refreshes active results while it is visible, and selecting a poll card opens the “Poll” view with its current option counts. Archiving from that view removes the poll from the active list and makes one attempt to delete its Telegram message. Sent threshold notifications are never deleted.

Creating or manually republishing a poll makes one bounded Telegram request. A confirmed Telegram rejection is shown as “Not published”; a timeout or network interruption asks the owner to check General because the poll may still have arrived. The application never automatically resends a poll. The owner can use **Republish** from the poll view after checking General when necessary.

The global **Weather** action sends the current Minsk weather to the configured Telegram chat/topic. It is independent of matches, has no daily cap, and can be pressed repeatedly.

All mutations use idempotency keys. Updating or deleting a match and editing a venue use `If-Match` versions to prevent silent overwrites.

## Operational boundary

The API accepts only authenticated native `poll` updates at `/v1/telegram/webhook`. The endpoint ignores unrelated updates and unknown poll identifiers. It has no callback-query, message, roster, or `poll_answer` handling. Outbound cards, polls, threshold notifications, and weather messages use bounded Bot API calls. Poll publication, archival deletion, and threshold notifications each use direct one-shot calls; only information-card effects use the durable outbox.

Local and production bots, chats, databases, origins, and secrets must remain separate. Production deployment, migration, webhook registration, and Telegram messages require separate explicit owner authorization.
