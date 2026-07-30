# Bot and Mini App Guide

Football Bot has two user surfaces:

- the Telegram public match card, where group members vote;
- an owner-only Telegram Mini App, where the configured owner manages matches, players, and Telegram publication.

The migrated flow is not based on private commands, private admin panels, or private external-player menus.

## Member flow

1. The owner publishes a match card to the configured `General` topic.
2. A group member selects an availability option such as `После 19:00`, or presses `Участвую`, `Под вопросом`, or `Не смогу` when the match already has an exact time.
3. Telegram sends the callback to the API webhook.
4. The API validates the callback's group, topic, source message, match status, and Telegram update ID.
5. PostgreSQL stores the current vote and a refresh event in one transaction.
6. The API edits the same public card immediately when possible; the jobs process retries the durable event when needed.

Members can change their current vote while the match accepts voting. A duplicate Telegram update is acknowledged as already processed and does not create a second vote or notification.

## Owner flow

The owner opens the Mini App from the bot's Telegram Mini App entry point. The frontend receives signed Telegram `initData`, sends it to the API, and shows an access error when the session is missing, expired, invalid, or belongs to another Telegram account. Opening the web URL outside Telegram does not create an authenticated session.

The owner dashboard contains Matches, Players, and History views. The current structured match flow is:

1. Choose **New match** and enter a date plus either an exact time or several availability thresholds such as `19:00` and `20:00`.
2. Choose **Опубликовать матч**. One idempotent API transaction creates the active match, records the pending Telegram card, and queues its durable publication event.
3. For an availability poll, wait for the threshold notification, book the field, and choose **Уточнить время и место**. Enter the exact booked time, location, venue type, and price; one transaction confirms the match, updates the public card, and queues the final chat notification.
4. Edit an existing match with its current version in `If-Match`; a stale version produces a conflict instead of overwriting newer data.
5. Repair an uncertain initial publication by attaching the existing Telegram message ID or confirming that no card exists before retrying.
6. Use the owner match and roster operations for completion, cancellation, vote correction/removal, and external participants.

All owner REST operations are protected by the Mini App guard and scoped to the configured Telegram owner and group. The API remains the source of truth; the Mini App is a client of the generated OpenAPI contract.

## Match lifecycle

The domain supports these states:

- `draft` — legacy unpublished data retained for backward compatibility; the current creation flow skips this state;
- `active` — published and accepting votes and roster changes;
- `confirmed` — confirmed by the owner while the roster can still be updated;
- `completed` — finished and retained as history;
- `cancelled` — stopped with a retained cancellation reason.

Completion and cancellation queue deletion of the public card while keeping the match history in PostgreSQL. The required-player value is a threshold, not a capacity, so the card does not create a waitlist or lock the roster at the threshold.

## Player and roster data

Telegram callbacks create or update player identity snapshots. An owner can assign a readable name to a username before that person votes; the alias binds to the Telegram identity when the first matching update arrives. Confirmed and unconfirmed player states are shown in the Players view.

External participants are owner-managed in the Mini App. Their quantities contribute to the confirmed count, remain attributed to the owner action that created them, and are included in match details and public-card rendering. This replaces the former private participant-management flow.

## Notifications and weather

Threshold, threshold-lost, confirmation, cancellation, and card-related Telegram effects are durable outbox work. Delivery is idempotent and retried by the short jobs process. A failed or uncertain Telegram publication is visible through publication state and can require explicit reconciliation.

The weather job uses the configured group timezone, currently defaulting to `Europe/Minsk`. It considers eligible outdoor matches near the 16-hour window and sends at most one forecast per chat and Minsk calendar day. Indoor matches and duplicate Cron invocations do not create another forecast.

## Operational expectations

- The webhook is the only Telegram update ingress for the maintained API; there is no long polling.
- The public card is a projection and may temporarily show a reconciliation state after an uncertain Telegram API result.
- A health check at `/health` is unauthenticated and reports API process health only; it does not prove that Telegram or PostgreSQL is fully operational.
- Local and production use separate bots, groups, databases, origins, and secrets.
- Production deployment, webhook registration, Mini App URL changes, and BotFather changes require explicit owner authorization.
