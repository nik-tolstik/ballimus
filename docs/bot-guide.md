# Bot and Mini App Guide

Ballimus is an owner-only Telegram Mini App for publishing match information and independent native Telegram polls. It does not collect players or maintain rosters.

## Telegram card

Creating a match publishes one read-only Telegram card in the configured General topic. The card contains:

- date and local time range, for example `17:00-18:30`;
- a required catalog venue with a map link;
- venue type (indoor or outdoor);
- optional field price.

The card has no inline keyboard, vote status, player list, threshold, or lifecycle controls. Polls remain separate from cards and matches.

Editing a match updates the same Telegram message. A jobs invocation retries transient Telegram card-delivery failures. The owner can manually archive a match from its actions: the Telegram card is deleted, the match disappears from the active list, and its details remain available in the Mini App archive. Archived matches can be repeated into a new card or permanently deleted after confirmation; they cannot be restored and are never archived automatically.

## Owner Mini App

The configured owner opens the Mini App from Telegram. Signed Telegram `initData` is required; an ordinary browser tab or another Telegram user cannot access the API.

The Mini App has three sections:

- **Matches** — create and edit information cards; the active-card actions menu contains only **Archive**. The archive button beside **New match** opens archived matches, newest first;
- **Polls** — create native regular Telegram polls in the configured General topic. The archive button beside **New poll** opens archived polls, newest first;
- **Venues** — maintain the reusable venue catalog; a venue can be permanently deleted when no match uses it.

A poll has a question, 2–12 ordered options, and an optional multiple-answer setting. The editor starts with a dedicated “New option” draft row that has a plus icon and no option actions. Entering text promotes the draft to a regular option and adds a fresh draft row. A cleared regular option remains visible until the user presses Backspace or Delete again, then it is removed and focus moves to an adjacent row. At least two populated options are required to publish. Polls are non-anonymous regular polls and explicitly allow voters to change or retract their choices. The bell beside an option directly enables or disables count notifications for that option; new options have the bell enabled by default.

Count notifications are enabled by default at 10 people, and the organizer can change or disable the poll-level setting before publication. Bell controls are shown beside the options only while the poll-level setting is enabled. After a native poll has been created, the large **Save** action in its view changes only the bells for its existing ordered options; it cannot change the question, options, threshold, Telegram references, or the native poll. Its **Options** menu contains only **Archive**. Re-enabling a bell while its option is already above the threshold does not send a message until that option falls below and later crosses upward again. Disabling a bell suppresses future notices and cancels its pending delayed withdrawal alert. When Telegram reports that an option with an enabled bell crossed the threshold upward, the bot makes one bounded attempt to send a message to the Chat topic even though the poll itself is published in General. The option is rearmed after its count falls below the threshold, so a later upward crossing can notify again. Options with a disabled bell never trigger notifications. The Polls screen refreshes active results while it is visible, and selecting a poll card opens the “Poll” view with its current option counts. Archived polls cannot be edited. Archiving from that view removes the poll from the active list and makes one attempt to delete its Telegram message. An archived poll can then be permanently deleted after a separate confirmation; that deletion does not attempt Telegram deletion again. Sent threshold notifications are never deleted.

Creating a poll makes one bounded Telegram request. A confirmed Telegram rejection is shown as “Not published”; a timeout or network interruption asks the owner to check General because the poll may still have arrived. The application never resends a poll automatically or manually. Failed and uncertain polls remain visible with their status and may be archived.

The global **Weather** action sends the current Minsk weather to the configured Telegram chat/topic. It is independent of matches, has no daily cap, and can be pressed repeatedly.

All mutations use idempotency keys. Updating or archiving a match, editing a venue, and deleting a venue use `If-Match` versions to prevent silent overwrites. A venue cannot be deleted while any match references it; existing matches remain unchanged.

## Operational boundary

The API accepts authenticated native `poll` and `poll_answer` updates at `/v1/telegram/webhook`. Aggregate poll updates refresh displayed totals and trigger each distinct upward threshold crossing. Individual voter answers retain the latest selected options for active polls so a downward crossing can identify the voter. The API waits 10 seconds before that alert and suppresses it if the threshold is restored or the voter selects the option again during the grace period. The endpoint ignores unrelated updates and unknown poll identifiers. It has no callback-query, message, or roster handling. Outbound cards, polls, threshold notifications, and weather messages use bounded Bot API calls. Poll publication, archival deletion, and threshold notifications each use direct one-shot calls; only information-card effects use the durable outbox.

Local and production bots, chats, databases, origins, and secrets must remain separate. Production deployment, migration, webhook registration, and Telegram messages require separate explicit owner authorization.
