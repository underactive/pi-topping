# pi-topping

We garnish our pies. It seemed rude not to extend Pi the same courtesy. This is a [Pi](https://github.com/earendil-works/pi-coding-agent) extension that adds some quality of life improvements to Pi's UX, while looking good in the process:

**User Prompt** — high-vis bordered prompt box with configurable border color and style, pi icon toggle, timestamp, and provider/model label. The box, timestamp, and provider/model label are display-only; Pi sends your prompt text unchanged to the model, so they do not affect LLM prompt caching. Prompts submitted while Pi is working (steer / `Alt+Enter` follow-up) are left undecorated so Pi's native `Steering:` / `Follow-up:` queue rows still render.

![Example of pi-topping's decorated user prompt](https://raw.githubusercontent.com/underactive/pi-topping/main/media/demo_user_prompt.png)

**“Working” Loader** — animated spinner (with color choice), randomized activity word, optional word packs, shimmer, token activity monitor with an adjustable full-scale rate, elapsed timer, output token display, live output-token rate, and the response model when it meaningfully differs from the selected model — all arrangeable left to right. For raw Responses-API stream events, it can also include Ramp Router's gateway backend as `<model> via <backend>`, or just `via <backend>` when the served model restates the selection. Under a Pi virtual model such as pi-topping-routesense's `routesense/auto`, the response model is the routed physical model. During a blocking extension prompt, the loader switches to a stable dim waiting line with a pulsing indicator, then resumes afterward.

![Demo of pi-topping's shimmering activity word, scrolling activity meter, elapsed timer, token count, and token rate](https://raw.githubusercontent.com/underactive/pi-topping/main/media/demo.gif)

**Completion Marker** — end-of-turn marker with icon, randomized verb (or `Worked`; matching past tense when Randomize "Worked" text is on), token consumption display, and optional marker-style, border-style, and border-color decorations spanning the full terminal width. It can append the response model when it differs from the selected model, with its own color option. It can also append per-call service-tier counts (e.g. `flex tier ×3`), but only for calls whose provider reports a tier. The default `elite` style trails the summary with tapering dashes; `bookend` fills the remaining width to a closing corner glyph. Hooks into Pi's `agent_settled` event. A cancelled run (for example, one stopped with Escape) shows `Interrupted` instead of the random verb, with the word and any border in the warning color; time, tokens, and other enabled details still appear. **Show completion marker** also controls this marker.

![Example of pi-topping's completion marker](https://raw.githubusercontent.com/underactive/pi-topping/main/media/demo_completion_marker.png)

**Output Styles** — choose prompt-instruction styles such as Explanatory or Simplified Technical English to guide how the model responds. Styles are instructions, not output formatters.

## Install

```bash
pi install npm:@underactive/pi-topping
```

Restart Pi (or run `/reload`) to pick it up.

### Sibling toppings

Run `/topping-setup` in TUI mode to selectively install missing Pi Topping sibling extensions or uninstall sibling packages recorded in Pi's user settings. Installation rows are selected by default; removal rows are unchecked by default. Restart Pi after applying package changes. Use `/topping-setup disable-side-toppings-check` to suppress missing-topping notices, or `enable-side-toppings-check` to restore them.

## Settings

Run `/topping-settings` (TUI only) to customize your toppings. Settings persist to
`~/.pi/agent/pi-topping/settings.json`; hand edits are tolerated on load.

```
╔═[ Pi Topping: Settings ]══════════════════════════════════════╗
╟─ Preview ─────────────────────────────────────────────────────╢
║                                                               ║
║ ⠋ Crafting ⣠⣤⣶⣶⣤⣠⣀⢀ 28 tps · 3s · ↓ 84 tokens · test-model   ║
║                                                               ║
╟─ User Prompt ─────────────────────────────────────────────────╢
║    [■] High-vis prompt                                ON      ║
║    [■] Border style                             ‹ double ›    ║
║    [■] Border color                      ‹ thinkingLevel ›    ║
║    [■] Pi icon                                        ON      ║
║    [■] Timestamp                                      ON      ║
║    [■] Provider                                       ON      ║
║    [■] Model                                          ON      ║
║                                                               ║
╟─ “Working” Loader ────────────────────────────────────────────╢
║    [■] Animated spinner                               ON      ║
║  ❯ [■] Animated spinner color            ‹ thinkingLevel ›    ║
║    [■] Randomize “Working” text                       ON      ║
║    [■] Text shimmer                                   ON      ║
║    [■] Invert shimmer                                OFF      ║
║    [■] Text shimmer direction            ‹ Left to Right ›    ║
║    [■] Text shimmer speed                       ‹ Normal ›    ║
║    [■] Token activity monitor                         ON      ║
║    [■] Token activity monitor color             ‹ accent ›    ║
║    [■] Token activity monitor direction  ‹ Right to Left ›    ║
║    [■] Token activity monitor dimmed                 OFF      ║
║    [■] Token activity monitor upper bound       ‹ 80 tps ›    ║
║    [■] Elapsed time since prompt                      ON      ║
║    [■] Show output tokens                             ON      ║
║    [■] Token rate                                     ON      ║
║    [■] Token rate color                        ‹ warning ›    ║
║    [■] Token rate dimmed                             OFF      ║
║    [■] Response model                                 ON      ║
║    [■] Response model color                     ‹ accent ›    ║
║    [■] Response model dimmed                         OFF      ║
║                                                               ║
╟─ Elements Order ──────────────────────────────────────────────╢
║    [ ] Animated spinner                                       ║
║    [ ] “Working” text                                         ║
║    [ ] Token activity monitor                                 ║
║    [ ] Token rate                                             ║
║    [ ] Elapsed time                                           ║
║    [ ] Output tokens                                          ║
║    [ ] Response model                                         ║
║                                                               ║
╟─ Completion Marker ───────────────────────────────────────────╢
║    [■] Show completion marker                         ON      ║
║    [■] Marker style                              ‹ elite ›    ║
║    [■] Border style                               ‹ none ›    ║
║    [■] Border color                      ‹ thinkingLevel ›    ║
║    [■] Pi icon                                        ON      ║
║    [■] Randomize “Worked” text                        ON      ║
║    [■] Tokens spent                                   ON      ║
║    [■] Mid-turn inputs                                ON      ║
║    [■] Service tier                                   ON      ║
║    [■] Response model                                 ON      ║
║    [■] Response model color                      ‹ muted ›    ║
║    [■] Response model dimmed                         OFF      ║
║                                                               ║
╟─ Word Packs ──────────────────────────────────────────────────╢
║    [ ] Doctor Who                                    OFF      ║
║    [ ] Firefly                                       OFF      ║
║    [ ] Hitchhiker's Guide                            OFF      ║
║    [ ] The Lord of the Rings                         OFF      ║
║    [ ] The Matrix                                    OFF      ║
║    [ ] Portal                                        OFF      ║
║    [ ] SimCity                                       OFF      ║
║    [ ] Star Trek                                     OFF      ║
║    [ ] Star Wars                                     OFF      ║
║                                                               ║
║    [■] Include default/random “Working” text          ON      ║
║                                                               ║
╟─ Output Style ────────────────────────────────────────────────╢
║    [■] Style                                   ‹ Default ›    ║
║                                                               ║
╟─ Options ─────────────────────────────────────────────────────╢
║    [■] Use NerdFont icons                             ON      ║
║    [ ] Response model footer                         OFF      ║
╟───────────────────────────────────────────────────────────────╢
║  ↑↓ move  PgUp/PgDn page  ←→ select                           ║
║  ␣ toggle  ⏎ apply  esc cancel                                ║
╚═══════════════════════════════════════════════════════[ 9/59 ]╝
```

### Output styles

Choose an output style with `←`/`→` in the Output Style section of `/topping-settings`. The selected style changes the model's prompt instructions from your next message.
- **Explanatory** requests brief Insight blocks before and after coding. This is a prompt instruction, not a formatter, so a turn may have no Insight.
- **Simplified Technical English** instructs the model to write all English prose (not code or quoted text) using ASD-STE100 Simplified Technical English (controlled language rules, active voice, simple tenses, short sentences, and small noun clusters).

While a non-default style is active, each prompt also carries a one-line hidden reminder of the style; the model receives it, but the transcript does not show it.

Output styles also apply in print and RPC modes. Set `"outputStyle": "explanatory"` (or `"simplified"`) in `~/.pi/agent/pi-topping/settings.json`; if you edit the file while an interactive session is running, use `/reload` to load the change. Switching styles changes one system-prompt section. Pi appends that change to the conversation, so providers that support mid-conversation prompt updates keep their cached prefix; other providers may re-read the full prompt once.

The Explanatory prompt is copied word for word from Claude Code's output styles, with two Pi clarifications: a lead-in that frames the instructions for Pi, and an exception allowing Insight blocks despite Pi's conciseness rule. The Simplified Technical English prompt adapts the ASD-STE100 writing rules but does not include the STE dictionary of approved words. A more specific instruction from you, your project instructions, a skill, or the file being edited takes precedence over it. When migrating from `pi-topping-insights`, its saved style is imported until you next save `/topping-settings`. Remove the old extension to avoid duplicate hidden reminders. `/insights` is gone; use `/topping-settings`.

### Word packs

Base activity words are included by default. All word packs, including the shipped **Doctor Who**, **Firefly**, **Hitchhiker's Guide**, **The Lord of the Rings**, **The Matrix**, **Portal**, **SimCity**, **Star Trek**, and **Star Wars** packs and custom packs, are disabled by default. Enable packs in `/topping-settings` to add their entries to the same uniformly selected pool. With at least one pack enabled, turn off **Include default/random “Working” text** to draw only from enabled packs; with none enabled the option is locked on. When Randomize “Worked” text is on, the completion marker uses the selected entry’s matching past tense; otherwise it uses `Worked`.

Bundled packs live in [`wordpacks/`](wordpacks/). Copy `wordpacks/doctor-who.json`, `wordpacks/firefly.json`, `wordpacks/hitchhikers-guide.json`, `wordpacks/lord-of-the-rings.json`, `wordpacks/matrix.json`, `wordpacks/portal.json`, `wordpacks/simcity.json`, `wordpacks/star-trek.json`, or `wordpacks/star-wars.json` to `~/.pi/agent/pi-topping/word-packs.json`, then change the pack `id` (the bundled `doctor-who`, `firefly`, `hitchhikers-guide`, `lord-of-the-rings`, `matrix`, `portal`, `simcity`, `star-trek`, and `star-wars` IDs are reserved), name, and words:

```json
{
  "packs": [{
    "id": "cooking",
    "name": "Cooking",
    "description": "Kitchen operations.",
    "words": [{ "present_tense": "Sautéing onions", "past_tense": "Sautéed" }]
  }]
}
```

Pack IDs must start with a lowercase letter, contain only lowercase letters, digits, and `-`, and be at most 64 characters. Each pack needs a non-empty `name` and at least one word with non-empty `present_tense` and `past_tense` strings. An optional `description` appears in the settings preview when the pack row is selected, and an optional `attribution` records the source. Invalid entries are ignored. Packs reload when a session starts and whenever `/topping-settings` opens, not while a turn is running. Preferences for missing packs are retained so they apply when the pack returns.

### Colors and loader details

Every color setting offers `thinking-level` (shown as `thinkingLevel` in `/topping-settings`); it is the default for the animated spinner, the prompt border, and the completion marker border. The spinner, token activity monitor, token rate, and response model follow Pi's current thinking level. The prompt border uses the level captured when the prompt was submitted, and the completion marker uses the level captured when the turn settled, so earlier entries keep their color after you change level. When hand-editing `settings.json`, write `thinking-level`; the legacy `default` spelling is only recognised for `spinnerColor` and `doneMarkerBorderColor`.

Under **Elements Order**, press `␣` to grab a row, then `↑`/`↓` to slide that element
left or right within the loader. Elapsed time, output tokens, token rate, and response model are joined with
`·` separators whenever adjacent. When reordering separates them, each adjacent run is rendered
without a separator before or after it.

The `N tps` token rate uses the selected theme color and
remains reorderable. Active rates below 1,000 are padded to three characters so updates do not shift the other
segments; larger rates may shift later segments. When inactive, it remains as the dim `--- tps` placeholder. After its last update it holds
full brightness for 1.5 seconds, then fades through five theme-aware shades to the dim text color over
the next 0.25 seconds before returning to the placeholder; a new count restores full brightness and
restarts the cycle.

The token activity monitor reaches full `⣿` at or above its configurable upper bound (80 tps by default), with lower levels scaled proportionally to that bound. In `/topping-settings`, `←`/`→` cycle through presets spanning 10–1000 tps, and `␣` (Space) lets you enter any whole number from 10–1000. Invalid typed entries show an inline error and keep the editor open without changing the current value; invalid hand-edited `meterUpperBoundTps` values in `settings.json` revert to 80 on load.

The response model is captured from assistant responses and raw Responses-API stream events, displayed as its sanitized value with no label only when it meaningfully differs from the selected model, and defaults to the final loader detail after output tokens. When Ramp Router reports a gateway backend in the raw event, the label can include it as `<model> via <backend>`, or `via <backend>` alone when the served model restates the selection. Under a Pi virtual model such as pi-topping-routesense's `routesense/auto`, it is the routed physical model: taken from the router's `pi-topping-routesense:routed-model` announcement when present, which arrives before the first token (announcements for `direct` routes such as compaction are ignored), and otherwise from the assistant message's model. There only a failed route, which reports the virtual model itself, is hidden, and a bare routed id never displaces a provider-reported decorated form of itself such as a dated name. While pi-topping-statusline embeds the loader in its status bar, the model slides out tail first from behind its separator over 0.3 seconds when it first appears in a run, like that bar's embedded status; elsewhere it appears at once, and a different model replacing it always swaps in place. Equivalent local paths and decorated filenames are suppressed. Its loader display can be hidden, recolored, permanently dimmed, or reordered. The independent **Response model footer** option is disabled by default; when enabled, the final model appears under the editor after settlement, remains visible for 3 seconds, fades through five theme-aware shades over 0.5 seconds, then clears. New work cancels the pending fade. When the active provider is `switchyard`, the loader and footer hold/fade use NVIDIA green (`#84c51a`, matching pi-topping-statusline) regardless of the configured Response model color; the dim setting still applies.

## Requirements

- [Pi](https://github.com/earendil-works/pi-coding-agent) ≥1.2.0. Output styles rely on Pi running the agent-start hook for the run that the decorated prompt starts, which Pi 1.2.0 added. On an older host pi-topping shows a one-time warning at session start, and output styles do not reach decorated prompts.
- The working indicator is embedded in the default editor border and long loaders are truncated to the border width instead of wrapping; custom editors that do not opt in keep the standalone wrapping indicator.
- Node.js ≥22.19.0

## Development

```bash
npm install
npm test
npm run typecheck
```

Tests cover the word/shimmer rendering, prompt box and completion marker rendering, activity meter behavior and its configurable upper bound, timer resets, settings persistence and schema migrations, word-pack parsing, loading, and default-text selection, output-style selection and prompt integration, response-model loader and footer behavior, served-model and service-tier extraction, the `menu.ts` component and its typed number entry, the settings menu wiring end to end, and the `/topping-setup` command's install and uninstall flows.

## Limitations

- Token counts are a streaming word-count estimate, not an exact tokenizer count — they self-correct when each message finishes, so you'll see a small jump at that point.
- Elapsed time normally starts when you submit a prompt; for auto-continuations without that event, it starts slightly later instead.
- If another extension also customizes the working message, whichever one runs last wins.
- Service-tier details and Responses-API served-model/backend labels depend on Pi's `provider_stream_event`; SDK adapters that do not expose raw events show neither.

## Author

Eric Sison
