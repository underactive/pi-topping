# pi-topping

We garnish our pies. It seemed rude not to extend Pi the same courtesy. This is a [Pi](https://github.com/earendil-works/pi-coding-agent) extension that changes the default "Working..." loader with a shimmering activity word, a scrolling token-activity meter, an elapsed timer, and a live output-token count.

![Demo of pi-topping's shimmering activity word, scrolling activity meter, elapsed timer, and token count](demo.gif)

## What it does

- Picks a random activity word (`Cerebrating…`, `Noodling…`, `Zigzagging…`, etc.) when you submit a prompt, and a new one each time a tool call starts.
- Sweeps a theme-aware shimmer across the word while it's showing.
- Shows an elapsed timer (`Xm YYs`) that counts up from when you submitted the prompt.
- Shows a live output-token estimate (`↓ N tokens`), reconciled against the real usage total once each assistant message finishes.
- Resets everything — word, timer, token count — on each new prompt, and restores Pi's normal loader between turns.

## Activity meter

Next to Pi's spinner there's an eight-column scrolling meter that reflects how fast tokens are streaming in. It updates every 100ms and uses your theme's accent color, so it should blend in with whatever theme you're running.

## Settings

Run `/topping-settings` (TUI only) to toggle things on or off:

```
╔═[ Pi Topping: Settings ]══════════════════════════╗
╟─ Preview ─────────────────────────────────────────╢
║                                                   ║
║  ⠋ Crafting ⣤⣤⣤⣤ (0m 03s · ↓ 84 tokens)          ║
║                                                   ║
╟─ Decorations ─────────────────────────────────────╢
║  ▸ [■] Animated spinner                       ON  ║
║    [■] "Working..." text shimmer              ON  ║
║    [■] Token activity monitor                 ON  ║
╟─ Features ────────────────────────────────────────╢
║    [■] Substitute Pi's "Working..." message   ON  ║
║    [■] Elapsed time since prompt              ON  ║
║    [■] Show output tokens                     ON  ║
╟───────────────────────────────────────────────────╢
║  ↑↓ move  ␣ toggle  ⏎ apply  esc cancel           ║
╚═══════════════════════════════════════════════════╝
```

**Decorations** — animated spinner, word shimmer, activity meter.

**Features** — whether to substitute the random word at all, the elapsed timer, and the token count.

The menu has a live preview so you can see changes as you make them. Everything is on by default, so nothing changes unless you open the menu. Use `↑↓` to move, `␣` to toggle, `⏎` to save, `esc` to cancel. Settings are saved to `~/.pi/agent/pi-topping/settings.json`.

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
