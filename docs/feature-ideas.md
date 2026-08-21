# pi-topping Feature Ideas

## High Impact / Easy Wins

### 1. Custom Word Packs — Implemented

Let users add their own working-text themes (e.g., "Star Trek", "cooking", "wizardry") alongside the built-in and SimCity pools, with per-pack toggles. Keeps the existing picker architecture but makes it extensible.

**Value:** Users can personalize the idle text without waiting for upstream additions. Fits naturally into the existing `WordEntry` + `pickWorkingTextSelection()` pipeline — just extend the word list source to read from a user-supplied packs file (e.g., `~/.pi/agent/pi-topping/word-packs.json`).

**Effort:** Low. Add a new settings key, a packs loader, and per-pack toggles in the settings menu sections.

---

### 2. Quick Toggle Command (`/topping-toggle`)

A one-line TUI command to show/hide all decorations without opening the full settings menu. Useful for presentations or when you just want plain output temporarily.

**Value:** The current path to disabling decorations requires navigating the full settings menu. A single toggle saves several keystrokes and is discoverable via `/topping-*` commands.

**Effort:** Low. Add a new `ExtensionCommand` that toggles a `decorationEnabled` setting (default true), persisted to settings.json so it survives restarts.

---

### 3. Export / Import Settings

A `/topping-export <file>` and `/topping-import <file>` pair so users can share configs, back them up, or migrate between installs.

**Value:** Settings currently live in `~/.pi/agent/pi-topping/settings.json`. Users managing multiple Pi installations lose their config on reinstall. Export/import is a one-line solution.

**Effort:** Low. Read/write the existing settings JSON with a stable key ordering. Validate import shape before writing.

---

## Medium Effort

### 4. Stats Dashboard (`/topping-stats`)

A summary panel showing tokens spent, sessions since last reset, average token rate, and total elapsed time. Gives users visibility into cost and performance.

**Value:** Token counts are currently a streaming estimate only visible during output. A stats view surfaces lifetime data for power users tracking usage or costs.

**Effort:** Medium. Add a stats store (in-memory + optional persisted to `~/.pi/agent/pi-topping/stats.json`), hook into `message_end` and `session_start` events, render via the menu component's preview section.

---

### 5. Time-of-Day Themes

Automatically swap accent colors based on time (e.g., warm tones in the evening, cool in the morning). Configurable via a simple preset list.

**Value:** Aesthetic polish with minimal cognitive overhead. Users don't have to think about color choices.

**Effort:** Medium. Add a `themeMode: "manual" | "auto"` setting. In auto mode, read the active color from a time-of-day lookup table instead of the user-selected color.

---

### 6. Custom Prompt Templates

Let users define their own prompt box content format (e.g., include a session ID, project name, or custom prefix) instead of just timestamp + provider/model.

**Value:** Power users who want richer context on each prompt (e.g., `prompt · project/foo · claude-sonnet-4`) get it without forking the extension.

**Effort:** Medium. Add a template string setting with `{timestamp}`, `{provider}`, `{model}`, `{project}` placeholders, rendered in place of the current static layout.

---

### 7. Completion Marker Sound / Notification

Optional brief terminal bell or system notification when Pi finishes, so users can step away without watching the screen.

**Value:** Solves the "Pi is done but I'm not looking" problem. Terminal bell is zero-dependency; a native notification would require platform-specific APIs.

**Effort:** Medium. Add a setting `completionNotification: "none" | "bell"`. On completion, emit `\x07` (BEL) for terminal bell. A macOS `osascript` fallback could be added later.

---

## Lower Priority

### 8. Auto-Hide Idle Decorations

Fade out spinner and shimmer after N seconds of inactivity (no token rate updates), then restore on next input. Saves visual noise during long pauses.

**Value:** During long waits between tool calls or thinking steps, decorations are unnecessary animation. Auto-hiding reduces distraction.

**Effort:** Medium. Track last activity time from the rate tracker; fade via opacity/ANSI dim after a configurable threshold. Reset on next token update.

---

### 9. Per-Project Settings Override

A `.pi-topping.json` at the workspace root could override specific settings (e.g., different word pack per project).

**Value:** Teams or personal projects might want distinct decoration styles. Check for a local config file and merge on top of user defaults.

**Effort:** Low-medium. Add a config resolver that reads `~/.pi/agent/pi-topping/settings.json` first, then overlays any `.pi-topping.json` found in the workspace root.

---

### 10. Keyboard Shortcut Bindings

Map keys like `T` to toggle decorations or `Shift+P` to cycle border styles, configurable in the menu.

**Value:** Reduces reliance on `/topping-settings` for common actions. Power users prefer keyboard over TUI navigation.

**Effort:** Medium. Hook into Pi's keybinding system (or add a custom key handler via the TUI overlay). Store bindings in settings; validate against conflicts.
