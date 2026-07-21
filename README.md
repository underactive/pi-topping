# pi-topping

We garnish our pies. It seemed rude not to extend Pi the same courtesy. This is a [Pi](https://github.com/earendil-works/pi-coding-agent) extension that changes the default "Working..." loader with a shimmering activity word, a scrolling token-activity meter, an elapsed timer, and a live output-token count.

![Demo of pi-topping's shimmering activity word, scrolling activity meter, elapsed timer, and token count](https://raw.githubusercontent.com/underactive/pi-topping/main/demo.gif)

## What it does

- Picks a random activity word (`Cerebrating…`, `Noodling…`, `Zigzagging…`, etc.) when you submit a prompt, and a new one each time a tool call starts.
- Sweeps a theme-aware shimmer across the word while it's showing (configurable left-to-right or right-to-left).
- Shows an animated spinner (`⠋⠙⠹…`) and an eight-column braille activity meter that reacts to token throughput, all in your chosen theme color (`accent`, `border`, or `borderAccent`).
- Shows an elapsed timer (`Xm YYs`) that counts up from when you submitted the prompt.
- Shows a live output-token estimate (`↓ N tokens`), reconciled against the real usage total once each assistant message finishes.
- Resets everything — word, timer, token count — on each new prompt, and restores Pi's normal loader between turns.
- Leaves a durable completion marker in the transcript after each finished turn, e.g. `π Whisked for 2s (↓ 55 tokens)` — a fresh random word, the elapsed time, and the confirmed token count, all dimmed with the icon in text color. TUI-only — never enters LLM context.
- Decorates normal user prompts in a bordered box with a `π` title and submission timestamp, making them easy to spot in transcript history.

## Activity meter

Next to Pi's spinner there's an eight-column scrolling meter that reflects how fast tokens are streaming in. It updates every 100ms and uses your chosen theme color (`accent`, `border`, or `borderAccent`) with an optional dim toggle. You can also flip the scroll direction so the meter flows left-to-right or right-to-left.

## Settings

Run `/topping-settings` (TUI only) to toggle things on or off — the menu adapts to your terminal height and scrolls when needed:

```
╔═┥ Pi Topping: Settings ┝═══════════════════════════╗
╟─ Preview ──────────────────────────────────────────╢
║                                                    ║
║  ⠋ Crafting ⣤⣤⣤⣤ (0m 03s · ↓ 84 tokens)           ║
║                                                    ║
╟─ User Prompt ──────────────────────────────────────╢
║  ▸ [■] High-vis prompt                        ON  ║
║    [■] Border color                   ‹ accent ›  ║
║    [■] Pi icon                              ON  ║
║    [■] Timestamp                            ON  ║
║                                                    ║
╟─ Working Loader Text ──────────────────────────────╢
║    [■] Animated spinner                       ON  ║
║    [■] Animated spinner color       ‹ accent ›  ║
║    [■] Randomize "Working" text              ON  ║
║    [■] Text shimmer                          ON  ║
║    [■] Text shimmer direction    ‹ Left to Right ›║
║    [■] Token activity monitor                 ON  ║
║    [■] Token activity monitor color ‹ accent ›  ║
║    [■] Token activity monitor direction         ║
║        ‹ Left to Right ›                        ║
║    [■] Token activity monitor dimmed          OFF ║
║    [■] Elapsed time since prompt              ON  ║
║    [■] Show output tokens                     ON  ║
║                                                    ║
╟─ Completion Marker ────────────────────────────────╢
║    [■] Show completion marker                  ON  ║
║    [■] Pi icon                                ON  ║
║    [■] Randomize "Worked" text                ON  ║
║    [■] Tokens spent                           ON  ║
║                                                    ║
╟─ Options ──────────────────────────────────────────╢
║    [■] Use NerdFont icons                      ON  ║
╟────────────────────────────────────────────────────╢
║  ↑↓ move  ←→ select  ␣ toggle  ⏎ apply  esc cancel║
╚══════════════════════════════════════════════[ 1/9 ]╝
```

**User Prompt** — high-vis bordered prompt box with configurable border color, pi icon toggle, and timestamp.

**Working Loader Text** — animated spinner (with color choice), randomized activity word, shimmer (with direction), token activity meter (with color, direction, and dim toggle), elapsed timer, and output token display.

**Completion Marker** — end-of-turn marker with icon, randomized verb, and token consumption display.

**Options** — Nerd Font icon support (`` vs `π`).

### Prompt decoration

Decorated prompts use only standard Pi theme keys, so they work with any theme. Commands, bash, skills, special-prefix inputs (`/`, `!`, `?`, `:`), and image-bearing prompts pass through unchanged.

The menu has a context-aware live preview that shows the relevant preview for whichever setting section you're browsing — the prompt box when adjusting prompt settings, the loader when configuring animation, or the completion marker when adjusting the end-of-turn display. Everything is on by default, so nothing changes unless you open the menu. Use `↑↓` to move, `←→` to cycle values, `␣` to toggle, `⏎` to save, `esc` to cancel. Settings are saved to `~/.pi/agent/pi-topping/settings.json`.

The toggle-menu component itself lives in `menu.ts` and is reusable by other extensions if you want a similar settings UI.

## Install

```bash
pi install npm:@underactive/pi-topping
```

Restart Pi (or run `/reload`) to pick it up.

## Requirements

- [Pi](https://github.com/earendil-works/pi-coding-agent)
- Node.js ≥22.19.0

## Development

```bash
npm install
npm test
npm run typecheck
```

Tests cover the word/shimmer rendering, activity meter behavior, timer resets, settings persistence, the `menu.ts` component, and the settings menu wiring end to end.

## Limitations

- Token counts are a streaming word-count estimate, not an exact tokenizer count — they self-correct when each message finishes, so you'll see a small jump at that point.
- Elapsed time normally starts when you submit a prompt; for auto-continuations without that event, it starts slightly later instead.
- If another extension also customizes the working message, whichever one runs last wins.

## Author

Eric Sison
