# pi-topping

We garnish our pies. It seemed rude not to extend Pi the same courtesy. This is a [Pi](https://github.com/earendil-works/pi-coding-agent) extension that adds some quality of life improvements to Pi's UX, while looking good in the process:

**User Prompt** — high-vis bordered prompt box with configurable border color and style, pi icon toggle, timestamp, and provider/model label. Prompts submitted while Pi is working (steer / `Alt+Enter` follow-up) are left undecorated so Pi's native `Steering:` / `Follow-up:` queue rows still render.

![Example of pi-topping's decorated user prompt](https://raw.githubusercontent.com/underactive/pi-topping/main/media/demo_user_prompt.png)

**“Working” Loader** — animated spinner (with color choice), randomized activity word, optional word packs, shimmer (with direction, speed, and invert option), token activity monitor (with color, direction, and dim toggle), elapsed timer, output token display, and live output-token rate (with color choice and dim toggle) — all arrangeable left to right.

![Demo of pi-topping's shimmering activity word, scrolling activity meter, elapsed timer, token count, and token rate](https://raw.githubusercontent.com/underactive/pi-topping/main/media/demo.gif)

**Completion Marker** — end-of-turn marker with icon, randomized verb (or `Worked`; matching past tense when Randomize "Worked" text is on), token consumption display, and optional border-style/color decorations. Hooks into Pi's `agent_settled` event.

![Example of pi-topping's completion marker](https://raw.githubusercontent.com/underactive/pi-topping/main/media/demo_completion_marker.png)

## Settings

Run `/topping-settings` (TUI only) to customize your toppings. Settings persist to
`~/.pi/agent/pi-topping/settings.json`; hand edits are tolerated on load.

```
╔═[ Pi Topping: Settings ]═══════════════════════════════════╗
╟─ Preview ──────────────────────────────────────────────────╢
║                                                            ║
║ ⠋ Crafting… ⣠⣤⣶⣶⣤⣠⣀⢀ 28 tok/s · 3s · ↓ 84 tokens          ║
║                                                            ║
╟─ User Prompt ──────────────────────────────────────────────╢
║    [■] High-vis prompt                                ON   ║
║    [■] Border style                             ‹ double › ║
║    [■] Border color                       ‹ borderAccent › ║
║    [■] Pi icon                                        ON   ║
║    [■] Timestamp                                      ON   ║
║    [■] Provider                                       ON   ║
║    [■] Model                                          ON   ║
║                                                            ║
╟─ “Working” Loader ─────────────────────────────────────────╢
║    [■] Animated spinner                               ON   ║
║  ❯ [■] Animated spinner color                   ‹ accent › ║
║    [■] Randomize “Working” text                       ON   ║
║    [■] Text shimmer                                   ON   ║
║    [■] Invert shimmer                                OFF   ║
║    [■] Text shimmer direction            ‹ Left to Right › ║
║    [■] Text shimmer speed                       ‹ Normal › ║
║    [■] Token activity monitor                         ON   ║
║    [■] Token activity monitor color             ‹ accent › ║
║    [■] Token activity monitor direction  ‹ Right to Left › ║
║    [■] Token activity monitor dimmed                 OFF   ║
║    [■] Elapsed time since prompt                      ON   ║
║    [■] Show output tokens                             ON   ║
║    [■] Token rate                                     ON   ║
║    [■] Token rate color                        ‹ warning › ║
║    [■] Token rate dimmed                             OFF   ║
║                                                            ║
╟─ Elements Order ───────────────────────────────────────────╢
║    [ ] Animated spinner                                    ║
║    [ ] “Working” text                                      ║
║    [ ] Token activity monitor                              ║
║    [ ] Token rate                                          ║
║    [ ] Elapsed time                                        ║
║    [ ] Output tokens                                       ║
║                                                            ║
╟─ Completion Marker ────────────────────────────────────────╢
║    [■] Show completion marker                         ON   ║
║    [■] Border style                               ‹ none › ║
║    [■] Border color                       ‹ borderAccent › ║
║    [■] Pi icon                                        ON   ║
║    [■] Randomize “Worked” text                        ON   ║
║    [■] Tokens spent                                   ON   ║
║    [■] Mid-turn inputs                                ON   ║
║                                                            ║
╟─ Word Packs ───────────────────────────────────────────────╢
║    [ ] SimCity                                       OFF   ║
║    [ ] Star Trek                                     OFF   ║
║    [ ] Star Wars                                     OFF   ║
║                                                            ║
╟─ Options ──────────────────────────────────────────────────╢
║    [■] Use NerdFont icons                             ON   ║
╟────────────────────────────────────────────────────────────╢
║  ↑↓ move  ←→ select  ␣ toggle  ⏎ apply  esc cancel         ║
╚════════════════════════════════════════════════════[ 9/39 ]╝
```

### Word packs

Base activity words are always available. All word packs, including the shipped **SimCity**, **Star Trek**, and **Star Wars** packs and custom packs, are disabled by default. Enable packs in `/topping-settings` to add their entries to the same uniformly selected pool. When Randomize “Worked” text is on, the completion marker uses the selected entry’s matching past tense; otherwise it uses `Worked`.

Bundled packs live in [`wordpacks/`](wordpacks/). Copy `wordpacks/simcity.json`, `wordpacks/star-trek.json`, or `wordpacks/star-wars.json` to `~/.pi/agent/pi-topping/word-packs.json`, then change the pack `id` (the bundled `simcity`, `star-trek`, and `star-wars` IDs are reserved), name, and words:

```json
{
  "packs": [{
    "id": "cooking",
    "name": "Cooking",
    "words": [{ "present_tense": "Sautéing onions", "past_tense": "Sautéed" }]
  }]
}
```

Pack IDs must start with a lowercase letter and contain only lowercase letters, digits, and `-`. Each pack needs a non-empty `name` and at least one word with non-empty `present_tense` and `past_tense` strings. Invalid entries are ignored. Packs reload when a session starts and whenever `/topping-settings` opens, not while a turn is running. Preferences for missing packs are retained so they apply when the pack returns.

Under **Elements Order**, press `␣` to grab a row, then `↑`/`↓` to slide that element
left or right within the loader. Elapsed time, output tokens, and token rate are joined with
`·` separators whenever adjacent. When reordering separates them, each adjacent run is rendered
without a separator before or after it.

The `N tok/s` token rate uses the selected theme color and
remains reorderable. Active rates below 1,000 are padded to three characters so updates do not shift the other
segments; larger rates may shift later segments. When inactive, it remains as the dim `--- tok/s` placeholder. After its last update it holds
full brightness for 1.5 seconds, then fades through five theme-aware shades to the dim text color over
the next 0.25 seconds before returning to the placeholder; a new count restores full brightness and
restarts the cycle.

## Sibling Toppings

Run `/topping-setup` (TUI only) to install any missing Pi Topping sibling extensions:

- `@underactive/pi-topping-statusline`
- `@underactive/pi-topping-splash`
- `@underactive/pi-topping-persona-audit`
- `@underactive/pi-topping-web-tools`

The setup menu selects every missing topping by default, but you can toggle individual extensions before installing. Pi Topping confirms toppings through their active extension commands and otherwise checks its agent settings and checkout directories. After a successful install, restart Pi to activate the new extension. A one-time session-start warning shows this menu's command whenever toppings are missing. Run `/topping-setup disable-side-toppings-check` to suppress that warning; use `/topping-setup enable-side-toppings-check` to show it again.

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

Tests cover the word/shimmer rendering, prompt box and completion marker rendering, activity meter behavior, timer resets, settings persistence, the `menu.ts` component, and the settings menu wiring end to end.

## Limitations

- Token counts are a streaming word-count estimate, not an exact tokenizer count — they self-correct when each message finishes, so you'll see a small jump at that point.
- Elapsed time normally starts when you submit a prompt; for auto-continuations without that event, it starts slightly later instead.
- If another extension also customizes the working message, whichever one runs last wins.

## Author

Eric Sison
