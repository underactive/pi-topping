# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- “Elements Order” section in `/topping-settings` that reorders the working loader's spinner, activity word, token activity monitor, elapsed time, and output tokens. Press `␣` to grab a row and `↑`/`↓` to move it; the live preview follows along and the order persists as `loaderOrder` in `settings.json`.
- “Text shimmer speed” setting in `/topping-settings` offering `Slow`, `Normal`, and `Fast`, where slow halves and fast doubles the sweep velocity. Only the sweep scales: the band keeps its default pace across the padding on either side of the word, so the pause between one shimmer and the next stays the same at every speed.
- Reusable `reorderGroup` rows in `menu.ts`: grabbed rows consume up/down so they cannot escape their group, and the group's order is published as a comma-joined id list in the menu result.
- Mid-turn input count in the completion marker: steers and `Alt+Enter` follow-ups submitted while Pi is working are tallied and shown as e.g. `π Galloped for 37s (↓ 2.7k tokens · 4 mid-turn inputs)`, with a “Mid-turn inputs” toggle in `/topping-settings`.
- CI workflow running the test suite and typecheck on pushes to `main` and pull requests.

### Changed
- The spinner is drawn inside the working message (with pi's own indicator hidden) whenever it is not the first element, since pi's `Loader` always prepends its indicator. The session ticker clamps to the 80ms frame interval in that case so the spinner keeps animating.
- Elapsed time and output tokens now collapse into a single `(3s · ↓ 84 tokens)` parenthetical only while adjacent, and render as separate `(3s)` / `(↓ 84 tokens)` groups once another element is placed between them.

### Fixed
- Steering or following up while Pi is working no longer resets the elapsed timer and token count mid-turn; the working loader and completion marker now report the whole working span.

## [0.3.1] - 2026-07-28

### Fixed
- High-vis prompt decoration now preserves steering and follow-up delivery for messages submitted while Pi is working.

## [0.3.0] - 2026-07-21

### Added
- High-vis prompt box wraps each normal user prompt with a `π` title bar and submission timestamp, toggleable via `/topping-settings`.
- Cycle-value menu items for color (`accent`/`border`/`borderAccent`) and scroll direction (left-to-right/right-to-left) settings, navigable with left/right arrow keys.
- Context-aware live preview that follows the active setting section — prompt box, loader configuration, or completion marker — so each setting shows its own preview without scrolling away.
- Configurable spinner color, activity-meter color, shimmer sweep direction, and meter scroll direction via `/topping-settings`.
- Nerd Font icon (``) toggleable alongside the classic `π` symbol for both the prompt box and completion marker.
- Token consumption tracking appended to the completion marker, e.g. `(↓ 949 tokens)`.
- “Token activity monitor dimmed” toggle that applies the ANSI dim attribute to reduce meter brightness by roughly 50%.
- Settings menu scrolls automatically when there are more items than the terminal height can fit.

### Changed
- Completion marker format to `π Whisked for 2s (↓ 55 tokens)` — parentheses replace the `·` separator, icon stays in text color, the rest dimmed.
- Shimmer sweep supports left-to-right and right-to-left directions, matching the meter scroll direction.
- Menu border brackets changed from `[`/`]` to `┥`/`┝` for a cleaner look.
- Settings menu preview now schedules its own refresh per render instead of animating on a fixed interval — static previews render once, animated ones (loader, prompt-box timestamp) declare their own delay. The reusable `menu.ts` preview callback may now return a `PreviewResult` in addition to a plain `string[]`.
- The session's internal ticker now runs only as fast as the enabled decorations require, instead of always ticking at the 50ms shimmer interval.
- Prompt box preview rendering is memoized per terminal width.

### Fixed
- Preview no longer jumps in height when scrolling between the tall prompt-box preview and the single-line loader/completion previews — blank padding rows keep the layout stable.

## [0.2.1] - 2026-07-17

### Changed

- Bump version to 0.2.1

## [0.2.0] - 2026-07-16

### Added

- Durable completion marker appended after each finished turn, e.g. `π Baked for 6m 41s` — a fresh random word plus the turn's total elapsed time, rendered with `π` in the theme's primary text color and the rest dimmed. It's a TUI-only transcript entry that never enters LLM context.
- Seventh independent setting, "Show completion marker", toggleable via `/topping-settings` (on by default)

### Fixed

- `format.ts`: Token counts near a unit boundary (e.g. 999,999) no longer render as "1000k" — they promote to the next unit ("1.0M") instead.
- `menu.ts`: A zero-item settings menu can now be dismissed with Enter (apply), Escape, or Ctrl+C instead of swallowing key input and returning early.
- `settings.ts`: Non-boolean leaf values in `settings.json` no longer override boolean toggle defaults; only properly-typed boolean leaves are applied.

## [0.1.1] - 2026-07-14

### Fixed

- Use wildcard (`"*"`) peer dependency ranges for pi core packages per pi package spec
- Add missing `@earendil-works/pi-tui` peer dependency
- Point README demo image at raw GitHub URL so it renders on npmjs.com

## [0.1.0] - 2026-07-14

### Added

- Shimmering randomized activity word replacing the default "Working..." loader
- Theme-aware light-sweep shimmer across the activity word
- Eight-column scrolling token-activity meter using braille characters
- Live elapsed timer (`Xm YYs`) counting from prompt submission
- Live output-token estimate (`↓ N tokens`) with per-message reconciliation
- Fresh word on each tool call to keep long tool loops feeling alive
- `/topping-settings` command with box-drawing toggle menu and live preview
- Six independent settings: animated spinner, text shimmer, activity meter, word substitution, elapsed time, output tokens
- Settings persistence to `~/.pi/agent/pi-topping/settings.json`
- Reusable `menu.ts` toggle-menu component for other Pi extensions
- Full test suite covering rendering, meter behavior, timer resets, settings, and menu wiring
