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
