# pi-topping

We garnish our pies. It seemed rude not to extend Pi the same courtesy. This is a [Pi](https://github.com/earendil-works/pi-coding-agent) extension that adds some quality of life improvements to Pi's UX, while looking good in the process:

**User Prompt** — high-vis bordered prompt box with configurable border color and style, pi icon toggle, and timestamp.

![Example of pi-topping's decorated user prompt](https://raw.githubusercontent.com/underactive/pi-topping/main/media/demo_user_prompt.png)

**“Working” Loader** — animated spinner (with color choice), randomized activity word, shimmer (with direction and speed), token activity monitor (with color, direction, and dim toggle), elapsed timer, output token display, and live output-token rate (with color choice and dim toggle) — all arrangeable left to right.

![Demo of pi-topping's shimmering activity word, scrolling activity meter, elapsed timer, token count, and token rate](https://raw.githubusercontent.com/underactive/pi-topping/main/media/demo.gif)

**Completion Marker** — end-of-turn marker with icon, randomized verb, and token consumption display. If you steered or followed up (`Alt+Enter`) while Pi was working, the marker also tallies those, e.g. `π Whisked for 2s (↓ 55 tokens · 2 mid-turn inputs)`. Hooks into Pi's `agent_settled` event.

![Example of pi-topping's completion marker](https://raw.githubusercontent.com/underactive/pi-topping/main/media/demo_completion_marker.png)

## Settings

Run `/topping-settings` (TUI only) to customize your toppings. Settings persist to
`~/.pi/agent/pi-topping/settings.json`; hand edits are tolerated on load.

```
╔═┥ Pi Topping: Settings ┝═══════════════════════════════════╗
╟─ Preview ──────────────────────────────────────────────────╢
║                                                            ║
║    Crafting (3s · ↓ 84 tokens)  28 tok/s                  ║
║                                                            ║
╟─ User Prompt ──────────────────────────────────────────────╢
║    [■] High-vis prompt                                ON   ║
║    [■] Border color                             ‹ accent › ║
║    [■] Border style                             ‹ double › ║
║    [■] Pi icon                                        ON   ║
║    [■] Timestamp                                      ON   ║
║                                                            ║
╟─ “Working” Loader ─────────────────────────────────────────╢
║    [■] Animated spinner                               ON   ║
║  ▸ [■] Animated spinner color                   ‹ accent › ║
║    [■] Randomize "Working" text                       ON   ║
║    [■] Text shimmer                                   ON   ║
║    [■] Text shimmer direction            ‹ Left to Right › ║
║    [■] Text shimmer speed                       ‹ Normal › ║
║    [■] Token activity monitor                         ON   ║
║    [■] Token activity monitor color             ‹ accent › ║
║    [■] Token activity monitor direction  ‹ Left to Right › ║
║    [■] Token activity monitor dimmed                 OFF   ║
║    [■] Elapsed time since prompt                      ON   ║
║    [■] Show output tokens                             ON   ║
║    [■] Token rate                                     ON   ║
║    [■] Token rate color                        ‹ warning › ║
║    [■] Token rate dimmed                             OFF   ║
║                                                            ║
╟─ Elements Order ───────────────────────────────────────────╢
║    [ ] Animated spinner                                    ║
║    [■] “Working” text                                ↑ ↓   ║
║    [ ] Token activity monitor                              ║
║    [ ] Elapsed time                                        ║
║    [ ] Output tokens                                       ║
║    [ ] Token rate                                          ║
║                                                            ║
╟─ Completion Marker ────────────────────────────────────────╢
║    [■] Show completion marker                         ON   ║
║    [■] Pi icon                                        ON   ║
║    [■] Randomize "Worked" text                        ON   ║
║    [■] Tokens spent                                   ON   ║
║    [■] Mid-turn inputs                                ON   ║
║                                                            ║
╟─ Options ──────────────────────────────────────────────────╢
║    [■] Use NerdFont icons                             ON   ║
╟────────────────────────────────────────────────────────────╢
║  ↑↓ move  ←→ select  ␣ toggle  ⏎ apply  esc cancel         ║
╚════════════════════════════════════════════════════┥ 1/32 ┝╝
```

▸ marks the keyboard cursor.

The Border color, Animated spinner color, Token activity monitor color, and Token rate color
settings all cycle through `accent`, `border`, `borderAccent`, `success`, `error`, and `warning`.

Under **Elements Order**, press `␣` to grab a row, then `↑`/`↓` to slide that element
left or right within the loader. Elapsed time and output tokens share a single
`(3s · ↓ 84 tokens)` parenthetical whenever they end up next to each other, and split
into `(3s)` and `(↓ 84 tokens)` when they do not. The `N tok/s` token rate uses the selected theme
color and is a standalone segment, last by default, and remains reorderable. Active rates are padded to
three characters so updates do not shift the other segments; when inactive, it remains as the dim
`--- tok/s` placeholder. After its last update it holds full brightness for 1.5 seconds, then fades
through five theme-aware shades to the dim text color over the next 0.25 seconds before returning to the
placeholder; a new count restores full brightness and restarts the cycle.

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

Tests cover the word/shimmer rendering, prompt box rendering, activity meter behavior, timer resets, settings persistence, the `menu.ts` component, and the settings menu wiring end to end.

## Limitations

- Token counts are a streaming word-count estimate, not an exact tokenizer count — they self-correct when each message finishes, so you'll see a small jump at that point.
- Elapsed time normally starts when you submit a prompt; for auto-continuations without that event, it starts slightly later instead.
- If another extension also customizes the working message, whichever one runs last wins.

## Author

Eric Sison
