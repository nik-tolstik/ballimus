# Match Detail Redesign QA

## Comparison target

- Source visual truth: `/mnt/c/Users/vibeg/.codex/generated_images/019fae66-c4a6-74f3-afc2-ff4317b67eb5/exec-503e8da7-4f21-4a9c-bc13-50bbd9d3964f.png`
- Source pixels: `853 x 1844`.
- Intended CSS viewport: `390 x 844`, mobile, dark theme.
- Intended state: active match, Overview tab selected.
- Implementation URL: `https://unscarce-shalonda-uninfectiously.ngrok-free.dev`.
- Implementation screenshot: unavailable.
- Implementation pixels and density normalization: unavailable because the browser capture bridge rejected the workspace URI before navigation.

## Full-view comparison evidence

Blocked. The source visual was opened and inspected at native resolution. The live Vite application and transformed match-detail module return HTTP 200, but HTTP/source checks are not browser-rendered evidence and cannot be used for a visual comparison.

## Focused-region comparison evidence

Blocked for the same reason. Typography, spacing, token mapping, icon alignment, wrapping, viewport overflow, and persistent navigation placement could not be compared from an implementation screenshot.

## Findings

- [P1] Browser-rendered fidelity is not verified.
  - Location: dedicated match detail screen at the active-match Overview state.
  - Evidence: source mock is available, but no implementation screenshot or browser console capture is available.
  - Impact: visual mismatches or mobile overflow could remain despite passing static and build checks.
  - Fix: open the live Mini App in a supported browser capture surface at `390 x 844`, capture the active match Overview state, combine it with the source mock, and run the visual comparison.

## Functional evidence

- Web tests pass `19/19`.
- TypeScript typecheck passes.
- Lint passes with zero warnings and errors.
- Production build passes.
- Static rendering verifies separate list/detail surfaces, a back control, Overview/Roster/Settings tabs, the match cancellation action, and removal of the manual Telegram-card refresh action.
- Static rendering verifies that the public-card status appears before the match date, Summary precedes Next action on Overview, and the redundant Telegram row is absent from Summary.
- Static rendering verifies that the standalone Telegram card is absent from Match settings while reconciliation actions remain available when required.
- Cancellation uses a Select with two predefined reasons and an Other option; static rendering covers conditional custom-reason disclosure, and focused tests cover validation and final API text.
- Static app rendering verifies that the redundant Owner badge is absent from the root header while the rest of the header remains available.
- Static rendering verifies the development brand name and removal of the former generic title/subtitle; the environment selector is covered for both Ballimus and Ballimus Dev, and both optimized logo assets are reachable from the live Vite server.
- Cancellation-reason validation and roster-avatar initials are covered by focused component tests.
- Roster drag-and-drop groups, drag handles, and removal of the former vote-state buttons are covered by static component tests; pointer and touch interaction remain part of the browser QA blocker below.
- The draggable card no longer transitions opacity during the overlay handoff, preventing the destination card from fading in a second time after the drop animation; the rendered class contract is covered by a regression assertion.
- Active roster drop zones now use semantic feedback: Going is green, Maybe is amber, and Not going is red. Each state colors the zone border, subtle background, inset ring, heading, and empty-state drop prompt; the mapping is covered by focused tests.
- External participants render as individual editable rows inside the Going group with a fallback avatar and a header add action; source/quantity validation and combined roster counts are covered by focused tests.
- All five save flows use native form submission, so Enter invokes the same validated action as the primary submit button; secondary actions inside forms use explicit non-submit button types.
- Form controls now share one mobile type scale and height: text/number inputs, Select, date/time triggers, and the venue ToggleGroup render at 16px and 40px high, with a consistent 14px compact scale at wider viewports. Field labels remain 14px for hierarchy.
- The Players tab only exposes readable-pseudonym editing for confirmed Telegram users; pre-created unconfirmed profiles and username-alias management are absent from the rendered surface.
- The live Vite modules return HTTP 200 and contain the dedicated detail navigation.
- Browser interactions and console errors were not checked because browser capture is blocked.

## Comparison history

- Initial comparison: blocked before implementation capture; no visual-fidelity fixes can be evidence-backed yet.

## Implementation checklist

- Capture the active-match Overview screen at the intended mobile viewport.
- Exercise list card -> detail -> Roster -> Settings -> back to list.
- Check the browser console after each transition.
- Compare source and implementation together, fix any P0/P1/P2 differences, and repeat.

final result: blocked
