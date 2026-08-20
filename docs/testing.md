# Testing Guide

## Automated checks

Run checks that cover the changed area. Before completing a rendered frontend task, run `pnpm test:e2e` or the relevant focused Playwright command. Playwright is the required browser check because it provides deterministic mocked API and Telegram WebApp fixtures.

The full repository quality gate is:

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm api:contracts:check
pnpm build
pnpm test:e2e
```

Report any limitation and do not claim that visual QA passed when the relevant check could not run.

## Chrome Telegram Mini App smoke check

When the Chrome plugin is connected and Telegram Web is already signed in, supplement Playwright with a smoke check inside the real local Telegram Mini App:

1. Ensure the local Cloudflare Tunnel connector is healthy, run `pnpm dev`, and wait for `Local Telegram development is ready`. Do not open a loopback URL as a standalone session.
2. In Telegram Web, verify both the bot display name `Ballimus Dev` and the exact username `@ballimus_dev_bot`. Never open `Ballimus`, the production bot, or any bot with a different username.
3. Open the Mini App only after verifying the bot. Inspect only the iframe origin and require it to equal the configured `CLOUDFLARE_TUNNEL_URL`. Never read, print, copy, or store the iframe query, fragment, or signed Telegram `initData`.
4. Verify that the app identifies itself as `Ballimus Dev`, owner-only data loads, the relevant flow renders, and the Chrome console has no related errors. Capture a screenshot when it provides useful evidence.
5. Keep the check read-only unless the owner separately authorizes a specific mutation. Navigation, opening sheets, cancelling UI confirmations, temporary unsaved changes, console inspection, and screenshots are safe. Creating, saving, archiving, deleting, republishing, voting, or sending weather can change local data or send Telegram messages and must target only the local bot, local database, and `Футбол тест` group.
6. If Chrome is unavailable, Telegram Web is signed out, the exact bot identity or iframe origin cannot be verified, or the iframe cannot be controlled, report the limitation and rely on Playwright. Never fall back to another bot.

## Extended local acceptance

Run mutating Telegram acceptance checks only with separate owner authorization and only against the local bot, local database, and `Футбол тест`:

1. Create a venue and a match. Verify that Telegram receives one card with the expected time range.
2. Edit the match and verify that the same message changes, then delete it.
3. Send current Minsk weather and verify that the message appears in the configured test topic.
4. Create a non-anonymous native poll with one option notification enabled. Verify publication, live counts, threshold crossings, delayed shortage behavior, manual republishing after a failed publication, and archival. Use **Редактировать оповещения** to disable a bell and verify that the question, option text and order, counts, threshold, and Telegram poll remain unchanged. Disable a bell during the 10-second withdrawal grace period and verify that no alert is sent. Re-enable a bell above the threshold and verify that no immediate message is sent; the next upward crossing should notify.

Run `pnpm --filter @football/api jobs:run` when a local deletion retry is required.
