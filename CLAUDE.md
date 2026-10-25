# CLAUDE.md

Obsidian plugin: a `rich-table` fenced code block rendered as an interactive table. The block's YAML front-matter is the only data source; every edit is a pure reducer op written back to the note.

## Commands

```bash
npm run dev            # watch mode
npm run build          # generate meta → tsc → eslint → minified main.js
npm run lint           # ESLint (obsidianmd recommended rules)
npm test               # vitest (parser / serializer / reducers / pure layout logic)
npm run test:e2e       # playwright, real renderer in a browser, at dpr 1 and 1.5
npm run verify:ci      # what CI does: clean install, build, changelog check, tests — run before releasing
```

After code changes run `npm run build`, then copy `main.js manifest.json styles.css` into `<vault>/.obsidian/plugins/rich-table/` and reload the plugin. Keep the vault path in your personal global config, not here.

## Architecture

```
code block → TableBlock (tableBlock.ts) → parseTable (parser.ts) → TableModelV2 (model.ts) → renderTable (renderer.ts)
UI interaction → StructuralOpV2 (operations.ts) → TableBlock.handleStructuralOp → applyStructuralOpV2 (pure reducer)
               → serializeTable → vault.process()   (batched per tick, writes sequenced through a promise chain)
```

- `renderer.ts` never touches the filesystem; it only emits ops. New behaviour belongs in a reducer op or a pure module first, DOM second.
- Large behaviours are split into `render*.ts` siblings; pure decision logic lives apart from DOM code (`cellNav.ts`, `reorderPlan.ts`, `renderFreezePlan.ts`, `selectorLayout.ts`) so it can be unit-tested. Prefer that split for new features.
- Tables are ID-based (`r_…`, `c_…`); styles and merges address IDs, never positions. Style targets are parsed in `styleTarget.ts`.
- v1 (Excel-style coordinates) is migration-only (`src/history/v1`, `src/migrations`).
- Every write-back rebuilds the table in a fresh container. State that must survive a rebuild (hover, in-progress edit, selection) goes through a `cacheKey`-keyed handoff module (`render*Handoff.ts`), and `injectLiveSnapshot` keeps the old look in place while the new render completes. You cannot reach the previous instance's DOM from the new one.

## Core and command-line tool

- `src/core.ts` is the Obsidian-free surface (`parse`, `serialize`, `applyOp`, `editBlock`, `findBlocks`) shared by the plugin's own modules and by the bundled CLI (`src/cli.ts` → `skills/obsidian-rich-table/scripts/rich-table.cjs`, rebuilt by `npm run build`). Keep everything it imports free of `import … from 'obsidian'`.
- YAML goes through `src/yamlAdapter.ts`. The plugin installs Obsidian's own `parseYaml`/`stringifyYaml` in `onload`; the CLI installs the `yaml` package with the `core` schema, because a default YAML parser turns `2026-07-17` into a timestamp and rewrites every date cell. Parsing or serializing before an adapter is installed throws.
- A new `StructuralOpV2` variant must also be listed in `STRUCTURAL_OP_TYPE_MAP` (`operations.ts`); `tsc` fails otherwise. A new field that names a row or column id must be added to `ROW_FIELDS`/`COL_FIELDS` in `opCheck.ts`, or the CLI will not check it.
- The committed `rich-table.cjs` is a build output that agents run directly; commit it with the source change that alters it.

## Layout and interaction invariants

- **One width constant.** `SEL_UNIT` (`selectorLayout.ts`, mirrored as `--bt-sel-unit`) sizes the toolbar, row/col selectors, row/col adders and the vertical scrollbar. Left and right are designed as mirrors; change them together.
- **Reserve space permanently, never on hover.** Padding for hover-only strips is reserved from first paint and never collapsed; toggling it on hover shifts the table and can change the pane's scrollbar.
- **The view (outer frame) contains the status bar.** Frame bounds come from one place, `viewSpan` (`renderGeometry.ts`), shared by the runtime and first-paint code paths. The resize handles are positioned from the frame's `--of-*` box.
- **Top gap.** One value, `TOP_STRIP_PAD` → `--bt-sel-pad`, applies to every table (editable, locked, read-only), written once at creation; its CSS rule is deliberately doubled-class so host stylesheets cannot override it.
- **Prefer adjacency to absolute coordinates** when positioning one element relative to another, and keep conditionals to variable assignment with one shared rendering path.
- **Positions are logical px.** `zoom` is CSS `zoom` on the table subtree; divide measured visual rects by it. The status bar and frame live outside the zoomed subtree.
- Frozen rows/columns, block reorder and similar features read live geometry; unit-test their pure planning, e2e-test the DOM.

## `.xlsx` file view and Rich Search

- **The `.xlsx` tab is read-only, by decision.** Its value is browsing and search; write-back is out of scope until it is wanted. It does not go through `TableBlock`; the two share only `xlsxFileWatch.ts` and `settleRenderedTables`, so a new post-attach fix goes into the latter, not into one caller.
- **Extension ownership uses Obsidian internals** (`viewRegistry.unregisterExtensions`/`unregisterView`), read from the source and not measured. If they are missing the setting falls back to "reload to finish".
- **`richSearchApi.ts` is a verbatim copy of the Rich Search contract.** Change the contract first, then every copy. Changing what `xlsxExtract.ts` or `blockExtract.ts` returns means bumping the matching version constant. Both readers stay free of `obsidian` imports (a test enforces it).
- **Search marks are transient and never written** to the file or the note. Their lifetime, colour and which one is "opened" (brighter) are decided by the Rich Search panel; every view that marks follows it through the one `SearchPanelFollower`. Mark text as it is shown, not from the raw value.
- **Opening a hit never moves the cursor into a block** (Live Preview would show it as source). Revealing a hit in a block may switch sheets in memory only, never in the note.
- **A note can hold several live copies of one block** (Reading view rebuilds sections). Look a block up through `findBlockAt`, which takes the one that is on screen.
- Scrolling to a cell must clear the frozen rows and columns, so it does not use `scrollIntoView`.
- The e2e shim stands in for Obsidian: keep `Setting.descEl`, `HTMLElement.toggle` and `isShown` faithful, and run all of `test/e2e` before committing shared-code changes (settings tab, `render()`). Its `MarkdownRenderer` emits plain text only.

## Backward compatibility of the code block

A block is user content in people's notes; breaking it is data loss.

- Extend with new optional YAML fields; never rename or remove existing ones. Parsers ignore unknown fields and trailing content.
- A change that alters how existing fields are interpreted, or that an old parser would misread, needs a `CURRENT_TABLE_VERSION` bump plus a migration in `src/migrations` (the chain runner needs only a new entry).
- A table written with a newer version is refused with a banner rather than half-parsed; an older one renders read-only with an upgrade banner.
- Prefer a discriminated-union extension (scalar vs object) over pre-generalizing a field.
- **Any change to the code block's fields (add, remove, rename, or change what a field means) must update the skill in `skills/obsidian-rich-table/` in the same commit.** It is the agent-facing format reference; a stale one makes agents write blocks the plugin misreads. Core fields live in `SKILL.md`; the rest are in `references/` (formulas, display fields, workbook/xlsx, style targets, cell content, examples, themes). Update the field's section, the examples that use it, and the style-target reference if targets changed, and keep the index table in `SKILL.md` in step when a field moves or is added. Pure UI changes that leave the block untouched do not need it.

## Themes and styles

- A theme is `src/themes/*.css` with an `@theme-label-en` comment (plus optional `@theme-label-<lang>`); it is auto-discovered. Never edit `src/themes/generated.ts` or `src/templates/generated.ts`; they are produced by the build.
- Theme CSS may set custom properties and non-layout visuals only; layout properties live in `styles.css`. A layout-affecting property in a theme is a bug, and a baseline test asserts the scroll container stays scrollable.
- A user's explicit per-cell style always wins over a theme, enforced once in `applyResolvedStyle` (inline `!important`), not by themes avoiding `!important`.
- Obsidian styles markdown tables with specificity our single-class rules can lose to (`.markdown-rendered table`, `div` padding rules). When a rule must hold, double the class and cover it with a test that injects a hostile host rule.
- `styles.css` ends with an auto-generated themes block; add rules above its marker.

## Languages

- UI strings live in `src/i18n/<lang>.ts`, typed `Dict` against `en.ts` (the source of truth), so a missing key fails `tsc`. Read them with `t()`/`fmt()`; never branch on the language in feature code. Sentences with variable parts are `{placeholder}` templates in each dictionary, not code.
- Add a language: one `src/i18n/<code>.ts` and one line in `DICTS` (`src/i18n/index.ts`). Templates (`src/templates/<id>-<lang>.yaml`) and theme labels (`@theme-label-<lang>`) are optional per language and fall back to English.
- Any new `en.ts` key needs a value in every language file in the same commit.

## Testing

- `test/*.test.ts` (vitest) for pure logic; `test/e2e` (Playwright) for behaviour. Run e2e serially (`--workers=1`) and in batches; the full suite can exhaust memory otherwise.
- Every e2e test runs at dpr 1; one tagged `{ tag: '@geometry' }` also runs at dpr 1.5. Tag any test that asserts a size, position, scroll offset, inline width or pixels, whether it reads it directly or through a helper; an untagged one loses the fractional-scaling check without a warning.
- Three fixtures, smallest that works: `renderReal` (real merge/style resolution), `renderFull` (real `renderTable`, ops land in `window.__btOps`), `renderBlock` (real `tableBlock`, writes a note; call `reprocess()` to simulate Obsidian's rebuild).
- `common/obsidian-shim.ts` stands in for Obsidian; keep it faithful where layout, event timing or `Component` lifecycle matter. `common/obsidian-vars.css` carries Obsidian's competing table declarations so a rule that cannot win the cascade fails here, not in a vault.
- Frozen-block rendering is verified with pixel oracles (`common/pixel-invariance.ts`, `common/appearance-probe.ts`), not computed styles: the defect is where pixels are painted, and computed styles read back correct.
- **Every new test is verified in both directions**: reintroduce the bug and confirm it fails, restore and confirm it passes. Check the build actually succeeded after a mutation, and that the mutation hits the path under test.
- Do not weaken a test or add waits to hide a real bug; fix the product code. A test must encode the requirement, not the current implementation.
- A test run is only a pass once the summary shows `PASS (n) FAIL (0)`. An exit code of 0 is not enough (a bundle failure can produce one with zero tests run).

## Conventions

- `noUncheckedIndexedAccess` is on: guard indexed access.
- Use `setCssProps({ '--bt-…': value })` for dynamic styling; `style.setProperty/removeProperty` only where no CSS variable fits.
- Cell content is rendered with `MarkdownRenderer.render`; CSS zeroes paragraph margins inside cells.
- Use bare `window.setTimeout` / `requestAnimationFrame`.
- Do not disable `obsidianmd/*` lint rules inline; fix the code. Desktop-only Node/Electron access goes through `src/nodeBridge.ts`, behind `Platform.isDesktop`.
- `minAppVersion` is 1.8.7 (write-back needs `Vault.process`).
- Comments: short, only for a non-obvious why (hidden constraint, subtle invariant). No narration of how a fix was reached, no references to who reported what.

## Working principles

- **Evaluate requests before building them.** Is the need met more simply? Does it fit the ID model, the reducer pattern and the write-back cycle? Is it breaking for existing notes (version bump)? Does it match how Excel/Notion users expect it to behave? Raise concerns before implementing.
- **Fix the pattern, not the instance.** When a bug shows a cross-cutting invariant enforced by convention, enforce it in the shared code path rather than patching each variant.
- **Derive edge cases fully.** When a feature has a symmetry or invertibility property, derive every case from it instead of defaulting to "drop it", and check against a concrete example from the user.
- **Diagnose with evidence.** After two failed fixes for timing or event-order bugs, stop theorising and add temporary logging; do not stack unverified fixes on unverified fixes.
- **Verify before claiming.** For anything that cannot be exercised in the test harness (real Obsidian behaviour), say so and ask for confirmation. Do not record a fix's outcome in docs until it is confirmed.
- **Docs follow code.** User-visible changes update `README.md` and `README_CN.md` in the same commit, and code block changes also update the skill (see above); new interactions may need the insertable template (`src/templates`) updated; remind about re-recording demo GIFs when an interaction changes substantially.

## Commits

- Messages are high level: what changed and why, not mechanisms or the debugging path. Subject uses `type: summary` (`feat`, `fix`, `refactor`, `build`, `chore`, `docs`, `test`).
- Reference issues in the body: `Fixes #n` only when the commit fully resolves it, otherwise `Refs #n`.
- A feature developed in steps is squashed into one complete, working commit before it is considered done; later fixes are separate commits.
- No `Co-Authored-By` trailer.

## Releasing

Tag-driven; the `Release` workflow builds and publishes on any pushed tag.

1. Clean tree on `master`, then `npm run verify:ci`.
2. `npm version <x.y.z>`. One command bumps `manifest.json`, `package.json`, `package-lock.json` and `versions.json`, regenerates `src/changelog/generated.ts`, commits `chore: release x.y.z` and creates the tag (no `v` prefix).
3. Check `git log --stat -1`, `git tag --points-at HEAD` and `npm run changelog:check`.
4. Push `master` and the tag together. Do not push without being asked.

The changelog is generated from git tags plus the version in `package.json`, so the committed file equals a rebuild; CI fails if they differ. Never hand-edit it. After rewriting a release commit, re-point its tag (`git tag -f`).

Dependency hygiene: CI uses `npm ci`, which fails if `package.json` and the lockfile disagree. Keep root `esbuild` inside the range vitest's bundled `vite` requires, run `npm run lockfile:normalize` after regenerating the lockfile (it rewrites mirror URLs), and check `grep -c '"extraneous": true' package-lock.json` is 0 after adding dependencies.
