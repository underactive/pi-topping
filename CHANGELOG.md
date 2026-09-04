# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.7.0] - 2026-09-04

### Removed
- Legacy `string[]` menu preview results; preview callbacks must now return `PreviewResult` (use `nextRefreshInMs: 50` for the previous default animation interval).

### Added
- `default` animated spinner color option, which defers to Pi's thinking-level-colored indicator.
- `default` completion marker border color option, which defers to Pi's thinking-level-colored border.
- `thinking-level` user-prompt border color option, which follows the thinking level captured at submission.
- `thinkingLevel` color options for the token activity monitor, token rate, and response model, which follow Pi's active thinking-level color.
- `text` and `muted` color options for the token activity monitor, token rate, and response model in the working loader.

### Changed
- The settings TUI now displays `thinkingLevel` instead of the internal color sentinel for prompt, animated-spinner, completion-marker border, token activity monitor, token rate, and response model color options.
- Default spinner and prompt-border colors now follow Pi 0.85.0's thinking-level presentation, and working text no longer includes an ellipsis.
- A one-time `schemaVersion: 2` migration resets saved spinner colors to `default` and prior-default `borderAccent` prompt borders to `thinking-level`.
- Completion marker border colors now default to `default` (thinking-level); a one-time `schemaVersion: 3` migration resets previously saved colors to `default`.
- The `accent` spinner color now sends explicit accent frames, distinct from Pi's default indicator.

### Fixed
- The default animated spinner in the working loader now uses the active thinking-level color, matching the settings preview.

## [0.6.5] - 2026-08-31

### Changed
- Working-text selection no longer rebuilds its candidate pool on every pick, and unchanged response-model values skip reprocessing on each streaming token delta, reducing per-token overhead.

### Fixed
- Response models that merely restate the selected model — including local paths and decorated filenames of it — no longer appear as response-model details.

## [0.6.4] - 2026-08-29

### Added
- Response-model display in the working loader, with visibility, color, permanent-dim, and reorder controls. The sanitized value appears without a label, remains for 3 seconds after settlement, then fades over 0.5 seconds.

### Changed
- The token-rate unit label is now `tps` (was `tok/s`).

### Fixed
- The response model is now picked up from partial assistant messages during streaming, so the loader shows the current model before the turn ends.
- Token counts reported by providers are validated before use: non-finite or negative `usage.output` values are ignored instead of being written into session state.
- The decorated prompt submission now awaits delivery before the input is claimed as handled; when delivery fails, a `Failed to submit prompt` error is shown and the input is not swallowed.
- The post-settlement display of the response model now renders on a persistent status surface instead of the transient working message, so the hold/fade no longer fights the loader, and it clears cleanly on the next turn, session start, and shutdown.

## [0.6.3] - 2026-08-28

### Added
- Blocking extension prompts now replace the animated working loader with a stable dim waiting state and pulse indicator, then resume the configured loader afterward. This state requires Pi ≥0.84.4.
- Page Up/Page Down navigation in the `/topping-settings` menu moves the cursor by a screenful of items.

### Changed
- `/topping-settings` now limits its menu to 75% of the terminal height and scrolls longer settings lists within that space.
- `/topping-settings` menu navigation no longer wraps around; ↑/↓ clamp at the first and last items.

### Fixed
- Reorder rows in `/topping-settings` (e.g. Elements Order) now move correctly when shifted multiple positions with ↑/↓ while grabbed.

## [0.6.2] - 2026-08-23

### Added
- Bundled **Doctor Who** word pack (68 entries, off by default) in the Word Packs section of `/topping-settings`.
- Bundled **Firefly** word pack (31 entries, off by default) in the Word Packs section of `/topping-settings`.
- Bundled **Hitchhiker's Guide** word pack (47 entries, off by default) in the Word Packs section of `/topping-settings`.
- Bundled **The Matrix** word pack (58 entries, off by default) in the Word Packs section of `/topping-settings`.
- Bundled **The Lord of the Rings** word pack (66 entries, off by default) in the Word Packs section of `/topping-settings`.
- Bundled **Portal** word pack (40 entries, off by default) in the Word Packs section of `/topping-settings`.

### Changed
- Star Trek and Star Wars word packs drop generic articles from verb-object phrases (e.g. “Igniting lightsaber”), keeping iconic quotes like “Feeling the Force” intact; Star Wars gains six new entries.

## [0.6.1] - 2026-08-21

### Fixed
- The scrolling `/topping-settings` menu no longer drops a section's heading when the section starts near the window bottom; the window now re-flows so the heading renders with a blank separator above it and its items below, instead of crowding or folding into the previous section.

## [0.6.0] - 2026-08-21

### Added
- Added word packs: custom working-text packs from `~/.pi/agent/pi-topping/word-packs.json`, with per-pack settings, validation, and matching completion-marker tenses. Word packs default off; preferences persist while a pack is unavailable.
- Added modular bundled word packs under `wordpacks/` — SimCity, Star Trek, and Star Wars, all off by default — managed in a new Word Packs section of `/topping-settings`. SimCity phrases are vendored from [svenstaro/genact](https://github.com/svenstaro/genact), specifically [`data/simcity.txt`](https://github.com/svenstaro/genact/blob/master/data/simcity.txt), under its verified MIT license.
- “Marker style” setting in `/topping-settings` cycling the decorated completion marker between `elite` (default; trailing dashes taper off after the summary) and `bookend` (dashes fill the remaining width to a closing corner glyph).

### Fixed
- Completion markers now use the matching past-tense entry for the final working text instead of an unrelated random entry, including word-pack selections.
- Decorated completion markers now span the full terminal width instead of starting one column in.
- The settings menu overlay sizes to 86% of the terminal width (was a fixed 76 columns), and section previews render at the overlay's inner width so they are no longer truncated or misaligned on wide terminals.

## [0.5.1] - 2026-08-11

### Fixed
- Inputs submitted while Pi is working (steer / `Alt+Enter` follow-up) now pass through undecorated so Pi's native `Steering:` / `Follow-up:` queue rows render again ([#2](https://github.com/underactive/pi-topping/issues/2)). Re-sending them via `sendMessage(deliverAs)` bypasses Pi's queue UI state, so mid-turn prompts skip the high-vis box until Pi exposes a queue-aware path.

## [0.5.0] - 2026-08-06

### Added
- Configurable Completion Marker border style with `none`, `double`, `single`, `rounded`, and `heavy` choices; `none` keeps the existing undecorated marker.
- Completion Marker border color setting with the same `accent`, `border`, `borderAccent`, `success`, `error`, and `warning` choices as the User Prompt border color.
- All color settings (prompt border, completion marker border, animated spinner, token activity monitor, and token rate) now offer `accent`, `border`, `borderAccent`, `success`, `error`, and `warning` choices.
- Added an `Invert shimmer` setting that keeps the working text at the default text color and sweeps a dimmed gradient across it.
- Prompt decorators now show the active provider/model in the lower-right border, with independent Provider and Model visibility toggles in `/topping-settings`.
- "Token rate color" setting in `/topping-settings`, defaulting to `warning`.
- "Token rate dimmed" setting in `/topping-settings` that renders the `N tps` segment with the terminal dim attribute, matching the token activity monitor's dim toggle.
- Live output-token throughput in the working loader, displayed by default as a warning-colored `N tps` segment with a "Token rate" toggle and reorder row. Active rates below 1,000 are padded to three characters so updates do not shift the other segments; larger rates may shift later segments. When inactive, the segment shows a dim `--- tps` placeholder. The rate holds full brightness for 1.5 seconds, then fades through five theme-aware shades to the dim text color over the next 0.25 seconds before returning to the placeholder; a new count restores full brightness and restarts the cycle.

### Changed
- `/topping-settings` now marks the selected row with `❯` (was `▸`) and highlights the whole row with the theme's `selectedBg` color, instead of coloring only the marker glyph.
- The working loader now joins adjacent elapsed time, output token, and token-rate details with `·` separators without surrounding parentheses; separated details do not retain dangling separators.
- New installations now default to this working-loader order: spinner, activity word, token activity monitor, token rate, elapsed time, then output tokens.
- The token activity monitor now defaults to right-to-left movement.
- `/topping-settings` now describes prompt decoration, working-loader features/order, and completion-marker settings.
- User Prompt border color now defaults to `borderAccent`.

### Fixed
- Settings menu labels and titles now use visible width when truncating, keeping box-drawing layouts aligned.
- Provider and model labels now strip control and Unicode formatting characters before rendering.
- Settings previews now require strict boolean values.
- Removed the warning-only fade wrapper, added safe fallback rendering for non-truecolor themes, and hardened preview cycle-value conversion.

## [0.4.0] - 2026-07-30

### Added
- “Border style” setting in `/topping-settings` cycling the high-vis prompt box between `double` (default), `single`, `rounded`, and `heavy` box-drawing character sets.
- “Elements Order” section in `/topping-settings` that reorders the working loader's spinner, activity word, token activity monitor, elapsed time, and output tokens. Press `␣` to grab a row and `↑`/`↓` to move it; the live preview follows along and the order persists as `loaderOrder` in `settings.json`.
- “Text shimmer speed” setting in `/topping-settings` offering `Slow`, `Normal`, and `Fast`, where slow halves and fast doubles the sweep velocity. Only the sweep scales: the band keeps its default pace across the padding on either side of the word, so the pause between one shimmer and the next stays the same at every speed.
- Reusable `reorderGroup` rows in `menu.ts`: grabbed rows consume up/down so they cannot escape their group, and the group's order is published as a comma-joined id list in the menu result.
- Mid-turn input count in the completion marker: steers and `Alt+Enter` follow-ups submitted while Pi is working are tallied and shown as e.g. `π Galloped for 37s (↓ 2.7k tokens · 4 mid-turn inputs)`, with a “Mid-turn inputs” toggle in `/topping-settings`.

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
