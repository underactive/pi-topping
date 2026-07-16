# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Durable completion marker appended after each finished turn, e.g. `π Baked for 6m 41s` — a fresh random word plus the turn's total elapsed time, rendered with `π` in the theme's primary text color and the rest dimmed. It's a TUI-only transcript entry that never enters LLM context.
- Seventh independent setting, "Show completion marker", toggleable via `/topping-settings` (on by default)

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
