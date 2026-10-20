# Handoff: shared packages for the pi-topping family

Written 2026-10-17 after a 15-lane evaluation of every `pi-topping*` repo under `~/Development/projects/pi`. This document is the execution plan. It is self-contained, but every claim below has line-level evidence in the reports listed in section 2, and the executor should open the relevant report before touching a repo.

## 1. Decision

Build two packages and migrate the family onto them in phases.

| Package | Role | Installed as |
| --- | --- | --- |
| `@underactive/pi-topping-primitives` | Runtime library: typed contracts, settings store, activity meter maths and renderers, settings menu, model picker, colour and text helpers, process helpers | `dependencies` entry in each topping |
| `@underactive/pi-topping-test-utils` | Fake ExtensionAPI, context, TUI and theme; key table; agent-dir sandbox; message and model fixtures; hermetic git; ship-manifest check | `devDependencies` entry only; must never reach a user's `~/.pi` |

Neither package is a pi extension. Neither has a `pi` field in `package.json`. Both READMEs open with "library, not an extension".

Hard rules for the runtime package:

- Ships TypeScript source as the runtime entry and compiled output for tests (section 3). Never ship compiled JavaScript as the runtime entry.
- Zero runtime `dependencies`. `@earendil-works/pi-coding-agent`, `@earendil-works/pi-tui`, `@earendil-works/pi-ai` are `peerDependencies` at `"*"`, matching every topping.
- No module-level mutable state and no `instanceof` across package boundaries, so two versions loaded in one pi process are harmless.
- Tabs. `.js` suffix on relative imports inside the package. Code must pass `erasableSyntaxOnly`, `verbatimModuleSyntax`, `noUncheckedIndexedAccess`, `strict`.
- The `contracts` subpath is additive-only forever: names are immutable, payloads append-only, parsers ignore unknown fields.

## 2. Evidence and prior work

Reports from the evaluation (11 per-repo inventories, 4 cross-cutting reviews):

```
~/.pi/agent/sessions/--Users-esison-Development-projects-pi-pi-topping--/subagent-artifacts/outputs/dbce4ee8-6773-4078-bf4a-99b6c51aca2c/primitives-eval/
  inventory-<repo>.md            one per repo: profile, shareable candidates, settings, contracts, utilities, verdict
  xcut-contracts-pickers-spawn.md  contract registry, three live defects, model pickers, pi spawning
  xcut-settings-store-menu.md      store and menu comparison tables, proposed APIs, per-repo migration and test moves
  xcut-activity-working-ux.md      feature matrix for the five meter copies, proposed API, per-repo notes
  xcut-theme-utils-testdoubles.md  colour/text duplicates, pi-tui overlap, test-double inventory
```

A durable copy of all fifteen reports was made on 2026-10-17 at `.pi/primitives-eval/` in the pi-topping checkout (same file names). Use that copy; the session artifact directory above is subject to retention pruning.

Memory notes for future sessions (in the Claude memory dir for this project): `pi-topping-primitives-evaluation.md` (outcome and lineage map) and `pi-topping-shared-dep-loading.md` (loader experiments and the packaging recipe).

Repos in scope, with the state observed on 2026-10-17:

| Repo | Version | pi devDependency pin | Remote | Notes |
| --- | --- | --- | --- | --- |
| pi-topping | 0.12.0 | 1.3.0 | github.com/underactive | umbrella; clean on `main` at `066d42a` |
| pi-topping-statusline | 0.2.8 | 1.3.0 | github.com/underactive | `[Unreleased]` changelog pending release |
| pi-topping-splash | 0.5.3 | 1.3.0 | github.com/underactive | |
| pi-topping-persona-audit | 0.3.1 | 1.3.0 | github.com/underactive | |
| pi-topping-moa-fusion | 0.4.5 | 1.3.0 | github.com/underactive | tests are `.mjs` scripts |
| pi-topping-web-tools | 0.2.9 | 1.3.0 | github.com/underactive | only repo with runtime deps |
| pi-topping-routesense | 0.1.0 | 1.3.0 | none | |
| pi-topping-sensei | 0.1.0 | 1.3.0 | none | vitest + biome; had uncommitted edits (CHANGELOG, README, docs, notices, two tests) |
| pi-topping-bash-gate | 0.1.0 | 0.99.1 (1.0.3 installed) | none | |
| pi-topping-compact | 0.1.1 | 1.0.0 (1.0.3 installed, lock says 1.0.0) | none | private |
| pi-topping-insights | 0.1.0 | 1.0.0 | none | private, zero commits; superseded |
| pi-switchyard | 0.1.0 | 0.85.1 | not checked | not prefixed, not inventoried; ancestor of routesense's menu, picker and format helpers; a consumer |

All toppings are loaded in the user's pi through symlinks in `~/.pi/agent/extensions/` pointing at these checkouts, so each checkout's own `node_modules` is what resolves dependencies at runtime.

## 3. Packaging recipe (verified by experiment, do not change without re-verifying)

Four facts, each tested on 2026-10-17 against pi-coding-agent 1.3.0's loader (jiti 2.7.0) on Node 24.18:

1. Pi's loader calls `createJiti(import.meta.url, { moduleCache: false, alias: <pi packages → host copies> })`. A bare dependency whose entry is a `.ts` file is transformed by jiti, so the alias applies and the dependency shares the host's single pi-tui instance. This also holds through the `~/.pi/agent/extensions` symlinks and for `exports` subpaths pointing at `.ts` files.
2. A dependency whose entry is compiled `.js` is imported natively by jiti whenever the extension's `node_modules` can resolve `@earendil-works/pi-tui`, which is every dev checkout. The dependency then gets the checkout's devDependency copy of pi-tui while the extension gets the host's copy. Identity check `hostTui.visibleWidth === depTui.visibleWidth` returned `false`. Under `pi install npm:` the peers are absent and jiti falls back to transform, so behaviour would differ between dev and installed. This is why compiled JS cannot be the runtime entry.
3. Plain `node --test` refuses `.ts` files under `node_modules` with `ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING`. Nine repos run tests that way.
4. jiti resolves with the ordinary `node`, `import`, `default` conditions. A custom `"jiti"` condition is ignored (the `"jiti"` string in its bundle is its never-transform module list). So the split must happen on the test side, where Node accepts `-C <condition>`.

Resulting `package.json` shape for the runtime package:

```json
{
	"name": "@underactive/pi-topping-primitives",
	"version": "0.1.0",
	"type": "module",
	"license": "MIT",
	"files": ["src/**/*.ts", "!src/**/*.test.ts", "dist/**", "README.md", "LICENSE", "CHANGELOG.md", "THIRD_PARTY_NOTICES.md"],
	"exports": {
		"./contracts":    { "types": "./dist/contracts/index.d.ts",    "compiled": "./dist/contracts/index.js",    "default": "./src/contracts/index.ts" },
		"./settings":     { "types": "./dist/settings/index.d.ts",     "compiled": "./dist/settings/index.js",     "default": "./src/settings/index.ts" },
		"./activity":     { "types": "./dist/activity/index.d.ts",     "compiled": "./dist/activity/index.js",     "default": "./src/activity/index.ts" },
		"./activity-tui": { "types": "./dist/activity-tui/index.d.ts", "compiled": "./dist/activity-tui/index.js", "default": "./src/activity-tui/index.ts" },
		"./menu":         { "types": "./dist/menu/index.d.ts",         "compiled": "./dist/menu/index.js",         "default": "./src/menu/index.ts" },
		"./models":       { "types": "./dist/models/index.d.ts",       "compiled": "./dist/models/index.js",       "default": "./src/models/index.ts" },
		"./color":        { "types": "./dist/color/index.d.ts",        "compiled": "./dist/color/index.js",        "default": "./src/color/index.ts" },
		"./text":         { "types": "./dist/text/index.d.ts",         "compiled": "./dist/text/index.js",         "default": "./src/text/index.ts" },
		"./glyphs":       { "types": "./dist/glyphs/index.d.ts",       "compiled": "./dist/glyphs/index.js",       "default": "./src/glyphs/index.ts" },
		"./process":      { "types": "./dist/process/index.d.ts",      "compiled": "./dist/process/index.js",      "default": "./src/process/index.ts" }
	},
	"peerDependencies": {
		"@earendil-works/pi-ai": "*",
		"@earendil-works/pi-coding-agent": "*",
		"@earendil-works/pi-tui": "*"
	},
	"devDependencies": {
		"@earendil-works/pi-ai": "1.3.0",
		"@earendil-works/pi-coding-agent": "1.3.0",
		"@earendil-works/pi-tui": "1.3.0",
		"@types/node": "^24.0.0",
		"typescript": "^5.9.3"
	},
	"scripts": {
		"build": "tsc -p tsconfig.build.json",
		"typecheck": "tsc --noEmit",
		"test": "node --test tests/*.test.ts && npm run build && node -C compiled --test tests/exports/*.test.ts",
		"prepack": "npm run build"
	},
	"engines": { "node": ">=22.19.0" }
}
```

Notes on that shape:

- No root `"."` export is needed. Subpaths keep jiti from transpiling menu code for a topping that only wants contracts.
- `dist/` is not committed. `prepack` builds it for publishing. For the user's symlinked dev checkouts, run `npm run build` in the package after changes, or the `compiled` condition will be stale in consumers' tests. Add a CI job that builds and runs `tests/exports/*.test.ts` under `-C compiled` through package self-reference (`import ... from "@underactive/pi-topping-primitives/contracts"`), which proves the exports map, the compiled output, and the declarations all agree.
- `tsconfig.json` (typecheck): `module` and `moduleResolution` `NodeNext`, `target` `ES2022`, `strict`, `noEmit`, `erasableSyntaxOnly`, `verbatimModuleSyntax`, `noUncheckedIndexedAccess`. `tsconfig.build.json` extends it with `noEmit: false`, `declaration: true`, `outDir: dist`, `rootDir: src`, and excludes tests.
- Relative imports inside `src/` use the `.js` suffix. Reason: consumers whose tsconfig lacks `allowImportingTsExtensions` (sensei, statusline's source) would fail TS5097 if `.ts`-suffixed package source ever entered their program, and jiti resolves `.js` specifiers to `.ts` files (statusline already ships that way and loads in pi).
- Consumers typecheck against `dist/*.d.ts` through the `types` condition, so their own strict flags do not apply to package source.

Re-verification script, if the loader or Node changes. It builds a fake dependency with both forms and checks which one each path picks:

```sh
PT=~/Development/projects/pi/pi-topping
T=$(mktemp -d); P="$T/ext/node_modules/@underactive/fake-prim"; mkdir -p "$P/src" "$P/dist" "$T/ext/tests"
ln -s "$PT/node_modules/@earendil-works" "$T/ext/node_modules/@earendil-works"
cat > "$P/package.json" <<'EOF'
{ "name": "@underactive/fake-prim", "type": "module",
  "exports": { ".": { "types": "./dist/index.d.ts", "compiled": "./dist/index.js", "default": "./src/index.ts" } } }
EOF
printf 'import * as tui from "@earendil-works/pi-tui";\nexport const form = "ts-source"; export const depTui = tui;\n' > "$P/src/index.ts"
printf 'import * as tui from "@earendil-works/pi-tui";\nexport const form = "compiled-js"; export const depTui = tui;\n' > "$P/dist/index.js"
printf 'export declare const form: string;\n' > "$P/dist/index.d.ts"
printf 'import * as host from "@earendil-works/pi-tui";\nimport { form, depTui } from "@underactive/fake-prim";\nexport const r = { form, same: host.visibleWidth === depTui.visibleWidth };\n' > "$T/ext/index.ts"
printf 'import { test } from "node:test";\nimport { form } from "@underactive/fake-prim";\ntest("x", () => console.log("TEST FORM:", form));\n' > "$T/ext/tests/dep.test.ts"
# Expect: jiti -> {"form":"ts-source","same":true}
( cd "$PT" && node --input-type=module -e "
import { createJiti } from './node_modules/@earendil-works/pi-coding-agent/node_modules/jiti/lib/jiti.mjs';
const alias = { '@earendil-works/pi-tui': '$HOME/Development/projects/pi/pi-topping-statusline/node_modules/@earendil-works/pi-tui/dist/index.js' };
const jiti = createJiti(import.meta.url, { moduleCache: false, alias });
console.log('jiti ->', JSON.stringify((await jiti.import('$T/ext/index.ts')).r));" )
# Expect: ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING
( cd "$T/ext" && node --test tests/dep.test.ts 2>&1 | grep -m1 -E "TEST FORM|ERR_" )
# Expect: TEST FORM: compiled-js
( cd "$T/ext" && node -C compiled --test tests/dep.test.ts 2>&1 | grep -m1 "TEST FORM" )
rm -rf "$T"
```

The alias deliberately points at a different physical copy of pi-tui (statusline's checkout) than the one the fake dependency can resolve natively (pi-topping's), which is what exposes the duplicate-instance hazard.

## 4. Package contents and sources of truth

Each row names the file to start from. "Base" means copy it nearly verbatim; "merge" means add the listed features from the other copies.

### 4.1 `contracts` (phase 1)

| Export | Source of truth |
| --- | --- |
| `CHANNELS.routedModel = "pi-topping-routesense:routed-model"`, `RoutedModelAnnouncementV1` payload type | pi-topping-routesense `src/decision.ts:166-188` |
| `CHANNELS.workingStatusEmbedded = "pi-topping-statusline:working-status-embedded"`, `{ embedded: boolean }` | pi-topping-statusline `src/working-status-embed.ts:8`; pi-topping `src/statusline-embed.ts` |
| `ENTRY_TYPES.compactSavings = "pi-topping-compact/savings"`, `compactCompactionSavings`, `compactCompaction` with payload types | pi-topping-compact `src/monitor.ts:38-63` |
| `ENTRY_TYPES.browser = "pi-topping-web-tools/browser"`, `{ label, open }` | pi-topping-web-tools `src/web-browser/feeds.ts:3-8` |
| `ENTRY_TYPES.splashLocalChanges = "pi-topping-splash:local-changes"` | pi-topping-splash `src/local-changes.ts:23` |
| `parseRoutedModel(data: unknown)` | merge pi-topping `src/routesense-feed.ts:44-52` (sanitising) and pi-topping-sensei `src/core/response-model.ts:86-101` (keeps `thinkingLevel`); validate `version === 1`, ignore unknown fields |
| `parseEmbeddedAnnouncement(data: unknown)` | pi-topping `src/statusline-embed.ts`; pi-topping-compact `src/statusline-embed.ts:57` |
| `emit(events, channel, payload)` and `subscribe(events, channel, handler): () => void` typed over a `ChannelPayloads` map | new; `events` is `pi.events` typed structurally as `{ on, emit }` |
| `PI_VIRTUAL_MODEL_API = "pi-virtual"` | hard-coded today in pi-topping `src/session.ts:85`, routesense `src/catalog.ts:13`, persona-audit `src/agentRunner.ts:128`, moa-fusion `src/moa/modelRuntime.ts:16`, sensei `src/core/response-model.ts:25` |
| `WORKING_STATUS_SLIDE_MS = 300` | pi-topping `src/format.ts:109`; statusline `src/working-status.ts:7` (both say they must match) |

This module imports nothing from pi at runtime; type-only imports are allowed.

### 4.2 `settings` (phase 2)

Base: pi-topping-routesense `src/settings/store.ts` (atomic write, locked `update`, refuse-on-corrupt, `mtimeMs:size:ino` stamp, injectable `SettingsStore` interface) plus `src/file-lock.ts` (mkdir lock, pid liveness, stale takeover). Merge:

- `atomicWriteFile` with `wx` and unique tmp name and unlink on failure: pi-topping `src/settings.ts:423-438`. File mode 0600, dir 0700: routesense, statusline.
- `preserveUnknownKeys` option: pi-topping-sensei `src/settings/store.ts:36-45`.
- `pathEnv` and `maxBytes` options: pi-topping-web-tools `src/tool-exposure.ts:24-61`.
- `version: { key, current, backupBelow }` option: pi-topping `schemaVersion` ladder and routesense `config.v1.json` backup.
- `onDiagnostic` sink instead of console output (several repos note console output corrupts the TUI).
- `cached()` with stamp-based re-read and `onChange`: routesense `runtime.ts:151-160` pattern.
- `sanitize` helpers (`isRecord`, `booleanOr`, `numberOr` with bounds, `enumOr`, `stringList`, `onOff`): routesense `src/settings/codec.ts:80-114`; splash `src/preferences.ts` for `on`/`off` strings.
- `toppingSettingsPath(packageName, file = "settings.json")` returning a function, resolved per call (statusline's module-constant path at `src/settings.ts:22` is a known bug this fixes).
- `memorySettingsStore(initial)` for tests and injection (bash-gate, insights, routesense already inject).

Full proposed signatures are in `xcut-settings-store-menu.md` section 3a.

### 4.3 `activity` and `activity-tui` (phase 3)

`activity` imports nothing from pi at runtime. Base: pi-topping `src/activity-meter.ts` (tunable upper bound, `tokenRate` getter). Merge:

- `levels()` / `setLevels()` snapshot: persona-audit `src/activityMeter.ts:128-140`.
- `StreamingWordCounter`: pi-topping `src/format.ts:278-314` (identical in moa-fusion, persona-audit, statusline `src/token-rate.ts:29-66`).
- `OutputTokenAccount` (confirmed plus live tokens, revision bump, optional partial with exact usage): moa-fusion `src/runtime/activityTracking.ts:53-93` plus persona-audit `src/subprocess.ts:252-295`.
- `RateHoldFade` (hold, fade, shade count, sample interval as options): pi-topping `src/session.ts:806-848` and statusline `src/token-rate.ts:84-217`, which share the maths and even the comments.
- `RunClock` with `nested` option and `bindUIPromptWaits`: persona-audit `src/runClock.ts`; moa-fusion's depth-counted clock at `src/ui/moaProgressWidget.ts:273-277,368-395` is the `nested: true` case.
- `easeFade`, `fadeShade`, `slideOutTail`, `formatElapsedUnits` ("4m 46s"), `formatElapsedClock` ("4:46").
- Constants: `ACTIVITY_METER_WIDTH = 8`, `DEFAULT_METER_UPPER_BOUND_TPS = 80`, `LEGACY_METER_UPPER_BOUND_TPS = 40`, bounds 10 and 1000.

`activity-tui` (type-only pi imports, plus `stripTerminalSequences` from pi-tui):

- `dimAttribute`, `colorizeMeterCell(level, glyph, theme, colorize, dimmed)`, `renderMeter`, `renderIdleMeter`: pi-topping `src/activity-meter.ts:136-146`, `src/format.ts:95-97`; `colorize` accepts a `ThemeColor` string or a closure so both the widgets' thinking-colour map and pi-topping's `getThinkingBorderColor` path work.
- `thinkingLevelThemeColor`, `thinkingLevelColorizer`: moa-fusion `src/ui/moaProgressWidget.ts:152-162`; persona-audit `src/modelConfig.ts:47-66`; pi-topping `src/format.ts:22-31`.
- `shimmerString`, `ansiToRgb` (unanchored, pi-topping's variant), `fadeThemeColorString`: pi-topping `src/format.ts:128-144,209-268`.
- `formatToolActivity` (with `stripTerminalSequences`) and `highlightActivity`: moa-fusion `src/runtime/activityTracking.ts:11-38`, `src/ui/toolActivity.ts`.

Sensei's `src/ui/meter.ts` documents three deliberate deltas (newest cell on the right by default, non-finite rate reads idle, elapsed drops the day unit). Expose each as an option or sensei will not adopt the shared meter.

### 4.4 `menu` (phase 4, lineage A only)

Base: pi-topping-routesense `src/ui/menu.ts` (1081 lines; hint pane, validator, disabled and hidden rows, async actions with busy marker, rebuild preserving values by id, action bar, preview with refresh, pure helpers `flattenSections`, `rebuildMenu`, `moveCursor`). Merge:

- `number` item with preset snapping and typed editor: pi-topping `src/menu.ts:50,352-380`; bash-gate `src/menu.ts:255` has the correct below-lowest-preset wrap.
- `reorder` rows: pi-topping `src/menu.ts:57,312-333`.
- `spacerBefore`, `disabledUnlessAnyOf`: pi-topping.
- `pick` rows, `clearValue`, `initialCursor`, button bar semantics: splash `src/menu.ts:42,48,70,150-201`. Replace splash's close-and-reopen dance with an `onPick` hook that suspends input while the host runs its own picker.
- Selected-row background re-opened after embedded resets: statusline `src/menu.ts:590`.
- Item kinds as a discriminated union (`kind: "toggle" | "cycle" | "number" | "text" | "action" | "pick" | "reorder"`), `cycle.labels` as a `Record` (pi-topping) not an index-aligned array (routesense).
- Keys resolved through `KeybindingsManager` with `DEFAULT_MENU_KEYBINDINGS` matching today's physical keys, following the pattern in routesense `src/keybindings.ts`. Every current menu ignores the manager that `ctx.ui.custom` hands it.
- `snapshot()` accessor so tests stop poking private fields (statusline `src/tests/menu.test.ts:73-105` does).
- Exported `chrome` helpers (top border, section divider, separator, content row, bottom border) for domain editors that want the frame without the menu.

Lineage B (moa-fusion `src/ui/menu.ts`, persona-audit `src/components/menuChrome.ts`) stays local in this plan. Its items are callback-driven and mutated in place; an adapter can follow once lineage A is unified.

Full proposed signatures are in `xcut-settings-store-menu.md` section 3b.

### 4.5 `models` (phase 5)

| Export | Source of truth |
| --- | --- |
| `ModelRef`, `THINKING_LEVELS`, `isThinkingLevel`, `isModelRef`, `modelRefLabel`, `parseRef`, `shortModelName`, `parseModelKey`, `composeModelKey` | moa-fusion `src/shared/modelRefs.ts`; sensei `src/core/model-ref.ts` |
| `getModelCatalogue(registry)` WeakMap-cached, `validateSavedChoice` | persona-audit `src/modelCatalogue.ts` (superset of moa-fusion `src/config/modelCatalogue.ts`) |
| `thinkingOptionsForModel`, `defaultThinkingForModel(key, overrides, current, levels)` | persona-audit `src/modelConfig.ts:308-325` (general signature); splash `COMMON_THINKING_LEVELS` fallback as an option |
| `TwoPaneModelThinking` component with injectable `requestRender`, `filter`, `levelOptions`, `listFactory` or theme, `backKeys`, `maxVisibleRows`, `printable` | moa-fusion `src/ui/twoPaneModelThinking.ts` (origin); splash `src/model-picker.ts` (render-pure, `fuzzyRanked`, `isPrintableInput` from `src/gate-ui.ts`); persona-audit `src/components/ModelPicker.ts` (`ConsistentSelectList`, Ctrl+C as back); routesense `src/ui/model-picker.ts` (`INHERITED_THINKING`, `decodeKittyPrintable`) |
| `smartTruncateModelLabel` | moa-fusion `src/ui/modelLabel.ts` |

Frames and overlays around the picker stay in each repo. Multi-slot composites (MoA slots, audit phases, opinion and debate pickers) stay local.

### 4.6 `color`, `text`, `glyphs` (phase 6)

Before moving anything, delete duplicates that pi-tui already exports at every pinned version: `parseColor`, `colorToHex`, `mixColors`, `foregroundAnsi`, `backgroundAnsi`, `getTerminalColorMode`, `TerminalColorMode`, `stripTerminalSequences`, `okhslColor`. Compact's colour-mode detection via `getCapabilities().trueColor` should become `getTerminalColorMode()`.

Then share what pi-tui lacks:

| Export | Source of truth |
| --- | --- |
| Tuple `Rgb`, `parseHex` (validated), `mixRgb`, `rgbTo256`, `xterm256ToRgb`, `rgbToFgAnsi(rgb, mode)`, `hexToFgAnsi`, `ansiToRgb` covering 38/48 truecolor, 256 and 39 | statusline `src/theme.ts:232-316`; compact `src/progress-bar.ts:26-57` |
| `hslToRgb`, `hsvToRgb`, `wrapDeg` | statusline `src/rainbow.ts:33,53-65`; splash `src/color.ts:36-49` |
| `easeRaisedCosine`, `cosineFalloff`, `FADE_SHADE_COUNT`, `fadeRgbToward`, `shimmerCell` | statusline `src/theme.ts:259-262,383-403`; pi-topping `src/format.ts`; splash `src/reveal.ts:84-91` |
| Palette: `SWITCHYARD_PROVIDER`, `NVIDIA_GREEN_HEX`, `NVIDIA_GREEN_DARK_HEX`, `isSwitchyardProvider`, `SYNTHWAVE_GREENS` | statusline `src/nvidia-green.ts:5-11`; pi-topping `src/nvidia-green.ts`; compact `src/progress-bar.ts:18-21` |
| `renderCometBar(percent, { mode, elapsedMs, palette })`, `BAR_CELLS = 20`, filled and trough glyphs | compact `src/progress-bar.ts` (self-contained); statusline `src/compaction-bar.ts`, `src/context-graph.ts:10-12` |
| `stripSgr`, `dimAttribute`, `ELLIPSIS` | statusline `src/footer.ts:5-9`; pi-topping `src/format.ts:105-107` |
| Named sanitisers: `stripControlChars` (Cc and Cf), `sanitizedText`, `sanitizeTerminalBytes`, `sanitizeLabel` | pi-topping `src/util.ts:7-13`; persona-audit `src/components/AuditProgress.ts:697-704`; statusline `src/utils.ts:67-80` |
| `padRight`, `padCenter`, `fitCell` (fg-only close), `truncateVisible`, `pickFitting`, `joinParts`, `wrapCommaDelimited` | splash `src/text.ts` |
| `formatClock`, `formatDurationCompact`, `formatElapsedUnits`, `formatCostUsd`, `formatPercent`, `formatCount` | persona-audit and moa-fusion pair; routesense `src/format.ts`; pi-topping `src/format.ts` |
| `isPlainObject`, `hostBelow`, `isTruthyEnvFlag`, `suppressNotifications` | pi-topping `src/util.ts`; compact `src/config.ts:19-27`; web-tools `src/env.ts` |
| `acquireDirLock` family (also used by `settings`), `combineSignals`, `raceAbort`, `createDeadline`, `stableStringify` | routesense `src/file-lock.ts`; web-tools `src/abort-utils.ts`; sensei `src/core/abort.ts`, `src/review/deadline.ts`, `src/core/stable-json.ts` |
| `BoxGlyphs`, `BOX_STYLES`, `SPINNER_FRAMES`, `SPINNER_FRAME_MS`, braille and quadrant spinner sets | statusline `src/theme.ts:17-24,155-164`; pi-topping `src/format.ts:5-8`; moa-fusion `src/ui/chrome.ts` |

Token formatting has five incompatible output styles. Either expose `formatTokens(count, style)` with named styles or leave it out until the repos agree. Do not silently pick one.

Licensing: sensei's `abort.ts`, `stable-json.ts`, `terminal-controls.ts` carry MIT attribution to pi-advisor in `THIRD_PARTY_NOTICES.md`. The notice moves with the code.

### 4.7 `process` (phase 7)

| Export | Source of truth |
| --- | --- |
| `resolvePiInvocation(): { command, args }` | moa-fusion `src/runtime/runner.ts:76-91` (most robust: real argv[1], execPath when not generic node or bun, else `pi` on PATH); replaces pi-topping `src/pi-installer.ts:17-19` and splash `relaunch.ts:63,73` |
| `escalateKill`, `trackedProcesses`, `spawnCollect(command, args, { timeoutMs })` | moa-fusion `src/runtime/processPool.ts:6-14`; pi-topping `src/pi-installer.ts:9-40` |
| `mapWithConcurrencyLimit(items, n, fn, onStart)` | moa-fusion `src/runtime/processPool.ts:39-56` |
| `parsePiVersion`, `versionAtLeast` | moa-fusion `src/runtime/piCapabilities.ts` |
| `loadAgentsFromDir(dir, source, { parseThinking })`, `findNearestProjectAgentsDir` | moa-fusion `src/agents/discovery.ts:29-104`; persona-audit `src/subprocess.ts:33-99` (layering policy and the `persona-audit-*` shadow guard stay local) |

The two sub-run transports (persona-audit's in-process `agentRunner.ts`, moa-fusion's subprocess `runner.ts` plus `wire.ts`) stay local by design.

### 4.8 `@underactive/pi-topping-test-utils` (alongside every phase)

Seed from splash `test/helpers/` (fake-api, fake-ctx, fake-tui, theme, env, git, keys, width, wait, deferred), bash-gate and routesense `test/helpers.ts` (SGR `fakeTheme`, `KEY`, `stripAnsi`, `withAgentDir`, model fixtures), sensei `test/sensei-test-utils/ship-manifest.mts` (`verifyShipManifest`), pi-topping `tests/lifecycle.test.ts:94-162` (`MockExtension` with `events` bus and renderer capture).

Rules: no spy framework (sensei's `vi.fn` doubles are not portable), no timer mocking, assertions through `node:assert/strict`, injectable clocks. The fake theme must give `dim` a colour escape, not SGR 2, because real themes emit a grey colour and the fade code parses it. `ui.custom` needs an option for pi-topping's dispose-on-done semantics versus splash's immediate-resolve semantics.

## 5. Phases

Work one phase at a time. A phase is done when the package and every migrated repo pass `npm run typecheck` and `npm test`, the repo's CHANGELOG records behaviour changes, and a live smoke test (`pi -ne -e ./index.ts --model <id>`, see the memory note `pi-topping-live-smoke-test.md`) shows the extension loading in a real pi.

### Phase 0: package repo

1. Create `~/Development/projects/pi/pi-topping-primitives` as an npm workspace repo with `packages/primitives` and `packages/test-utils`, GitHub `underactive/pi-topping-primitives`. One repo keeps the two packages versioning together.
2. Apply the `package.json` and tsconfig shapes from section 3. Add `.editorconfig` with tabs. Reuse sensei's `biome.json` as the formatter if a formatter is wanted.
3. CI: typecheck, source tests, build, exports tests under `-C compiled`, and `npm pack --dry-run` to prove `files`.
4. Run the re-verification script from section 3 once and record the output in the package README.
5. Decide the consumer dev story and document it: each symlinked checkout needs `npm install` after adding the dependency, and `npm run build` in the primitives checkout is required before consumer tests pass under `-C compiled`. Optionally use `"file:../pi-topping-primitives/packages/primitives"` during development; Node realpaths the symlink out of node_modules, so even plain `node --test` works in that mode.

### Phase 1: contracts and the three defects

1. Implement `contracts` from section 4.1 with tests for both parsers (malformed payloads, unknown fields, wrong version).
2. routesense: emit through `emit(pi.events, CHANNELS.routedModel, …)`; export the payload type from the package, not from `decision.ts`.
3. pi-topping and sensei: subscribe through `subscribe(...)` and delete the local channel strings and parsers (`src/routesense-feed.ts`, `src/statusline-embed.ts`; sensei `src/core/response-model.ts:22,86-101`).
4. statusline: emit `workingStatusEmbedded` through the package; replace the default feed `pi-prompt-cache/savings` at `src/settings.ts:35` with `ENTRY_TYPES.compactSavings`. Decide whether to keep the old name as a second default row for users with the pre-rename extension.
5. compact: delete `src/statusline-embed.ts` and `test/statusline-embed.test.ts`, remove the sink wiring from the controller, publish entries through `ENTRY_TYPES`, and fix README line 58, ONBOARDING 441-495, and the CHANGELOG 0.1.1 text that describe the handshake as live.
6. web-tools and splash: publish entry types through `ENTRY_TYPES`.
7. Replace the five `"pi-virtual"` literals with `PI_VIRTUAL_MODEL_API`.

### Phase 2: settings store

Order: moa-fusion first (its unlocked read-modify-write at roughly eight sites is a live race; replace `saveMoaConfig({ ...loadMoaConfig(), x })` with `update()`), then bash-gate (gains atomic writes; keep its injection point at `index.ts:37`), pi-topping, statusline, splash, persona-audit, routesense (its store becomes the package), web-tools `tool-exposure.ts` (grant store keeps its module and swaps internals), sensei last or not at all.

Do not migrate on-disk paths. Each repo passes its current path. Changing throw semantics to result objects touches "could not save" notifications whose wording is tested in pi-topping, persona-audit, and moa-fusion.

### Phase 3: activity

Order: pi-topping (origin; replaces `src/activity-meter.ts` and the generic half of `src/format.ts`), moa-fusion, persona-audit (`formatToolActivity` gains sanitising, a behaviour fix), sensei (needs the three options), statusline (`token-rate.ts` keeps `attach`, `enable`, `disable`, timer and render diff; delegates maths to `RateHoldFade`). Per-repo edits and the list of tests that move are in `xcut-activity-working-ux.md` section 4. Keep one smoke assertion per host.

### Phase 4: menu, lineage A

Order: bash-gate (smallest, two rows), pi-topping, statusline (rewrite private-field pokes against `snapshot()`), splash (add shared tests for button bar, pick, and clearValue; splash has none), routesense (convert `cycleValueLabels` arrays to Records; its `test/menu.test.ts` becomes the package suite), pi-switchyard after its pin is raised.

### Phase 5: models

Order: moa-fusion, persona-audit, splash, routesense, pi-switchyard.

### Phase 6: colour, text, glyphs

Start with the pi-tui deletions, then the palette and comet bar (compact and statusline), then sanitisers and formatters as each repo is touched for other reasons.

### Phase 6.1: xterm256ToRgb cube correction (0.7.0)

Correct only `cubeLevel` to xterm's colour-cube levels. Keep the gray ramp, indices 0–15 as black, `rgbTo256`, the comet bar, and truecolor-sourced fades unchanged. Rewrite the 24 affected Phase 6 fade fixture rows in place; all other rows stay byte-identical. The primitives fix commit remains at version 0.6.0; a separate release commit moves primitives and test-utils to 0.7.0 and receives a local `v0.7.0` tag. Statusline is the only consumer bumped, and only after the owner publishes; gate it against the packed candidate first, then pause for the publish. Phase 7 (`./process`) follows as 0.8.0.

### Phase 7: process

moa-fusion and persona-audit for the agent discovery and concurrency helpers; pi-topping `pi-installer.ts` and splash `relaunch.ts` for invocation and kill escalation.

### Cleanup, any time after phase 1

- Archive pi-topping-insights. After a grace period drop the migration read in pi-topping `src/settings.ts:172-178`.
- Raise devDependency pins to 1.3.0 in bash-gate, compact, insights (if kept) using the in-place pin recipe in the memory note `pi-topping-family-compat-check.md`. All needed exports were confirmed present at 1.0.3 in those repos' installed node_modules.
- pi-topping `src/toppings.ts` catalogue lists only the five siblings published on npm (statusline, splash, persona-audit, web-tools, moa-fusion). That is correct today: `/topping-setup` installs through `pi install npm:<pkg>`, so an unpublished entry would produce an unactionable notice. When routesense, sensei, or bash-gate are published, add them in the same change. Never add compact (private), insights (retiring), or the primitives package (a library, not an extension).
- compact's `node_modules` (1.0.3) disagrees with its lockfile (1.0.0); reinstall after the pin bump.

## 6. Decisions to confirm with the owner

Recommended defaults in parentheses; the owner can override before the relevant phase.

1. Meter ceiling for widget tables: adopt pi-topping's inclusive 80 tokens per second (yes, for parity; pass `LEGACY_METER_UPPER_BOUND_TPS` where today's look must be kept).
2. Menu defaults: Enter applies when there are no buttons and is inert when there are (yes); cycle rows wrap (yes, four of five forks); up and down clamp (yes, three of five); overlay width 90 percent via `layout.width` (yes); preview receives `innerWidth` and decides its own margin (yes).
3. Settings paths stay as they are (yes).
4. Statusline default savings feed: replace the pre-rename name or add a second default row (replace).
5. Compact keeps its own progress bar after the dead channel is removed (yes; revisit later).
6. Token formatting: named styles or leave out (leave out of the first release).
7. Package repo layout: one repo, two workspace packages (yes).
8. Whether pi-switchyard is migrated in this effort (yes, after phases 4 and 5, with a pin bump first).

## 7. Consumer change checklist (per repo)

1. `package.json`: add `"@underactive/pi-topping-primitives": "^0.1.0"` under `dependencies`. Test-utils goes under `devDependencies`. Do not touch `peerDependencies` or `files`.
2. Test script: `node -C compiled --test …`. moa-fusion's `.mjs` scripts take the same flag. Sensei adds `resolve: { conditions: ["compiled"] }` to `vitest.config.mts`. Statusline keeps `--import ./src/tests/ts-resolve.ts`; that hook only rewrites relative `.js` specifiers.
3. `npm install` in the checkout (symlinked into `~/.pi/agent/extensions`). Run `npm run build` in the primitives checkout first if using a `file:` link.
4. Replace the vendored module with imports from the package subpath. Delete the tests that moved; keep one host-level smoke assertion.
5. Remove the "vendored from" header comment and the "mirror test as drift alarm" claim; both are obsolete.
6. `npm run typecheck`, `npm test`, live smoke test, CHANGELOG entry listing any behaviour change from section 6.
7. Commit per repo with a message that names the primitives version adopted.

## 8. Risks and guardrails

- A shared package means a security or rendering fix ships through a version bump in every consumer instead of one repo. Keep web-tools' permission store and untrusted-content fence local for now; the fence helper is a later candidate.
- Routesense's `Symbol.for` lease table and sensei's cache are reload-survival state for one extension each. Do not generalise them into a shared global registry.
- Splash's `src/extensions.ts` (about 1100 lines) mirrors pi's package manager and must track pi releases. It stays in splash.
- Hot paths: statusline renders on every keystroke and 30 to 100 ms ticks; the widgets sample meters at 100 ms; `shimmerString` runs per frame. Shared code on those paths must not allocate per call beyond what the current copies do.
- Startup: every topping jiti-loads its import graph at session start. Keep package modules free of top-level I/O and keep subpaths narrow so a contracts-only consumer never transpiles menu code.
- Peer floor: declare `"*"` and state "tested against pi 1.3.0" in the README. `decodeKittyPrintable`, `sliceByColumn`, `getTerminalColorMode`, `stripTerminalSequences`, `fuzzyFilter`, `isKeyRelease`, `getSelectListTheme`, `withFileMutationQueue`, `parseFrontmatter` exist at pi 1.0.3. pi-switchyard's 0.85.1 pin is unverified.
- Two copies of the package in one process (npm nesting) are harmless only while the no-module-state rule holds. Add a test that imports a subpath twice via different specifiers and checks no shared mutable export exists.
- Behaviour changes are expected in phases 3 and 4 (meter ceiling, menu key semantics, preview width, overlay width). Record each in both the package and consumer CHANGELOGs.

## 9. Definition of done

- Both packages published to npm under `@underactive`, with READMEs stating they are libraries, and CI green.
- All lineage-A menus, all five activity meters, all five model pickers, and all nine settings stores import from the package; the only remaining copies are lineage-B menus, documented as deferred.
- The three contract defects are fixed and covered by tests in the package.
- pi-topping-insights archived; compact's embed module deleted; pi-topping's sibling catalogue current; laggard pins at 1.3.0.
- Every migrated repo passes typecheck, tests, and a live smoke test, and its CHANGELOG names the primitives version and any behaviour change.

## 10. Phase 0 outcome (2026-10-17)

Phase 0 is done. Repo: https://github.com/underactive/pi-topping-primitives (public). `main` is at the scaffold commit with CI green on Node 22.19.0 and 24, plus the advisory `host-latest` job.

`npm run check` passes locally and in CI: 138 tests (46 repo, 10 primitives source, 32 primitives exports, 12 test-utils source, 38 test-utils exports) and `check-pack: 2 packages OK, 120 files packed`. Nothing is published; both registry names still return 404.

### Deviations from section 3, and why

1. **Source tests need a resolve hook.** Section 3's literal `node --test tests/*.test.ts` fails with `ERR_MODULE_NOT_FOUND` the moment a module spans two files, because the `.js`-suffix rule from section 1 is a jiti behaviour and Node has no equivalent. `tools/ts-resolve.ts` (copied from statusline) rewrites a relative `.js` specifier to its `.ts` sibling, and `test:src` loads it with `--import`. It is existence-guarded, so a real `dist/*.js` is never shadowed. `tests/ts-resolve.test.ts` is the proof.
2. **The package `test` script is four steps, not one.** `test:src && build && typecheck:exports && test:exports`. The declarations only exist after a build, so typechecking `tests/exports` after it is what proves the `.d.ts` files agree with the compiled output. Section 3's single command never read the declarations.
3. **`publishConfig.access: "public"` was added.** Section 3 omits it; the first publish of a scoped package fails without it, and every sibling already has it.
4. **`build` deletes `dist` before `tsc`.** Without it a removed source file leaves a stale compiled entry that `check-pack` would happily ship.
5. **`prepack` runs the build; `prepublishOnly` runs the package tests, then the repo-level hygiene and package-shape tests, then the empty-subpath guard.** Verified by `npm publish --dry-run --workspaces`: it runs `prepublishOnly` per workspace, the guard names all ten empty subpaths, and npm aborts with exit 1.
6. **A root `check` gate exists** (`lint && typecheck && test && check:pack`). The nine CI steps are enumerated separately because section 5 Phase 0 step 3 requires each observable to fail under its own name; the cost is that the list must be kept in step with `check` by hand.

### Correction to Phase 0 step 5

Step 5 says that with a `file:` link "even plain `node --test` works in that mode". That holds for **single-file entries only**. Node realpaths the symlink out of `node_modules`, which lifts the type-stripping restriction, but the `.js`-to-`.ts` specifier rewrite is jiti's, not Node's. A package module that spans two files still fails under plain `node --test`. Every real consumer should plan on the resolve hook or `-C compiled`.

### The bundled-loader branch section 3 never exercised

`bin.pi` is `dist/bundle/cli.js`. The bundle is built with `PI_BUNDLED_NODE` defined, so `isBundledNode` is `true` in the shipped chunk and the CLI takes `{ virtualModules, tryNative: false }` from `dist/core/extensions/loader.js` (lines 472-476); the unbundled SDK entry `dist/index.js` falls through to `{ alias: getAliases() }`. Section 3 only reproduced the alias branch.

Driving `discoverAndLoadExtensions` through both branches, with a physically different pi-tui on the extension's resolution path:

| branch | dual export | compiled only |
| --- | --- | --- |
| bundled chunk (`bundle/index.js`) | `same:true`, ts-source | `same:false`, compiled-js |
| unbundled SDK (`dist/index.js`) | `same:true`, ts-source | `same:false`, compiled-js |

With no `@earendil-works` on disk at all, all four rows are `same:true`.

So section 3's conclusion stands and its reason is stronger than stated: the `.ts` default is safe under both branches, while compiled JavaScript duplicates pi-tui under both when peers are resolvable. `tryNative:false` is not a general safety net — it governs only the module jiti was asked for, not that module's own bare specifiers. Reproduce with `PEERS=present sh scripts/probe-pi-loader.sh` and `PEERS=absent sh scripts/probe-pi-loader.sh`.

Note that both probed entries are SDK entries. The probe never loads `cli.js`; it reaches the same loader chunk, which is why the branch selection is the CLI's.

### Tarball rehearsal

Both packed packages were installed into a throwaway consumer with a separate `@earendil-works` copy: 55 and 65 entries, zero test files, exports map and `*` peers intact. The real loader loaded `@underactive/pi-topping-primitives/contracts` and `@underactive/pi-topping-test-utils/theme` with zero errors under both branches; hiding `node_modules/@underactive` produced the expected load error, so the positive rows were not vacuous. `node -C compiled --test` resolved into `node_modules/.../dist/`; plain `node --test` failed with `ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING`, reproducing section 3 fact 3 against the real artifact.

### Guard coverage

Each Phase 0 hard rule now has a test that fails when broken, not just prose: a top-level `let`/`var`, a module-level `const` bound to a `new Map|Set|WeakMap|WeakSet(` or to an object/array literal the file later mutates, a non-built-in `instanceof` (including `instanceof (X)` and `instanceof list[i]`), `console`, and a non-type `@earendil-works/*` import in `contracts/` or `activity/`. An adversarial mutation pass confirmed each one bites. `test:exports` also fails when `dist/` is older than `src/`, because it reads `dist/` and does not build.

### Next: Phase 1

Phase 1 is `contracts` plus the three live defects, with the caveat that nothing publishes until either every remaining subpath is filled or the unfilled ones are removed from `exports` first (see the release policy in the repo READMEs). Consumers take the package through a `--no-save` link or a packed tarball until then.

## 11. Phase 1 outcome (2026-10-19)

Phase 1 is implemented. `@underactive/pi-topping-primitives@0.1.0` was published after owner approval; its export map contains only `./contracts`, and registry metadata reports 0.1.0 as `latest`. The `v0.1.0` tag (target `67e2d51`) and primitives `main` (`d9d9e03`) are pushed. All nine consumer branches declare `@underactive/pi-topping-primitives: ^0.1.0`, and each is squash-merged to its local `main` in one commit; tracked lockfiles record the registry tarball. Consumer `main` was pushed for pi-topping (`2eb653f`), statusline (`7caf4d6`), web-tools (`4adf5e4`), splash (`d3398950`), persona-audit (`b5b4cb1`), and moa-fusion (`aabae11`). Routesense (`c3e325d`), sensei (`6fcd2b5`), and compact (`1d20abe`) remain local-only because no remotes are configured. The consumer packages were not released.

The contract registry contains the routed-model and working-status channels, shared entry types, both parsers, and typed `emit`/`subscribe`. The compact handoff and wrong default savings-feed defects are fixed. In moa-fusion, the stale `src/moa/modelRuntime.ts` docblock naming `litellm-auto/*` was removed in `deba48b`; the separate `mfPlanSubagent.ts` note remains because extension-registered models still require extensions in child processes. Changelog entries cover the consumer changes.

Validation passed against the published registry package:

| Repository | Tests passed | Skipped |
| --- | ---: | ---: |
| primitives `npm run check` | 121 | 0 |
| routesense | 501 | 1 |
| pi-topping | 300 | 0 |
| sensei | 703 | 0 |
| statusline | 201 | 0 |
| compact | 123 | 0 |
| web-tools | 243 | 0 |
| splash | 498 | 0 |
| persona-audit | 636 | 0 |
| moa-fusion | 122 | 0 |

Other gates passed: `node scripts/check-release.ts packages/primitives`, all nine `npm ls @underactive/pi-topping-primitives`, and each consumer's typecheck/test scripts (sensei's `npm run check`; compact's `typecheck`, `check`, and tests). The final post-review pass reran the primitives check and all nine consumer gates; every command exited 0. C1 commit scopes were inspected; compact's released 0.1.1 changelog section is byte-for-byte unchanged from Stage 2 commit `5054519`; statusline's `src/tests/menu.test.ts` is unchanged from `68aa0b4..HEAD` and in the worktree; the feed test/docs assert the new compact savings default. All nine live extension-load checks exited 0, and a routesense/statusline/pi-topping combined smoke returned `OK` via `openai-codex/gpt-6-luna`. No settings menu was opened; the crash-log baseline hash was unchanged. Stage 6 clean-tree gates also passed: pi-topping and statusline passed `npm ci`, typecheck, and tests in fresh local clones (300 and 201 tests); sensei passed `npm ci && npm run check` in its clean squashed-main worktree (703 tests). The pre-existing sensei separator edits and other dirty/untracked user files remain preserved and unstaged.

### Deviations from the phase plan

- Keep separate strict emitter and parsed subscriber payload maps.
- Shrink the 0.1.0 export map to the implemented `./contracts`; `test-utils` was not published.
- Land the compact and statusline defect fixes before publishing primitives.
- Add a `typecheck` alias to compact.
- Run moa-fusion tests with `-C compiled --experimental-transform-types` on the parent command because tests relaunch themselves.
- Sensei's tarball-verified Vitest setting is `resolve.conditions: ["compiled"]`.
- The verifier's C3 criterion conflicted with the approved Stage 1 export block: `Channel` and `EntryType` remain public, and C3 was corrected to include them; no published API change was made.
- Sensei now uses shared `WORKING_STATUS_SLIDE_MS` instead of a local 300 ms copy; the pending separator edits remain outside the Phase 1 commits.
- The root README records the workspace-specific 0.1.0 publish (primitives only; test-utils remains unpublished); the package README says 0.1.0 is published. Compact's stale `pi.events.on/emit` API-surface entry was removed.

### Final verifier follow-up (2026-10-19)

- **Owner approvals:** The owner explicitly answered “Approve publish” to the `@underactive/pi-topping-primitives@0.1.0` publish prompt. Before pushing, the owner selected “Push configured,” authorizing primitives `main` and `v0.1.0`, plus the six consumer `main` branches with configured remotes (pi-topping, statusline, web-tools, splash, persona-audit, moa-fusion). No remotes were added; routesense, sensei, and compact remain local.
- **C3 adjudication:** The owner-approved Stage 1 code block exports `Channel` and `EntryType`; both remain public names in the published additive-only API. The C3 criterion now explicitly includes them. No API was removed and no republish was needed.
- **C1 evidence:** `git show -p` on sensei `6fcd2b5` and statusline `7caf4d6` shows only Phase 1 contract/dependency changes, including the shared slide constant. The pre-existing sensei README/docs/test hunks remain uncommitted and are absent from `6fcd2b5`; the earlier statusline `[Unreleased]` content is in the parent of `7caf4d6`, not its Phase 1 patch. Sensei’s two adjacent `### Changed` headings also predate `6fcd2b5`.
- **C13/C15 evidence:** Compact’s released `[0.1.1]` section is unchanged from `5054519`; the CHANGELOG diff adds only the `[Unreleased]` entry. Statusline’s `src/tests/menu.test.ts` has no diff from `68aa0b4` to `7caf4d6` or in the worktree.
- **C18:** Routesense’s export-removal bullet is now under `[Unreleased]` → `### Removed`; the unrelated virtual-model change remains under `### Breaking Changes`.
- **C26:** The ignored, untracked moa-fusion `package-lock.json` was removed. `test/rename-verification.test.mjs` validates its package metadata when a local lockfile exists, but no longer requires that ignored file in a clean checkout.
- **Follow-up gates:** Routesense `npm run typecheck && npm test` passed (501 passed, 1 skipped). Moa-fusion `npm run check && npm test` passed (122 tests); `package-lock.json` remains absent.

**Next: Phase 2** (outcome recorded in §12).

## 12. Phase 2 outcome (2026-10-19)

Status: **complete.** `@underactive/pi-topping-primitives@0.2.0` was published to npm on 2026-10-19 (`latest`), the eight consumers take `^0.2.0` from the registry and are committed locally on `primitives-settings`; nothing is pushed.

### What shipped

- `@underactive/pi-topping-primitives@0.2.0` (pi-topping-primitives branch `primitives-settings`, commits `8f74e7a`, `61a079d` and the hardening commit after it; local tag `v0.2.0`, not pushed): `./settings` with `createSettingsStore`, `memorySettingsStore`, `atomicWriteFile`, `fileStamp`, `sanitize`, `toppingSettingsPath`, and the directory lock (`acquireDirLock`, `releaseDirLock`, `dirLockStale`, `isProcessAlive`). test-utils moves to 0.2.0 in lockstep and stays unpublished.
- Eight consumers migrated on branch `primitives-settings`, validated first against a packed tarball and then re-run against the published registry package (all gates green, `npm ls` shows 0.2.0, no `file:`/`link:` specs in any lockfile): moa-fusion, bash-gate, pi-topping, statusline, splash, persona-audit, routesense, web-tools. On-disk paths and save-failure wording are unchanged.

### Test counts (Stage 0 baseline to now)

| Repo | Baseline | Now | Note |
| --- | --- | --- | --- |
| primitives | 46 + 59 + 15 + 12 + 38 (check suites) | 46 + 66 + 15 + 12 + 38 | settings suites added after the 0.1.0 shape |
| moa-fusion | 122 | 122 | extra assertions in `moa-settings.test.mjs` |
| bash-gate | 116 | 116 | |
| pi-topping | 300 | 302 | +mode 0600, +unwritable dir |
| statusline | 201 | 205 | new `settings.test.ts` |
| splash | not recorded | 498 | |
| persona-audit | 636 | 639 | new `modelConfigStore.test.ts` |
| routesense | 502 | 494 | file-lock and generic refusal/busy/write-failure cases moved to the package; one stamp test added |
| web-tools | 243 | 244 | empty-env case |

### Loader gate

`scripts/probe-pi-loader.sh` takes `PRIM_TGZ` and `SUBPATH`. The real seven-module `./settings` layout, loaded from the tarball in `node_modules`, reads defaults and writes under both loader branches (bundled chunk and unbundled SDK), each with pi packages present and absent, on pi 1.3.0. No collapse to a single file was needed. All eight consumers also load with zero errors through both branches (web-tools through its three manifest entries).

### Smoke evidence

Menu-driven live smokes were not run. In their place each extension was loaded through pi's real loader in a temp `PI_CODING_AGENT_DIR`, so no real settings file was touched; the settings menus (save and reopen) were not exercised by hand.

### Deviations from the plan

- Sensei is deferred (the handoff allows last or not at all). It would need a `readFallbackPaths` option for its legacy path, `onDiagnostic` wired to its warning strings, a decision between delete-on-undefined and `preserveUnknownKeys`, and vitest's `compiled` condition.
- web-tools keeps its own async `.lock` file lock for the grant store; only `writeStore` uses `atomicWriteFile`.
- bash-gate keeps its pi 0.99.1 pin; raising it is a separate cleanup item.
- Routesense backup rule: a stored version below 2 is backed up (previously any version other than 2), and `write()` now takes the one-time backup too, via an exclusive copy.
- splash and bash-gate keep their boolean write results.
- persona-audit's renderer at `index.ts:517` is not moved to `cached()`; recorded follow-up.
- `read()` is guarded against a throwing `path()` and diagnostic sink, but a codec whose `sanitize(undefined)` throws still escapes; that is the codec contract.

### Remaining

1. Pushes (primitives branch and `v0.2.0` tag, then each consumer) need separate owner approval. Routesense and bash-gate have no remote.
2. bash-gate's lockfile diff is larger than a one-line range bump: adding its first runtime dependency makes npm stop marking the pi packages `dev`, because primitives peers on them, and refreshes the lock's stale peer ranges.
3. moa-fusion keeps no tracked lockfile; its ignored local lock was removed.

**Next: Phase 3** (outcome recorded in §13).

## 13. Phase 3 outcome (2026-10-19)

Status: **complete.** The request called this "phase 5.3"; the document's phase is Phase 3 (§5), and that is what was implemented. `@underactive/pi-topping-primitives@0.3.0` (`./activity` and `./activity-tui`) was published to npm on 2026-10-19 at 19:10:49 UTC and is `latest`. Its registry shasum (`1e5725c3…`) is byte-identical to the tarball every consumer was first verified against. Tag `v0.3.0` is local, on primitives `1f2cb6a`. The five consumers are committed locally on `primitives-activity` against `^0.3.0` from the registry; nothing is pushed.

### What shipped

- **primitives** (`af0f9e5`, `1f2cb6a`, docs `3d4818d`): `./activity` is pure maths (`ActivityMeter`, `rateToLevel`, `TokRateTracker`, `RateHoldFade`, `StreamingWordCounter`, `OutputTokenAccount`, `RunClock` with `nested`, `bindUIPromptWaits`, `easeFade`, `fadeShade`, `slideOutTail`, `formatElapsedUnits`, `formatElapsedClock`, the meter constants). `./activity-tui` renders it (`renderMeter`, `renderIdleMeter`, `colorizeMeterCell`, `dimAttribute`, `thinkingLevelThemeColor`, `thinkingLevelColorizer`, `shimmerString`, `fadeThemeColorString`, `ansiToRgb`, `formatToolActivity`, `highlightActivity`). The first subpath with a runtime pi-tui import (`stripTerminalSequences`).
- **Consumers**, each one commit titled `feat(activity): Adopt @underactive/pi-topping-primitives 0.3.0 activity primitives`: pi-topping `0303977`, statusline `8ee65cf`, persona-audit `2577a4a`, moa-fusion `50ceb39`, sensei `72a303d` (in the worktree `pi-topping-sensei-activity`, so the owner's uncommitted sensei edits stayed untouched).
- Vendored copies and their mirror tests are deleted in every consumer; each host keeps a smoke assertion.

### Test counts (Stage 0 baseline to now)

| Repo | Baseline | Now | Where the difference went |
| --- | --- | --- | --- |
| primitives | 46 + 66 + 15 + 12 + 38 | 46 + 161 + 28 + 12 + 38 | +95 source, +13 compiled-export |
| pi-topping | 302 | 280 | -9 `activity-meter.test.ts`, -13 moved `format.test.ts` cases |
| moa-fusion | 122 | 117 | -5: `activity-meter.test.mjs` (1, a script file) and `shimmer.test.mjs` (4 subtests) |
| persona-audit | 639 | 613 | -26: activityMeter 5, shimmer 4, toolActivity 4, runClock 9, subprocess 4 |
| statusline | 205 | 204 | -1 `easeFade` |
| sensei | 703 | 701 | -2 `reveal.test.ts` |

Every drop reconciles to tests that moved into the package. The same counts held in the working trees against the tarball, against the registry package, and in fresh clones of the committed branches (`npm ci`, then the gate). The parity oracles passed with their bodies unchanged: pi-topping `tests/lifecycle.test.ts` (the token-rate hold and fade timeline, the eight dim cells, the upper bound), statusline `token-rate-monitor.test.ts` and `token-rate.test.ts`, sensei `test/upstream/sensei/activity.test.ts` and `render.test.ts`, persona-audit `auditProgress.test.ts` and moa-fusion `moa-progress-widget.test.mjs`.

### Loader gate

`scripts/probe-pi-loader.sh` now takes `SUBPATH=settings|activity|activity-tui`. With `SUBPATH=activity` and `SUBPATH=activity-tui`, in both loader branches (bundled chunk and unbundled SDK), with pi peers present and absent, on pi 1.3.0 and Node 24.18: all eight rows loaded with zero errors and returned the expected values. The `activity-tui` rows stripped an escape sequence through pi-tui, which shows the runtime pi-tui import resolves in every configuration. The rows were run against the packed candidate and again against the tarball downloaded from the registry (same shasum). All five consumers also loaded through pi's real loader in both branches (ten rows, zero errors, handlers and commands registered); hiding the dependency from pi-topping produced `Cannot find module '@underactive/pi-topping-primitives/contracts'`, so the clean rows were not vacuous.

### Smoke evidence

- pi-topping in a barebones pi (`-ne -e ./index.ts`, `openai-codex/gpt-6-luna`): on a real stream the meter went from idle `--- tps` to a scrolling trace with a live 66, 97 then 83 tps readout, reaching the full glyph at 83 tps, and the done marker read `Whirred for 8s (↓ 639 tokens · default tier)`. Exit 0.
- statusline, with `segments.tokenRate` temporarily set to `true` (it is `false` in the real settings, so the segment was off): idle `--- tok/s`, then 59, 78, 96, 84, 73, 75, 74 tok/s while streaming, back to `--- tok/s` about two seconds after the turn ended (1.5 s hold, 0.5 s fade). Exit 0. The real settings file was restored with `cp -p` from a backup.
- Before and after, `~/.pi/agent/crashes.json` and both settings files had identical shasums, and no `pi-tui-crash.log` was written.
- **Skipped:** a live sensei consult. It sends repo context to external advisor models, there is no sensei settings directory under `~/.pi/agent`, and its upstream activity and render suites already pass unchanged.
- No settings menu was opened.

### Behaviour changes

- The MoA and audit progress tables' meters saturate at an inclusive 80 tokens/s instead of 40. `LEGACY_METER_UPPER_BOUND_TPS` restores the old scale for a host that wants it.
- `ansiToRgb` is unanchored, so the shimmer reads a colour carried in a compound SGR (moa-fusion and persona-audit required one bare escape).
- `formatToolActivity` strips terminal sequences and stray control characters before it truncates. persona-audit did not sanitise at all, and moa-fusion stripped after cutting, which could leave half an escape sequence.
- `OutputTokenAccount` ignores negative, NaN and infinite usage and falls back to its word-count estimate; persona-audit's copy counted any number.
- pi-topping: with the meter on and Token rate off, the rate is now held in the background, so enabling Token rate mid-turn shows an already-held rate at once.

### Deviations from the plan

- **moa-fusion keeps its inline depth-counted clock.** The package ships `RunClock({ nested: true })` with tests, but moa-fusion's widget did not adopt it (owner decision).
- **statusline adopted only the word counter, the EMA and the hold/fade.** Its confirmed/live accounting and its unchecked use of `usage.output` are unchanged.
- **sensei keeps a constructor-only `SenseiActivityMeter extends ActivityMeter`.** `test/upstream/sensei/activity.test.ts` runs `new ActivityMeter()` and expects the newest cell on the right, and neither that file nor `test/contract/` may change (`CONTRIBUTING.md`).
- **pi-topping's `lifecycle.test.ts` takes one import swap**, `FADE_SHADE_COUNT as TOKEN_RATE_FADE_SHADE_COUNT`, so the test body is untouched.
- **The consumers other than pi-topping were migrated by four delegated workers.** Each diff was read and every gate re-run by the implementer before anything was committed. The harness marked all four runs `acceptance: rejected`; the edits and gates were sound.
- **The first `npm publish` ran at the repo root without `-w`** and failed on the root's missing version before publishing anything; the workspace-scoped run published.
- **`npm install` returned `ETARGET` for `^0.3.0` about 45 seconds after the publish**, from stale package metadata. `npm install --prefer-online` resolved it.

### Remaining

1. Pushes (the primitives branch and `v0.3.0` tag, then each consumer) need separate owner approval.
2. statusline's `usage.output` is still read unchecked, so a non-finite value would poison its token total. Recorded, not fixed.
3. sensei's `primitives-activity` branch edits `CHANGELOG.md` and `test/sensei/consulting-line.test.ts`, which the owner also has uncommitted in the main checkout; expect a textual conflict when the two meet.
4. moa-fusion's pre-existing uncommitted `test/rename-verification.test.mjs` edit is still uncommitted, and the committed version of that test requires `package-lock.json`, which the repo does not track.
5. Phase 6: `./color` will have a broader `ansiToRgb`. It must not silently replace `./activity-tui`'s truecolor-only one.
6. pi-topping still defines `ThinkingLevel`, `THINKING_LEVEL_VALUES` and `isThinkingLevel` locally; Phase 5 owns them.

**Next: Phase 4** (outcome recorded in §14).

## 14. Phase 4 outcome (2026-10-19)

Status: **complete.** `@underactive/pi-topping-primitives@0.4.0` (`./menu`) was published to npm by the owner on 2026-10-19 and is `latest`. Its registry artifact (sha1 `70eb2c7e…`, sha256 `9acb099a…`) is byte-identical to the tarball every consumer was first verified against. Tag `v0.4.0` is local, on primitives `787ab11`. The five lineage-A consumers are committed locally on `primitives-menu` against `^0.4.0` from the registry; nothing is pushed. moa-fusion and persona-audit (lineage B) and pi-switchyard were not touched, per the scope decision.

### What shipped

- **primitives** (`e52a31b` feat, `787ab11` release): `./menu` exports `MenuComponent`, `showMenu`, the pure model helpers (`flattenSections`, `buildInitialValues`, `resolveCycleValueLabel`, `firstEnabledIndex`, `moveCursor`, `rebuildMenu`), the frozen `chrome` frame helpers, `DEFAULT_MENU_KEYBINDINGS`, `menuKeybindings`, and the types (`MenuItem` union of `toggle`/`cycle`/`number`/`text`/`action`/`pick`/`reorder`, `MenuConfig`, `MenuButton`, `MenuRebuild`, `MenuHandlerResult`, `PreviewSlot`, `MenuResult`, `MenuSnapshot`, `MenuTheme`, `MenuTui`). Routesense's `src/ui/menu.ts` is the base; pi-topping's number editor, reorder rows and OSC 8 closure, bash-gate's preset wrap, statusline's re-opened selected background, and splash's button bar, `clearValue`, pick rows and `initialCursor` are merged in. The `pi-topping.menu.*` ids are declared on pi-tui's `Keybindings` and the component matches keys only through its own `KeybindingsManager`, seeded with the host's user bindings. Runtime pi-tui imports: `KeybindingsManager`, `Key`, `decodeKittyPrintable`, `truncateToWidth`, `visibleWidth`, `wrapTextWithAnsi`.
- **Consumers**, each one commit titled `feat(menu): Adopt @underactive/pi-topping-primitives 0.4.0 settings menu`: bash-gate `64d3c3e`, pi-topping `09fdfa0`, statusline `0754903`, splash `31f5343d`, routesense `ddf3da2`. Every vendored menu and its unit-test file is deleted; each host keeps one smoke test that mounts the shared menu and resolves on apply and on cancel (splash keeps its command suite, re-anchored). Each CHANGELOG lists the user-visible changes.

### Test counts (Stage 0 baseline to now)

| Repo | Baseline | Now | Where the difference went |
| --- | --- | --- | --- |
| primitives | 46 + 161 + 28 + 12 + 38 | 46 + 262 + 33 + 12 + 38 | +100 in eleven `menu-*.test.ts` suites, +1 `./menu` row in the source entries test; +3 `./menu` rows in the compiled entries test, +2 in `exports/menu.test.ts` |
| bash-gate | 116 | 107 | -10 `test/menu.test.ts`, +1 host smoke |
| pi-topping | 280 | 243 | -37 `tests/menu.test.ts` |
| statusline | 204 | 198 | -8 `src/tests/menu.test.ts`, +2 host smoke (`settings-menu.test.ts`) |
| splash | 498 | 498 | no menu unit file existed; the pick flows now assert on the same mounted menu |
| routesense | 494 (1 skipped) | 451 (1 skipped) | -44 `test/menu.test.ts`, +1 host smoke; the skip is the live Jev test |

Every drop maps to a package test (the mapping tables are in the migration reports and in the routesense CHANGELOG commit). The same counts held against the packed tarball, against the registry package, and in fresh clones of the committed branches (`npm ci`, then the gates). Routesense's gates must run with `PI_SUBAGENT_CHILD` unset: two lease tests read it and report the owner as `subagent`.

### Loader gate

`scripts/probe-pi-loader.sh` takes `SUBPATH=menu`, which constructs a `MenuComponent` through pi's loader, renders it and presses Enter. In both loader branches (bundled chunk and unbundled SDK), with pi peers present and absent, on pi 1.3.0 and Node 24.18, all four rows returned `{"top":true,"rows":7,"result":{"applied":true,"values":{"on":true}}}` with zero errors, against the packed candidate and again against the registry tarball (same shasum). All five consumers loaded through both branches with zero errors and their commands and handlers registered (bash-gate 2/2, pi-topping 2/13, statusline 1/13, splash 2/4, routesense 1/7).

### Smoke evidence

Each extension ran in a barebones pi (`-ne -e ./index.ts`, `openai-codex/gpt-6-luna`) in a 120x40 tmux pane, against the tarball install. Settings files were backed up with `cp -p` first.

- pi-topping: the settings menu rendered its 59 rows with the preview; PgDn moved one visible screenful (16 rows); a typed `250` committed, presets stepped 250 → 300 → 200 → 150; an invalid `5` showed `✗ Enter a whole number from 10 to 1000 tps` in the hint block and Escape discarded it; grabbing an Elements Order row showed `↑ ↓` and Down moved it below “Working” text; at 46 columns every frame line kept its right border and long labels wrapped; Escape closed without saving; `/topping-setup` reported every topping already active (the `-ne` fallback). Exit 0.
- bash-gate: Right stepped the threshold 70 → 80; Escape closed without saving. Exit 0.
- statusline: `+ add feed` grew the menu from 55 to 60 rows; Escape closed without saving. Exit 0.
- splash: Enter on Summary model opened the two-pane picker **over the still-mounted menu** (both frames visible in one capture); Escape returned to the same menu with the cursor still on that row (`[ 7/7 ]`); Escape closed without saving. Exit 0. This is the one behaviour unit tests could not prove.
- routesense: Tab moved focus to the bar (`[ Save ]` focused, its hint and the bar hints shown); Escape closed; Save was never pressed. Exit 0.
- Before and after, every settings file and `~/.pi/agent/crashes.json` had identical shasums, and no `pi-tui-crash.log` existed.
- tmux note: keys sent as tmux key names through the terminal tool during a resize were dropped; raw escape sequences, or `tmux send-keys` with a one-second pause between keys, were delivered reliably. The pane had to be forced to 120x40 (`window-size manual`); at the tool's default 24 rows the 75%/85% height budget left the body with only its scroll-status row below the preview, which is the same arithmetic the vendored menus had.

### Behaviour changes

- Number rows publish numbers (`MenuValue` is `boolean | string | number`); pi-topping and bash-gate used decimal strings. pi-topping's `applyMenuResult` accepts either.
- Every menu uses one button bar, right-aligned between two rules (splash's look). `MenuButton.applies` validates then closes applied; `closeOnAction` closes with the draft; a plain button runs `onAction` and stays open.
- Up/Down stop at the ends (statusline and splash wrapped); cycle rows always wrap (routesense stopped); PgUp/PgDn move one visible screenful (routesense moved ten rows); the pi-topping left-arrow defect below the lowest preset is fixed by wrapping.
- Enter on a toggle or cycle row applies only under `enterApplies` (default: no buttons; routesense passes `true`). Enter on a number or text row opens the editor and on a reorder row grabs or releases it, so pi-topping and bash-gate users apply from another row.
- Escape and Ctrl+C close with `applied: false` and the current draft (every copy returned the initial values; every caller reads values only on apply).
- The overlay defaults to 90% wide and 85% high: pi-topping and bash-gate were 86% wide; statusline and splash were 100% high; splash was fixed at 76 columns; pi-topping keeps `maxHeight: "75%"`.
- The marker is `❯` (statusline used `>`); ungated cycle, number and pick rows carry no checkbox; labels wrap instead of truncating (statusline's 16-cell label cap and tail-scrolling caret are gone).
- Previews are a `PreviewSlot` given the full inner width with no margin; pi-topping, bash-gate and statusline add their old one-space indent themselves.
- A failing `onAction` or `onPick` shows `✗ <message>` in the hint block and is never re-thrown (routesense re-threw). The hint block renders for any message, so a validation error shows in a menu without hints, and the number editor's error moved there from the hints row.
- `onPick` keeps the menu mounted and ignores keys until the picker settles (splash closed and reopened its menu).
- Content rows truncate with pi-tui's default `...` ellipsis, as every copy did.

### Deviations from §3b and the plan

- Numeric values; no `CycleItem.wrap`, `layout.marker`, `layout.previewTitle`, `NumberItem.integer` or `config.keys`; `MenuButton.applies`; the structural `MenuTheme` (and a structural `MenuTui`); in-menu failures; `MenuHandlerResult` as the one `void`-carrying return alias; `snapshot()` adds `rowCount`, `focus` and `busy`.
- `menuKeybindings` tolerates a host without `getUserBindings` (splash's and statusline's test fakes pass `{}`).
- **`rebuildMenu` re-seeds reorder groups instead of keeping them by key.** The plan's Stage 2 text says `rebuildMenu` "keeps reorder group values". The shipped `model.ts` deliberately does not: a rebuild lays the rows out in the rebuilt sections' order, and if the previous group value were kept by key the published order and the rows on screen would disagree. Re-seeding keeps them consistent (`menu-model.test.ts` "reorder groups survive a rebuild with the rebuilt sections' order", `menu-reorder.test.ts` "a rebuild resets the grab and restores the sections' order"). This is the one place the plan's literal wording was not followed, it was chosen before the publish, and 0.4.0 shipped with it; restoring the literal behaviour would need a 0.4.1 release and a consumer bump, so it is recorded here instead. No consumer rebuilds while a reorder group is on screen.
- The first foundation worker (Codex) died on a provider usage limit after writing `types.ts`, `keys.ts`, `model.ts` and `chrome.ts`; the implementer finished the package. statusline, splash and routesense were migrated by three delegated workers on `claude-fable-5-1`; every diff was read and every gate re-run (against the final tarball, the registry and a fresh clone) before anything was committed.
- The publish was run by the owner rather than from this session; the registry artifact was then verified against the candidate tarball. `npm install --prefer-online` resolved `^0.4.0` first time.
- **Test-only files outside the plan's file lists.** The migrations needed small edits the plan's Files to Modify lists did not name, all confined to tests: bash-gate `test/helpers.ts` (the fake theme gains `getBgAnsi`, which the shared component calls) and `test/extension.test.ts` (one key sequence, since Enter on the threshold row now opens the editor); pi-topping `tests/setup.test.ts` (`getBgAnsi` on its fake theme); statusline `src/tests/cache-hit.test.ts` (narrows a row to `kind === "cycle"`) and the new host smoke `src/tests/settings-menu.test.ts`; routesense `test/helpers.ts` (`getBgAnsi`) and `test/transfer.test.ts` (it imported the vendored component). No source file outside the lists changed, and nothing outside the six repos was touched.

### Remaining

1. Pushes (the primitives branch and `v0.4.0` tag, then each consumer) need separate owner approval.
2. pi-switchyard still carries its own lineage-A menu and an older primitives pin; its bump and migration wait.
3. routesense's tier-weight editor may adopt the exported `chrome` helpers; nothing does yet.
4. The lineage-B menus in moa-fusion and persona-audit stay local; an adapter was rejected in planning.
5. The menu's hint strings are the caller's and do not change when a user remaps `pi-topping.menu.*`.
6. `@underactive/pi-topping-test-utils` moved to 0.4.0 in lockstep and stays unpublished.

**Next: Phase 5.**

## 15. Phase 5 outcome (2026-10-19)

Status: **complete.** `@underactive/pi-topping-primitives@0.5.0` (`./models`) was published to npm by the owner on 2026-10-19 and is `latest`. Its registry artifact (sha1 `e201d5fc…`, sha256 `6c4da8fd…`) is byte-identical to the tarball packed from the release commit, which differs from the candidate every consumer was gated against only in the CHANGELOG heading (`[Unreleased]` → `[0.5.0] - 2026-10-19`). Tag `v0.5.0` is local, on primitives `e76be47`. moa-fusion, persona-audit, splash, routesense and pi-topping are committed locally on `primitives-models` against `^0.5.0` from the registry; nothing is pushed. pi-switchyard was deferred, per the owner's decision.

### What shipped

- **primitives** (`7ad7b81` feat, `e76be47` release): `./models` exports the vocabulary (`ModelRef`, frozen `THINKING_LEVELS` and `COMMON_THINKING_LEVELS`, `ThinkingLevel`, `isThinkingLevel`, strict `isModelRef`, `modelRefLabel`, lenient `parseRef`, sensei's `parseModelKey`/`composeModelKey`, `shortModelName`), the registry catalogue (`getModelCatalogue`, `CatalogueRegistry`, `ModelCatalogue`, `validateSavedChoice`, `registryLevelOptions`), the thinking policy (`thinkingOptionsForModel` with an optional fallback, `defaultThinkingForModel`), the label helpers (`smartTruncateModelLabel`, frozen `MODEL_LIST_LAYOUT`, `modelThinkingPaneWidths`), `fuzzyRanked`, and `TwoPaneModelThinking<L>` with `TwoPaneModelThinkingOptions` and the structural `ModelPickerTheme`. moa-fusion's picker is the base; persona-audit's selected-row sentinel and catalogue, splash's `fuzzyRanked`, printable decoding and render-pure dispatch, and routesense's kitty input are merged in. The one module-state exception is the catalogue `WeakMap`, keyed by the host registry, behind a reasoned `hygiene-allow`. Runtime pi imports: pi-ai `getSupportedThinkingLevels`; pi-tui `SelectList`, `fuzzyFilter`, `Key`, `matchesKey`, `decodeKittyPrintable`, `truncateToWidth`, `visibleWidth`, `wrapTextWithAnsi`. pi-coding-agent is imported for types only, so `./settings` is still its only runtime importer.
- **Consumers**, each one commit titled `feat(models): Adopt @underactive/pi-topping-primitives 0.5.0 model primitives`: moa-fusion `275f43b`, persona-audit `68048cd`, splash `66dea49a`, routesense `b0b48f2`, pi-topping `790f8c9`. moa-fusion, persona-audit and splash keep a local factory (`createMoaModelPicker`, `createPhaseModelPicker`, `createSplashModelPicker`) that binds their policy; routesense's `PiModelPickerComponent` composes the shared body inside its own frame; pi-topping re-exports the level vocabulary from `format.ts`. Each host keeps its frame, warnings, persistence and overlay; the vendored catalogue, label and picker copies are deleted.

### Test counts (Stage 0 baseline to now)

| Repo | Baseline | Now | Where the difference went |
| --- | --- | --- | --- |
| primitives | 46 + 262 + 33 + 12 + 38 | 46 + 362 + 37 + 12 + 38 | +99 in six `models-*.test.ts` suites (refs 12, thinking 8, catalogue 15, label 10, filter 15, picker 39), +1 `./models` row in the source entries test; +3 `./models` rows in the compiled entries test, +1 `exports/models.test.ts` |
| moa-fusion | 117 | 108 | -9: `model-catalogue` (1 file test), `model-label-truncate` (6), `two-pane-model-picker` (1), `model-picker-registry-levels` (1). The filter-retention case was added inside `moa-thinking-preferences.test.mjs`, which counts as one |
| persona-audit | 613 | 605 | -5 `test/modelCatalogue.test.ts`, -2 thinking helpers in `modelConfig.test.ts`, -2 truncation cases in `modelPicker.test.ts`; +1 host test (ten model rows with and without a filter) |
| splash | 498 | 481 | -6 pure helpers in `model-picker.test.ts`, -13 printable and `fuzzyRanked` cases in `gate-ui.test.ts`; +2 host tests (ten-row boundary at 9/10/11/12/15 models, last-of-eleven selection visibility) |
| routesense | 451 (1 skipped) | 459 (1 skipped) | +8 host tests for the wrapper (labels, defaults, retention, paste, Select, frame and viewport widths, `showPiModelPicker` wiring); none removed |
| pi-topping | 243 | 243 | re-export only |

Every removed test maps to a named package test; the tables are in the four migration reports, and the splash printable gap they disclosed (exhaustive positive ASCII, NBSP, `ÿ`) was closed in `models-filter.test.ts` before release. The same counts held against the packed candidate, against the registry package, and in fresh clones of the committed branches (`npm ci`, or `npm install` for moa-fusion, whose lockfile is gitignored). moa-fusion's suite runs with `NODE_OPTIONS='-C compiled --experimental-transform-types'`; routesense's with `PI_SUBAGENT_CHILD` unset.

### Loader gate

`scripts/probe-pi-loader.sh` takes `SUBPATH=models`, which builds the picker from a one-model fake registry through `registryLevelOptions` (so pi-ai's `getSupportedThinkingLevels` and pi-tui's `SelectList` both resolve through the loader), renders it at width 60 and presses Enter. In both loader branches with pi peers present and absent, on pi 1.3.0 and Node 24.18, all four rows returned `{"rows":2,"pick":{"ref":{"provider":"probe","id":"model"},"thinking":"off"}}` with zero errors, against each candidate and again against the registry tarball. All five consumers loaded through both branches with zero errors (commands/handlers: moa-fusion 8/11, persona-audit 3/4, splash 2/4, routesense 1/7, pi-topping 2/13).

### Smoke evidence

Each extension ran in a barebones pi (`-ne -e ./index.ts`, `openai-codex/gpt-6-luna`) in a 120x40 tmux pane against the candidate install; no Save, Start, Continue or Apply was pressed, and every session exited 0. Splash ran from an empty temp directory so its startup summary had no diff to send.

- moa-fusion, `/mf-plan-settings` → cheap/fast agent: typing `gpt` added the filter row and moved the selection to the first match; ANSI captures showed Tab moving the accent from the Models header to Thinking and then to `[ Select ]`; the active row carried `selectedBg`; Escape from the buttons returned to the settings; Escape closed with no save notification.
- persona-audit, `/persona-audit --full src/modelConfig.ts` → manual reviewers → phase overview → Review: `❯` in both panes; moving Thinking to `off` showed the host's warning row; Ctrl+C returned to the overview with Review unchanged; Escape three times printed "Audit cancelled." `validateSavedChoice` reported the saved claude-bridge refs (that provider is not loaded under `-ne`) without persisting the drop.
- splash, `/topping-splash-settings` → Summary model: the picker opened over the still-mounted menu with exactly ten model rows and `(121/675)`; pasting `gpt` gave the filter row, ten rows and `(1/157)`; Escape returned to the same menu row (`[ 7/7 ]`) with the value unchanged.
- routesense, `/routesense settings` → Default model: the square frame, `thinking` pane title and `>` marker rendered, the saved default level `low` was honoured, two Tabs focused `[ Select ]`, and Escape left the menu unchanged.
- pi-topping loaded and `/topping-settings` rendered its thinking-level colour rows.
- The persona-audit smoke found that the shared total-body cap showed 8 model rows where the old picker showed 10; the host budget below restores 10. The review-wave fixes after the smokes (moa-fusion level retention, splash live registry reads, persona-audit hint inset, no `requestRender` at construction) are covered by tests and were not re-smoked.
- `crashes.json` and every settings file kept their shasums, except `mf-plan/settings.json`, whose `.implementer` changed at 20:26 to `claude-bridge/claude-opus-5-5`. That was the owner switching the session's implementation model, not a smoke (the smoke's registry could not even offer claude-bridge), so the backup was not restored. No `pi-tui-crash.log` existed.

### Behaviour changes

- `isModelRef` rejects an empty provider or id, so such a saved ref in moa-fusion or persona-audit settings reads as unset (splash already required both).
- Empty Select is inert in every host; moa-fusion, splash and routesense used to back out.
- Typing or Backspace while the buttons are focused edits the filter and returns to Models (every copy ignored it); multi-character paste and kitty CSI-u printable keys filter; Backspace follows pi-tui's key parser and removes one whole character; C0, DEL, C1 and control sequences are rejected.
- A selected model that still matches survives filtering (persona-audit and splash jumped to the first match). moa-fusion keeps a hand-picked thinking level while the same model stays selected, as it did; persona-audit and splash re-apply their default level on filter, as they did; routesense keeps the previous level through the package default.
- The select-list colours are derived from the theme the host passes in (accent selected text; muted description, scroll and no-match). moa-fusion and splash used pi's global `getSelectListTheme()`, which uses exactly those roles, so nothing looks different; persona-audit already derived them; routesense still passes the global theme through the `selectTheme` override.
- `maxVisibleRows` caps the whole body (header, filter and scroll rows included), and the scroll row is reserved when the items exactly fill the space as well as when they overflow. moa-fusion and routesense already counted the whole body; at exact equality they now show one fewer item plus a scroll row. splash and persona-audit keep exactly ten model rows through host budgets.
- Footer hints wrap instead of clipping. splash wraps them inside its own rules; persona-audit keeps its two-column inset.
- splash gets asymmetric panes, one-column insets, namespace-aware truncation and the kitty input above; its look (`→` marker, no row background, `fuzzyRanked`, the common-four fallback) is unchanged.
- routesense's buttons sit one column further left inside its frame (the shared action row ends in two spaces). Cosmetic; not changed.

### Deviations from §4.5 and the plan

- **Scroll row reserved at equality** (`itemCount >= available`). Splash's boundary test found that no total budget gave exactly ten rows for exactly eleven models (twelve rows showed eleven, eleven showed nine). A bounded read-only review found no smaller API-preserving fix; the trade-off is documented in the package README and CHANGELOG, and model- and level-pane tests pin it with the selected row still visible.
- **Host row budgets.** splash (`renderSplashModelPicker`, `GATE_LIST_HEIGHT + 2 + (filter ? 1 : 0)`) and persona-audit (`pickerBodyRows`, `10 + 2 + (filter ? 1 : 0)`, applied in `renderFramedPicker`) set the cap per render; the plan assumed one constructor option would do.
- splash's local `renderFooter(theme, picker, bodyWidth, hints)` takes the host theme, because the rules need it and the picker's theme is private.
- **splash reads the registry live** (`getAvailable()` in `availableModelRefs`, `find()` plus `thinkingOptionsForModel` for levels) instead of `getModelCatalogue`/`registryLevelOptions` as step 23 said: pi refreshes its registry in place after a login or a models.json reload, and the catalogue snapshot would hide that. moa-fusion and persona-audit cached before this phase and still do.
- moa-fusion's `preferredLevel` keeps `previous` while the same model stays selected; the plan's one-line wrapper over the saved/current default reset the level on every filter keystroke.
- The picker's constructor applies its initial state without calling `requestRender`; only `reset()` and input mutations notify.
- `defaultPrintable` lives in `picker.ts` (still internal), not `filter.ts`.
- Files outside the plan's lists: moa-fusion `test/moa-thinking-preferences.test.mjs` (the filter-retention case); splash `test/contracts.md` (it described the moved helpers and the old escape rejection); the consumer lockfiles, which only moved to the registry 0.5.0 entry. moa-fusion has no tracked lockfile. No source file outside the lists changed, and nothing outside the six repos was touched.
- The foundation, the picker and the four picker-consumer migrations were delegated to workers; every report and diff was read back, two fresh-context reviewers (package and consumers) returned "OK with notes", and every gate was re-run by the parent before commit. The session model was switched to claude-opus-5-5 partway through. The sensei advisor was unavailable throughout (stale extension context), so no advisor review ran.
- The publish was run by the owner; the registry artifact was then verified byte-for-byte against the release-commit tarball.

### Remaining

1. Pushes (the primitives branch and `v0.5.0` tag, then each consumer) need separate owner approval; the Phase 4 pushes are still pending too.
2. pi-switchyard: pin bump, then menu and models adoption over `ReasoningEffort`. The generic level type and `levelWidthLabels` shipped for it.
3. sensei and routesense's `tiers.ts` keep local model-key parsers; `parseModelKey`/`composeModelKey` are the shared names when they adopt.
4. The catalogue snapshot does not observe `registry.refresh()`. moa-fusion and persona-audit keep the cached lists they had before; an invalidation hook or a live variant would be a later, additive change.
5. The lineage-B menus in moa-fusion and persona-audit stay local.
6. `@underactive/pi-topping-test-utils` moved to 0.5.0 in lockstep and stays unpublished.

**Next: Phase 6 (`./color`, `./text`, `./glyphs`).**

## 16. Phase 6 outcome (2026-10-20)

Status: **complete.** `@underactive/pi-topping-primitives@0.6.0` (`./color`, `./text`, `./glyphs`) was published to npm by the owner on 2026-10-20 and is `latest`. Its registry artifact (shasum `b27ff802349163f0f582324eb48672e57f60fc97`, integrity `sha512-3SbgT50n1A0iDFOr2Vh3upYLdoNSidICHWVe5L/s/O+XJ9P6bxv+X9eYO4hjxUMzcKcG+rJa5cO1AkesFo8P1A==`, 260 files) is byte-identical to the tarball packed from the release commit (sha256 `0a22d10fb7d6b6022b9ea4445257e96a6769aba5d2a0c357b031f9f026240332`; `cmp` agrees) and to the candidate every consumer was gated against. Tag `v0.6.0` is local, on primitives `f756bcb` (`607b722` feat). compact, statusline, pi-topping, splash, persona-audit, moa-fusion and routesense are committed locally on `primitives-color` against `^0.6.0` from the registry; nothing is pushed.

### What shipped

- **primitives** (`607b722` feat, `f756bcb` release):
  - `./color` exports the tuple `Rgb`, `parseHex`, `mixRgb`, `rgbTo256`, `xterm256ToRgb`, `channelsToFgAnsi`, `rgbToFgAnsi(rgb, mode)`, `hexToFgAnsi(hex, mode)`, `parseSgrColor` with the tagged `SgrColor` (truecolor, indexed or default; foreground or background), `hslToRgb`, `hsvToRgb`, `wrapDeg`, `fadeRgbToward`, `cosineFalloff`, `shimmerCell`, `SWITCHYARD_PROVIDER`, `NVIDIA_GREEN_HEX`, `NVIDIA_GREEN_DARK_HEX`, `isSwitchyardProvider`, `SYNTHWAVE_GREENS`, `renderCometBar` and `BAR_CELLS`/`BAR_FILLED`/`BAR_TROUGH`. It has no runtime pi import (`TerminalColorMode` is a type), and every call that writes an escape takes the mode from the host.
  - `./text` exports `padRight`, `padCenter`, `truncateVisible`, `fitCell`, `ELLIPSIS`, `pickFitting`, `joinParts`, `wrapCommaDelimited`, `stripSgr`, four separately named sanitisers (`stripControlChars`, `sanitizedText`, `sanitizeTerminalBytes`, `sanitizeLabel`, each docblock naming its source repo and what it does not do), and `formatDurationCompact`, `formatCount`, `formatPercent`, `formatCostUsd`. `layout.ts` is its one runtime pi-tui importer (`visibleWidth`, `sliceByColumn`); `sanitize.ts` needs only `node:util`.
  - `./glyphs` exports `BoxGlyphs`, `BoxStyle`, `BOX_STYLES`, `ASCII_BOX`, `SPINNER_FRAMES`, `SPINNER_FRAME_MS` and `QUADRANT_SPINNER_FRAMES`, with no imports at all. Every exported table in the three subpaths is frozen at every level; the module-level regular expressions are used only through `replace`, which resets `lastIndex`.
  - The sources were statusline's `theme.ts`, `rainbow.ts`, `nvidia-green.ts`, `compaction-bar.ts` and `footer.ts`; compact's `progress-bar.ts`; splash's `text.ts`, `reveal.ts` and `color.ts`; pi-topping's `util.ts` and `nvidia-green.ts`; persona-audit's and moa-fusion's `formatCost`; routesense's `format.ts`; and the spinner and box tables in five repos.
  - `tools/hygiene.ts` now treats `color` and `glyphs` as pi-free, matched on the directory straight under `src`. `scripts/probe-pi-loader.sh` takes `SUBPATH=color|text|glyphs`. Primitives and test-utils moved to 0.6.0 in lockstep; test-utils stays unpublished.
- **Consumers**, each one commit titled `feat(color): Adopt @underactive/pi-topping-primitives 0.6.0 colour, text and glyph primitives`: compact `cdc7995`, statusline `86af936`, pi-topping `623c744`, splash `a8cb0f87`, persona-audit `e678f0f`, moa-fusion `9f3b187`, routesense `25e0381`. Each commit's parent is its stated base (compact's local `main`, statusline `0754903`, the others' `primitives-models` heads):
  - **compact** (`^0.1.0` to `^0.6.0`): `progress-bar.ts` is a wrapper over `renderCometBar` that reads the colour depth with pi-tui's `getTerminalColorMode()` (the same `trueColor` expression the bar used before); `compaction-widget.ts` takes its spinner from `./glyphs`; `ONBOARDING.md` points at `./color` and its stale `▩`/`▁` glyph text is corrected to `▋`/`░`.
  - **statusline** (`^0.4.0` to `^0.6.0`): `theme.ts` drops `parseHex`, `xterm256ToRgb`, `rgbTo256`, `mixRgb`, `rgbToFgAnsi`, the SGR regex and the box tables, and keeps `hexToFgAnsi(hex, mode = detectColorMode())` as a one-line wrapper so `segments.ts` and the colour-mode tests are untouched. `fadeAnsi` calls `fadeRgbToward` with a target hoisted once at load (the old code rebuilt it on every call), and `fadeFg` keeps its own arithmetic and ends in `channelsToFgAnsi`. `rainbow.ts`, `nvidia-green.ts` and `utils.ts` import from `./color`; `getSessionAccentHex` uses pi-tui's `colorToHex(rgbColor(...))` in place of the local `rgbToHex` (10,088 values across seven saturation/lightness pairs were byte-identical before the local one was deleted). `compaction-bar.ts` is a wrapper, `context-graph.ts` aliases `BAR_*` to its old `CELLS`/`FILLED`/`TROUGH`, and `footer.ts` re-exports `stripSgr` as `stripAnsi`.
  - **pi-topping** (`^0.5.0` to `^0.6.0`): `nvidia-green.ts`, `format.ts` (spinner) and `util.ts` (sanitisers) re-export under their old names; `prompt-decorator.ts` is typed `BORDER_GLYPHS: Readonly<Record<BorderStyle, BoxGlyphs>> = BOX_STYLES`, so a border style added to `settings.ts` without glyphs fails the typecheck, and its `tl`/`tr`/`bl`/`br`/`h`/`v` accesses became the `BoxGlyphs` field names.
  - **splash** (`^0.5.0` to `^0.6.0`): `text.ts` re-exports the eight layout helpers; `reveal.ts` `shimmerCell` delegates with a hoisted frozen options object. `hsvRgb` and `sanitizeTuiText` stay local.
  - **persona-audit**, **moa-fusion**, **routesense** (`^0.5.0` to `^0.6.0`): one-line aliases (`formatCostUsd as formatCost`, `sanitizeTerminalBytes as sanitizeTerminalText`, `QUADRANT_SPINNER_FRAMES as TABLE_FRAMES`; moa-fusion's `BRAILLE_SPINNER_FRAMES`/`QUADRANT_SPINNER_FRAMES`; routesense's `formatDurationCompact as formatDuration`, `formatCount`, `formatPercent`). persona-audit's `sanitizeDiffLine` (it keeps tab), moa-fusion's eight-field joined boxes and routesense's signed `formatCost` stay local.
  - splash, persona-audit, moa-fusion and routesense were migrated by workers; every report and diff was read back. compact, statusline and pi-topping were done by the parent.

### Test counts (Stage 0 baseline to now)

| Repo | Baseline | Now | Where the difference went |
| --- | --- | --- | --- |
| primitives | 46 + 362 + 37 + 12 + 38 | 47 + 485 + 53 + 12 + 38 | repo +1 (the colour/glyph/text pi-import case in `hygiene.test.ts`); source +123 in ten new suites (`color-rgb` 20, `color-hue` 6, `color-fade` 17, `color-palette` 4, `color-comet-bar` 10, `text-ansi` 4, `text-sanitize` 18, `text-layout` 23, `text-format` 10, `glyphs` 8) and +3 rows in `entries.test.ts`; compiled +16 (+9 rows in the compiled entries test, +4 `exports/color`, +2 `exports/text`, +1 `exports/glyphs`) |
| compact | 123 | 121 | -4 geometry tests of `progress-bar.test.ts` (glyphs and trough, right-to-left travel, 256-colour path, clamping) -> `color-comet-bar.test.ts`; +2 host tests (delegation to `renderCometBar` in both modes; default mode read from `setCapabilities`). The label-padding test stays |
| statusline | 198 | 194 | -4 geometry tests of `compaction-bar.test.ts` -> `color-comet-bar.test.ts`, +1 delegation smoke; -1 `recognizes the Switchyard provider…` -> the two `isSwitchyardProvider` tests in `color-palette.test.ts`. "default bar color follows terminal capability detection" stays |
| pi-topping | 243 | 242 | -1 `recognizes only the Switchyard provider…` -> the same two tests. The colorizer byte oracle and the override test stay |
| splash | 481 | 463 | -20 in `text.test.ts`: T-04 (3), T-05/T-14 (5), T-08 (3), T-09/T-15 (4), T-10 (3), T-11 (2) -> the same-named tests in `text-layout.test.ts`, whose names keep the IDs; +2 host tests (the eight re-exports are identical to the package's, and `pickFitting([])` is `""`). `test/contracts.md` marks the moved rows |
| persona-audit | 605 | 604 | -1 `formatCost uses fixed precision…` -> `formatCostUsd uses fixed precision, clamps negatives and dashes unknown or invalid values` in `text-format.test.ts` (plus the captured-matrix test and the zero-versus-unknown test) |
| moa-fusion | 108 | 108 | the three `formatCost` assertions lived inside one block-level test and were removed from it -> the same `text-format.test.ts` tests; the count is unchanged |
| routesense | 459 (1 skipped) | 459 (1 skipped) | nothing removed or added; `test/format.test.ts` stays as the host test for the re-exported `formatDuration` and the local `formatCost` |

Stage 0 was recorded on the branch heads before any edit, with each repo's own runner: statusline `npm test` (its script carries `--import ./src/tests/ts-resolve.ts`), moa-fusion `npm test` (its script carries `-C compiled --experimental-transform-types`, so it is equivalent to `NODE_OPTIONS='-C compiled --experimental-transform-types'`), routesense with `PI_SUBAGENT_CHILD` unset (`env -u PI_SUBAGENT_CHILD npm test`), and splash counted with `--test-reporter=spec` (its `npm test` uses the dot reporter). Typecheck was clean in all seven. Each consumer's suite also ran **unedited** against the candidate after its source edits and before any test moved, and returned the baseline count (compact 123, statusline 198, pi-topping 243, splash 481, persona-audit 605, moa-fusion 108, routesense 459), which is the byte-parity gate for the aliases. The same counts held against each of the three candidate tarballs the work passed through, against the registry package, and in fresh clones of the committed branches (`npm ci`, or `npm install` for moa-fusion, whose lockfile is not tracked), each of which installed 0.6.0 from the registry. moa-fusion's commit leaves its pre-existing `test/rename-verification.test.mjs` edit and the untracked `HANDOFF-fanout-max-tokens.md` alone, as does routesense's with `routesense-models.json`.

### Package gate

`npm run check` at the primitives root (biome, both typecheck legs, `test:repo`, source tests, build, `typecheck:exports`, compiled export tests, `check:pack`) passed with the counts in the table above, in the working tree, in a clean `npm ci` checkout of the tag, and on the `feat` commit alone (which still carries version 0.5.0, as in earlier phases). `check:pack` reports 2 packages, 325 files, nothing forbidden and no `dist/` committed. `node scripts/check-release.ts packages/primitives` lists nine non-empty subpaths: `./contracts` 8 exports, `./settings` 10, `./activity` 22, `./activity-tui` 11, `./menu` 11, `./models` 19, `./color` 23, `./text` 17, `./glyphs` 5.

### Loader gate

`SUBPATH=color` renders a 50% comet bar at 500 ms and an NVIDIA-green escape; `SUBPATH=text` fits a CJK string and centres another through pi-tui; `SUBPATH=glyphs` reads a frame glyph and the frozen spinner. On pi 1.3.0 and Node 24.18, in both loader branches with pi peers present and absent, all twelve rows returned zero errors and the expected JSON, against the final candidate (`0a22d10f…`), against both earlier ones, and again against the registry tarball:

| Subpath | Expected row (all four peer/branch combinations) |
| --- | --- |
| `color` | `{"filled":10,"trough":10,"green":"\u001b[38;2;132;197;26m"}` |
| `text` | `{"fit":"日\u001b[39m...","center":"  日本  "}` |
| `glyphs` | `{"corner":"╭","frames":10,"frozen":true}` |

With `PEERS=absent` nothing else on disk can supply pi-tui, so the `text` row shows the host's alias reaching the subpath. All seven consumers loaded through both branches with zero errors, against the candidate install and again against the registry install (commands/handlers: compact 2/11, statusline 1/13, pi-topping 2/13, splash 2/4, persona-audit 3/4, moa-fusion 8/11, routesense 1/7), and a one-line extension importing `./color` with no install failed to load in both branches, so the check can fail.

### Parity evidence beyond the unit suites

- **Golden fixtures** (`packages/primitives/tests/fixtures/phase6/`, outside `files`, so not packed) were captured from the vendored code before it was edited: 162 comet-bar cases (compact's `renderProgressBar`, asserted equal to statusline's `renderCompactionBar` first), 196 `fadeAnsi` cases under both capability modes, 64 splash `shimmerCell` cases, the splash layout matrix, 102 `hslToRgb` and 80 `hsvRgb` cases, and the routesense, persona-audit and moa-fusion formatter cases. The package tests reproduce them byte for byte.
- **Differential fuzz.** The pre-migration sources of all seven repos were extracted with `git archive HEAD src` and compared with the package and with the migrated hosts over seeded random inputs (NaN, infinities, negatives, out-of-range indices and channels, CJK, emoji, SGR and OSC 8 mixes, control and format characters). 57 targets and eight runs over four seeds (20261019, 7, 424242, 99), 243,407 to 545,907 comparisons per run and about 3.2 million in all; the last five runs used the package as installed in a consumer rather than the working tree (one on the previous candidate, two on the final candidate, two on the registry copy). No difference appeared outside the five documented below. A mutation control (a 1 ms shift in the comet clock, a one-unit change in the fade target, a 0.4 degree hue shift, a width off-by-one) was caught every time.
- **Statusline output dumps** taken before and after the migration (the theme palette in both modes, `fadeFg`, both borders over a perimeter walk, the context graph, the accent hashes, the sanitisers, `stripAnsi`, and every box preset) are byte-identical, on the candidate install and again on the registry install. The fuzz also ran against the registry copy (seeds 20261019 and 424242, 364,407 comparisons each, no unexplained difference).
- **Comment-only re-cut.** The final candidate (`0a22d10f…`) differs from the previous one (`139f0bef…`, on which the consumer gates and the first smoke pass ran) in eleven packed files: the CHANGELOG date and the two `./text` sources with their compiled outputs and maps. A comment-stripped transpile of all 51 source files is identical, with a negative control that was caught.

### Smoke evidence

Each extension ran in a barebones pi (`-ne -e <abs path>/index.ts`, `--model openai-codex/gpt-6-luna`, as planned) in a 120x40 tmux pane against the registry-installed copies (0.6.0 from npm); the same pass on the candidate install (`0a22d10f…`) gave the same results, and the numbers below are the registry run's. No Save, Start, Continue or Apply was pressed, and every session exited with ctrl+d. An earlier pass on the first two candidates had to use `google/gemini-2.5-flash`, because luna had answered "The usage limit has been reached"; luna answers again, and this pass replaced that one with the same results. tmux re-serialises attributes in a capture (an app's `ESC[22m` comes back as `ESC[0m` or `ESC[0;2m`), so the smoke checks structure, colour and motion; that the bars never emit `ESC[0m` is asserted byte for byte by the unit tests and the fuzz, not by a capture.

- **statusline + compact together:** the boxed layout drew its `░` context bar. During a short prompt (78 frames, 43 with the Working group) the group faded into the bar background, its grey frames reading `134;134;134`, `85;85;85`, `44;44;44` and `21;21;21` in turn (the bar background is `18;18;18`), while the path faded in. After the model read three large type-declaration files, `/compact` ran: across 43 frames of compact's above-editor widget and 51 of the statusline's bottom border, every frame had exactly 20 cells and the `38;2;38;100;70` trough, with 84 and 86 distinct comet colours and a bold crest in 21 frames each. The bar was about 21% full, so three or four cells were lit and the comet's travel was visible: across the widget frames its brightest cell moved from cell 3 down to cell 0 five times and wrapped back to the right three times. Compaction completed ("Compacted from 57,076 tokens").
- **pi-topping:** the working indicator walked the braille set in order (all ten glyphs in 20 frames, steps of one or two at the sampling rate), and the submitted-prompt box used `╭` (U+256D), the `rounded` style already in the owner's settings.
- **splash**, from an empty temp directory: the tagline reveal drew the `model · system prompt` placeholder (10 frames) and a bold truecolour shimmer crest on the tagline row (15 frames); at 46 columns the panel's widest line was 46 columns.
- **routesense**, `/routesense stats`: 5,095 requests, `$162.91`, 483,501,573 tokens, `$990.04` savings over 5,089 requests, and the `openai-codex/gpt-6-luna` row at 1,553 calls, 3 errors, 30%, 148,744,342 prompt, 977,500 completion, 95% cache, `$2.70`, p50 12087, identical in every run.
- **persona-audit and moa-fusion** only show their spinners during a real multi-model run, so throwaway harness extensions (outside every repo) import each repo's real source by absolute path and mount the real components with canned data in a real pi TUI, with no model call. persona-audit's `AuditProgressWidget`, four rows: the working rows' spinner went `◐◓◑◒◐◓◑◒…` in order (197 changes, all forward by one, 72 to 108 ms apart), the footer read `total cost $0.373*` (the sum of the canned `0.1234` and `0.25`, starred because two rows have no cost), and the rows without a cost showed `—`. moa-fusion's `MoaProgressWidget` and the real `withWorkingOverlay`: the widget's quadrant spinner (157 forward changes), the overlay's braille spinner (76 forward changes), `$0.123` and `$0.250` cells, `—` for the unknown, and `total $0.373`. The widest line in every frame was 120 columns, no error text appeared, and both harnesses printed `primitives 0.6.0` from the registry-installed package. A first pass of the same harnesses on the previous candidate behaved the same way, with slightly different change counts because the runs differed in length (persona-audit 187, moa-fusion 157 and 77), and the parent recounted its step histograms from the raw captures. These are component mounts, not audit or MoA runs.
- **Shasums.** All thirteen files the smoke could touch are byte-identical to their Stage 0 copies (`cmp`, checked after each pass, the last one on the registry copies: 13 compared, 0 changed), and `$TMPDIR/pi-tui-crash.log` did not exist before and does not exist after. The Stage 0 sha256 values:

```
2574cf06634081365e9adb85714dcc8c173c0d0b498cdd89c4d1ac428d8c5d98  ~/.pi/agent/crashes.json
0afd74b37558e82990f36b5591a60c54c6f387b18f62ce53bb61262e0b091ecc  ~/.pi/agent/settings.json
9d3147cd0d2c680b9fccb4bd2691ed4854c0bc1c8b7831a91792c19dabff566b  ~/.pi/agent/pi-topping/settings.json
947e90becd918c8a996ff3032faa7597f7bc92925304fcb2c6f8e33fe428b45b  ~/.pi/agent/pi-topping/custom_words.json
1bb5d791a98540d764dfc3af08a22fc3ae71825c68bc6dfd6f20b447c301bc33  ~/.pi/agent/pi-topping/setup-check.json
e999ee4ee0884fad6454fff25e4e55324d8cd569c575cdbec81d8a8dc36ba383  ~/.pi/agent/pi-topping-statusline/settings.json
cef4768e33681e3bbad85d6969181a19a93e9860550e1a37568b103db5b4a2b4  ~/.pi/agent/pi-topping-splash.json
7b8c187494624fc41ab8276fbff176f465883ac80bfefcc69c571c9323187149  ~/.pi/agent/pi-startup-splash.json
56d6d3c26647947c71bccdbfcb00128073943cbf44ad2b06eae997d395bdbebf  ~/.pi/agent/persona-audit/settings.json
a3524909066a1fbd4ff56dd078c199a59147d8c571ad3909f169e6c7534a9d05  ~/.pi/agent/pi-topping-routesense/config.json
56c2ee40e3b9a421b72b77728591792b7933b46dd30e8086a6ddf13026688a95  ~/.pi/agent/pi-topping-bash-gate/settings.json
ca1410e72a0742e4287158314b489c3d434f5577fe4797ef6c777875c46d1787  ~/.pi/agent/moa-plan/settings.json
22a83df00bdbc2040019f0c86417d28fb08fafcb5b7057ccc43b84aa504e7d44  ~/.pi/agent/mf-plan/settings.json
```

### Behaviour changes

- `pickFitting([])` returns an empty string where splash's copy threw. splash's only caller passes three literal candidates, so no host can reach it.
- Nothing else a user can see. Inputs the vendored copies mishandled are now defined: `shimmerCell` and `cosineFalloff` read a distance as a magnitude (a distance of -7 used to glow and go bold; a `bandHalf` of 0 wrote `NaN` into the escape), `fadeRgbToward` with a NaN opacity returns the text instead of writing `NaN` channels, and `mixRgb` with a NaN amount reads 0. Neither host reaches them: splash passes `Math.abs(i - pos)` with a fixed band, and statusline only fades while `leftFade < 1`.
- The spinner tables pi-topping, moa-fusion and persona-audit now import are frozen `readonly` tuples, not mutable arrays. No consumer mutates them (pi-topping `.map`s, the others index); an API typed as `string[]` would need `[...SPINNER_FRAMES]`.
- compact reads its colour depth through `getTerminalColorMode()`, which is `capabilities.trueColor ? "truecolor" : "256color"` in both the installed 1.0.0 and 1.3.0 copies, so the choice is unchanged.

### Deviations from §4.6 and the plan

- **`parseSgrColor`, not a second `ansiToRgb`.** §4.6 asks for an `ansiToRgb` covering 38/48 truecolor, 256-colour and 39, and §13 Remaining 5 forbids silently replacing `./activity-tui`'s truecolor-only one. The broad reader has its own name and a tagged result (`SgrColor | undefined`), so importing the wrong one is a compile error. The split is pinned by a test on `ESC[38;5;196m`, `ESC[39m` and `ESC[48;2;…m`.
- **Not added, because they already shipped:** `easeRaisedCosine` (it is `easeFade` in `./activity`), `FADE_SHADE_COUNT`, `formatClock` and `formatElapsedUnits` (`formatElapsedClock` and `formatElapsedUnits` in `./activity`), and `dimAttribute` (`./activity-tui`). Also not added: `hueDistance` and `rgbToHex` (pi-tui's `colorToHex` replaces the one caller), and a token formatter (§6 decision 6).
- **Added:** `channelsToFgAnsi`, so the fade and statusline's `fadeFg` build no tuple per colour; `mode` is a required argument of every call that writes an escape, so `./color` and `./glyphs` read no terminal state; `formatDuration` is `formatDurationCompact`, and the host wrappers keep `shimmerElapsedMs` where the package says `elapsedMs`.
- **Non-text helpers deferred** (resolution 2): `isPlainObject`, `hostBelow`, `isTruthyEnvFlag`, `suppressNotifications`, `combineSignals`, `raceAbort`, `createDeadline` and `stableStringify` wait for Phase 7's `./process` or for sensei's and the env-using repos' own adoption. `THIRD_PARTY_NOTICES.md` is unchanged. The `./text` barrel says so.
- **`xterm256ToRgb` keeps statusline's cube arithmetic**, `55 + v * 51`, where xterm's levels are `55 + v * 40` (0, 95, 135, 175, 215, 255). Levels 4 and 5 come out as 259 and 310, above what a channel holds, and every other non-zero level reads bright. It shows in the fade of a 256-colour escape and in the `rgb` that `parseSgrColor` reports for an indexed colour; a level-5 component passes 255 once the opacity is about 0.81 toward `#121212`. Correcting it would change faded 256-colour bytes, so it is kept for parity, documented in the README and CHANGELOG, and pinned by a test that must change with the fix. Corrected in 0.7.0; see §17.
- **`sanitizeLabel` limit.** It strips escape sequences with Node's regex-based `stripVTControlCharacters`, which removes CSI and OSC sequences whole but can leave the payload of a DCS, APC, PM or SOS string behind when it holds spaces or punctuation. pi-tui's `stripTerminalSequences` covers a different subset. Documented in the README, the CHANGELOG and the docblock; hosts with untrusted text should run `stripTerminalSequences` first.
- **Guards the vendored copies lacked** (see Behaviour changes) and a stricter hygiene path match (the directory straight under `src`, so a checkout under a directory named `color` no longer makes every file pi-free).
- **Smoke deviation:** persona-audit and moa-fusion were checked through harness mounts (above), not real audit or MoA runs.
- **Review.** A fresh-context read-only reviewer could not execute anything; it returned no blockers and about twenty findings (behavioural guards, several overstated docs claims, test names and a vacuous inclusivity test). All were fixed before release. The independent verifier then found the sanitiser docblocks did not name their sources, the `./text` barrel lacked the Phase 7 deferral and `docs/consumers.md` lacked the release; those were fixed by re-cutting the release before it was published, which is why the candidate moved from `139f0bef…` to `0a22d10f…` and the primitives commits from `1d9db07`/`685c6d4` to `607b722`/`f756bcb`.
- **Files outside the plan's lists:** `packages/primitives/tests/phase6-fixtures.ts` (the shared fixture decoder).
- **`package.json` formatting.** The consumers' `package.json` files were edited by hand (the dependency line only) before the install, and npm rewrote three of them on the real install (compact, pi-topping and splash: inline arrays expanded, dependency keys re-sorted), as a rehearsal against a throwaway local registry had predicted. Each was restored to the one-line edit, so every `package.json` diff is exactly the dependency range, and each lockfile changed by four lines added and four removed (the root range and the primitives entry's `version`, `resolved` and `integrity`).
- The publish was run by the owner (`npm publish -w @underactive/pi-topping-primitives`); the registry artifact was then verified byte for byte against the release-commit tarball, as in Phase 5.

### Remaining

1. Pushes (the primitives branch and `v0.6.0` tag, then each consumer) need separate owner approval; the Phase 4 and Phase 5 pushes are still pending too.
2. The deferred non-text helpers (above) for Phase 7 and sensei.
3. splash's `hsvRgb` (it returns a string, and delegating would allocate a tuple per swatch cell) and `sanitizeTuiText` stay local; no consumer adopts `hsvToRgb` yet.
4. moa-fusion's eight-field joined boxes, persona-audit's `sanitizeDiffLine` and routesense's signed `formatCost` stay local by design.
5. `./activity-tui`'s `shimmerString` keeps its own loop, because it always closes a cell with `ESC[22m` and sweeps a string; only splash's per-cell `shimmerCell` moved.
6. The `sanitizeLabel` limit above; the cube defect is fixed in 0.7.0, see §17.
7. pi-switchyard (pin bump, menu, models, and now colour/text), sensei and web-tools/bash-gate for the env and abort helpers.
8. `@underactive/pi-topping-test-utils` moved to 0.6.0 in lockstep and stays unpublished.

## 17. Phase 6.1 outcome: the xterm256ToRgb cube fix (0.7.0, 2026-10-20)

Status: **published by the owner and `latest`.** Registry shasum `6e19432a6408fc6f5f8519d8af64f03f56e09b7a`, integrity `sha512-Cxz1cLvgSbJ7fTg3jd+xQDX5O9sq65UzHlCVuZcphgGvdUW/+xH103Tci0P2BywPolmQP9v2qTP5VJRY+DEebQ==`. The registry tarball is byte-identical to the Stage 3 candidate (`cmp` agrees; sha256 `b5df292c7d034dcc05ec4eec16a354d2572fd16f0e3c874d38a028bd7f5298ef`). The mf-plan verifier ran once the implementation turn settled at the publish pause (report `.pi/mf-plan/read-implement-pause-publish__verification.md`, local and gitignored, 2026-10-20 10:35). Verdict: **partial**. C1–C25 and C28 pass, including a hand re-derivation of all 24 fixture rows and of the host test's values. C26, C27, C29 and C30 failed only because Stages 5–7 were waiting on the publish. Those stages landed afterwards (below) and have not been re-verified independently.

### What shipped

- **primitives** (`7931410` fix, `aa89b9b` release; local tag `v0.7.0`): `cubeLevel` now reads the xterm cube as `55 + v * 40`, yielding levels 0, 95, 135, 175, 215 and 255. The gray ramp, indices 0–15 as black, `rgbTo256`, comet bar and truecolor-sourced fades are unchanged. Primitives and test-utils moved to 0.7.0 in lockstep; test-utils remains unpublished.
- **statusline** (`d32b9f7`): adopts the registry package at `^0.7.0` and adds a host regression test and changelog entry; runtime source is unchanged. It is the only consumer bumped. The other six consumers remain on `^0.6.0` until their next bump.
- **Plan record** (`pi-topping`, `adf64f1`): Phase 6.1 was recorded on `primitives-color` before implementation. No branches or tags were pushed.

### Behaviour and fixtures

| Cube digit `v` | 0 | 1 | 2 | 3 | 4 | 5 |
| --- | --- | --- | --- | --- | --- | --- |
| 0.6.0 (`55 + v * 51`) | 0 | 106 | 157 | 208 | 259 | 310 |
| 0.7.0 (`55 + v * 40`, xterm's) | 0 | 95 | 135 | 175 | 215 | 255 |

The corrected cube changes `xterm256ToRgb` and `parseSgrColor`'s `rgb` for indices 17–231, and therefore changes their partial fades. For example, index 196 at opacity 0.75 changes from truecolor `38;2;237;5;5` to `38;2;196;5;5`; in 256-colour mode its faded foreground changes from index 196 to 160 (the bar background remains 247). Index 39 at 0.9 changes from truecolor `2;189;281` to `2;159;231`, and from 256-colour index 46 to 39. Index 178 at 0.9 remains 178 instead of turning gold at 220. The 24 cube-reaching fixture rows were recomputed; 18 output lines changed bytes and the other six stayed identical. No unrelated fixture output changed.

### Test counts and release gates

| Repo / gate | Result |
| --- | --- |
| primitives `npm run check` | baseline 47 + 485 + 53 + 12 + 38; now repo 47, source 490 (+5), compiled exports 54 (+1), test-utils source 12 and exports 38; pack check 2 packages / 325 files |
| statusline, registry 0.7.0 | baseline 194; the new host test failed against 0.6.0 (46 / 220 / 281); against registry 0.7.0, typecheck passed and 195 tests passed (+1, the host test) |
| statusline, fresh `npm ci` clone at `d32b9f7` | `npm ls` resolved registry 0.7.0 with no file/link; typecheck passed; 195 tests passed; clean tree |
| statusline extension loader | bundled chunk and unbundled SDK each registered 1 command and 13 handler event types, with zero errors |

The package loader probe passed all four bundled/unbundled × pi-peers-present/absent rows against both the candidate and registry tarball. Every real `./color` row returned `cube: [0,175,255]` with zero errors. `npm view` confirmed 0.7.0 is `latest`.

### Smoke evidence

In 120×40 tmux panes, statusline loaded through `-ne -e` in a scratch git repository with one staged, one unstaged and one untracked change. The 256-colour capture covered 160 top-border frames and showed `*1` at 178, `+1` at 70 and `?1` at 39; neither wrong index 46 nor 220 appeared. The truecolor capture covered 160 frames and 18,274 truecolor SGR triples; every channel was an integer from 0 through 255. The statusline settings file and `crashes.json` retained their original SHA-256 values, and `$TMPDIR/pi-tui-crash.log` was absent.

The short live prompts did not produce an observable `leftFade` transition in the captured frames. The statusline host regression directly exercises the fade at opacity 0.9 in both colour modes; the live smoke is recorded as a render/crash sanity check, not as proof of the animated transition.

### Deviations and remaining

- The cube fix changes only statusline's faded git indicators (`*N`, `+N`, `?N`); no other consumer calls the changed functions.
- The verifier's deviations need no change. The §5 heading reads `xterm256ToRgb cube correction` where the plan said `the xterm256ToRgb cube fix` (committed in `adf64f1`). The criteria's literal greps for `55 + v * 51` and `[310, 0, 0]` hit only the docblock sentence and the `// 0.6.0:` comments the plan requires. `docs/consumers.md:7` said statusline had moved before it had; `d32b9f7` made that true.
- The verifier could not run commands, so the gate counts above are executor runs. The four post-publish criteria (C26 statusline's range and lockfile, C27 its CHANGELOG, C29 this section, C30 the memory note) were closed after the verifier ran and have not been independently re-verified.
- `rgbTo256` remains a linear approximation and does not round-trip every xterm index.
- The documented `sanitizeLabel` limitation remains.
- Six consumers remain on `^0.6.0`; they adopt 0.7.0 on their next bump.
- Pushes of the primitives branch/tag and consumer branches remain pending separate owner approval.

**Next: Phase 7 (`./process`), released as 0.8.0.**
