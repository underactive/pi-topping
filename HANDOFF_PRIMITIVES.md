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

- Archive pi-topping-insights. After a grace period drop the migration read in pi-topping `src/settings.ts:172-178`. **Status (2026-10-20, §21):** insights was never committed or pushed, so there is nothing to archive; the migration read was removed in `4f25d9f`.
- Raise devDependency pins to 1.3.0 in bash-gate, compact, insights (if kept) using the in-place pin recipe in the memory note `pi-topping-family-compat-check.md`. All needed exports were confirmed present at 1.0.3 in those repos' installed node_modules. **Status (§21):** moot; all three are being retired, so their pins (bash-gate 0.99.1, compact 1.0.0, insights 1.0.0) were not raised.
- pi-topping `src/toppings.ts` catalogue lists only the five siblings published on npm (statusline, splash, persona-audit, web-tools, moa-fusion). That is correct today: `/topping-setup` installs through `pi install npm:<pkg>`, so an unpublished entry would produce an unactionable notice. When routesense, sensei, or bash-gate are published, add them in the same change. Never add compact (private), insights (retiring), or the primitives package (a library, not an extension). **Status (§21):** still correct; bash-gate is being retired and is no longer a candidate, and routesense and sensei are still unpublished.
- compact's `node_modules` (1.0.3) disagrees with its lockfile (1.0.0); reinstall after the pin bump. **Status (§21):** the drift is gone (installed and locked are both 1.0.0) because the `npm install` run in compact for the 0.9.0 adoption reconciled it; the pin bump itself is moot.

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
- pi-topping-insights archived; compact's embed module deleted; pi-topping's sibling catalogue current; laggard pins at 1.3.0. (Status 2026-10-20, §21: the embed module went in Phase 1; the catalogue is current; the insights and pin items were resolved by retiring bash-gate, compact and insights.)
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

Status: **published by the owner and `latest`.** Registry shasum `6e19432a6408fc6f5f8519d8af64f03f56e09b7a`, integrity `sha512-Cxz1cLvgSbJ7fTg3jd+xQDX5O9sq65UzHlCVuZcphgGvdUW/+xH103Tci0P2BywPolmQP9v2qTP5VJRY+DEebQ==`. The registry tarball is byte-identical to the Stage 3 candidate (`cmp` agrees; sha256 `b5df292c7d034dcc05ec4eec16a354d2572fd16f0e3c874d38a028bd7f5298ef`). The mf-plan verifier ran once the implementation turn settled at the publish pause (report `.pi/mf-plan/read-implement-pause-publish__verification.md`, local and gitignored, 2026-10-20 10:35). Verdict: **partial**. C1–C25 and C28 pass, including a hand re-derivation of all 24 fixture rows and of the host test's values. C26, C27, C29 and C30 failed only because Stages 5–7 were waiting on the publish. Those stages landed afterwards (below). A manual re-run of the same verifier (`claude-bridge/claude-sonnet-5-5` at `max`, read-only tools; report `.pi/mf-plan/read-implement-pause-publish__reverification.md`, 2026-10-20 13:11) judged only those four and returned **complete**: all four pass, with cosmetic deviations only.

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
- The verifier's deviations need no change. The §5 heading reads `xterm256ToRgb cube correction` where the plan said `the xterm256ToRgb cube fix` (committed in `adf64f1`). The criteria's literal greps (C3 over `src/`, C8 over `color-rgb.test.ts`) for `55 + v * 51` and `[310, 0, 0]` hit only the docblock sentence and the `// 0.6.0:` comments the plan requires. `docs/consumers.md:7` said statusline had moved before it had; `d32b9f7` made that true.
- The verifier could not run commands, so the gate counts above are executor runs; it re-derived the fixture rows, the before/after bytes and the 24-reached/18-changed count by hand. The four post-publish criteria (C26 statusline's range and lockfile, C27 its CHANGELOG, C29 this section, C30 the memory note) were closed after its first run and passed its re-run. The re-run's deviations need no change: §17's headings are condensed against §16's, `e0072d6` is an extra correction commit, and the memory note was first written to pi's own store (`~/.pi/agent/memory/…`) before the `~/.claude` note the criterion names.
- `rgbTo256` remains a linear approximation and does not round-trip every xterm index.
- The documented `sanitizeLabel` limitation remains.
- Six consumers remain on `^0.6.0`; they adopt 0.7.0 on their next bump.
- Pushes of the primitives branch/tag and consumer branches remain pending separate owner approval.

**Next: Phase 7 (`./process`), released as 0.8.0.**

## 18. Phase 7 outcome (2026-10-20)

Status: **complete.** `@underactive/pi-topping-primitives@0.8.0` (`./process`) was published to npm by the owner on 2026-10-20 and is `latest`. Its registry artifact (shasum `d008995760e22028a8c8f3e144d1b9e3a7dc8101`, integrity `sha512-e4KaaGDZaKtWlpciFgDDXtikdBxOkjP2u6YSNZ2ua7euDkdaN4X6Nws0N58mpPVPplBRNopDLAQhx0FfH2gc2A==`, 290 files) is byte-identical to the tarball packed from the release commit (sha256 `41117c7f574c13a6601f224897686dd2e1ebbd0348f7abb378cedf57e9305226`; `cmp` agrees). Tag `v0.8.0` is local, on primitives `734b983` (`fa83d00` feat). moa-fusion, persona-audit, pi-topping and splash are committed locally on `primitives-process` against `^0.8.0` from the registry; nothing is pushed. This is the last planned subpath: no phase remains.

The mf-plan verifier ran three times (reports in `.pi/mf-plan/`, local and gitignored; the two out-of-band runs write the same `read-implement-phase-seven__verification.md`, so the later one overwrote the earlier). **Run 1** came when the implementation turn stopped at the publish pause (2026-10-20 14:57). Verdict: **partial**. Three criteria failed on content and the rest could not be checked without history or the registry:

- **C11 (timer margins):** the kill tests used 20 ms graces and 60 ms waits, and the spawn timeout test used 400 ms with no ready handshake. They now use a 50 ms grace, waits of ten times that where nothing more should happen, and a deadline poll where a signal is expected; the spawn timeout test runs `timeoutMs: 100, killGraceMs: 50` against `sh`, which traps SIGTERM on its first instruction, so there is no startup race (a node child installs its handler about 40 ms in). It is stable over five runs and four parallel runs.
- **C16 (CHANGELOG provenance):** the `### Added` entry named source repos and files without lines. It now lists each export group with its source lines at the base commits.
- **C26 (installer timeout):** the injected child could be ended by SIGTERM. It is now `sh -c 'trap "" TERM; sleep 1.5'`, so the timeout resolves while the child is still alive (asserted under 1 s) and the child ends by itself.
- **C29 and C30** waited for the publish and landed afterwards (below). **C1, C9, C10, C18, C19, C22, C28** asked for history and execution evidence rather than content; it is recorded under "Evidence for the cannot-verify criteria".

Because the CHANGELOG is packed and the release was unpublished, the fixes were folded into the feat commit and the release commit was replayed on top (`4631c83`/`cf9d25a` became `fa83d00`/`734b983`, tag moved), as in Phase 6. The first release pack (shasum `55d48cce6034d5feda83e0a59a481139e5eda790`) was superseded before it was published; the pack that differs from the Stage 2 candidate only in the version field and the CHANGELOG is the published one.

**Run 2** (out-of-band again, 15:31, after the fixes, the publish, the consumer commits and this section; the file `__verification.md` now holds it) returned **cannot-verify** with no failing criterion: C11, C16 and C30 passed. C1, C9, C10, C18, C19, C22, C26, C28 and C29 stayed unverified because the verifier is read-only and the harness gives it only the session repo's own check output (pi-topping's 245 tests): it cannot run `git diff <base> HEAD`, execute the other repos' suites or compare the registry tarball. It also noted that this section said the splash gate and the `/topping-setup` menu had not been exercised, which was true then. Both were rendered and cancelled afterwards in throwaway agent directories and the section was corrected (`2eaf232`).

**Run 3** (manual, 16:03, `__reverification.md`; `openai-codex/gpt-6.1-sol` at medium, read-only, 47 s, run through moa-fusion's own `buildVerifierTask` and `runSingleAgent`) re-checked those ten criteria (the nine above plus C30, which `2eaf232` touched) against `__evidence.md`: 926 lines of raw command output (branch refs, `git diff --quiet <base> HEAD` for every protected file, range-only manifest diffs, the `cmp` of the registry tarball against a fresh pack, fresh-clone gates, loader rows) plus nine fresh script results that all passed. Verdict: **complete**, all ten pass. A tripwire over the five repos' HEADs and status, the memory files and the 14 settings files showed no change.
### What shipped

- **primitives** (`fa83d00` feat, `734b983` release):
  - `./process` exports `resolvePiInvocation(args?, facts?)` returning `{ command, args, via }` with `via` one of `"script"`, `"executable"` and `"path"` (moa-fusion's `getPiInvocation`, `nodejs` added to the generic runtimes, no Windows shim); `escalateKill` and `DEFAULT_KILL_GRACE_MS`; `createProcessTracker()` (a frozen, Set-like registry: `add`, `delete`, `has`, `size`, `cleanup`); `spawnCollect` and `SPAWN_TIMEOUT_EXIT_CODE` (pi-topping's collect-with-124 contract, plus `timedOut`); `mapWithConcurrencyLimit` (with `onStart`); `parsePiVersion`, `versionAtLeast`, `hostBelow`; and `parseAgentFile`, `loadAgentsFromDir`, `findNearestProjectAgentsDir` with the `parseThinking` callback. Thirteen runtime exports and eleven types.
  - `agents.ts` imports `parseFrontmatter` and `CONFIG_DIR_NAME` from pi-coding-agent at runtime, the second subpath to do so after `./settings`. The other five files need only Node.
  - `scripts/probe-pi-loader.sh` takes `SUBPATH=process`. `THIRD_PARTY_NOTICES.md` records the MIT licence of pi's `subagent` example for `invocation.ts`, `concurrency.ts` and `agents.ts`. The README gained `## Process` and lost `## Future subpaths`. The `./text` barrel now says `hostBelow` shipped. Primitives and test-utils moved to 0.8.0 in lockstep; test-utils stays unpublished.
- **Consumers**, each one commit titled `feat(process): Adopt @underactive/pi-topping-primitives 0.8.0 process primitives`: moa-fusion `7e439e4`, persona-audit `f618f46`, pi-topping `1fd68fa`, splash `fa4ef9d5`. Each commit's parent is its stated base (`9f3b187`, `e678f0f`, `c8e2f3e`, `a8cb0f87`):
  - **moa-fusion** (`^0.6.0` to `^0.8.0`): `processPool.ts` is the host tracker module (`trackedProcesses = createProcessTracker()`, `cleanupTrackedProcesses` delegating to `.cleanup`); `runner.ts` calls `resolvePiInvocation` at its two sites and loses `getPiInvocation`; `piCapabilities.ts` re-exports the version helpers and `PiInvocation` and keeps the `--no-mcp` probe and its cache; `discovery.ts` keeps `AgentScope`, the user-then-project merge and its two-argument `parseAgentFile`, with a frozen `AGENT_FILE_OPTIONS` carrying `isThinkingLevel`.
  - **persona-audit**: `subprocess.ts` re-exports `loadAgentsFromDir` and `mapWithConcurrencyLimit` (so every importer keeps its path), defines `AgentConfig = AgentDefinition<AgentSource>`, and keeps `BUNDLED_AGENTS_DIR`, the bundled, user, project order and the `persona-audit-*` shadow guard.
  - **pi-topping**: `pi-installer.ts` resolves the pi hosting the session, takes an optional `{ piInvocation }` third parameter, wraps in `cmd.exe /c` only when `via === "path"` on Windows, and returns exactly `{ code, stdout, stderr }`; `util.ts` re-exports `hostBelow`.
  - **splash**: `relaunch.ts` gained `relaunchInvocation(overrides, facts?)`, which returns `undefined` for the PATH fallback, and `relaunchPi` refuses before `tui.stop()` on that.
  - moa-fusion's commit leaves its pre-existing `test/rename-verification.test.mjs` edit and the untracked `HANDOFF-fanout-max-tokens.md` alone; its lockfile is not tracked, so none was added.

### Test counts (Stage 0 baseline to now)

| Repo | Baseline | Now | Where the difference went |
| --- | --- | --- | --- |
| primitives | 47 + 490 + 54 + 12 + 38 | 47 + 561 + 63 + 12 + 38 | source +71: 70 in six new suites (`process-invocation` 10, `process-kill` 15, `process-spawn` 14, `process-concurrency` 9, `process-version` 8, `process-agents` 14) and +1 row in `entries.test.ts`; compiled +9 (+3 rows in the compiled entries test: resolves to dist, second instance, no shared mutable state; +6 in `exports/process.test.ts`) |
| moa-fusion | 108 | 108 | nothing removed or added as a test. `plan-read-only-boundary.test.mjs` swapped its five body-shape greps on `cleanupTrackedProcesses` for delegation greps (imports from the package, `trackedProcesses = createProcessTracker()`, `.cleanup(termTimeoutMs)`, no `new Set(`, no `!proc.killed`, no `proc.kill(`); the behaviour they described is pinned by the package tests "cleanup SIGKILLs the snapshot after clearing" and "cleanup judges a process by its exit state, not its killed flag", and by the unchanged real-child `subagent-trust-boundary.test.mjs`. `agent-thinking-frontmatter.test.mjs` gained broken-YAML, `tools: [read]` and `name: 123` siblings |
| persona-audit | 604 | 606 | -1 `mapWithConcurrencyLimit preserves order and caps concurrency` -> the same name in `process-concurrency.test.ts`, body moved verbatim; +1 `mapWithConcurrencyLimit is the shared implementation` (identity against the package function); +2 `a project-local persona-audit-* file cannot shadow the bundled agent` and `a malformed project agent file does not abort discovery`, both isolated with `PI_CODING_AGENT_DIR` |
| pi-topping | 242 | 245 | +3 installer tests that inject `piInvocation` (success passthrough for install and remove, the 124 timeout with the exact `[timed out after 50ms]` suffix against a SIGTERM-ignoring child, spawn error code 1). `tests/util.test.ts` is byte-identical to `c8e2f3e` and stays as the host oracle; its `hostBelow` table is copied byte for byte into `process-version.test.ts` |
| splash | 463 | 466 | +3 pure `relaunchInvocation` tests (X-07: script, Bun virtual path, PATH fallback refused). X-01 to X-05 and `gate.test.ts` are byte-identical to `a8cb0f87` |

Stage 0 was recorded on the branch heads before any edit with each repo's own runner (splash counted with `--test-reporter=spec`). Each consumer's suite also ran **unedited** against the candidate and returned the baseline count (108, 604, 242, 463) before a test moved. The same counts held against the registry install and in fresh clones of the committed branches (`npm ci`, or `npm install` for moa-fusion), each of which installed 0.8.0 from the registry, with typecheck clean.

### Package gate

`npm run check` at the primitives root passed with the counts above in the working tree, on the feat commit alone (which still carries version 0.7.0 and the `./process` export as the last key), and in a clean `npm ci` checkout of `v0.8.0`. `check:pack` reports 2 packages, 355 files, nothing forbidden and no `dist/` committed. `node scripts/check-release.ts packages/primitives` lists ten non-empty subpaths: `./contracts` 8 exports, `./settings` 10, `./activity` 22, `./activity-tui` 11, `./menu` 11, `./models` 19, `./color` 23, `./text` 17, `./glyphs` 5, `./process` 13. The repo's own hygiene scanner reports zero findings on all seven `src/process` files, and `tools/`, `tests/package-shape.test.ts`, `scripts/check-release.ts`, `scripts/check-pack.ts`, `.github`, `biome.json` and `tsconfig.base.json` are untouched across both commits.

The timer-based tests were checked for discrimination as well as stability, on the final versions of the suites: with the settled check also reading `proc.killed`, with the snapshot taken after the clear, with the finite-timeout guard removed, with `setEncoding` removed and with both SIGKILL calls removed, the matching tests failed (3, 5, 1, 1 and 8 tests) and the source was restored with `git checkout`. The final process suites pass 70 of 70 in four parallel runs.

### Loader gate

`SUBPATH=process` writes a project agent file and reports what the package reads through pi's real loader. On pi 1.3.0 and Node 24.18, in both loader branches with pi peers present and absent, all four rows returned zero errors and the expected JSON, against the Stage 2 candidate, against the release tarball, and again against the registry tarball; `SUBPATH=settings`, the other pi-coding-agent importer, passed all four rows each time.

| Subpath | Expected row (all four peer/branch combinations) |
| --- | --- |
| `process` | `{"agents":[["probe",["read","grep"],"high"]],"atLeast":true,"inv":{"command":"pi","args":["--version"],"via":"path"},"mapped":[2,4,6],"tracked":0}` |

With `PEERS=absent` nothing else on disk can supply pi-coding-agent, so that row shows `parseFrontmatter` and `CONFIG_DIR_NAME` resolving through the host's alias. The probe spawns nothing. All four consumers loaded through both branches with zero errors against the candidate install and again against the registry install (commands/handlers: pi-topping 2/13, splash 2/4, persona-audit 3/4, moa-fusion 8/11, identical to §16), and hiding `node_modules/@underactive/pi-topping-primitives` made each load fail ("Cannot find module '@underactive/pi-topping-primitives/<first subpath imported>'"), so the check can fail.

### Evidence for the cannot-verify criteria

- **Branches (C1):** each of the five repos has a local `primitives-process`; no `refs/remotes/*/primitives-process` exists anywhere. statusline, compact, routesense, sensei, bash-gate, web-tools and pi-switchyard have no such branch and no `feat(process)` commit; their dirty files were dirty before the phase and were not touched.
- **Byte identity against the bases (C18, C19, C22, C28):** against moa-fusion `9f3b187`, `planMode.ts`, `mutationTripwire.ts`, `wire.ts`, `authoritative.ts`, `mfPlanSubagent.ts` and the four oracle tests (`subagent-trust-boundary`, `runner-nul-task`, `runner-no-mcp`, `max-concurrent-agents`) are identical, and `runner.ts` differs only in the new import, the deleted `getPiInvocation` and the two call lines. Against splash `a8cb0f87`, the only removed line in `relaunch.test.ts` is the import, and the X-01 to X-05 blocks and `gate.test.ts` are identical. `getPiInvocation` appears nowhere under `src/`. The moa-fusion suite reports 108 tests (84 `.mjs` files).
- **Feat-commit manifest (C10):** `fa83d00` has version 0.7.0 and `./process` as the last export; `734b983` changes only the version, to 0.8.0.

### Smoke evidence

Each extension ran in a barebones pi (`-ne -e <abs path>/index.ts`, `--model openai-codex/gpt-6-luna`) in a 120x40 tmux pane. No Save, Apply, Start or Install was pressed, and every session exited with ctrl+d.

- **pi-topping:** loaded (`[Extensions]` listed the checkout), no old-host warning on pi 1.3.0 (`hostBelow("1.3.0", "1.2.0")` is false), and `/topping-setup` answered "All Pi Topping extensions are already active in this session", because under `-ne` it reports the settings fallback and does not open its menu. The installer's real spawn path was therefore **not** run live; the three injected-invocation tests cover it. A second pass in a throwaway `PI_CODING_AGENT_DIR` (no toppings installed, so the real settings were never in play) opened the real menu: a "Missing Toppings" list with statusline, splash, persona-audit, web-tools and moa-fusion all pre-checked "will install", where Enter would have run `pi install`. It was left with Escape only: no `pi install`, `pi remove` or `npm install` process existed at any point, and the throwaway directory recorded no package.
- **splash**, from an empty temp directory: the startup panel drew, and `/topping-splash-settings` rendered the shared menu and was left with Escape. `menuGate` is off in the owner's settings and was not changed. A second pass in a throwaway agent directory with `menuGate: on` (and the changes summary off, so no model call) rendered the real startup gate: New session, Resume session, Model, Theme, View system prompt, Settings and Quit, with the hint "esc = new session". Escape proceeded to the normal editor; the session's pi had no child process (no relaunch), and Ctrl+D exited. Choosing Resume, Model or Theme was not tried, so the relaunch itself was **not** triggered; its resolution is covered by the pure tests only.
- **persona-audit:** `/persona-audit --full src/modelConfig.ts` reached "Choose reviewers" (the command refuses to start if the bundled agents are missing), the manual list showed 53 reviewers, and Escape ended with "Audit cancelled.". A direct call of the real `discoverAgents` against the candidate install returned `persona-audit-adjudicator`, `persona-audit-reviewer` and `persona-audit-verifier`, all `bundled`, with no `thinking` key on any.
- **moa-fusion:** loaded. A throwaway harness extension outside every repo called the real `runSingleAgent` once ("Reply with exactly OK.", `openai-codex/gpt-6-luna`): the resolver returned `via: "script"` with node and pi's own `.bin/pi`, the child exited 0 with output "OK", `trackedProcesses.size` was 0 afterwards, and `ps` showed no leftover child. The run was repeated against the registry install with the same result.
- **Shasums.** All fourteen files the smoke could touch are byte-identical to their baseline copies (`cmp` and `shasum -c`, after the candidate pass and again after the registry pass), and `$TMPDIR/pi-tui-crash.log` did not exist before and does not exist after. The baseline sha256 values:

```
0afd74b37558e82990f36b5591a60c54c6f387b18f62ce53bb61262e0b091ecc  ~/.pi/agent/settings.json
2574cf06634081365e9adb85714dcc8c173c0d0b498cdd89c4d1ac428d8c5d98  ~/.pi/agent/crashes.json
9d3147cd0d2c680b9fccb4bd2691ed4854c0bc1c8b7831a91792c19dabff566b  ~/.pi/agent/pi-topping/settings.json
56c2ee40e3b9a421b72b77728591792b7933b46dd30e8086a6ddf13026688a95  ~/.pi/agent/pi-topping-bash-gate/settings.json
e999ee4ee0884fad6454fff25e4e55324d8cd569c575cdbec81d8a8dc36ba383  ~/.pi/agent/pi-topping-statusline/settings.json
cef4768e33681e3bbad85d6969181a19a93e9860550e1a37568b103db5b4a2b4  ~/.pi/agent/pi-topping-splash.json
a3524909066a1fbd4ff56dd078c199a59147d8c571ad3909f169e6c7534a9d05  ~/.pi/agent/pi-topping-routesense/config.json
08b1dc585965b1fb5ca71c5fb303a0526fcf2f62e07ab10fd99c30b02dddb051  ~/.pi/agent/pi-topping-routesense/config.v1.json
7b8c187494624fc41ab8276fbff176f465883ac80bfefcc69c571c9323187149  ~/.pi/agent/pi-startup-splash.json
56d6d3c26647947c71bccdbfcb00128073943cbf44ad2b06eae997d395bdbebf  ~/.pi/agent/persona-audit/settings.json
ca1410e72a0742e4287158314b489c3d434f5577fe4797ef6c777875c46d1787  ~/.pi/agent/moa-plan/settings.json
3a75440df39db2bd1cc895c78677cb1a3fa35e951631be1dbcd2f4016648d584  ~/.pi/agent/mf-plan/settings.json
947e90becd918c8a996ff3032faa7597f7bc92925304fcb2c6f8e33fe428b45b  ~/.pi/agent/pi-topping/custom_words.json
1bb5d791a98540d764dfc3af08a22fc3ae71825c68bc6dfd6f20b447c301bc33  ~/.pi/agent/pi-topping/setup-check.json
```

`mf-plan/settings.json` differs from the §16 value (`22a83df0…`): it had already changed before this phase's baseline was taken, and the smoke left the Phase 7 baseline intact. The other thirteen match §16.

### Behaviour changes

- **pi-topping's install target.** `/topping-setup` install and remove now run the pi hosting the session (the entry script under its runtime, or a compiled pi's own executable) instead of the first `pi` on PATH, so they reach the same agent directory. They fall back to `pi` on PATH only when neither is usable, and on Windows `cmd.exe /c` is used only for that fallback. Spec rejection, code 124 and the `[timed out after Nms]` suffix are unchanged; output is decoded intact across chunk boundaries.
- **splash's relaunch.** A Bun-compiled pi is relaunched through its executable instead of being handed its `/$bunfs/root/` virtual script path; the PATH-only case is still refused before the TUI stops. This is inferred from moa-fusion's handling and covered with injected process facts, not on a real compiled binary.
- **Malformed agent files are skipped.** In moa-fusion and persona-audit a bad file (broken YAML, a frontmatter that is not a mapping, a non-string `name`, `description`, `tools`, `model` or `thinking`) no longer aborts discovery, and a non-string `name` can no longer crash `/persona-audit`. This fails closed: a malformed project file cannot override a trusted bundled definition. YAML `null` counts as absent.
- **`nodejs` is a generic runtime** when looking for the pi to spawn, as `node` and `bun` already were (the basename comparison was already case-insensitive).
- **`mapWithConcurrencyLimit`** accepts `NaN` and fractional limits (the vendored copies threw `RangeError`) and a `readonly` input. `spawnCollect`'s SIGKILL timer is `unref`'d, where pi-topping's old one kept the event loop alive.
- Nothing else a user can see. Statusline, compact, routesense, sensei, bash-gate and web-tools do not call `./process` and are unchanged.

### Deviations from §4.7 and the plan

- **Tracker factory instead of an exported set.** §4.7 names `trackedProcesses`; a package-level `Set` would be module state (the hygiene `module-state` rule and the deep-frozen exports test both reject it), so each extension makes its own with `createProcessTracker()`. moa-fusion keeps the name `trackedProcesses` for its instance, so `runner.ts`, `planMode.ts` and the `size` assertions did not change.
- **`resolvePiInvocation(args, facts?)` returns `via` and wraps no shell.** The PATH fallback is something each host decides about: pi-topping's installer adds `cmd.exe /c` there only, and splash refuses there. `cmd.exe` re-parses its arguments, so a shared wrapper would put moa-fusion's arbitrary task text at risk.
- **`spawnCollect` clamps oversized finite timeouts** to Node's 2,147,483,647 ms timer limit (a larger delay fires almost at once). This was not in the plan; the message still prints the requested value. It is documented in the source but not in the published CHANGELOG, which is already on the registry, so it belongs in the next release's notes.
- **The rewritten moa-fusion greps** (above) replace body-shape checks with delegation checks; the fallback the plan named (moa keeps its local cleanup body) was not needed.
- **Skip rules** go further than either vendored loader: both let the parser's exception escape.
- **The timeout tests use `sh`**, not a node child, for the SIGTERM-ignoring case (above), and the installer's timeout test is POSIX-only like the package's.
- **Notice source.** pi-coding-agent's npm package ships no `LICENSE`; the copyright line (`Copyright (c) 2025 Mario Zechner`, MIT) was taken from the `earendil-works/pi` repository's `LICENSE` on GitHub, and the package's own `"license": "MIT"` and `"author"` fields agree.
- **`docs/consumers.md` at the release commit** said the four consumers had moved to `^0.8.0` before they had; the consumer commits made it true.
- **What Run 3 rests on.** The verifier cannot run commands, so it passed the history-dependent criteria on the supplied command output together with its own reads of the live files (the seven `src/process` files, `processPool.ts`, the `runner.ts` call sites, the manifests), not on commands it ran. The bundle is generated by `make-evidence.sh` scripts kept outside the repos; its first draft compared every repo against splash's base because macOS bash 3.2 has no associative arrays, and was fixed before the run. Its deviations list repeats the clamp, the `/bin/sh` tests and the premature `docs/consumers.md` sentence, all recorded above.
- **Files outside the plan's lists:** none.

### Remaining

1. ~~Pushes~~ Primitives `main` and tags `v0.2.0`–`v0.8.0` were pushed afterwards (§19). The consumer branches (pi-topping, moa-fusion, persona-audit, splash, statusline and the Phase 2 to 6 stacks) still need separate owner approval.
2. ~~The deferred non-text helpers wait for sensei's, web-tools' and compact's own adoption.~~ The env-flag and abort helpers shipped in 0.9.0 (§20); `isPlainObject` and `stableStringify` stay local to their hosts.
3. Sub-run transports, agent layering and persona-audit's shadow guard stay in their hosts by design. moa-fusion's `--no-mcp` probe and cache stay local.
4. pi-switchyard (pin bump, menu, models, colour/text and now process) adopts `^0.8.0` on its next bump. sensei and web-tools did (§19, §20); compact and bash-gate are being retired and will not (§21). statusline stays on `^0.7.0` and routesense on `^0.6.0` until then.
5. Not exercised: Windows (the `cmd.exe` wrapper and `basename` handling are tested as strings only), splash's relaunch on a real compiled pi (the gate was rendered and escaped; the relaunch was not triggered), and `/topping-setup` against a real install (its menu was rendered and cancelled; nothing was installed).
6. `@underactive/pi-topping-test-utils` moved to 0.8.0 in lockstep and stays unpublished.

## 19. Primitives push, sensei and web-tools on ^0.8.0 (2026-10-20)

Done after the Phase 7 re-verification, on the owner's instruction to push primitives and bring sensei and web-tools up to date.

### Primitives pushed

- `main` fast-forwarded `d9d9e03..734b983` and tags `v0.2.0` to `v0.8.0` (lightweight; each is an ancestor of the pushed history) went to `github.com/underactive/pi-topping-primitives`. Before this the remote had only `v0.1.0`, although npm had 0.1.0 to 0.8.0. The only workflow, `ci.yml`, triggers on pushes to `main` and on pull requests, so the tag push could not start a publish. CI on `734b983` passed all three jobs (Node 22.19.0, Node 24, host-latest).
- The `primitives-*` work branches in primitives and in every consumer are **not** pushed.

### sensei (`44b26ee`, branch `primitives-process`)

- Built on `primitives-activity` (`72a303d`, which was on `^0.3.0`), in the existing worktree `pi-topping-sensei-activity`; the branch name `primitives-activity` still points at `72a303d` but is no longer checked out. The main checkout stays on `primitives-contracts` at `^0.1.0` with the owner's uncommitted edits (`CHANGELOG.md`, `README.md`, `docs/tool-reference.md`, `src/text/notices.ts`, two tests, untracked `scratchpad`), which were not touched.
- `^0.3.0` becomes `^0.8.0`, and `src/core/model-ref.ts` re-exports `parseModelKey`, `composeModelKey` and `ModelRef` from `./models`. The package took those functions from sensei's own codec, so they are byte-identical. The six importers and `test/sensei/model-ref.test.ts` are unchanged; the test now runs against the package.
- Gates: `npm run check` is green at 67 files and **701** tests before and after (nothing moved or was added), in the worktree and in a fresh clone (`npm ci`, then `npm run check`). The extension loads under both pi loader branches (1 command, 4 handlers, no errors).
- Not adopted, on purpose: `./settings` (the handoff defers it: it needs `readFallbackPaths`, `onDiagnostic` wiring and a delete-on-undefined decision); `EFFORT_ORDER` in `src/text/effort.ts` (graded levels without `off`, a different vocabulary from the package's seven); `abort.ts`, `review/deadline.ts`, `stable-json.ts` and `terminal-controls.ts` (the helpers are not in the package; `abort.ts`, `stable-json.ts` and `terminal-controls.ts` carry pi-advisor MIT attribution that must move with the code).

### web-tools (`78e6cde`, branch `primitives-process`)

- Range and lockfile only: `^0.2.0` becomes `^0.8.0`. web-tools imports only `./contracts` and `./settings`, and `git diff v0.2.0 v0.8.0 -- src/settings src/contracts` is empty, so there is nothing for it to adopt from 0.3.0 to 0.8.0: it spawns no processes and the env and abort helpers are not in the package. npm reformatted the `keywords` array while installing; the single-line form was restored.
- Gates: typecheck clean and **244** tests before and after, also in a fresh clone. All four manifest entries (`fetch-markdown`, `pdf-extract`, `web-browser`, `web-permissions`) load clean under both pi loader branches. The owner's untracked `scratchoad` was not touched.

### Remaining

1. ~~The env and abort helpers need a primitives release before sensei and web-tools can finish~~ Shipped in 0.9.0 (§20), minus `stableStringify`, which stays in sensei. The original list was: `isTruthyEnvFlag` and `suppressNotifications` (web-tools `src/env.ts`), `combineSignals`, `raceAbort`, `createDeadline`, `stableStringify`, `abortError` and `isAbortError`. The two `combineSignals` differ: web-tools' takes a timeout and an `activeFetches` set, so the shared signature has to be decided first. That release also carries the `spawnCollect` timeout clamp note (§18) in its CHANGELOG.
2. ~~sensei's `primitives-activity` branch still edits two files the owner has uncommitted in the main checkout~~ The owner's `CHANGELOG.md` and `consulting-line.test.ts` edits are stashed (§20); the stash applies cleanly on top of the branch work.
3. Consumer pushes, as in §18 item 1.

## 20. `./env` and `./abort` (primitives 0.9.0); sensei, web-tools and compact (2026-10-20)

Done on the owner's instruction after §19, which listed these helpers as the work sensei and web-tools were waiting on.

### Scope, and why it is narrow

A grep of every repo's `src` before starting found that only the env helpers have more than one live copy (compact `config.ts`, web-tools `env.ts`, and both were byte-identical to pi core's `isTruthyEnvFlag`). `combineSignals` (web-tools), `raceAbort`, `abortError`, `isAbortError` and `createDeadline` (sensei) each have one owner, so moving them removes no duplication; it only makes them reusable and moves sensei's MIT notice. They shipped anyway, as instructed, in two small subpaths. `stableStringify` (sensei only) and `isPlainObject` (pi-topping keeps its own; pi-switchyard has the other copy) stay local.

### Primitives (branch `primitives-env-abort`)

- Commits: feat `abb9813`, release `b68f81a` (tag `v0.9.0`, lightweight, on `b68f81a`), then `768ac09` (the `docs/consumers.md` consumer pins). The owner published 0.9.0 and it is `latest`: shasum `5a5870543e136d4b4a63fe1ad8412f18214d650b`, integrity `sha512-B/PSZ8IwCzQ7XaEpiov5eRElF13sM04Y2GZ3hkfL8Zcwa2jjYtRTVJo74azAzJuXNqEQvbBcrwhLtw3Szoreeg==`, sha256 `bd0c75f1d2d83d846b23fd69aff843f797525aa902ace14fe582b0b1f0f443ce`, 330 files. A fresh `npm pack` from the registry is byte-identical (`cmp`) to the pack the consumers were validated against before the publish. **Not pushed**; the owner pushes by hand.
- `./env`: `isTruthyEnvFlag`, `suppressNotifications` (web-tools `src/env.ts:1-10`, compact `src/config.ts:18-27`).
- `./abort`: `isAbortError`, `abortError`, `raceAbort` (sensei `src/core/abort.ts`, adapted from pi-advisor), `createDeadline` and `Deadline` (sensei `src/review/deadline.ts`), `combineSignals` and `CombinedSignals` (web-tools `src/abort-utils.ts`). The two timeout helpers were not merged: `createDeadline` owns a `setTimeout`, answers `timedOut()` and needs `dispose()`; `combineSignals` uses `AbortSignal.timeout` and registers a controller in the host's set for shutdown. Both keep their vendored signatures.
- `THIRD_PARTY_NOTICES.md` gained pi-advisor's MIT notice for `src/abort/errors.ts` and `race.ts`; sensei's notice now lists only `stable-json.ts` and `terminal-controls.ts` and points to the package for the third portion.
- `env/` and `abort/` joined the subpaths the hygiene scanner forbids from importing pi at runtime (`pi-runtime-import`), with a test; the scan finds nothing in the eight new source files and flags a pi import, module state and `console` in a negative control under both paths.

### Behaviour changes (both measured, not assumed)

- **Timer clamp.** `createDeadline` and `combineSignals` clamp a timeout above 2^31 - 1 ms to that value. On Node 24.18 `setTimeout(Infinity)` and `setTimeout(2 ** 31)` fire after about 2 ms with only a `TimeoutOverflowWarning`, and `AbortSignal.timeout(2 ** 31)` and `(2 ** 32 - 1)` abort after 2 and 4 ms; from 2^32 up it throws `ERR_OUT_OF_RANGE`. Sensei's copy would have aborted a call at once on `Infinity`. `spawnCollect` (0.8.0) already clamps the same way and the 0.8.0 CHANGELOG never said so; the 0.9.0 notes do.
- **Register after validate.** web-tools' `combineSignals` added its controller to `activeFetches` before `AbortSignal.timeout` could throw on a `NaN`, negative or fractional timeout, leaving a stale entry. The package builds the timeout signal first.

### Tests

| Suite | Before (0.8.0) | After | Delta |
| --- | --- | --- | --- |
| repo (`test:repo`) | 47 | 48 | +1: the `pi-runtime-import` case for `env/` and `abort/` |
| primitives source | 561 | 597 | +36: 34 in five suites (`env-flags` 7, `abort-errors` 3, `abort-race` 7, `abort-deadline` 8, `abort-signals` 9) and +2 `./env` and `./abort` rows in the entries test |
| primitives compiled exports | 63 | 74 | +11: `exports/env` 2, `exports/abort` 3, and 3 rows each in the entries test for the two subpaths |
| test-utils source / exports | 12 / 38 | 12 / 38 | none |

The env tests carry web-tools' and compact's assertions over unchanged. The package's timer tests use real timers (no mocking): they count live `Timeout` resources with `process.getActiveResourcesInfo()` and wait 75 times longer than the unclamped failure would take. Breaking each change in turn made exactly one test fail: `createDeadline` without the clamp, `combineSignals` without the clamp, and `combineSignals` registering before validating. `npm run check` (lint, typecheck, tests, build, pack check) is green; the pack is 330 files.

### Loader gate

`scripts/probe-pi-loader.sh` has `SUBPATH=env` and `SUBPATH=abort` arms. Loaded from the 0.9.0 tarball through both pi loader branches, with `PEERS=present` and `PEERS=absent`, all eight rows returned the expected object (`{"yes":true,"no":false,"off":false,"on":true}` for env; `{"named":true,"plain":false,"registered":1,"after":0,"noTimer":true,"timedOut":false}` for abort). Neither subpath imports a pi package, so the `absent` rows show them running with no peers on disk.

### Consumers

| Repo | Commit (branch `primitives-env-abort`) | Range | What changed | Tests before and after | Fresh clone |
| --- | --- | --- | --- | --- | --- |
| sensei (worktree `pi-topping-sensei-activity`) | `f9e5076` | `^0.8.0` to `^0.9.0` | `src/core/abort.ts` and `src/review/deadline.ts` are re-exports; notices and CHANGELOG | 701 / 701 | 701 |
| web-tools | `35d7a96` | `^0.8.0` to `^0.9.0` | `src/env.ts` and `src/abort-utils.ts` are re-exports; CHANGELOG | 244 / 244 | 244 |
| compact (no remote) | `9e0ee3d` | `^0.6.0` to `^0.9.0` | `src/config.ts` imports and re-exports `isTruthyEnvFlag`, `suppressNotifications`; CHANGELOG | 121 / 121 | 121 |

Each consumer was first run against the packed tarball with uncommitted edits (`npm install --no-save`), then re-run after the publish against the registry package (`npm install --save-dev=false ...@^0.9.0 --prefer-online`), then committed. The lockfiles resolve registry 0.9.0 with the registry's integrity and no `file:` or `link:` spec for primitives (sensei's own `sensei-test-utils` link was already there). The consumers' existing tests are the parity oracles: sensei's `deadline.test.ts` (vitest fake timers over `createDeadline` and `raceAbort`), web-tools' `env.test.ts` and compact's `config.test.ts` now run against the package unchanged. Extensions load clean under both pi loader branches: sensei 1 command and 4 handlers, compact 2 and 11, and all four web-tools entries.

### The sensei stash, and landing sensei on `main`

The owner's uncommitted separator change (U+E0B1 before the answering model on the consulting line) sat in the main sensei checkout: `CHANGELOG.md` and `test/sensei/consulting-line.test.ts` were stashed first, to stop them colliding with the activity branch, and four more files were never stashed. It is now committed as `a6bb498` on sensei's `primitives-env-abort`, and the checkout is clean.

- **All six files had to land together.** The stash applied to the branch without conflict, but with only its two files 5 tests in `consulting-line.test.ts` failed: the implementation is in `src/text/notices.ts`, which was never stashed. With `notices.ts`, `README.md`, `docs/tool-reference.md` and `run-response-model.test.ts` applied the gate is green. The four files are byte-identical to the owner's working copies. In the two merged files every line the owner added is present and every line removed is gone, and the diff against `f9e5076` is exactly the stash's size, so the branch's own edits to them were not disturbed.
- **`main` is the stack's first three commits squashed.** `main` (`6fcd2b5`) has one commit that the stack lacks, and its tree is identical to `d1df933`'s (`git diff 6fcd2b5 d1df933` is empty). `git merge-tree` reported conflicts in `CHANGELOG.md`, both package files and `result-view.ts` only because the stack later edited the same regions. `e480539` records `main` as merged with `-s ours`, which keeps the branch's tree unchanged (checked) and every hash cited in this document valid; rebasing would have rewritten `72a303d`, `44b26ee` and `f9e5076`.
- **Result.** `main` is an ancestor of the branch, so merging the branch into `main` is a fast-forward; a `git merge-tree` dry run reports no conflicts and a tree equal to the branch's. `main` was not moved. The gate is green in the worktree and in a fresh clone of `e480539` (`npm ci`, then `npm run check`, 67 files and 701 tests, registry 0.9.0).
- **Cleanup.** The four working-copy edits were discarded from the main checkout only after each was compared with the committed file, and the stash was dropped after its hunks were found in the commit. Backups of the originals were kept at `/tmp/p10` (volatile). The untracked `scratchpad` was left alone. Stash commit `2f8a253` is unreachable now but recoverable with `git stash store` until it is garbage-collected.

### Deviations

- npm reformatted `package.json` on install in web-tools (`keywords`) and compact (`extensions` and whitespace on two lines); both were restored so each commit carries only the range line.
- compact's first commit message listed three primitives subpaths and omitted `./contracts`; it was amended before anything else depended on it (`80c8b9c` became `9e0ee3d`, tree unchanged).
- The 0.9.0 repo docs were written to say only what was true at release time (no consumer had moved); `768ac09` records the three that have.
- Not exercised: a real sensei consult (it sends repo context to external models), a live web-tools fetch or browser session, and Windows.

### Remaining

1. Pushes, by the owner: primitives `primitives-env-abort` (it contains `main`'s history plus Phase 8; `v0.9.0` is on `b68f81a`), and every consumer branch, including these three. sensei's `primitives-env-abort` (tip `e480539`) contains `main` and stacks on `primitives-process`, `primitives-activity` and `primitives-contracts`; web-tools' on `primitives-process` and `primitives-settings`.
2. Still local to their hosts: `isPlainObject` and `stableStringify`. sensei's settings store stays deferred (§12). sensei's `EFFORT_ORDER` is a different vocabulary from the package's thinking levels and stays.
3. Behind: statusline `^0.7.0` and routesense `^0.6.0`; moa-fusion, persona-audit, pi-topping and splash on `^0.8.0` need no change for `./env` or `./abort`. pi-switchyard has no dependency yet. bash-gate (`^0.4.0`) is being retired and compact (`^0.9.0` on an unpushed branch) with it (§21).
4. `@underactive/pi-topping-test-utils` moved to 0.9.0 in lockstep and stays unpublished.
5. ~~The sensei stash needs `git stash pop`~~ Resolved in the subsection above. The owner merges with `git switch main && git merge --ff-only primitives-env-abort` in the main sensei checkout (sensei has no remote).

## 21. Retiring bash-gate, compact and insights; the "Cleanup" list (2026-10-20)

The owner is retiring pi-topping-bash-gate, pi-topping-compact and pi-topping-insights. None of them is published anywhere. There is no git remote on any of the three, `github.com/underactive/pi-topping-compact` returns 404 (a repository that exists returned 200 as a control), `gh repo view` cannot resolve any of them, bash-gate is not on npm (E404 as `@underactive/pi-topping-bash-gate`), compact and insights are `private`, and insights has no commits at all.

### The four "Cleanup, any time after phase 1" items (§5)

| Item | Result |
| --- | --- |
| Archive insights; drop the migration read | Nothing to archive. The migration read was removed in pi-topping `4f25d9f`. |
| Raise the pi pins in bash-gate, compact, insights | Moot: bash-gate 0.99.1, compact 1.0.0 and insights 1.0.0 were left as they are. The other eight toppings (pi-topping, statusline, splash, persona-audit, moa-fusion, web-tools, routesense, sensei) and both primitives packages are on 1.3.0; pi-switchyard, which is not in this list, is on 0.85.1. |
| `toppings.ts` catalogue | Still correct: the five siblings, all on npm (statusline 0.2.8, splash 0.5.3, persona-audit 0.3.1, web-tools 0.2.9, moa-fusion 0.4.5). routesense and sensei are still unpublished (E404), and bash-gate no longer counts as a candidate. |
| compact `node_modules` against its lockfile | Gone: installed and locked are both 1.0.0, because the `npm install` run in compact for the 0.9.0 adoption reconciled it. |

### The insights fallback (pi-topping `4f25d9f`)

A missing or invalid `outputStyle` used to fall back to `~/.pi/agent/pi-topping-insights/settings.json`. That read is gone: `legacyOutputStyle()` and `fromLegacyOutputStyle()` are deleted along with the `readFileSync` import only they used, and the fallback is now `default`. `README.md` line 131 told readers the old style "is imported until you next save"; it now says the saved style is no longer read. `CHANGELOG.md` has a "Removed" entry. Five tests that exercised the legacy file became two, one of which pins that the file is ignored: it fails against the previous source (30 of 31 pass in `settings.test.ts`) and passes against the new. pi-topping goes from 245 to 242 tests, typecheck clean. On the owner's machine nothing changes: `~/.pi/agent/pi-topping/settings.json` already records `outputStyle: explanatory`, and the insights file (`style: Explanatory`) was only a fallback.

### Documentation fixes

- statusline `2b0f314`: the README linked a compact repository that does not exist; the name stays, marked private. No tests read the README; 195 tests pass.
- primitives `3b67827`: the settings-store example used `pi-topping-bash-gate` and now uses `pi-topping-example`, and `docs/consumers.md` no longer lists bash-gate as a consumer still to adopt. The `./menu` provenance sentence ("pi-topping, pi-topping-bash-gate, ... each carried a copy of") and the CHANGELOG history were left, because both are true history. The README is packed, so the published 0.9.0 keeps the old example until the next release; `v0.9.0` still points at `b68f81a`.

### Left in place on purpose

- **pi settings.** `~/.pi/agent/settings.json` lists compact but has it switched off. `extensions[13]` adds the compact directory and `[19]` (`-../../Development/projects/pi/pi-topping-compact/index.ts`, which resolves to compact's `index.ts`) is pi's exact-path exclude for that file, so compact is disabled. That fits the sessions: 375 contain a real `pi-topping-compact/` entry, the newest from 2026-10-07, and none of the 163 sessions from the last three days does, while 159 of them carry entries from other pi-topping extensions. `[7]` (`-extensions/pi-prompt-cache/index.ts`) excludes a path that does not exist (compact's old name). **Applied afterwards, on the owner's go-ahead:** `[7]`, `[13]` and `[19]` were removed (top-level `extensions` 20 to 17 entries; sha256 `0afd74b3…` became `84495d67…`; backup of the original in `/tmp/p12/settings.json.bak`, volatile). `[13]` and `[19]` had to go together, since dropping only `[19]` would have switched compact on. The edit was text-level, so the indent, key order and missing trailing newline are unchanged; the other 18 top-level keys, including the nested package filter, compare equal to the backup; the file was written atomically with its 0600 mode kept and was unchanged eight seconds later. No pi process was using the real agent directory (the only two were old wrappers on a throwaway `/tmp/pi120-audit`). No live pi start was run against it. (An earlier version of this section called `[19]` a dead exclusion and said the settings still loaded compact; both were wrong.)
- **Data directories.** `~/.pi/agent/pi-topping-bash-gate/settings.json` and `pi-topping-insights/settings.json` were not touched.
- **Published contracts.** `./contracts` still exports `ENTRY_TYPES.compactSavings`, `compactCompactionSavings` and `compactCompaction` and the `SavingsEntry` and `CompactionOutcomeEntry` types, and statusline's default savings subscription is still `pi-topping-compact/savings` (its segment is off by default). Removing them would be a breaking change.
- **Seed sources.** test-utils' README and source comments name bash-gate as a seed for five unported helpers (`./theme`, `./keys`, `./ansi`, `./sandbox`, `./fixtures/models`). routesense is named beside it for every one of them, so deleting bash-gate removes no seed that routesense does not also hold.
- **Moot branches.** bash-gate's `primitives-settings` and `primitives-menu`, and compact's `primitives-contracts`, `primitives-color` and `primitives-env-abort` (`9e0ee3d`, the `^0.9.0` adoption), are local only and go with their directories.

### Remaining

1. ~~The owner's decisions~~ The settings entries were removed (above); the rest was decided and carried out in §22: archive without deleting, remove statusline's compact seed and saved feeds, remove the compact entry types in primitives 0.10.0, and prepare the pushes.
2. Pushes, as in §18 and §20; this section's commits are `4f25d9f` (pi-topping `primitives-process`), `2b0f314` (statusline `primitives-cube`) and `3b67827` (primitives `primitives-env-abort`).

## 22. Retired repos archived, compact seed and types removed (primitives 0.10.0), pushes prepared (2026-10-20)

The owner's answers to the open items in §21: archive the retired repos and delete nothing; remove statusline's compact seed and the two saved compact feeds; remove the compact entry types from `./contracts` in 0.10.0; prepare all six consumer pushes for the owner to run, with `HANDOFF_PRIMITIVES.md` published as is.

### Archive (nothing deleted)

`~/Development/archive/pi-retired-2026-10-20/` (1.8 MB) holds a `git bundle` of compact (4 branches, 67 commits) and of bash-gate (3 branches, 11 commits), a tarball of each of the three directories without `node_modules` (insights has no commits, so it only has the tarball), the two data files from `~/.pi/agent`, and a `MANIFEST.txt` with sha256 values and restore steps. Verified: `git bundle verify`; a bare clone of each bundle reproduces every branch head and the commit count; each tarball extracts to a tree identical to the live directory (compact 201 files, bash-gate 219, insights 42); the data copies compare equal to the originals; the manifest checksums pass. The three directories and both data directories are still where they were.

### statusline (`27d2bee`)

`DEFAULT_FEEDS` is empty and the `ENTRY_TYPES` import that only the seed used is gone. README and the doc comments use `my-extension/savings` and say the list ships empty. The feeds tests that leaned on the seeded default now pass it explicitly (it is the `OPTIONS` test constant), two seed tests became three (empty default, a saved subscription renders, an unsubscribed entry renders nothing) and the settings-menu test addresses the first feed as `feed.0`. Against the old seeded `settings.ts` exactly those three tests fail; 195 tests became 196. A fresh clone of the tip run against the 0.10.0 tarball (`npm install --no-save`) passes typecheck and all 196 tests, so statusline needs no code change to move to 0.10.0 later.

The owner's saved feeds in `~/.pi/agent/pi-topping-statusline/settings.json` went from 5 to 3: `pi-topping-compact/savings` (`CS:`) and `pi-topping-compact/compaction-savings` (`XS:`) were removed, and the two `pi-memdir` feeds and the web-tools feed stayed. Text-level edit, sha256 `e999ee4e…` to `98498b3f…`, backup `/tmp/p13/statusline-settings.json.bak` (volatile), mode 0600, tab indent and trailing newline kept, the other 12 top-level keys equal to the backup, unchanged six seconds later.

### primitives 0.10.0 (branch `primitives-trim-compact`)

Feature commit `be96902`, release commit `2c54008`, lightweight tag `v0.10.0`; **not published** (see the re-cut note below for why these are not the first hashes). `ENTRY_TYPES.compactSavings`, `compactCompactionSavings` and `compactCompaction`, the `SavingsEntry` and `CompactionOutcomeEntry` types and their `EntryPayloads` rows are removed (a breaking change; `./contracts` now has `browser` and `splashLocalChanges`). The contracts header comment and the README said "names never change", so both now record the one exception: a name whose only publisher is retired may be removed in a breaking release. The three names join the retired list that must not be reintroduced, in the README and in the test that guards it. Against the old source exactly the two contract tests fail. The pack for `2c54008` is shasum `27b6783244e69062875e6b0e54b87d07370f9111`, sha256 `33169b9b69b124221f32bf6f81f8e5612127d9178fc0c28ef1fd65b5372ec3cc`, 330 files. Every text file in it was scanned for the removed identifiers: the only mentions are the 0.10.0 removal entry and the 0.1.0 history line in `CHANGELOG.md` and the exception note in the README (the string `pi-topping-compact/` also appears in the explanatory header comment of the contracts source and its compiled copies). `npm run check` passes at repo 48, source 597, compiled exports 74, test-utils 12 and 38 (no count changed), in the working tree and in a fresh clone. `v0.9.0` still points at `b68f81a`. No consumer needs to bump: a caret range on 0.x stops at the next minor, and nothing outside compact used the removed names.

**Re-cut before publishing.** The first 0.10.0 pack (feature `e50f951`, release `b15a53c`, shasum `468212d1…`) was superseded: its README still listed `SavingsEntry` and `CompactionOutcomeEntry` among the module's exports, in a long hand-written sentence that a scan of the table rows and of `src` and `dist` had missed, so the published README would have claimed two exports that no longer exist. The fix was folded into the feature commit and the release commit replayed on top (`e50f951` and `b15a53c` became `be96902` and `2c54008`, tag moved), as in Phases 6 and 7; the two packs differ by that one README line, so the statusline run against the first pack still stands. The corrected sentence was then checked against the real exports (all eight names it lists exist), and the whole pack is scanned, not just the code. The gate was re-run on the re-cut tip in the working tree and in a fresh clone (48 / 597 / 74).

### The six pushes, prepared

Primitives is a fast-forward of `main`. Each consumer's `main` is the Phase 1 stack squashed into one commit, and each stack contains all of `main`'s content (for pi-topping, `main`'s tree is the stack's `primitives-contracts` tree minus `HANDOFF_PRIMITIVES.md`, which the stack adds). Each stack now has `main` merged in with `-s ours`, as sensei did in §20; every merge kept the tree unchanged, makes `main` an ancestor, and a `git merge-tree` dry run into `main` gave zero conflicts and a tree equal to the branch's. Remote `main` equals local `main` in every repo (splash compared by full SHA).

| Repo | Branch | Merge commit | Fresh-clone gate (`npm ci` or `npm install`, then typecheck and tests) |
| --- | --- | --- | --- |
| primitives | `primitives-trim-compact` | none (fast-forward) | `npm run check`: 48 / 597 / 74 |
| pi-topping | `primitives-process` | `c2e0ad2` | 242 tests |
| moa-fusion | `primitives-process` | `158dc42` | 108 |
| persona-audit | `primitives-process` | `7b99070` | 606 |
| splash | `primitives-process` | `c47f79b8` | 466 |
| statusline | `primitives-cube` | `d1a736b` | 196 |
| web-tools | `primitives-env-abort` | `9788361` | 244 |

web-tools failed once in the first, parallel run (six repos installing and testing at once): `client-side cross-origin navigation is blocked without replacing the approved page`, a real-browser test in `test/web-browser-egress.test.ts` that read the page URL back as `null`. The file passes 4 of 4 when run alone and the whole suite passes 244 of 244 with nothing else running; the stack touches neither that test nor `egress-policy.ts`. Treat it as a load-sensitive test, not a regression. moa-fusion's two pre-existing dirty files (`test/rename-verification.test.mjs`, `HANDOFF-fanout-max-tokens.md`) are byte-identical before and after its merge. A scan of what the stacks add found no secret-shaped strings and no absolute home paths; `HANDOFF_PRIMITIVES.md` (165 KB) becomes public with the pi-topping push, on the owner's decision. Nothing was pushed.

### Remaining

1. The pushes, by the owner, primitives first (`git push origin primitives-trim-compact:main`, then the tags `v0.9.0` and `v0.10.0`), then each consumer with `git push origin <branch>:main`. Afterwards `git branch -f main <branch>` in each repo keeps the local `main` level. sensei has no remote: `git switch main && git merge --ff-only primitives-env-abort` in its main checkout.
2. Publish 0.10.0 (the owner); nothing depends on it.
3. Delete the three retired directories and the two data directories when comfortable; the archive exists.
4. pi-switchyard (no dependency), statusline `^0.7.0`, routesense `^0.6.0` and `isPlainObject`/`stableStringify` are unchanged from §20.
