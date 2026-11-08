import { MarkdownPostProcessorContext, MarkdownRenderChild, Notice, Platform, TFile, setIcon } from 'obsidian';
import { t, pick, tableVersionTooHighMsg } from './i18n';
import { CURRENT_TABLE_VERSION, MIN_STABLE_VERSION, getTableVersion, migrateSource } from './tableVersion';
import type BetterTablePlugin from './main';
import type { CtrlColButtonId, SheetDefV2, TableModelV2, WorkbookV3 } from './model';
import { parseTable, parseSource } from './parser';
import { serializeTable, serializeWorkbook } from './serializer';
import { renderTable } from './renderer';
import { applyStructuralOpV2, type StructuralOpV2 } from './operations';
import { applyWorkbookOp, isWorkbookOp, type WorkbookOpV2 } from './workbookOperations';
import { renderSheetTabBar } from './renderSheetTabs';
import { applyThemeClass } from './renderThemeClass';
import { genId } from './idGen';
import { registerHoverState, takeHoverState } from './renderHoverHandoff';
import { registerSelectedCell } from './renderSelectionHandoff';
import { registerCalendarMonth, clearCalendarMonth } from './renderCalendar';
import { clearAllLiveEdits } from './renderEditHandoff';
import { buildBlankTable } from './blankTable';
import type { EmptyEntry } from './emptyEntries';
import { openGridSizePicker } from './gridSizePicker';
import { BUILTIN_TEMPLATES } from './templates/index';
import { displayTheme, resolveDefaultTheme } from './themes';
import { editPolicy } from './editPolicy';
import { settleRenderedTables } from './renderAutofit';
import { markSpans, markableText, stripSearchMarks, type Marked } from './searchHighlight';
import { matchText } from './searchMatch';
import type { MatchOptions } from './richSearchApi';
import { isBlockAnchor, type BlockAnchor } from './blockExtract';
import { revealCell } from './searchReveal';
import { belongsToRoot, ownCells } from './renderOwnScope';
import { NESTED_CACHE_KEY_MARKER } from './blockCacheKey';
import { fsPromises } from './nodeBridge';
import { captureTablePng, captureTableSvg } from './tableSnapshot';
import type { SnapshotKind, TableAction } from './renderTypes';
import { tableEdits, type TableOpType } from './tableEdits';
import { NATIVE, type BlockSource, type Loaded, type Parsed, type SourceHost, type SourceKind } from './blockSource';
import { xlsxSourceKind } from './xlsxBlockSource';
import { tasksSourceKind } from './tasks/tasksBlockSource';
import { exportModelToXlsx, exportWorkbookToXlsx } from './xlsxExport';
import { XlsxSaveModal, ConfirmOverwriteModal, vaultFileExists } from './xlsxSaveModal';

/**
 * Module-level snapshot cache keyed by "sourcePath:lineStart". Each entry is a
 * clone of a table's LIVE DOM taken at write-back time (in handleStructuralOp) —
 * content, hover strips, editing look and all. The next (rebuilt) instance
 * injects it synchronously in onload() as a visual placeholder so the table
 * stays continuous (no blank/zero-height window) through Obsidian's ~200ms
 * tear-down-and-async-rerender. Cross-instance by design: the new instance can't
 * reach the old instance's DOM, so the old one publishes here and the new one reads.
 */
const renderCache = new Map<string, HTMLElement>();

/**
 * Every currently-mounted TableBlock, so a plugin-settings change (e.g. the
 * new "Left-toolbar buttons" visibility toggles) can refresh already-open
 * tables immediately instead of only taking effect on the NEXT edit or note
 * reopen. Reading View already gets this via main.ts's own
 * `previewMode.rerender(true)` after every save, which tears down and
 * rebuilds the whole preview pane — but Live Preview's CodeMirror widgets are
 * untouched by that, and settings that only affect a *rendered* affordance
 * (button visibility) don't otherwise invalidate anything CM6 would notice on
 * its own. A plain `Set`, not anything keyed — main.ts just wants "everyone,
 * refresh," and TableBlock's own `unload()` cleanup (registered below) is
 * what keeps this from ever holding a stale/torn-down instance.
 */
const liveInstances = new Set<TableBlock>();

/**
 * The block drawn from the fence that opens on `line` (0-based) of the note at `path`, inside `within`. The same
 * note can be open in several places at once (two tabs, Reading view and editing view, a hover preview), each
 * with its own block on the same line, so the view being asked about has to say which one it means. A table
 * nested in a cell shares its outer block's note and is never the answer.
 *
 * Even inside one view there can be two: Reading view builds a block again when a note is opened over itself, and
 * the old one stays attached for a while with no size. The newest one that has a size is the one on screen; with
 * `shownOnly` the old ones are not an answer at all, otherwise the newest is the fallback.
 */
export function findBlockAt(path: string, line: number, within: HTMLElement, shownOnly = false): TableBlock | null {
	let newest: TableBlock | null = null;
	let newestShown: TableBlock | null = null;
	for (const block of liveInstances) {
		if (block.notePath !== path || block.fenceLine !== line || block.isNested || !within.contains(block.containerEl)) continue;
		newest = block;
		if (block.containerEl.getClientRects().length > 0) newestShown = block;
	}
	return newestShown ?? (shownOnly ? null : newest);
}

/** Frames to wait for a note's block to exist and be drawn, about two seconds. Spent once, across both waits. */
export const BLOCK_WAIT_FRAMES = 120;

/**
 * Like `findBlockAt`, but waits for the block: a note that was just opened builds its blocks section by
 * section, so in Reading view the one asked for may not exist yet, its section info is null until it is
 * attached, and a block that is not laid out yet has no size. Gives up after `frames`, or as soon as
 * `stillWanted` says the note is no longer the one on screen. Only on the last frame is a block without a
 * size accepted, for a note that is not on screen at all.
 */
export async function waitForBlockAt(path: string, line: number, within: HTMLElement, stillWanted: () => boolean, frames = BLOCK_WAIT_FRAMES): Promise<{ block: TableBlock; framesLeft: number } | null> {
	for (let left = frames; left > 0; left--) {
		if (!stillWanted()) return null;
		const block = findBlockAt(path, line, within, left > 1);
		if (block) return { block, framesLeft: left };
		await new Promise<void>(r => window.requestAnimationFrame(() => r()));
	}
	return null;
}

/** Re-renders every currently-mounted table in place — main.ts's saveSettings
 *  calls this after every settings save, alongside its existing Reading View
 *  rerender, so a Live Preview table reflects e.g. a newly hidden/shown
 *  left-toolbar button without needing an edit or a note reopen to trigger one. */
export function refreshAllTableBlocks(): void {
	for (const block of liveInstances) void block.refresh();
}

/**
 * Inject a live-DOM snapshot into a freshly-handed (blank) container as a
 * transient placeholder, after de-fanging the two things that can't survive a
 * cross-instance clone:
 *  1. Editors are static `cloneNode` products (no event bindings). Left
 *     editable they'd invite the user to type into a dead node during the
 *     ~200ms window → input silently lost. So make them look-but-don't-touch:
 *     contenteditable=false, no tabindex, inputs readonly.
 *  2. Hover strips' `--strip-*` positions were computed against the OLD root's
 *     geometry; injected into the new container (esp. when a scroll jump is
 *     underway) they'd place the strips far from the table. Keep the visible
 *     class (so the table doesn't look like it lost hover) but drop the stale
 *     positions — the real hover handoff repositions them precisely after swap.
 */
function injectLiveSnapshot(container: HTMLElement, cached: HTMLElement | undefined): void {
	if (!cached) return;
	const clone = cached.cloneNode(true) as HTMLElement;
	clone.querySelectorAll<HTMLElement>('[contenteditable="true"]').forEach(el => {
		el.setAttribute('contenteditable', 'false');
		el.removeAttribute('tabindex');
	});
	clone.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>('input, textarea').forEach(el => {
		el.readOnly = true;
	});
	clone.querySelectorAll<HTMLElement>('.bt-strip-visible').forEach(el => {
		el.style.removeProperty('--strip-top');
		el.style.removeProperty('--strip-left');
		el.style.removeProperty('--strip-width');
		el.style.removeProperty('--strip-height');
	});
	while (clone.firstChild) container.appendChild(clone.firstChild);
}

/** Content for a given template id (falls back to the first/default template —
 *  "demo", always sorted first by generateTemplateMeta — if the id is unknown,
 *  e.g. a stale id from before a template was renamed/removed). */
function getTemplateContent(templateId: string): string {
	const tpl = BUILTIN_TEMPLATES.find(t => t.id === templateId) ?? BUILTIN_TEMPLATES[0];
	return tpl ? pick(tpl.content) : '';
}

/** The default template — used for the isEmpty/version-detection plumbing that
 *  needs *some* concrete content before the user has chosen anything (see the
 *  `isEmpty` branch in render()); the empty-block banner itself offers every
 *  template explicitly and doesn't go through this. */
function getEmptyTemplate(): string {
	return getTemplateContent(BUILTIN_TEMPLATES[0]?.id ?? 'demo');
}

/** True when the table's YAML front-matter contains `noUpgrade: true`. */
function hasUpgradeSuppressed(source: string): boolean {
	const lines = source.split('\n');
	if (lines[0]?.trim() !== '---') return false;
	for (let i = 1; i < lines.length; i++) {
		if (lines[i]?.trim() === '---') break;
		if (/^noUpgrade:\s*true/.test(lines[i] ?? '')) return true;
	}
	return false;
}

/** One queued op, tagged by which reducer it belongs to — see `queueOp`. */
type PendingOp =
	| { kind: 'cell';     op: StructuralOpV2 }
	| { kind: 'workbook'; op: WorkbookOpV2 };


export class TableBlock extends MarkdownRenderChild {
	// Exactly one of these two is non-null at a time (mutually exclusive
	// render modes) — see `activeModel`. `workbook` holds a genuine multi-
	// sheet table; `model` holds a plain single-sheet v2 table. A table only
	// ever moves from `model` to `workbook` via an explicit "add a second
	// sheet" user action (see `convertToWorkbook`), never automatically.
	private model: TableModelV2 | null = null;
	private workbook: WorkbookV3 | null = null;
	// Reference to the rendered bt-render-root element — used for instant theme updates.
	private renderedRoot: HTMLElement | null = null;
	// Serialised write chain — strictly ordered so concurrent writes never interleave.
	private writeChain: Promise<void> = Promise.resolve();
	// Batch queue: ops arriving in the same JS tick are applied together in one write.
	private pendingOps: PendingOp[] = [];
	private writeBackScheduled = false;
	// True during the atomic DOM swap in render() — strips must not show while
	// containerEl is being rebuilt (stale or double-root rects are unreliable).
	private isRendering = false;
	// Where the rows come from when they are not the block's own (an .xlsx file, a task query); null for a table
	// written in the note. Kept across draws while the kind stays the same, so what it watches carries on.
	private blockSource: BlockSource | null = null;
	private blockSourceKind: SourceKind | null = null;
	// The marks the search panel's query has put on this block's cells, and the query that came with the
	// hit it was opened from (used only by a Rich Search that cannot say when a search ends).
	private clearSearchMarks: (() => void) | null = null;
	/** The marks of each cell, kept so the bright one can move without marking again. */
	private markedCells = new Map<HTMLElement, Marked>();
	private brightCell: HTMLElement | null = null;
	private hitQuery: MatchOptions | null = null;
	// The sheet a search hit asked to see. Applied on every draw of this instance and never written to the
	// note by itself; a later edit on that sheet saves it as the active one, as any edit would.
	private hitSheetId: string | undefined;

	constructor(
		container: HTMLElement,
		private readonly source: string,
		private readonly plugin: BetterTablePlugin,
		private readonly sourcePath: string,
		private readonly ctx: MarkdownPostProcessorContext,
		private readonly cacheKey: string,
	) {
		super(container);
		// See liveInstances' own doc comment — added/removed here rather than in
		// onload()/onunload() so a table that's mounted but never separately
		// unloaded (there is no other onload/onunload override on this class)
		// still gets exactly one add/remove pair, matching every other
		// per-instance registration below.
		liveInstances.add(this);
		this.register(() => { liveInstances.delete(this); });
		// Registered once here: reads the CURRENT watcher at unload time.
		this.register(() => { this.blockSource?.dispose(); this.blockSource = null; });
		this.register(this.plugin.searchPanel.follow(change => { if (change === 'hit') this.moveBright(); else this.syncSearchMarks(); }));
		// A nested table's cacheKey (main.ts) is unique per mount — nothing will
		// ever look it up again after THIS instance is done with it, unlike a
		// top-level table's stable sourcePath:lineStart key, which the NEXT
		// instance deliberately reads via that same key. Without this, every
		// write-back on (or containing) a nested table would leave its cloned-DOM
		// renderCache entry — and its hover/edit/selection/calendar handoff
		// registrations — behind forever: a real, unbounded leak this fix would
		// otherwise introduce by removing the cacheKey COLLISION that used to
		// (incorrectly) keep reusing the same one entry/slot.
		if (this.cacheKey.includes(NESTED_CACHE_KEY_MARKER)) {
			this.register(() => {
				renderCache.delete(this.cacheKey);
				registerHoverState(this.cacheKey, false);
				registerSelectedCell(this.cacheKey, null);
				clearAllLiveEdits(this.cacheKey);
				clearCalendarMonth(this.cacheKey);
			});
		}
	}

	/** The sheet currently being shown — a plain single-sheet model in
	 *  `model` mode, or whichever sheet `workbook.activeSheetId` names (falling
	 *  back to the first sheet, since a workbook always has SOME active sheet —
	 *  unlike ViewDefV2's activeViewId, there's no "default/none" state here). */
	private get activeModel(): TableModelV2 | null {
		if (this.workbook) {
			return this.workbook.sheets.find(s => s.id === this.workbook!.activeSheetId) ?? this.workbook.sheets[0] ?? null;
		}
		return this.model;
	}

	onload(): void {
		// Every write-back makes Obsidian tear down the old table's DOM and hand this
		// new instance a *blank* container, which our async render() then takes ~200ms
		// to fill (one MarkdownRenderer.render per cell). During that window the empty
		// container has zero height — which (a) drops the hover strips → the "flicker",
		// and (b) collapses the document height → the scroll position gets clobbered →
		// the table jumps out of the viewport (both confirmed by diagnostics; same root
		// cause). To keep the table visually continuous through that window, the PREVIOUS
		// instance snapshotted its live DOM at write-back time (see handleStructuralOp);
		// inject that snapshot synchronously here so the container is never blank/zero-
		// height, then render() swaps in the real content and the hover/edit handoffs
		// restore the true interactive state. (Replaces an older 40ms-delayed base-state
		// snapshot that never actually fired — it was starved by render()'s microtask chain.)
		injectLiveSnapshot(this.containerEl, renderCache.get(this.cacheKey));
		void this.render();
	}

	private async render(): Promise<void> {
		const tmp = createDiv();
		const isEmpty = this.source.trim() === '';

		// ── Format-version gate ───────────────────────────────────────────────
		if (!isEmpty) {
			const tableV = getTableVersion(this.source);
			if (tableV > CURRENT_TABLE_VERSION) {
				// Table was written by a newer plugin — refuse to parse and tell the user.
				const banner = tmp.createDiv({ cls: 'bt-version-banner' });
				const icon = banner.createSpan({ cls: 'bt-version-banner-icon' });
				setIcon(icon, 'arrow-up-circle');
				const msg = banner.createDiv({ cls: 'bt-version-banner-body' });
				msg.createSpan({ text: tableVersionTooHighMsg(tableV, CURRENT_TABLE_VERSION) });
				const btn = msg.createEl('button', {
					cls: 'bt-version-banner-btn',
					text: t('openCommunityStore'),
				});
				btn.addEventListener('click', () => {
					window.open('obsidian://show-plugin?id=rich-table');
				});
				this.containerEl.empty();
				while (tmp.firstChild) this.containerEl.appendChild(tmp.firstChild);
				return;
			}
			// MIN_STABLE_VERSION, not CURRENT_TABLE_VERSION — a plain v2 table is
			// NOT "outdated", it just doesn't have sheets (see tableVersion.ts's
			// doc comment on why these two constants deliberately differ as of
			// v3). Only a real v1 table needs the upgrade-and-convert banner.
			if (tableV < MIN_STABLE_VERSION && !hasUpgradeSuppressed(this.source)) {
				// Table uses an older format — show upgrade banner; user must opt in.
				const banner = tmp.createDiv({ cls: 'bt-upgrade-banner' });
				const iconEl = banner.createSpan({ cls: 'bt-upgrade-banner-icon' });
				setIcon(iconEl, 'sparkles');
				const msg = banner.createDiv({ cls: 'bt-upgrade-banner-body' });
				msg.createSpan({
					text: t('upgradeBannerText'),
				});
				const btnRow = msg.createDiv({ cls: 'bt-upgrade-banner-btns' });
				const upgradeBtn = btnRow.createEl('button', {
					cls: 'bt-upgrade-banner-btn',
					text: t('upgradeBannerConvert'),
				});
				upgradeBtn.addEventListener('click', () => void this.applyMigration(tableV));
				const ignoreBtn = btnRow.createEl('button', {
					cls: 'bt-upgrade-banner-btn bt-upgrade-banner-btn-muted',
					text: t('upgradeBannerKeep'),
				});
				ignoreBtn.addEventListener('click', () => void this.suppressUpgradeBanner());
				// Also render the table below the banner so it remains usable.
			}
		}

		// Defer one frame so containerEl is in its final DOM position.
		// On initial load and write-back re-renders, Obsidian calls the processor
		// BEFORE inserting containerEl into .markdown-reading-view, so an immediate
		// closest() check returns null. After rAF the DOM is settled.
		// Do NOT check isConnected — CM6 may destroy/recreate live-preview widgets
		// between the render call and the rAF; rendering to a detached el is harmless.
		await new Promise<void>(r => window.requestAnimationFrame(() => r()));

		// .markdown-reading-view is the correct selector — same as v1, works after rAF.
		const isReadingView = !!(this.containerEl.closest('.markdown-reading-view'));
		if (!this.containerEl.isConnected) this.recheckViewModeOnAttach(isReadingView);

		const source     = isEmpty ? getEmptyTemplate() : this.source;
		const tableV     = isEmpty ? CURRENT_TABLE_VERSION : getTableVersion(source);
		// isOldFormat: v1 tables are read-only until the user explicitly upgrades.
		// Also prevents the lock button from accidentally triggering a v1→v2 write-back.
		const isOldFormat   = !isEmpty && tableV < MIN_STABLE_VERSION;

		try {
			if (tableV >= MIN_STABLE_VERSION) {
				// Current-format table (v2 single-sheet or v3 workbook): parse
				// directly. isEmpty always resolves to a fresh single-sheet
				// template, never a workbook, so parseTable is enough there —
				// parseSource's structural detection is only needed for real
				// on-disk content.
				const parsed = isEmpty ? parseTable(source) : parseSource(source);
				if (parsed.version === 3) { this.workbook = parsed; this.model = null; }
				else                      { this.model = parsed; this.workbook = null; }
				if (this.workbook && this.hitSheetId && this.workbook.sheets.some(sh => sh.id === this.hitSheetId)) {
					this.workbook.activeSheetId = this.hitSheetId;
				}
			} else {
				// Older format: migrate in-memory for a read-only preview. A v1
				// table always migrates to a plain v2 single-sheet model —
				// v1→v3 isn't a real migration path (see tableVersion.ts).
				this.model = parseTable(migrateSource(source, tableV));
				this.workbook = null;
			}

			// A block whose rows come from elsewhere (an .xlsx file, a task query) asks its source what to draw and
			// how to treat edits; one written in the note has no source. The source is kept while the kind stays the
			// same, so what it watches (a file, the vault's tasks) carries on across draws.
			const blockSource = this.sourceFor(isEmpty ? null : this.model);
			let drawn: TableModelV2 | undefined;
			let message: Extract<Loaded, { kind: 'message' }>['render'] | undefined;
			if (blockSource) {
				const parsed: Parsed = this.workbook ? { model: null, workbook: this.workbook } : { model: this.model!, workbook: null };
				const loaded = await blockSource.load(parsed);
				this.model = loaded.parsed.model;
				this.workbook = loaded.parsed.workbook;
				if (loaded.kind === 'message') message = loaded.render;
				else drawn = loaded.drawn;
			}

			const active = this.activeModel;
			const answers = blockSource ?? NATIVE;
			const locked = answers.locked(active?.locked ?? false);
			// What the user may do right now: the surface, the lock and the format decide, the source does not.
			const policy = editPolicy({
				surface: isReadingView ? 'reading' : 'live',
				readingEdit: this.plugin.settings.allowReadingViewEdit,
				locked,
				legacy: isOldFormat,
				empty: isEmpty,
			});
			// What the table accepts depends on its kind (the source); the user's situation (policy) narrows it further.
			const edits = tableEdits((type) => answers.accepts(type), (effect) => policy.permits(effect), (op) => {
				if (isWorkbookOp(op)) void this.handleWorkbookOp(op);
				else void this.handleStructuralOp(op);
			});
			const actions = this.tableActions(blockSource, isEmpty, isOldFormat, edits.can);

			const hiddenCtrlColButtons = new Set<CtrlColButtonId>(this.plugin.settings.ctrlColHiddenButtons[answers.scenario(locked)]);
			const onWorkbookOp = edits.can('rename-sheet') ? (op: WorkbookOpV2) => edits.run(op) : undefined;
			const onSwitchSheet = edits.can('set-active-sheet') ? (sheetId: string) => edits.run({ type: 'set-active-sheet', sheetId }) : undefined;
			const onCreateSheet = edits.can('create-sheet') ? () => edits.run({ type: 'create-sheet' }) : undefined;

			// isEmpty's "active" is a stand-in default-template model purely for
			// version-detection plumbing (see getEmptyTemplate) — the empty-block
			// banner below renders its own multi-template preview, so skip this
			// render entirely rather than showing the default template as if it
			// were the block's real (about-to-be-overwritten) content.
			if (message) {
				message(tmp, edits.can);
			} else if (active && !isEmpty) {
				// A theme that no longer exists is drawn as the one new tables get. Only for drawing: the model
				// written back keeps the theme the note names.
				const shown = displayTheme(active.theme, this.plugin.settings.defaultTheme);
				// A source may draw a model built from elsewhere; `active` stays the block as saved.
				const model = drawn ?? active;
				await renderTable(
					shown === active.theme ? model : { ...model, theme: shown },
					() => this.plugin.choiceRegistry,
					tmp,
					this.plugin.app,
					this.sourcePath,
					this,
					{
						edits, actions, hiddenCtrlColButtons,
						onRootReady: (root) => { this.renderedRoot = root; },
						isSwapping: () => this.isRendering,
						cacheKey: this.cacheKey,
						getSingleClickEdit: () => this.plugin.settings.singleClickEdit,
						// A 2+-sheet workbook's sheet tabs live INSIDE the status bar (see the .bt-status-tabs
						// mount below) — the only way to switch sheets at all, so this sheet's own statusBarMode
						// preference is overridden to always show it.
						forceStatusBarPinned: !!(this.workbook && this.workbook.sheets.length > 1),
					},
				);
			}

			if (isEmpty) {
				// onXlsxImport is only offered here, not in the per-sheet-empty
				// branch below — xlsxSource is only ever honored on a whole
				// single-sheet block's own front-matter (see the xlsx-loading
				// branch above and model.ts's doc comment on the field); a sheet
				// inside an already-multi-sheet workbook has no analogous "back
				// just this sheet with a file" path in phase 1.
				await this.renderEmptyBanner(tmp, this.emptyEntries({
					template: (templateId) => this.insertTemplate(templateId),
					blank: (rows, cols) => this.insertBlank(rows, cols),
					sources: true,
				}), BUILTIN_TEMPLATES[0]?.id ?? 'blank');
			} else if (active && active.columns.length === 0) {
				// A brand-new sheet (create-sheet appends one with zero columns) or
				// any other sheet a user emptied out completely — same banner as a
				// brand-new code block. In workbook mode this scopes the insert to
				// just this sheet's own content (a workbook op, not a raw-text
				// splice, since the block already holds other sheets); in plain
				// single-sheet mode (e.g. a table whose last column was manually
				// deleted, leaving 0 columns outside the normal "add a sheet" path)
				// there's no workbook to scope into, so it falls back to the exact
				// same whole-block replace the top-level isEmpty case already uses.
				await this.renderEmptyBanner(tmp, this.emptyEntries({
					template: (templateId) => this.workbook ? this.insertTemplateIntoActiveSheet(templateId) : this.insertTemplate(templateId),
					blank: (rows, cols) => this.workbook ? this.insertBlankIntoActiveSheet(rows, cols) : this.insertBlank(rows, cols),
				}), BUILTIN_TEMPLATES[0]?.id ?? 'blank');
			}

			// Sheet tab bar — workbook-level chrome, rendered OUTSIDE/AFTER
			// renderTable()'s own output (which only ever renders the ONE active
			// sheet, whatever render mode — table/kanban/calendar — that sheet
			// itself is showing) so it stays visible regardless of the active
			// sheet's own view. Only shown once there are actually 2+ sheets to
			// switch between — a workbook that's been pared back down to a single
			// sheet (or one that never needed the bar in the first place) has
			// nothing to distinguish via tabs, so the bar would just be a single,
			// pointless pill; the left-toolbar "add sheet" button stays the entry
			// point for going from 1 sheet back up to 2.
			//
			// Mount point: when the active sheet is in the default table view,
			// renderTable() just built a `.bt-status-bar` whose `.bt-status-tabs`
			// child exists exactly for this (Task 9, see that element's own
			// comment in renderer.ts) — mounting there instead of appending a
			// second, separate bar matches Excel's own single-row "tabs + status"
			// layout and lets the two share the divider-driven width split. A
			// kanban/calendar active view returns out of renderTable() before
			// ever creating a status bar (that chrome doesn't apply to a board),
			// so the query comes back null and this falls back to the original
			// standalone bottom bar — the only placement that still works when
			// there's no status bar to share a row with.
			if (this.workbook && this.workbook.sheets.length > 1) {
				const statusTabs = tmp.querySelector<HTMLElement>('.bt-status-bar .bt-status-tabs');
				renderSheetTabBar({
					container: statusTabs ?? tmp,
					sheets: this.workbook.sheets,
					activeSheetId: this.workbook.activeSheetId ?? this.workbook.sheets[0]?.id ?? '',
					cacheKey: this.cacheKey,
					component: this,
					onOp: onWorkbookOp,
					onSwitchSheet,
					onCreateSheet,
				});
			}
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			tmp.empty();
			tmp.createDiv({ cls: 'bt-error', text: `Rich Table: ${msg}` });
		}

		this.commitRender(tmp);
	}

	/**
	 * Puts the freshly drawn tree in place of the old one, then repairs what a swap loses: focus in a resumed editor,
	 * the hover the old root had, the title's pull variable, the search marks. Needs only the tree, so it is apart from
	 * everything that decides what to draw.
	 */
	private commitRender(tmp: HTMLElement): void {
		// NOTE: the placeholder snapshot is captured from the LIVE DOM at write-back
		// time (handleStructuralOp), not here — a render()-end clone would be the
		// pristine, never-hovered base state (strips hidden), i.e. exactly the "zeroed"
		// look we're trying to avoid injecting. See injectLiveSnapshot / renderCache.

		// Atomic swap: guard so showEdgeStrips rejects any attempt to display strips
		// during the window between containerEl.empty() and the new root being in DOM.
		this.isRendering = true;
		this.containerEl.empty();
		while (tmp.firstChild) {
			this.containerEl.appendChild(tmp.firstChild);
		}
		// Force a synchronous reflow so the next getBoundingClientRect() reads the
		// settled layout, then clear the guard.
		void this.containerEl.getBoundingClientRect();
		this.isRendering = false;

		// These read live layout, so they run here, after the swap, not inside renderTable()
		// (which renders into the detached `tmp` tree where every measurement is 0).
		settleRenderedTables(this.containerEl);

		// A resumed edit (renderEditHandoff.ts) builds its editor DURING the render
		// pass above, while the cell is still part of the off-screen `tmp` tree — a
		// detached element can't actually receive focus, so `enterEditMode`'s own
		// `.focus()` call silently no-ops there. The editor exists and shows the
		// right draft text, but isn't focused, so typing does nothing until the
		// user clicks it again — which is exactly the "have to click again" bug
		// this closes. Now that the tree is live, retry focusing whichever editor
		// (if any) still carries `.bt-editing` after the swap.
		const resumedEditor = this.containerEl.querySelector<HTMLElement>(
			'.bt-editing .bt-cell-editor, .bt-editing .bt-date-input, .bt-sheet-tab-renaming .bt-sheet-tab-input',
		);
		if (resumedEditor) {
			resumedEditor.focus();
			if (resumedEditor.isContentEditable) {
				const range = activeDocument.createRange();
				range.selectNodeContents(resumedEditor);
				activeWindow.getSelection()?.removeAllRanges();
				activeWindow.getSelection()?.addRange(range);
			}
		}

		const rootEl = this.containerEl.querySelector<HTMLElement>('.bt-render-root');
		// If this rebuild was triggered by a write-back while the table's hover
		// strips were showing (mouse over the table, or strips pinned by an open
		// menu), the brand-new root has never received a mouseenter — its strips
		// start hidden and stay hidden until the next real mousemove, reading as a
		// brief "drops out of hover, then recovers" flicker even though the mouse
		// never left. A synchronous `:hover` check here can't fix it: the browser's
		// :hover recalc for a just-inserted element lags a few ms behind the swap,
		// so it returns false right now (see renderHoverHandoff.ts). Instead, carry
		// the FACT forward: the previous instance recorded whether strips were
		// showing (registerHoverState, at write-back trigger time); restore it here
		// immediately by re-dispatching mouseenter — the strip listeners recompute
		// their positions against the now-mounted, reliable layout.
		if (rootEl && takeHoverState(this.cacheKey)) {
			rootEl.dispatchEvent(new MouseEvent('mouseenter'));
			// Self-correct the small case where the mouse genuinely DID leave during
			// the rebuild: one frame later (past the :hover recalc lag) re-check, and
			// undo the restore if it's truly not hovered and no menu is holding it open.
			// This is bounded and one-shot — the root's real mouseenter/mouseleave
			// listeners remain the final backstop.
			window.requestAnimationFrame(() => {
				if (rootEl.isConnected && !rootEl.matches(':hover')) {
					rootEl.dispatchEvent(new MouseEvent('mouseleave'));
				}
			});
		}

		// Bridge --bt-title-mb-pull from root to sibling titleEl.
		// CSS custom properties only inherit to descendants; a theme sets the variable
		// on root to express its intent (e.g. 0px = no pull-close with visible border),
		// and the renderer propagates it to the title after the atomic swap so that
		// getComputedStyle() can read the live stylesheet value (detached elements
		// don't resolve stylesheet-declared custom properties).
		const titleEl = this.containerEl.querySelector<HTMLElement>('.bt-table-title');
		if (rootEl && titleEl) {
			const pull = getComputedStyle(rootEl).getPropertyValue('--bt-title-mb-pull').trim();
			if (pull) titleEl.style.setProperty('--bt-title-mb-pull', pull);
			else      titleEl.style.removeProperty('--bt-title-mb-pull');
		}

		this.plugin.searchPanel.connect();
		this.syncSearchMarks();
	}

	/** The 0-based line of this block's opening fence in its note, or null when it cannot be told. */
	get fenceLine(): number | null {
		return this.ctx.getSectionInfo(this.containerEl)?.lineStart ?? null;
	}

	get notePath(): string {
		return this.sourcePath;
	}

	get isNested(): boolean {
		return this.cacheKey.includes(NESTED_CACHE_KEY_MARKER);
	}

	/**
	 * Shows a search hit in this block: its sheet, then the place itself. Returns false when there is nothing
	 * to show (a gone sheet or cell, a collapsed table), which leaves the block as it is.
	 */
	async revealSearchHit(anchor: BlockAnchor, query: MatchOptions, framesLeft = BLOCK_WAIT_FRAMES): Promise<boolean> {
		this.hitQuery = query;
		if (!(await this.untilDrawn(framesLeft))) return false;
		if (anchor.kind !== 'cell' && anchor.kind !== 'header' && anchor.kind !== 'title' && anchor.kind !== 'footer' && anchor.kind !== 'sheet') return false;
		if ('sheetId' in anchor && anchor.sheetId !== undefined) {
			if (!this.workbook?.sheets.some(sh => sh.id === anchor.sheetId)) return false;
			if (this.workbook.activeSheetId !== anchor.sheetId) {
				this.hitSheetId = anchor.sheetId;
				await this.render();
			}
		}
		const root = this.containerEl.querySelector<HTMLElement>('.bt-render-root');
		if (!root) return false;
		const target = this.findHitElement(root, anchor);
		if (!target) return false;
		if (anchor.kind === 'cell' || anchor.kind === 'header') revealCell(target);
		else target.scrollIntoView({ block: 'nearest', inline: 'nearest' });
		this.syncSearchMarks();
		return true;
	}

	/** Waits for the block's table to be on the page: a note being opened draws its blocks a little after it appears. */
	private async untilDrawn(framesLeft: number): Promise<boolean> {
		for (let i = 0; i < framesLeft; i++) {
			if (!this.isRendering && this.containerEl.querySelector('.bt-render-root')) return true;
			await new Promise<void>(r => window.requestAnimationFrame(() => r()));
		}
		return false;
	}

	private findHitElement(root: HTMLElement, anchor: BlockAnchor): HTMLElement | null {
		const own = (el: HTMLElement | null): HTMLElement | null => (el && belongsToRoot(el, root) ? el : null);
		switch (anchor.kind) {
			case 'cell':
			case 'header': {
				const rowId = anchor.kind === 'header' ? 'header' : anchor.rowId;
				const col = Array.from(root.querySelectorAll<HTMLElement>('col[data-col-id]')).find(c => c.dataset.colId === anchor.colId && belongsToRoot(c, root));
				const tr = Array.from(root.querySelectorAll<HTMLElement>('tr[data-row-id]')).find(r => r.dataset.rowId === rowId && belongsToRoot(r, root));
				if (!col || !tr) return null;
				return own(tr.querySelector<HTMLElement>(`:scope > [data-col="${col.dataset.col}"]`));
			}
			case 'title': return own(root.querySelector<HTMLElement>('.bt-table-title'));
			case 'footer': return own(root.querySelectorAll<HTMLElement>('.bt-table-footer-line')[anchor.line] ?? null);
			case 'sheet': {
				// The tabs are drawn in the order of the sheets and carry no id of their own.
				const at = this.workbook?.sheets.findIndex(sh => sh.id === anchor.sheetId) ?? -1;
				return at < 0 ? null : (this.containerEl.querySelectorAll<HTMLElement>('.bt-sheet-tab')[at] ?? null);
			}
		}
	}

	/**
	 * Marks every match of the search on screen in this block's own cells, following the panel as the
	 * .xlsx tab does (contract 5.8). Cells of a table nested in one of ours belong to that block.
	 */
	private syncSearchMarks(): void {
		this.clearSearchMarks?.();
		this.clearSearchMarks = null;
		this.markedCells.clear();
		this.brightCell = null;
		const panel = this.plugin.searchPanel;
		const host = panel.host();
		if (!host || !panel.covers(this.sourcePath)) return;
		const state = panel.state();
		const query = state.kind === 'query' ? state.query : state.kind === 'unknown' ? this.hitQuery : null;
		if (!query || query.query === '') return;
		const root = this.containerEl.querySelector<HTMLElement>('.bt-render-root');
		if (!root) return;
		root.querySelectorAll<HTMLElement>('table.bt-table').forEach(table => {
			if (!belongsToRoot(table, root)) return;
			for (const cell of ownCells(table)) {
				const spans = matchText(markableText(cell), query, host);
				if (spans.length > 0) this.markedCells.set(cell, markSpans(cell, spans));
			}
		});
		this.clearSearchMarks = () => { for (const undo of this.markedCells.values()) undo(); };
		this.moveBright();
	}

	/**
	 * Draws the match the user opened from the results at full strength and every other one dimmed (contract
	 * 5.10). Only the class moves; the text is not marked again. It is this block's only when the fence line is
	 * the same, so another block of the note, even with an equal anchor, stays dimmed.
	 */
	private moveBright(): void {
		if (this.brightCell) this.markedCells.get(this.brightCell)?.setActive(false);
		this.brightCell = null;
		const hit = this.plugin.searchPanel.hit();
		if (!hit?.block || this.isNested || hit.path !== this.sourcePath || hit.block.fromLine !== this.fenceLine) return;
		const root = this.containerEl.querySelector<HTMLElement>('.bt-render-root');
		if (!root) return;
		const cell = this.openedCell(root, hit.block.anchor);
		const marked = cell ? this.markedCells.get(cell) : undefined;
		if (!cell || !marked) return;
		marked.setActive(true);
		this.brightCell = cell;
	}

	/** The cell the anchor names, if it is a cell of the sheet this block is showing. */
	private openedCell(root: HTMLElement, anchor: unknown): HTMLElement | null {
		if (!isBlockAnchor(anchor) || (anchor.kind !== 'cell' && anchor.kind !== 'header')) return null;
		if (anchor.sheetId !== undefined && anchor.sheetId !== this.workbook?.activeSheetId) return null;
		return this.findHitElement(root, anchor);
	}

	/** Shared by the whole-block-empty case and the per-sheet-empty case (a
	 *  freshly created sheet, or any sheet a user emptied out completely) —
	 *  same banner/copy, different insert targets (splice raw text into the
	 *  file vs populate just the active sheet's own content).
	 *
	 *  Draws one button for each entry, in the order given, and a preview of
	 *  each below them: hovering a button shows its entry's preview, and with
	 *  nothing hovered the preview of `defaultKey` shows. Every preview is
	 *  rendered once up front (all read-only) and toggled by a class, rather
	 *  than rendered on each hover — cheap enough for the few entries there
	 *  are, and no visible per-hover delay. What choosing an entry does is the
	 *  entry's own (emptyEntries.ts); this only lays them out and keeps them
	 *  from racing each other. */
	private async renderEmptyBanner(tmp: HTMLElement, entries: EmptyEntry[], defaultKey: string): Promise<void> {
		const banner = createDiv({ cls: 'bt-template-banner' });
		banner.createSpan({ cls: 'bt-template-banner-label', text: t('templatePreview') });
		const btns = banner.createDiv({ cls: 'bt-template-btns' });

		// tmp is still off-screen at this point (render() swaps it into the live
		// containerEl only after this whole method resolves) — every preview's
		// renderTable() must be AWAITED here, not fired-and-forgotten. renderTable
		// awaits one MarkdownRenderer.render() per cell, appending each row's <tr>
		// as it resolves; if that were still in flight at swap time, the rest of
		// each row would keep appending directly into the now-LIVE DOM, visibly
		// popping in row by row instead of appearing as one finished table.
		const previewHost = createDiv({ cls: 'bt-template-preview-host' });
		const previewEls = new Map<string, HTMLElement>();
		const pending: Promise<void>[] = [];
		const draw = (el: HTMLElement, model: TableModelV2) =>
			renderTable(model, () => this.plugin.choiceRegistry, el, this.plugin.app, this.sourcePath, this);
		for (const e of entries) {
			if ('hint' in e.preview) {
				// No table content exists to preview before a file is even chosen —
				// a plain text hint in the same preview slot every other button uses,
				// not a rendered table.
				const el = previewHost.createDiv({ cls: 'bt-template-preview-item bt-template-preview-text', text: e.preview.hint });
				previewEls.set(e.key, el);
			} else {
				const el = previewHost.createDiv({ cls: 'bt-template-preview-item' });
				previewEls.set(e.key, el);
				pending.push(draw(el, e.preview.model));
			}
		}

		// A dedicated overlay rather than relying on previewHost.is-inserting's
		// own cursor/pointer-events: a rendered data cell has its own explicit
		// `cursor: text` edit hint (bt-td-editable), which an ancestor's cursor
		// value can't reliably override once the descendant's own rule applies
		// to it directly — and even where it could, a stationary pointer's
		// cursor icon doesn't repaint on a pure class/style change without a
		// real subsequent pointer move (browsers only re-hit-test cursor on
		// actual movement). Re-enabling pointer-events on just this element
		// (see styles.css) makes IT the actual hit-tested target the instant
		// it appears, so it reliably owns the wait cursor regardless of what's
		// rendered underneath.
		previewHost.createDiv({ cls: 'bt-template-preview-lock' });
		await Promise.all(pending);

		const showPreview = (key: string) => {
			for (const [k, el] of previewEls) el.toggleClass('is-active', k === key);
		};
		showPreview(defaultKey);

		// One-way latch: the actual insert (vault.process write → Obsidian's file
		// watcher detects the change → this block gets reprocessed as non-empty)
		// has real latency that's entirely Obsidian's own scheduling, not
		// anything renderTable() does — so the banner stays clickable during
		// that gap unless something explicitly blocks it. Without this, clicking
		// a second (different) button before the first insert lands fires a
		// second independent write, racing the first. Once any insert starts,
		// lock the whole button row — there's nothing to unlock later since a
		// successful insert always tears this exact banner down anyway.
		//
		// previewHost is locked too, not just banner — it's a sibling, not a
		// descendant (see the append(banner, previewHost) below), so it needs
		// its own is-inserting class or the preview table underneath stays
		// fully interactive (hover strips, cell selection) for the entire
		// insert-latency gap, which is confusing since that exact table is
		// about to be replaced by a real one anyway.
		let inserting = false;
		const lockAndInsert = (fn: () => Promise<void>) => {
			if (inserting) return;
			inserting = true;
			banner.addClass('is-inserting');
			previewHost.addClass('is-inserting');
			void fn();
		};

		// An entry that opens something floating (the size picker) holds the
		// preview while it is open: the pointer leaving the button for the
		// picker would otherwise send the preview back to the default.
		let held = false;

		for (const e of entries) {
			const button = btns.createEl('button', { cls: 'bt-template-btn', text: e.label });
			button.dataset.previewKey = e.key;
			e.bind({
				button,
				insert: lockAndInsert,
				showPreview: () => showPreview(e.key),
				redraw: (model) => {
					const el = previewEls.get(e.key);
					if (!el) return;
					el.empty();
					void draw(el, model);
				},
				holdPreview: () => {
					held = true;
					// Letting go sends the preview back to the default, unless an insert has begun: then it stays on
					// what was chosen, which is about to be written.
					return () => { held = false; if (!inserting) showPreview(defaultKey); };
				},
				inserting: () => inserting,
			});
		}

		// Delegated (not per-button) so moving directly between two adjacent
		// buttons doesn't flash back to the default preview in between. Also
		// guarded by `inserting`: adding is-inserting sets the button row to
		// pointer-events:none synchronously inside the click handler, and doing
		// that while the mouse still sits over the just-clicked button makes
		// the browser re-hit-test and fire a synthetic mouseleave on it right
		// away — without this guard that flipped the frozen preview back to
		// the default template (rich-table) instead of staying on whichever one
		// was actually confirmed and is now being written.
		btns.addEventListener('mouseover', (evt: MouseEvent) => {
			if (held || inserting) return;
			const btn = (evt.target as HTMLElement).closest<HTMLElement>('.bt-template-btn');
			const key = btn?.dataset.previewKey;
			if (key) showPreview(key);
		});
		btns.addEventListener('mouseleave', () => { if (!held && !inserting) showPreview(defaultKey); });

		tmp.append(banner, previewHost);
	}

	/**
	 * The entries the guide offers, left to right: the ways to begin as another kind of table, then each template, then
	 * a blank table. Another kind of table is a property of the whole block, so those are given only where the block is
	 * empty as a whole, not for a sheet or a table emptied of its columns, which can only be filled in.
	 */
	private emptyEntries(insert: {
		template: (templateId: string) => Promise<void>;
		blank: (rows: number, cols: number) => Promise<void>;
		/** Whether the kinds of table a source brings are offered: a whole block can be one, a sheet cannot. */
		sources?: boolean;
	}): EmptyEntry[] {
		const host = { ...this.sourceHost, defaultTheme: () => this.defaultTheme() };
		return [
			...(insert.sources ? this.sourceKinds.flatMap(k => k.entry ? [k.entry(host)] : []) : []),
			...BUILTIN_TEMPLATES.map(tpl => this.templateEntry(tpl, insert.template)),
			this.blankEntry(insert.blank),
		];
	}

	/** The entry for one built-in template: one click inserts it. */
	private templateEntry(tpl: (typeof BUILTIN_TEMPLATES)[number], insert: (templateId: string) => Promise<void>): EmptyEntry {
		return {
			key: tpl.id,
			label: pick(tpl.labels),
			preview: { model: parseTable(pick(tpl.content)) },
			bind: (ctx) => { ctx.button.addEventListener('click', () => ctx.insert(() => insert(tpl.id))); },
		};
	}

	/** The entry for a blank table: pointing at it opens the size picker, and the preview follows the size under the pointer. */
	private blankEntry(insert: (rows: number, cols: number) => Promise<void>): EmptyEntry {
		const PREVIEW_SIZE = 3;
		return {
			key: 'blank',
			label: t('insertBlankTable'),
			preview: { model: buildBlankTable(PREVIEW_SIZE, PREVIEW_SIZE, this.defaultTheme()) },
			bind: (ctx) => {
				// The grid size picker renders to document.body (CONFIRMED necessary via
				// live diagnostics — see openGridSizePicker's doc comment for the
				// measured root cause: Obsidian wraps every rendered code block in a
				// `contain: paint` container, which hijacks position:fixed/absolute's
				// containing block AND clips paint to its own ~127px-tall box while the
				// block is still just this empty-state banner; no CSS position value
				// escapes that from inside it). Being outside the buttons' own DOM subtree
				// means moving the mouse up into it fires a genuine mouseleave on them,
				// which would otherwise revert the preview back to the default template
				// mid-pick. Held on the blank-table preview for as long as the picker
				// is open, regardless of where the mouse actually is; see "Hover state
				// & floating popups" for the same class of issue with the hover-strip
				// show/hide machinery.
				let release: (() => void) | null = null;
				const open = () => {
					if (release || ctx.inserting()) return; // already open — mouseenter can re-fire without a leave in between
					ctx.showPreview();
					release = ctx.holdPreview();
					openGridSizePicker({
						component: this,
						anchor: ctx.button,
						onConfirm: (rows, cols) => ctx.insert(() => insert(rows, cols)),
						// Cheap regardless of how often the grid-hover fires: every
						// cell in buildBlankTable's output is empty, and renderDataCell's empty-
						// cell branch never awaits MarkdownRenderer — so this whole render
						// resolves within the same microtask flush, well before the next real
						// mouseover (a later browser task) could start an overlapping one. No
						// staleness guard needed as long as that stays true (it would be, e.g.,
						// if a future change gave blank cells default content to render).
						onHover: (rows, cols) => ctx.redraw(buildBlankTable(rows, cols, this.defaultTheme())),
						onClose: () => { release?.(); release = null; },
					});
				};
				// Hover opens it directly — no click needed, matching the other buttons'
				// hover-to-preview behavior. Click stays wired too (harmless if already
				// open) so it's still reachable via keyboard focus + Enter/Space, which
				// never dispatches a real mouseenter.
				ctx.button.addEventListener('mouseenter', open);
				ctx.button.addEventListener('click', open);
			},
		};
	}

	/**
	 * The source for a block of this kind, the one already held when the kind is unchanged. A block names its kind
	 * in its own fields: `xlsxSource` before `tasks`, as a block is one kind of table.
	 */
	private sourceFor(model: TableModelV2 | null): BlockSource | null {
		const kind = model ? this.sourceKinds.find(k => k.matches(model)) ?? null : null;
		if (kind && kind === this.blockSourceKind) return this.blockSource;
		this.blockSource?.dispose();
		this.blockSource = kind?.create(this.sourceHost) ?? null;
		this.blockSourceKind = kind;
		return this.blockSource;
	}

	/** Every kind of source, in the order a block is matched: the first whose fields a block has is its kind. Made
	 *  once, so the kind of a block is the same object from one draw to the next. */
	private readonly sourceKinds: readonly SourceKind[] = [xlsxSourceKind, tasksSourceKind(this.plugin.tasks)];

	/** What a source may ask of this block. */
	private readonly sourceHost: SourceHost = {
		app: this.plugin.app,
		sourcePath: this.sourcePath,
		rerender: () => this.render(),
		writeBlock: (text) => this.insertBlock(text),
		queueCell: (op) => this.handleStructuralOp(op),
		chainWrite: (write) => (this.writeChain = this.writeChain.then(write, write)),
	};

	private async handleStructuralOp(op: StructuralOpV2): Promise<void> {
		await this.queueOp({ kind: 'cell', op });
	}

	private async handleWorkbookOp(op: WorkbookOpV2): Promise<void> {
		// A source's workbook (an .xlsx file's sheets) is not the block's: it must not be wrapped into one.
		if (!this.blockSource) this.convertToWorkbook();
		await this.queueOp({ kind: 'workbook', op });
	}

	/** First time a table gains a second sheet, wrap the current single-sheet
	 *  `model` into a 1-sheet workbook so `applyWorkbookOp`'s own `create-sheet`
	 *  case (append + activate) has something to append to. A no-op if already
	 *  a workbook. Never runs automatically on load — only from this explicit
	 *  user action — per the "v2→v3 is opt-in, not a forced migration" design
	 *  (tableVersion.ts's MIN_STABLE_VERSION doc comment). */
	private convertToWorkbook(): void {
		if (this.workbook || !this.model) return;
		const existingIds = new Set<string>();
		const sheet: SheetDefV2 = { ...this.model, id: genId('s', existingIds) };
		this.workbook = { version: 3, activeSheetId: sheet.id, sheets: [sheet] };
		this.model = null;
	}

	/** The reading-view check above is only meaningful once the container is in
	 *  the DOM. If it wasn't yet, re-check when it gets attached (bounded wait)
	 *  and re-render if the answer changed. */
	private recheckViewModeOnAttach(usedReadingView: boolean, framesLeft = 180): void {
		window.requestAnimationFrame(() => {
			if (!this.containerEl.isConnected) {
				if (framesLeft > 0) this.recheckViewModeOnAttach(usedReadingView, framesLeft - 1);
				return;
			}
			if (!!this.containerEl.closest('.markdown-reading-view') !== usedReadingView) void this.render();
		});
	}

	/** liveInstances/refreshAllTableBlocks' entry point — same in-place
	 *  "re-run render() on this exact instance" shape as switchXlsxSheet just
	 *  above, since nothing here needs a fresh instance/container the way a
	 *  real write-back does: only which buttons/behaviour render() itself
	 *  chooses (from `this.plugin.settings`, read fresh on every call) needs
	 *  to change, not the underlying model. */
	async refresh(): Promise<void> {
		await this.render();
	}

	/** The toolbar buttons the kind of table offers that do not change it. */
	private tableActions(source: BlockSource | null, isEmpty: boolean, isOldFormat: boolean, can: (type: TableOpType) => boolean): TableAction[] {
		const actions: TableAction[] = [...(source?.actions(can) ?? [])];
		actions.push({
			id: 'snapshot', label: t('snapshotButton'), place: 'last',
			run: [
				{ label: t('snapshotCopyPng'), icon: 'copy', run: () => void this.captureSnapshot('copy-png') },
				{ label: t('snapshotSavePng'), icon: 'image', run: () => void this.captureSnapshot('save-png') },
				{ label: t('snapshotSaveSvg'), icon: 'file-code', run: () => void this.captureSnapshot('save-svg') },
			],
		});
		// A table already backed by an .xlsx file has "open" and "detach" for the same purpose.
		if ((source?.exportable ?? true) && !isEmpty && !isOldFormat) {
			actions.push({ id: 'exportXlsx', label: t('exportToXlsx'), place: 'last', run: () => void this.exportToXlsx() });
		}
		return actions;
	}

	/** The left-toolbar snapshot button (renderer.ts's onSnapshot) — the ONE
	 *  action available on every table regardless of edit/lock/xlsx state.
	 *  tableSnapshot.ts does the actual DOM→image work (pure, no Obsidian API
	 *  calls of its own — "renderer.ts never touches the filesystem" extends
	 *  to this module too); this method is just the Obsidian-facing half:
	 *  clipboard for the copy action, vault.createBinary/create for the save
	 *  actions. */
	private async captureSnapshot(kind: SnapshotKind): Promise<void> {
		if (!this.renderedRoot) return;
		try {
			if (kind === 'copy-png') {
				const blob = await captureTablePng(this.renderedRoot);
				await navigator.clipboard.write([new ClipboardItem({ [blob.type]: blob })]);
				new Notice(t('snapshotCopied'));
				return;
			}
			const base = this.sourcePath.split('/').pop()?.replace(/\.md$/, '') ?? 'table';
			if (kind === 'save-png') {
				const blob = await captureTablePng(this.renderedRoot);
				const path = await this.plugin.app.fileManager.getAvailablePathForAttachment(`${base} table.png`, this.sourcePath);
				await this.plugin.app.vault.createBinary(path, await blob.arrayBuffer());
				new Notice(`${t('snapshotSaved')}: ${path}`);
			} else {
				const svg = await captureTableSvg(this.renderedRoot);
				const path = await this.plugin.app.fileManager.getAvailablePathForAttachment(`${base} table.svg`, this.sourcePath);
				await this.plugin.app.vault.create(path, svg);
				new Notice(`${t('snapshotSaved')}: ${path}`);
			}
		} catch (err) {
			new Notice(`${t('snapshotFailed')}: ${err instanceof Error ? err.message : String(err)}`);
		}
	}

	/** The left-toolbar "Export as .xlsx" button (renderer.ts's onExportXlsx)
	 *  — only ever wired for a native (non xlsx-backed) table, see that
	 *  callback's own doc comment. Opens `XlsxSaveModal` to pick a
	 *  destination, builds the bytes via `xlsxExport.ts` (every sheet of
	 *  `this.workbook` if present, otherwise just `this.model` — deliberately
	 *  NOT `activeModel`, which would only export whichever sheet happens to
	 *  be active right now), then writes them either through
	 *  `vault.createBinary` (a vault-relative destination — the common case,
	 *  and the only one on mobile) or a raw `fs.writeFile` (a destination
	 *  outside the vault, only reachable via the native save dialog on
	 *  desktop — see `XlsxSaveModal`'s own doc comment for why an out-of-vault
	 *  path can't go through the vault API at all). */
	private async exportToXlsx(): Promise<void> {
		const defaultFolder = this.sourcePath.includes('/') ? this.sourcePath.slice(0, this.sourcePath.lastIndexOf('/')) : '';
		const noteBasename = this.sourcePath.split('/').pop()?.replace(/\.md$/, '') ?? 'table';
		const activeTitle = (this.workbook ?? this.model)?.title;
		const defaultFilename = `${(activeTitle || noteBasename).trim()}.xlsx`;

		new XlsxSaveModal(this.plugin.app, defaultFolder, defaultFilename, (result) => {
			void this.runXlsxExport(result);
		}).open();
	}

	private async runXlsxExport(result: { vaultPath?: string; absolutePath?: string }): Promise<void> {
		try {
			// A single-sheet model has no sheet-identity field of its own (that's
			// exactly what distinguishes it from a WorkbookV3's SheetDefV2 — see
			// model.ts) — reuse the same title-or-note-basename fallback exportToXlsx
			// already computed for the default FILENAME, as the one sheet's title.
			const noteBasename = this.sourcePath.split('/').pop()?.replace(/\.md$/, '') ?? 'table';
			const sheetTitle = (this.model?.title || noteBasename).trim();
			const bytes = this.workbook ? await exportWorkbookToXlsx(this.workbook)
				: this.model ? await exportModelToXlsx(this.model, sheetTitle)
				: undefined;
			if (!bytes) return;
			const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;

			if (result.absolutePath) {
				await this.writeXlsxExportToAbsolutePath(result.absolutePath, buffer);
				return;
			}

			const vaultPath = result.vaultPath;
			if (!vaultPath) return;
			if (await vaultFileExists(this.plugin.app, vaultPath)) {
				new ConfirmOverwriteModal(this.plugin.app, vaultPath, () => {
					void this.writeXlsxExportOverwriting(vaultPath, buffer);
				}).open();
				return;
			}
			await this.createXlsxExportFile(vaultPath, buffer);
		} catch (err) {
			new Notice(`${t('exportXlsxFailed')}: ${err instanceof Error ? err.message : String(err)}`);
		}
	}

	/** `absolutePath` is only ever set by `XlsxSaveModal`'s native-dialog
	 *  branch, itself already gated behind `Platform.isDesktopApp` (see that
	 *  class's own doc comment) — this function's own `Platform.isDesktop`
	 *  early-exit is what `obsidianmd/no-nodejs-modules` requires as the FIRST
	 *  statement of an enclosing function before it accepts a Node builtin
	 *  `require()` at all (a guard anywhere else in the function body, even
	 *  one that's equally correct at runtime, doesn't satisfy the rule's
	 *  static check). */
	private async writeXlsxExportToAbsolutePath(absolutePath: string, buffer: ArrayBuffer): Promise<void> {
		if (!Platform.isDesktop) return;
		await fsPromises().writeFile(absolutePath, new Uint8Array(buffer));
		new Notice(`${t('exportXlsxSaved')}: ${absolutePath}`);
	}

	private async createXlsxExportFile(vaultPath: string, buffer: ArrayBuffer): Promise<void> {
		const folder = vaultPath.includes('/') ? vaultPath.slice(0, vaultPath.lastIndexOf('/')) : '';
		if (folder && !this.plugin.app.vault.getAbstractFileByPath(folder)) {
			await this.plugin.app.vault.createFolder(folder);
		}
		await this.plugin.app.vault.createBinary(vaultPath, buffer);
		new Notice(`${t('exportXlsxSaved')}: ${vaultPath}`);
	}

	private async writeXlsxExportOverwriting(vaultPath: string, buffer: ArrayBuffer): Promise<void> {
		try {
			const existing = this.plugin.app.vault.getAbstractFileByPath(vaultPath);
			if (existing instanceof TFile) await this.plugin.app.vault.modifyBinary(existing, buffer);
			else await this.createXlsxExportFile(vaultPath, buffer);
			new Notice(`${t('exportXlsxSaved')}: ${vaultPath}`);
		} catch (err) {
			new Notice(`${t('exportXlsxFailed')}: ${err instanceof Error ? err.message : String(err)}`);
		}
	}

	private async queueOp(pending: PendingOp): Promise<void> {
		if (!this.model && !this.workbook) return;
		// Every op passes here, whatever called for it, so a source's rules are applied here and not only in the
		// buttons: an .xlsx table's model is the whole spreadsheet, and writing it back would inline the file.
		const source = this.blockSource;
		if (source) {
			if (!source.accepts(pending.op.type)) return;
			const routed = source.route(pending.op);
			if (routed === true) return;
			pending = isWorkbookOp(routed) ? { kind: 'workbook', op: routed } : { kind: 'cell', op: routed };
		}
		// Theme/collapse instant-apply — only meaningful for cell-level ops on
		// the active sheet's own model; a workbook op never touches these fields.
		if (pending.kind === 'cell') {
			const op = pending.op;
			const active = this.activeModel;
			// Theme changes: apply the CSS class immediately so the switch is instant,
			// without waiting for write-back → re-render (which would cause a flash).
			// Also patch the render cache so the cache-inject path in the next onload()
			// already shows the new theme, preventing the A→B→A→B triple flash.
			if (op.type === 'set-theme' && this.renderedRoot) {
				applyThemeClass(this.renderedRoot, op.theme);
				const cachedRoot = renderCache.get(this.cacheKey)?.querySelector<HTMLElement>('.bt-render-root');
				if (cachedRoot) applyThemeClass(cachedRoot, op.theme);
			}
			// Same instant-apply treatment for collapse/expand — toggled onto the existing
			// class list (not overwritten) since a theme class may already be present.
			if (op.type === 'toggle-collapse' && this.renderedRoot && active) {
				const willCollapse = !active.collapsed;
				this.renderedRoot.toggleClass('bt-collapsed', willCollapse);
				const cachedRoot = renderCache.get(this.cacheKey)?.querySelector<HTMLElement>('.bt-render-root');
				cachedRoot?.toggleClass('bt-collapsed', willCollapse);
			}
		}

		// Queue the op — it will be applied along with any other ops that
		// arrive in the same JS tick before the single write-back fires.
		this.pendingOps.push(pending);
		if (this.writeBackScheduled) return; // already scheduled by an earlier op
		this.writeBackScheduled = true;
		// Record — while this instance's DOM is still live and readable — whether the
		// hover strips are currently showing, so the rebuilt instance can restore that
		// hover state immediately instead of flickering out of it (see renderHoverHandoff.ts).
		// Reading the class is more robust than :hover here: it also captures the
		// "strips pinned open because a menu is up" case (renderHoverPin.ts).
		// Own-root-only, not a blanket querySelector: a nested rich-table living
		// inside one of this table's own cells can have its OWN strips visible
		// (or its own selected cell) at the same moment, and a raw query from
		// this.renderedRoot would reach right into it.
		const root = this.renderedRoot;
		registerHoverState(this.cacheKey,
			!!root && Array.from(root.querySelectorAll('.bt-strip-visible')).some(el => belongsToRoot(el, root)));
		// Same fact-driven idea for the keyboard-selected cell (see
		// renderSelectionHandoff.ts). Exactly ONE `.bt-selected` element means a
		// single Selected cell; a mouse drag-selection paints that same class across
		// a whole range, which this single-cell mechanism deliberately doesn't cover,
		// so anything other than one match registers nothing.
		const selectedEls = root
			? Array.from(root.querySelectorAll<HTMLElement>('.bt-selected')).filter(el => belongsToRoot(el, root))
			: [];
		const onlySelected = selectedEls.length === 1 ? selectedEls[0] : undefined;
		const selRow = parseInt(onlySelected?.dataset.row ?? '-1');
		const selCol = parseInt(onlySelected?.dataset.col ?? '-1');
		registerSelectedCell(this.cacheKey,
			selRow >= 0 && selCol >= 0 ? { row: selRow, col: selCol } : null);
		// Same idea for a Calendar view's displayed month (renderCalendar.ts):
		// navigating months is a purely local DOM change, so the ONLY place that
		// knows what's currently shown is the render root's own dataset, stamped
		// by renderCalendarBoard on every navigation. Read it now, before this
		// root is torn down by the rebuild this op triggers.
		const calYear = this.renderedRoot?.dataset.btCalYear;
		const calMonth = this.renderedRoot?.dataset.btCalMonth;
		if (calYear !== undefined && calMonth !== undefined) {
			registerCalendarMonth(this.cacheKey, Number(calYear), Number(calMonth));
		}
		// Snapshot the CURRENT live DOM (content + hover strips + editing look, exactly
		// what the user is seeing) so the rebuilt instance can inject it synchronously in
		// onload() and stay visually continuous through the ~200ms tear-down/re-render —
		// no blank/zero-height window, hence no flicker and no scroll jump. Captured here,
		// before the reducers mutate anything, so it reflects the pre-op look (the rebuild
		// replaces it with the post-op content once render() finishes).
		const snapshot = this.containerEl.cloneNode(true) as HTMLElement;
		stripSearchMarks(snapshot);
		renderCache.set(this.cacheKey, snapshot);

		await new Promise<void>(resolve => { window.setTimeout(resolve, 0); });
		this.writeBackScheduled = false;

		// Apply all queued ops in order — cell ops mutate the ACTIVE sheet's own
		// model (whichever sheet is active AT THE TIME each op applies — a batch
		// never contains a sheet switch followed by cell ops meant for the OLD
		// sheet, since switching itself is a workbook op that also triggers a
		// write-back/rebuild), workbook ops mutate the sheet list itself.
		for (const p of this.pendingOps) {
			if (p.kind === 'cell') {
				const target = this.activeModel;
				if (target) applyStructuralOpV2(target, p.op);
			} else if (this.workbook) {
				applyWorkbookOp(this.workbook, p.op);
			}
		}
		this.pendingOps = [];

		// Capture line info NOW (while containerEl is still attached to DOM).
		const file = this.plugin.app.vault.getAbstractFileByPath(this.sourcePath);
		if (!(file instanceof TFile)) return;
		const info = this.ctx.getSectionInfo(this.containerEl);

		// Serialize the updated model/workbook and write it back. Deleting the
		// last remaining sheet collapses the block to a literal empty string —
		// the SAME state a brand-new code block is in — rather than persisting
		// an empty `sheets: []` shell; the next render()'s `isEmpty` branch
		// picks this up automatically and shows the template/blank-table banner.
		let newSource: string;
		if (this.workbook) {
			newSource = this.workbook.sheets.length === 0 ? '' : serializeWorkbook(this.workbook);
		} else if (this.model) {
			newSource = serializeTable(this.model);
		} else {
			return;
		}
		this.writeChain = this.writeChain.then(
			() => this.writeRawSource(newSource, this.plugin.app.vault, file, info),
			() => this.writeRawSource(newSource, this.plugin.app.vault, file, info),
		);
	}

	/** Write a raw source string back into the vault, replacing the block content. */
	private async writeRawSource(
		newSource: string,
		vault: typeof this.plugin.app.vault,
		file: TFile,
		info: ReturnType<typeof this.ctx.getSectionInfo>,
	): Promise<void> {
		if (!info) return;
		await vault.process(file, content => {
			const lines = content.split('\n');
			const bodyLines = newSource === '' ? [] : newSource.trimEnd().split('\n');
			return [
				...lines.slice(0, info.lineStart + 1),
				...bodyLines,
				...lines.slice(info.lineEnd),
			].join('\n');
		});
	}

	/** Write `noUpgrade: true` into the code block front-matter to suppress future banners. */
	private async suppressUpgradeBanner(): Promise<void> {
		const file = this.plugin.app.vault.getAbstractFileByPath(this.sourcePath);
		if (!(file instanceof TFile)) return;
		const info = this.ctx.getSectionInfo(this.containerEl);
		if (!info) return;
		await this.plugin.app.vault.process(file, content => {
			const lines = content.split('\n');
			const blockLines = lines.slice(info.lineStart + 1, info.lineEnd);
			if (blockLines[0]?.trim() === '---') {
				// Front-matter exists — insert noUpgrade after opening ---
				blockLines.splice(1, 0, 'noUpgrade: true');
			} else {
				// No front-matter yet — add a minimal one
				blockLines.unshift('---', 'noUpgrade: true', '---');
			}
			return [
				...lines.slice(0, info.lineStart + 1),
				...blockLines,
				...lines.slice(info.lineEnd),
			].join('\n');
		});
	}

	private async applyMigration(fromVersion: number): Promise<void> {
		const file = this.plugin.app.vault.getAbstractFileByPath(this.sourcePath);
		if (!(file instanceof TFile)) return;
		const info = this.ctx.getSectionInfo(this.containerEl);
		if (!info) return;
		const migratedSource = migrateSource(this.source, fromVersion);
		await this.plugin.app.vault.process(file, content => {
			const lines = content.split('\n');
			return [
				...lines.slice(0, info.lineStart + 1),
				...migratedSource.trimEnd().split('\n'),
				...lines.slice(info.lineEnd),
			].join('\n');
		});
	}

	private async insertTemplate(templateId: string): Promise<void> {
		// Round-trips the hand-authored template through parse→serialize before
		// inserting — same normalization (canonical field order, recomputed
		// formulas) a real write-back applies, instead of trusting the template
		// file's own YAML formatting to already match what the plugin would write.
		await this.insertBlock(serializeTable({ ...parseTable(getTemplateContent(templateId)), wrap: true }));
	}

	private defaultTheme(): string | undefined {
		return resolveDefaultTheme(this.plugin.settings.defaultTheme);
	}

	private async insertBlank(rows: number, cols: number): Promise<void> {
		await this.insertBlock(serializeTable(buildBlankTable(rows, cols, this.defaultTheme())));
	}

	/** Shared by insertTemplate/insertBlank/insertXlsxSource/detachFromXlsx —
	 *  all four just splice fresh content (v2 for the first three, v2 or v3
	 *  for detachFromXlsx) into the code block's current line range
	 *  (replacing whatever is there, empty or not), same pattern as
	 *  applyMigration. */
	private async insertBlock(content: string): Promise<void> {
		const file = this.plugin.app.vault.getAbstractFileByPath(this.sourcePath);
		if (!(file instanceof TFile)) return;
		const info = this.ctx.getSectionInfo(this.containerEl);
		if (!info) return;
		await this.plugin.app.vault.process(file, fileContent => {
			const lines = fileContent.split('\n');
			return [
				...lines.slice(0, info.lineStart + 1),
				...content.trimEnd().split('\n'),
				...lines.slice(info.lineEnd),
			].join('\n');
		});
	}

	/** Per-sheet analogue of insertTemplate — populates just the active (empty)
	 *  sheet's own content via a workbook op instead of splicing raw text into
	 *  the file, since the block already holds a real workbook the raw-text
	 *  path would clobber. */
	private async insertTemplateIntoActiveSheet(templateId: string): Promise<void> {
		const sheet = this.activeModel;
		if (!sheet || !this.workbook) return;
		const content: Omit<TableModelV2, 'version'> = { ...parseTable(getTemplateContent(templateId)), wrap: true };
		await this.handleWorkbookOp({ type: 'set-sheet-content', sheetId: (sheet as SheetDefV2).id, content });
	}

	private async insertBlankIntoActiveSheet(rows: number, cols: number): Promise<void> {
		const sheet = this.activeModel;
		if (!sheet || !this.workbook) return;
		const content: Omit<TableModelV2, 'version'> = buildBlankTable(rows, cols, this.defaultTheme());
		await this.handleWorkbookOp({ type: 'set-sheet-content', sheetId: (sheet as SheetDefV2).id, content });
	}
}
