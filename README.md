# pi-topping

We garnish our pies. It seemed rude not to extend Pi the same courtesy. This is a [Pi](https://github.com/earendil-works/pi-coding-agent) extension that adds some quality of life improvements to Pi's UX, while looking good in the process:

**User Prompt** — high-vis bordered prompt box with configurable border color, pi icon toggle, and timestamp.

![Example of pi-topping's decorated user prompt](https://raw.githubusercontent.com/underactive/pi-topping/main/demo_user_prompt.png)

**Working Loader Text** — animated spinner (with color choice), randomized activity word, shimmer (with direction), token activity meter (with color, direction, and dim toggle), elapsed timer, and output token display.

![Demo of pi-topping's shimmering activity word, scrolling activity meter, elapsed timer, and token count](https://raw.githubusercontent.com/underactive/pi-topping/main/demo.gif)

**Completion Marker** — end-of-turn marker with icon, randomized verb, and token consumption display. Hooks into Pi's `agent_settled` event.

![Example of pi-topping's completion marker](https://raw.githubusercontent.com/underactive/pi-topping/main/demo_completion_marker.png)

## Settings

Run `/topping-settings` (TUI only) to customize your toppings:

```
╔═┥ Pi Topping: Settings ┝═══════════════════════════════════╗
╟─ Preview ──────────────────────────────────────────────────╢
║                                                            ║
║    Crafting (0m 03s · ↓ 84 tokens)                         ║
║                                                            ║
╟─ User Prompt ──────────────────────────────────────────────╢
║    [■] High-vis prompt                                ON   ║
║    [■] Border color                             ‹ accent › ║
║    [■] Pi icon                                        ON   ║
║    [■] Timestamp                                      ON   ║
║                                                            ║
╟─ Working Loader Text ──────────────────────────────────────╢
║    [■] Animated spinner                               ON   ║
║  ▸ [■] Animated spinner color                   ‹ accent › ║
║    [■] Randomize "Working" text                       ON   ║
║    [■] Text shimmer                                   ON   ║
║    [■] Text shimmer direction            ‹ Left to Right › ║
║    [■] Token activity monitor                         ON   ║
║    [■] Token activity monitor color             ‹ accent › ║
║    [■] Token activity monitor direction  ‹ Left to Right › ║
║    [■] Token activity monitor dimmed                 OFF   ║
║    [■] Elapsed time since prompt                      ON   ║
║    [■] Show output tokens                             ON   ║
║                                                            ║
╟─ Completion Marker ────────────────────────────────────────╢
║    [■] Show completion marker                         ON   ║
║    [■] Pi icon                                        ON   ║
║    [■] Randomize "Worked" text                        ON   ║
║    [■] Tokens spent                                   ON   ║
║                                                            ║
╟─ Options ──────────────────────────────────────────────────╢
║    [■] Use NerdFont icons                             ON   ║
╟────────────────────────────────────────────────────────────╢
║  ↑↓ move  ←→ select  ␣ toggle  ⏎ apply  esc cancel         ║
╚═════════════════════════════════════════════════════┥ 1/9 ┝╝
```

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
