# Match Card Design QA

**Source visual truth**

- Selected concept: Product Design ideation result 3.
- Source image: `/mnt/c/Users/vibeg/.codex/generated_images/019fc9fb-d6cb-7fb1-a035-71610c877a50/exec-d2bcf06e-dd66-451d-907f-14c15216c60b.png` (862 × 1825 px).
- Intended mobile canvas supplied to Image Gen: 390 × 844 CSS px. The generated output has a non-integer density, so comparison used normalized crops instead of treating the full image pixels as CSS pixels.
- Owner refinement: no internal card dividers; reduce the size and weight of date/time and venue text.

**Implementation evidence**

- Mobile screenshot: `/tmp/football-web-playwright/venues-groups-redesigned-m-d2786-ting-the-pending-time-label-mobile-chromium/match-lifecycle-groups.png` (1081 × 1999 px).
- Test viewport: Playwright `Pixel 5` project; the screenshot is a rendered mobile Chromium capture.
- State: owner match list with draft, active, and confirmed lifecycle sections; the focused card is active match #2 in flexible-time mode.
- Full-view evidence: both source and implementation retain the Mini App shell, pale cool-gray background, compact section header, white match surface, bottom navigation, and semantic active state. The full views intentionally differ in fixture density: the source illustrates one open match, while the verified product view includes all non-empty lifecycle groups.
- Focused comparison: `/tmp/match-card-design-comparison.png`. The left crop is the source card and the right crop is the implementation card; both are normalized to 431 × 240 px before side-by-side review.

**Required fidelity surfaces**

- Fonts and typography: implementation uses the project’s Geist Variable font. Status text is 12 px medium; date/time and venue text are 14 px normal with a 20 px line height. The abbreviated weekday keeps flexible-time strings on one line at the verified mobile width.
- Spacing and layout rhythm: the 4 px status rail, 12 px card radius, 20 px horizontal inset, 36 px header, and two 32 px itinerary rows produce a compact three-band rhythm. The rows are adjacent with no internal dividers or added gap.
- Colors and visual tokens: the existing Telegram blue token is preserved. The rail, dot, and status label use blue for active matches, green for ready/confirmed, amber for detail finalization, slate for neutral states, and destructive red for cancellation. Roster count remains a neutral secondary surface.
- Image quality and asset fidelity: the selected mock contains no product imagery. The implementation retains supplied app assets and uses the existing Lucide icon system rather than substituting custom drawings.
- Copy and content: the card shows status, match number, roster count, one date/time line, and one venue line. It does not render `displayTitle` or duplicate `время выбираем`.
- Icons and affordances: calendar, pin, users, and chevron retain the existing stroke family and are aligned to the 20 px content inset. The entire card remains one labelled button with a visible chevron.
- Responsiveness and accessibility: desktop and mobile Chromium scenarios pass. Long card text is safely truncated rather than overlapping; the status rail is decorative (`aria-hidden`) while the visible text carries the state. The control remains keyboard-focusable through the semantic button.

**Findings**

- No actionable P0, P1, or P2 findings remain.

**Comparison history**

1. Initial comparison found two P2 differences: the active status used a heavy tinted badge rather than the reference’s light dot-and-text treatment, and itinerary dividers started after the icons rather than spanning the card surface. The initial date used full weekday names, increasing the risk of crowded flexible-time text.
2. Fixed the card status label to use semantic text and a dot, aligned the initial separators, and abbreviated weekday names in the list card. Re-ran mobile and desktop Chromium verification.
3. The owner then requested no internal separators and smaller, lighter itinerary text. Removed the header and row dividers, reduced the three bands to 48 px, and changed date/time and venue to 14 px normal text.
4. The owner found the 48 px bands too loose. Tightened the header to 40 px, itinerary rows to 36 px, and their gap to 2 px while retaining the single full-card tap target.
5. The owner requested a denser treatment. Tightened the header to 36 px, each itinerary row to 32 px, and removed the remaining 2 px row gap.
6. Final mobile and desktop captures confirm no overlap or clipping; Playwright asserts that the card has no separator elements. The source is an illustrative single-card concept; the retained lifecycle grouping is an intentional product constraint.

**Implementation checklist**

1. Preserve `MatchListCard` dimensions and semantic status mapping when adding new match states.
2. Keep the card’s date/time and venue information to one line each; do not restore a display title or repeated labels.
3. Run `pnpm --filter @football/web run test:e2e` for any card layout change.

**Follow-up polish**

- [P3] Consider a visual-regression snapshot for the active card when the team adopts baseline screenshot review in CI.

final result: passed
