import { type EventRef, FileSystemAdapter, MarkdownPostProcessorContext, MarkdownRenderChild, Notice, Platform, TFile, setIcon } from 'obsidian';
import { isZh, t, tableVersionTooHighMsg } from './i18n';
import { CURRENT_TABLE_VERSION, MIN_STABLE_VERSION, getTableVersion, migrateSource } from './tableVersion';
import type BetterTablePlugin from './main';
import type { CtrlColButtonId, SheetDefV2, TableModelV2, WorkbookV3 } from './model';
import { parseTable, parseSource } from './parser';
import { serializeTable, serializeWorkbook } from './serializer';
import { renderTable } from './renderer';
import { applyStructuralOpV2, type StructuralOpV2 } from './operations';
import { applyWorkbookOp, type WorkbookOpV2 } from './workbookOperations';
import { renderSheetTabBar } from './renderSheetTabs';
import { applyThemeClass } from './renderThemeClass';
import { genId } from './idGen';
import { registerHoverState, takeHoverState } from './renderHoverHandoff';
import { registerSelectedCell } from './renderSelectionHandoff';
import { registerCalendarMonth, clearCalendarMonth } from './renderCalendar';
import { clearAllLiveEdits } from './renderEditHandoff';
import { buildBlankTable } from './blankTable';
import { openGridSizePicker } from './gridSizePicker';
import { BUILTIN_TEMPLATES } from './templates/index';
import { readXlsxAsModel, writeXlsxOps, isXlsxWritableOp, type XlsxWritableOp } from './xlsxSource';
import { applyAutoColWidths, applyCodeLineHeightFix } from './renderAutofit';
import { belongsToRoot } from './renderOwnScope';
import { NESTED_CACHE_KEY_MARKER } from './blockCacheKey';
import { reserveSelectorLeftPad, applyOuterFrame } from './renderGeometry';
import { openXlsxFilePicker } from './xlsxFilePicker';
import { captureTablePng, captureTableSvg } from './tableSnapshot';
import type { SnapshotKind } from './renderTypes';
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
	return isZh() ? (tpl?.zh ?? '') : (tpl?.en ?? '');
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
	// Set in render() whenever this block's content was loaded from an
	// external .xlsx file rather than parsed from this block's own YAML — see
	// the guard in queueOp().
	private isXlsxBacked = false;
	// Which sheet the user last picked in an xlsx-backed workbook. Switching
	// sheets can't go through the normal write-back/reprocess cycle (there's
	// nothing to write — see queueOp's isXlsxBacked guard), so switchXlsxSheet
	// re-runs render() directly on this same instance; render() re-derives a
	// FRESH WorkbookV3 from the file every time (it has no memory of its own
	// previous in-memory state), so this field is what survives across that
	// re-derivation to put the right sheet back active.
	private xlsxActiveSheetId: string | undefined;
	// The resolved TFile behind isXlsxBacked, set alongside it in render()'s
	// xlsx-loading branch — kept so the "open in default app" button (below)
	// doesn't need to re-resolve xlsxSource.path via metadataCache on click.
	private xlsxFile: TFile | null = null;
	// The block's own front-matter AS PARSED, captured right before the
	// xlsx-loading branch overwrites this.model with the file's real content
	// — i.e. `{ xlsxSource, viewWidth?, viewHeight?, title?, … }` with
	// `columns`/`rows` always empty (see model.ts's xlsxSource doc comment).
	// this.model/this.workbook become the DISPLAYED data (the loaded xlsx
	// content); this is the tiny "shell" that's actually honest to write back
	// to the block. setXlsxViewWidth/setXlsxViewHeight/handleXlsxRenamed all
	// mutate THIS, then re-serialize just it — never this.model/this.workbook,
	// which is exactly the giant-inline-dump risk queueOp's isXlsxBacked guard
	// exists to prevent (see that guard's own comment).
	private xlsxShell: TableModelV2 | null = null;
	// Phase-1 xlsx WRITE support (see CLAUDE.md's "xlsx write support" section):
	// batch queue for the SAME-tick-coalescing pattern queueOp already uses for
	// the YAML path, kept separate because it targets the external xlsx file
	// via writeXlsxOps/modifyBinary instead of vault.process() on this note.
	private xlsxPendingOps: XlsxWritableOp[] = [];
	private xlsxWriteScheduled = false;
	// The vault 'modify'/'rename'/'delete' listeners currently watching
	// xlsxFile for external changes (see refreshXlsxWatch) — re-established
	// on every render() since xlsxFile itself can change (e.g. xlsxSource.path
	// edited by hand), and explicitly swapped out rather than left to
	// accumulate, since leaving the OLD listeners registered too would
	// double-fire a refresh.
	private xlsxWatchRefs: EventRef[] = [];
	private xlsxRefreshTimer: number | null = null;

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
		// Registered once here, not per-render(): both callbacks read the
		// CURRENT field value at unload time regardless of when they were
		// registered, so there's nothing to gain from re-registering them on
		// every render() the way xlsxWatchRefs itself is swapped above.
		this.register(() => { for (const ref of this.xlsxWatchRefs) this.plugin.app.vault.offref(ref); });
		this.register(() => { if (this.xlsxRefreshTimer !== null) window.clearTimeout(this.xlsxRefreshTimer); });
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
					text: isZh() ? '前往社区商店升级' : 'Open in Community Store',
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
					text: isZh()
						? '该表格使用旧版格式，新版格式支持更多功能。转换时将自动修改表格代码块，可用 Ctrl+Z 撤回。'
						: 'This table uses an older format. The new format supports more features. Converting will update the code block — you can undo with Ctrl+Z.',
				});
				const btnRow = msg.createDiv({ cls: 'bt-upgrade-banner-btns' });
				const upgradeBtn = btnRow.createEl('button', {
					cls: 'bt-upgrade-banner-btn',
					text: isZh() ? '转换到新版格式' : 'Convert to new format',
				});
				upgradeBtn.addEventListener('click', () => void this.applyMigration(tableV));
				const ignoreBtn = btnRow.createEl('button', {
					cls: 'bt-upgrade-banner-btn bt-upgrade-banner-btn-muted',
					text: isZh() ? '继续使用旧版' : 'Keep old format',
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
		const editAllowed   = (!isReadingView || this.plugin.settings.allowReadingViewEdit);

		const source     = isEmpty ? getEmptyTemplate() : this.source;
		const tableV     = isEmpty ? CURRENT_TABLE_VERSION : getTableVersion(source);
		// isOldFormat: v1 tables are read-only until the user explicitly upgrades.
		// Also prevents the lock button from accidentally triggering a v1→v2 write-back.
		const isOldFormat   = !isEmpty && tableV < MIN_STABLE_VERSION;
		// lockAvailable: only for current-format tables in live-preview mode.
		const lockAvailable = !isReadingView && !isEmpty && !isOldFormat;

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
			} else {
				// Older format: migrate in-memory for a read-only preview. A v1
				// table always migrates to a plain v2 single-sheet model —
				// v1→v3 isn't a real migration path (see tableVersion.ts).
				this.model = parseTable(migrateSource(source, tableV));
				this.workbook = null;
			}

			// xlsx-backed table (phase 1: view-only — see the class-level
			// isXlsxBacked/xlsxActiveSheetId fields and queueOp's guard). Only a
			// plain single-sheet block can declare xlsxSource (see model.ts) —
			// the loaded file's OWN sheet count then decides whether this.model
			// or this.workbook ends up populated, replacing whatever the YAML
			// parse above produced. Errors (missing file, unreadable/corrupt
			// xlsx) are thrown rather than handled locally, so they fall through
			// to this method's own outer catch below and render as the exact
			// same `.bt-error` box every other parse failure in this file uses —
			// no separate error-display convention needed for this one source.
			this.isXlsxBacked = false;
			this.xlsxFile = null;
			this.xlsxShell = null;
			const xlsxRef = this.model?.xlsxSource;
			if (xlsxRef && !isEmpty) {
				this.xlsxShell = this.model;
				const dest = this.plugin.app.metadataCache.getFirstLinkpathDest(xlsxRef.path, this.sourcePath);
				if (!dest) throw new Error(isZh() ? `未找到 xlsx 文件：${xlsxRef.path}` : `xlsx file not found: ${xlsxRef.path}`);
				const bytes = await this.plugin.app.vault.readBinary(dest);
				const loaded = await readXlsxAsModel(bytes, xlsxRef.sheet);
				if (loaded.version === 3) {
					if (this.xlsxActiveSheetId && loaded.sheets.some(s => s.id === this.xlsxActiveSheetId)) {
						loaded.activeSheetId = this.xlsxActiveSheetId;
					}
					this.workbook = loaded;
					this.model = null;
				} else {
					this.model = loaded;
					this.workbook = null;
				}
				this.isXlsxBacked = true;
				this.xlsxFile = dest;
			}
			this.refreshXlsxWatch();

			const active = this.activeModel;
			// The view size is shell/block-level state (see xlsxShell's own doc
			// comment), not per-sheet — deliberately simpler than a real
			// (non-xlsx) workbook's per-sheet viewWidth/viewHeight, since the
			// original single-sheet block had only one view size to begin with,
			// before it ever became a multi-sheet display. Applied to whichever
			// sheet ends up active, so every sheet of an xlsx-backed workbook
			// shares the one size set on the block itself.
			if (this.isXlsxBacked && this.xlsxShell && active) {
				if (this.xlsxShell.viewWidth !== undefined)  active.viewWidth  = this.xlsxShell.viewWidth;
				if (this.xlsxShell.viewHeight !== undefined) active.viewHeight = this.xlsxShell.viewHeight;
				// Same shell-preservation idea, for theme: the theme picker button is
				// unavailable here (it needs onStructuralOp, which queueOp's
				// isXlsxBacked guard would drop anyway), so an xlsx-backed table can't
				// switch themes interactively. Default to 'grid' — plain/no-theme read
				// worse against a spreadsheet-shaped table than an explicit gridline
				// theme does — but still honor a theme the user hand-wrote into the
				// block's own YAML, the same way viewWidth/viewHeight above do.
				active.theme = this.xlsxShell.theme ?? 'grid';
			}
			// An xlsx-backed table is view-only outright (phase 1 — see the
			// isXlsxBacked field doc comment): every editing entry point below is
			// gated off by it directly, rather than relying solely on queueOp's
			// guard, so the UI doesn't even offer an action that would silently
			// no-op (e.g. a lock toggle that "locks" a table with nothing to lock).
			const locked = !this.isXlsxBacked && (active?.locked ?? false);
			const onWorkbookOp = (isEmpty || !editAllowed || locked || isOldFormat || this.isXlsxBacked) ? undefined : (op: WorkbookOpV2) => void this.handleWorkbookOp(op);
			// Deliberately NOT gated by editAllowed/locked, unlike onWorkbookOp
			// above — switching which sheet is active doesn't touch any sheet's
			// content, so a locked (or read-only-reading-view) table should still
			// let a user look at its other sheets. Only isEmpty/isOldFormat drop
			// this too, since neither has a real workbook to switch within.
			// For an xlsx-backed workbook, switching sheets can't route through
			// handleWorkbookOp/queueOp — there's no file content to write back to
			// (queueOp's isXlsxBacked guard would just drop it) — so it goes
			// through switchXlsxSheet, a local in-place re-render instead.
			const onSwitchSheet = (isEmpty || isOldFormat)
				? undefined
				: this.isXlsxBacked
					? (sheetId: string) => void this.switchXlsxSheet(sheetId)
					: (sheetId: string) => void this.handleWorkbookOp({ type: 'set-active-sheet', sheetId });
			// Left-toolbar "add sheet" button — kept visible regardless of
			// whether the table already has its own bottom sheet-tab-bar (which
			// has its own "+" too); both dispatch the exact same create-sheet op,
			// this one just stays reachable without needing the tab bar in view.
			const onCreateSheet = onWorkbookOp ? () => onWorkbookOp({ type: 'create-sheet' }) : undefined;

			// Which of settings.ts's three ctrlCol scenarios this table currently is —
			// same precedence renderTable()'s own button gates already imply (an
			// xlsx-backed table has neither onStructuralOp nor onToggleLock at all,
			// so it's never "locked"/"unlocked" in this sense regardless of `locked`
			// on its shell model).
			const ctrlColScenario: 'locked' | 'unlocked' | 'xlsxRef' = this.isXlsxBacked ? 'xlsxRef' : locked ? 'locked' : 'unlocked';
			const hiddenCtrlColButtons = new Set<CtrlColButtonId>(this.plugin.settings.ctrlColHiddenButtons[ctrlColScenario]);

			// isEmpty's "active" is a stand-in default-template model purely for
			// version-detection plumbing (see getEmptyTemplate) — the empty-block
			// banner below renders its own multi-template preview, so skip this
			// render entirely rather than showing the default template as if it
			// were the block's real (about-to-be-overwritten) content.
			if (active && !isEmpty) {
				await renderTable(
					active,
					() => this.plugin.choiceRegistry,
					tmp,
					this.plugin.app,
					this.sourcePath,
					this,
					(isEmpty || !editAllowed || locked || isOldFormat || this.isXlsxBacked) ? undefined : (op) => this.handleStructuralOp(op),
					(lockAvailable && !this.isXlsxBacked) ? () => this.handleStructuralOp({ type: 'toggle-lock' }) : undefined,
					(root) => { this.renderedRoot = root; },
					() => this.isRendering,
					this.cacheKey,
					() => this.plugin.settings.singleClickEdit,
					onCreateSheet,
					this.isXlsxBacked ? () => void this.openXlsxFileExternally() : undefined,
					this.isXlsxBacked ? () => void this.detachFromXlsx() : undefined,
					this.isXlsxBacked ? (width: number) => void this.setXlsxViewWidth(width) : undefined,
					this.isXlsxBacked ? (height: number) => void this.setXlsxViewHeight(height) : undefined,
					(kind) => void this.captureSnapshot(kind),
					// Phase 1 of xlsx WRITE support (see CLAUDE.md's "xlsx write support"
					// section) — the SAME handler as the normal onOp callback above
					// (queueOp's isXlsxBacked branch is what actually filters this down
					// to the writable op subset), just reachable under its own prop so
					// onOp itself stays undefined and every other editing affordance
					// stays off for this table.
					(this.isXlsxBacked && editAllowed && !isOldFormat) ? (op) => this.handleStructuralOp(op) : undefined,
					// Export-to-xlsx — the mirror-image gate of onOpenExternalFile/
					// onDetachFromXlsx above: THIS table is exactly the ones those two
					// are absent for (a native table, never xlsx-backed) — exporting
					// a table that's already backed by a real .xlsx file would just be
					// writing that same file's content back out under a new name,
					// which the existing "open in default app"/"convert to plain table"
					// buttons already cover more directly.
					(!this.isXlsxBacked && !isEmpty && !isOldFormat) ? () => void this.exportToXlsx() : undefined,
					hiddenCtrlColButtons,
					// A 2+-sheet workbook's sheet tabs live INSIDE the status bar (see
					// the .bt-status-tabs mount below) — the only way to switch sheets
					// at all, so this sheet's own statusBarMode preference is
					// overridden to always show it (see forceStatusBarPinned's own doc
					// comment on renderTable).
					!!(this.workbook && this.workbook.sheets.length > 1),
				);
			}

			if (isEmpty) {
				// onXlsxImport is only offered here, not in the per-sheet-empty
				// branch below — xlsxSource is only ever honored on a whole
				// single-sheet block's own front-matter (see the xlsx-loading
				// branch above and model.ts's doc comment on the field); a sheet
				// inside an already-multi-sheet workbook has no analogous "back
				// just this sheet with a file" path in phase 1.
				await this.renderEmptyBanner(tmp,
					(templateId) => this.insertTemplate(templateId),
					(rows, cols) => this.insertBlank(rows, cols),
					(file) => this.insertXlsxSource(file));
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
				await this.renderEmptyBanner(tmp,
					(templateId) => this.workbook ? this.insertTemplateIntoActiveSheet(templateId) : this.insertTemplate(templateId),
					(rows, cols) => this.workbook ? this.insertBlankIntoActiveSheet(rows, cols) : this.insertBlank(rows, cols));
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
					onCreateSheet: onWorkbookOp ? () => onWorkbookOp({ type: 'create-sheet' }) : undefined,
				});
			}
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			tmp.empty();
			tmp.createDiv({ cls: 'bt-error', text: `Rich Table: ${msg}` });
		}

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

		// Pin any column the renderer left unmeasured (col[data-auto] — a column
		// with no width of its own alongside a sibling that has one) to its real
		// content width. Must happen here, not inside renderTable() itself: that
		// runs against the detached `tmp` tree above, where every measurement
		// would read 0 — this is the first point the table is guaranteed attached
		// and reflowed. Runs for every sheet's table this reprocess just rendered
		// (a kanban/calendar active view has no <table> at all, so the query
		// simply finds nothing there).
		this.containerEl.querySelectorAll<HTMLElement>('table.bt-table').forEach(applyAutoColWidths);

		// Same "needs live layout, must run post-swap" reasoning, for the inline-
		// code line-height fix (see its own doc comment) — every table this
		// reprocess just rendered, found the same blanket way as above.
		this.containerEl.querySelectorAll<HTMLElement>('table.bt-table').forEach(applyCodeLineHeightFix);

		// Same "needs live layout, must run post-swap" reasoning, for the
		// selector strips' left-padding reservation (see reserveSelectorLeftPad's
		// doc comment) — every `.bt-render-root` this reprocess just rendered,
		// found the same blanket way applyAutoColWidths finds every table above
		// (a nested table's own root included, with no special-casing to single
		// it out — it gets here via the exact same query as its own top-level
		// container, and reserveSelectorLeftPad treats every root identically).
		this.containerEl.querySelectorAll<HTMLElement>('.bt-render-root').forEach(reserveSelectorLeftPad);

		// Same "needs live layout, must run post-swap" reasoning, for the outer
		// frame's own initial sizing (see applyOuterFrame's own doc comment) —
		// same blanket query/every-root treatment as reserveSelectorLeftPad
		// just above.
		this.containerEl.querySelectorAll<HTMLElement>('.bt-render-root').forEach(applyOuterFrame);

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
	}

	/** Shared by the whole-block-empty case and the per-sheet-empty case (a
	 *  freshly created sheet, or any sheet a user emptied out completely) —
	 *  same banner/copy, different insert targets (splice raw text into the
	 *  file vs populate just the active sheet's own content).
	 *
	 *  Every built-in template (BUILTIN_TEMPLATES, auto-discovered from
	 *  src/templates/) gets its own button, plus a fixed "insert blank table"
	 *  button (the one option that needs a second interaction — the grid size
	 *  picker — so it can't be a plain one-click insert like the others).
	 *  Hovering a button live-previews its content below the banner; the
	 *  default (nothing hovered) preview is always the first template
	 *  (BUILTIN_TEMPLATES[0], "demo" — see generateTemplateMeta's sort). Every
	 *  candidate is rendered once up front (all read-only, no onOp/onCellChange)
	 *  and toggled via a class, rather than re-rendering on each hover — cheap
	 *  enough for the handful of templates this is expected to have, and avoids
	 *  a visible per-hover render delay.
	 *
	 *  `onXlsxImport`, when given, adds one more button — "Import from .xlsx" —
	 *  that opens the vault-scoped file picker (xlsxFilePicker.ts) instead of
	 *  inserting directly on click. It has no real table content to preview
	 *  before a file is even chosen, so its hover preview is a plain text hint
	 *  rather than a rendered table, using the exact same key/toggle mechanism
	 *  every other button's preview already uses. */
	private async renderEmptyBanner(
		tmp: HTMLElement,
		onTemplate: (templateId: string) => Promise<void>,
		onBlank: (rows: number, cols: number) => Promise<void>,
		onXlsxImport?: (file: TFile) => Promise<void>,
	): Promise<void> {
		const BLANK_PREVIEW_SIZE = 3;
		const BLANK_KEY = 'blank';
		const XLSX_KEY = 'xlsx-import';

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
		const addPreview = (key: string, model: TableModelV2) => {
			const el = previewHost.createDiv({ cls: 'bt-template-preview-item' });
			previewEls.set(key, el);
			pending.push(renderTable(model, () => this.plugin.choiceRegistry, el, this.plugin.app, this.sourcePath, this));
		};
		for (const tpl of BUILTIN_TEMPLATES) addPreview(tpl.id, parseTable(isZh() ? tpl.zh : tpl.en));
		addPreview(BLANK_KEY, buildBlankTable(BLANK_PREVIEW_SIZE, BLANK_PREVIEW_SIZE));
		if (onXlsxImport) {
			// No table content exists to preview before a file is even chosen —
			// a plain text hint in the same preview slot every other button uses,
			// not a rendered table.
			const el = previewHost.createDiv({ cls: 'bt-template-preview-item bt-template-preview-text', text: t('xlsxImportPreviewHint') });
			previewEls.set(XLSX_KEY, el);
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

		const defaultKey = BUILTIN_TEMPLATES[0]?.id ?? BLANK_KEY;
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

		// Rebuilds the "blank" preview to the exact size currently hovered in the
		// grid picker. Cheap regardless of how often the grid-hover fires: every
		// cell in buildBlankTable's output is empty, and renderDataCell's empty-
		// cell branch never awaits MarkdownRenderer — so this whole render
		// resolves within the same microtask flush, well before the next real
		// mouseover (a later browser task) could start an overlapping one. No
		// staleness guard needed as long as that stays true (it would be, e.g.,
		// if a future change gave blank cells default content to render).
		const previewBlankSize = (rows: number, cols: number) => {
			const el = previewEls.get(BLANK_KEY);
			if (!el) return;
			el.empty();
			void renderTable(buildBlankTable(rows, cols), () => this.plugin.choiceRegistry, el, this.plugin.app, this.sourcePath, this);
		};

		// Leftmost — "import from an external file" reads as a more fundamental
		// choice of data source than "which built-in starting point", so it goes
		// first, ahead of the template buttons and the blank-table button.
		if (onXlsxImport) {
			const xlsxBtn = btns.createEl('button', { cls: 'bt-template-btn', text: t('importFromXlsx') });
			xlsxBtn.dataset.previewKey = XLSX_KEY;
			// A modal (FuzzySuggestModal), unlike the grid picker, isn't a hover
			// flyout anchored to this button — click-only, matching how every
			// other Obsidian file/command picker is invoked.
			xlsxBtn.addEventListener('click', () => {
				if (inserting) return;
				openXlsxFilePicker(this.plugin.app, (file) => lockAndInsert(() => onXlsxImport(file)));
			});
		}

		for (const tpl of BUILTIN_TEMPLATES) {
			const btn = btns.createEl('button', {
				cls: 'bt-template-btn',
				text: isZh() ? tpl.labelZh : tpl.labelEn,
			});
			btn.dataset.previewKey = tpl.id;
			btn.addEventListener('click', () => lockAndInsert(() => onTemplate(tpl.id)));
		}
		// The grid size picker renders to document.body (CONFIRMED necessary via
		// live diagnostics — see openGridSizePicker's doc comment for the
		// measured root cause: Obsidian wraps every rendered code block in a
		// `contain: paint` container, which hijacks position:fixed/absolute's
		// containing block AND clips paint to its own ~127px-tall box while the
		// block is still just this empty-state banner; no CSS position value
		// escapes that from inside it). Being outside btns' own DOM subtree
		// means moving the mouse up into it fires a genuine mouseleave on btns,
		// which would otherwise revert the preview back to the default template
		// mid-pick. Locked to the blank-table preview for as long as the picker
		// is open, regardless of where the mouse actually is; see "Hover state
		// & floating popups" for the same class of issue with the hover-strip
		// show/hide machinery.
		let pickerOpen = false;

		const blankBtn = btns.createEl('button', {
			cls: 'bt-template-btn',
			text: t('insertBlankTable'),
		});
		blankBtn.dataset.previewKey = BLANK_KEY;
		const openBlankPicker = () => {
			if (pickerOpen || inserting) return; // already open — mouseenter can re-fire without a leave in between
			pickerOpen = true;
			showPreview(BLANK_KEY);
			openGridSizePicker({
				component: this,
				anchor: blankBtn,
				onConfirm: (rows, cols) => lockAndInsert(() => onBlank(rows, cols)),
				onHover: (rows, cols) => previewBlankSize(rows, cols),
				onClose: () => { pickerOpen = false; if (!inserting) showPreview(defaultKey); },
			});
		};
		// Hover opens it directly — no click needed, matching the other buttons'
		// hover-to-preview behavior. Click stays wired too (harmless if already
		// open) so it's still reachable via keyboard focus + Enter/Space, which
		// never dispatches a real mouseenter.
		blankBtn.addEventListener('mouseenter', openBlankPicker);
		blankBtn.addEventListener('click', openBlankPicker);

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
			if (pickerOpen || inserting) return;
			const btn = (evt.target as HTMLElement).closest<HTMLElement>('.bt-template-btn');
			const key = btn?.dataset.previewKey;
			if (key) showPreview(key);
		});
		btns.addEventListener('mouseleave', () => { if (!pickerOpen && !inserting) showPreview(defaultKey); });

		tmp.append(banner, previewHost);
	}

	private async handleStructuralOp(op: StructuralOpV2): Promise<void> {
		await this.queueOp({ kind: 'cell', op });
	}

	private async handleWorkbookOp(op: WorkbookOpV2): Promise<void> {
		this.convertToWorkbook();
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

	/** The xlsx-backed counterpart to handleWorkbookOp's `set-active-sheet` —
	 *  used instead of it because there's no file content to write back to
	 *  (see queueOp's isXlsxBacked guard). Just remembers the choice and
	 *  re-runs render() in place: render() re-derives a fresh WorkbookV3 from
	 *  the file every time, and xlsxActiveSheetId is what tells that fresh copy
	 *  which sheet to reactivate. */
	private async switchXlsxSheet(sheetId: string): Promise<void> {
		this.xlsxActiveSheetId = sheetId;
		await this.render();
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

	/** The real xlsx sheet title `writeXlsxOps` should target — mirrors exactly
	 *  the `sheetName` render()'s xlsx-loading branch passed to `readXlsxAsModel`
	 *  when it read the file, so a write lands on the same sheet it was read
	 *  from. `undefined` is a valid answer in both the single-sheet case (the
	 *  block never pinned one) and lets `writeXlsxOps` fall back to the sole
	 *  visible sheet — same fallback `readXlsxAsModel` itself uses. */
	private xlsxActiveSheetName(): string | undefined {
		if (this.workbook) return this.workbook.sheets.find(s => s.id === this.workbook?.activeSheetId)?.name;
		return this.xlsxShell?.xlsxSource?.sheet;
	}

	/** Phase 1 of xlsx WRITE support — see queueOp's isXlsxBacked branch and
	 *  CLAUDE.md's "xlsx write support" section. Same same-tick batching shape
	 *  as queueOp's own YAML path (pendingOps/writeBackScheduled), applied to
	 *  the external .xlsx file instead: reads the file's CURRENT bytes fresh
	 *  (never a cached in-memory Workbook — matches how this.model/this.workbook
	 *  are already re-derived from disk on every render()), applies the whole
	 *  batch, and writes once. The vault 'modify' event a SUCCESSFUL write fires
	 *  is picked up by the SAME watcher (refreshXlsxWatch/scheduleXlsxRefresh)
	 *  that already handles an external editor changing the file — no separate
	 *  "refresh after my own write" path needed for the success case.
	 *
	 *  Failure needs its own explicit handling, though (reported: a cell edit
	 *  "succeeded" on screen — the typed text stayed visible — while the file
	 *  itself hadn't changed at all, e.g. because it was open and locked in
	 *  Excel at the time, with no error shown anywhere). Two separate gaps
	 *  produced that symptom together: (1) neither readBinary/writeXlsxOps nor
	 *  modifyBinary was ever wrapped in a try/catch, so a rejected write just
	 *  vanished as an unhandled promise rejection — nothing surfaced it; (2) the
	 *  on-screen "success" was never real in the first place — the cell editor's
	 *  own save() (renderEditMode.ts) intentionally leaves its edited text in the
	 *  DOM after a value change, on the assumption that the vault 'modify' event
	 *  from a successful write will trigger scheduleXlsxRefresh's re-render
	 *  shortly after, which replaces that DOM with the real (freshly re-read)
	 *  content. That assumption holds for a successful write; a FAILED one never
	 *  fires 'modify' at all, so nothing ever corrects the optimistic-looking but
	 *  never-actually-saved text — until the note is closed and reopened, i.e.
	 *  the very next full render(), which is what the report's "closing and
	 *  reopening shows no change" observation was actually seeing. Fixed by
	 *  catching here, surfacing a Notice, and explicitly re-rendering on failure
	 *  — re-deriving fresh from the (unchanged) file corrects the stale DOM
	 *  immediately instead of leaving it looking wrong until the next reopen. */
	private async handleXlsxWrite(op: XlsxWritableOp): Promise<void> {
		this.xlsxPendingOps.push(op);
		if (this.xlsxWriteScheduled) return;
		this.xlsxWriteScheduled = true;
		await new Promise<void>(resolve => { window.setTimeout(resolve, 0); });
		this.xlsxWriteScheduled = false;
		const ops = this.xlsxPendingOps;
		this.xlsxPendingOps = [];
		const file = this.xlsxFile;
		if (!file) return;
		try {
			const bytes = await this.plugin.app.vault.readBinary(file);
			const written = await writeXlsxOps(bytes, this.xlsxActiveSheetName(), ops);
			const buffer = written.buffer.slice(written.byteOffset, written.byteOffset + written.byteLength) as ArrayBuffer;
			await (this.writeChain = this.writeChain.then(
				() => this.plugin.app.vault.modifyBinary(file, buffer),
				() => this.plugin.app.vault.modifyBinary(file, buffer),
			));
		} catch (err) {
			new Notice(`${t('xlsxWriteFailed')}: ${err instanceof Error ? err.message : String(err)}`);
			await this.render();
		}
	}

	/** Called at the end of every render()'s xlsx-loading branch (whether or
	 *  not this table currently turns out to be xlsx-backed) to keep the vault
	 *  'modify' watcher pointed at whatever file (if any) is CURRENTLY bound —
	 *  editing xlsxSource.path by hand, or the table no longer being
	 *  xlsx-backed at all, both need the old watcher (if any) torn down rather
	 *  than left running against a file this table no longer represents. */
	private refreshXlsxWatch(): void {
		for (const ref of this.xlsxWatchRefs) this.plugin.app.vault.offref(ref);
		this.xlsxWatchRefs = [];
		if (!this.isXlsxBacked || !this.xlsxFile) return;
		const path = this.xlsxFile.path;
		const refs = [
			this.plugin.app.vault.on('modify', (file) => {
				if (file.path === path) this.scheduleXlsxRefresh();
			}),
			// Obsidian doesn't auto-update xlsxSource.path on rename the way it
			// does a real [[wikilink]] in note prose — it's a plain string field
			// inside a code block's YAML, invisible to that link-rewriting
			// feature. Without this, renaming the file breaks the reference
			// outright (next resolution throws "file not found"). Rewrite the
			// path immediately rather than waiting for the debounced refresh —
			// a rename is a single, deliberate action, not a burst of
			// intermediate autosave writes the way 'modify' can be.
			this.plugin.app.vault.on('rename', (file, oldPath) => {
				if (oldPath === path && file instanceof TFile) void this.handleXlsxRenamed(file);
			}),
			// No fix is possible here (unlike rename) — just refresh so the
			// normal "file not found" error path (render()'s own throw) shows
			// promptly instead of leaving stale content on screen indefinitely.
			this.plugin.app.vault.on('delete', (file) => {
				if (file.path === path) this.scheduleXlsxRefresh();
			}),
		];
		for (const ref of refs) this.registerEvent(ref);
		this.xlsxWatchRefs = refs;
	}

	/** Debounced re-render triggered by the 'modify'/'delete' watchers above —
	 *  an external editor (Excel, LibreOffice, …) can fire several rapid saves
	 *  for one logical edit (temp-file swaps, autosave, …), and Obsidian's own
	 *  file watcher can likewise coalesce or repeat 'modify' events for a
	 *  single real save; collapsing a burst into one refresh avoids re-reading
	 *  and re-rendering the whole file once per intermediate event. This
	 *  re-renders in place — same as switchXlsxSheet — since there's nothing
	 *  to write back and thus nothing that would otherwise trigger Obsidian to
	 *  reprocess the block. */
	private scheduleXlsxRefresh(): void {
		if (this.xlsxRefreshTimer !== null) window.clearTimeout(this.xlsxRefreshTimer);
		this.xlsxRefreshTimer = window.setTimeout(() => {
			this.xlsxRefreshTimer = null;
			void this.render();
		}, 400);
	}

	/** The 'rename' watcher's fix: rewrite xlsxSource.path to the file's new
	 *  location and write that into the block. Reuses insertBlock/xlsxShell —
	 *  same reasoning as setXlsxViewWidth/Height — and unlike those, doesn't
	 *  need a manual re-render afterward: the write itself changes the note,
	 *  which Obsidian reprocesses on its own (same as every other insertBlock
	 *  caller). */
	private async handleXlsxRenamed(newFile: TFile): Promise<void> {
		if (!this.isXlsxBacked || !this.xlsxShell?.xlsxSource) return;
		this.xlsxShell.xlsxSource = { ...this.xlsxShell.xlsxSource, path: newFile.path };
		await this.insertBlock(serializeTable(this.xlsxShell));
	}

	/** The left-toolbar "open in default app" button for an xlsx-backed table
	 *  (renderer.ts's onOpenExternalFile) — hands the file straight to
	 *  whatever the OS associates with .xlsx (real Excel, LibreOffice, …)
	 *  rather than trying to grow real editing into this plugin's own
	 *  read-only view. Desktop-only: `electron`'s `shell` module (already
	 *  `external` in esbuild.config.mjs, same as `obsidian`) doesn't exist on
	 *  mobile, and `FileSystemAdapter.getFullPath` — needed to turn a vault-
	 *  relative path into a real OS path `shell.openPath` can use — is a
	 *  desktop-only adapter (mobile's is a different, sandboxed adapter with
	 *  no such concept of a plain filesystem path). */
	private async openXlsxFileExternally(): Promise<void> {
		if (!this.xlsxFile) return;
		if (!Platform.isDesktopApp) {
			new Notice(t('openInDefaultAppUnsupported'));
			return;
		}
		const adapter = this.plugin.app.vault.adapter;
		if (!(adapter instanceof FileSystemAdapter)) return;
		const fullPath = adapter.getFullPath(this.xlsxFile.path);
		try {
			// A dynamic import('electron') fails at runtime in Obsidian's actual
			// desktop app — confirmed live ("failed to resolve module specifier
			// electron"): esbuild leaves a dynamic import of an external module
			// as a literal `import()` expression rather than rewriting it to a
			// require() call the way it does for a STATIC import of an external
			// module, and Obsidian's plugin loader doesn't resolve bare
			// specifiers through real ESM dynamic import. A plain synchronous
			// require() compiles to a literal `require("electron")` call
			// instead (same as any other external import in this codebase),
			// which Electron's own CJS module system resolves natively — the
			// same pattern used by every other Obsidian plugin that shells out
			// to electron.
			// eslint-disable-next-line @typescript-eslint/no-require-imports -- see comment above; a dynamic import() does not work here
			const { shell } = require('electron') as typeof import('electron');
			const err = await shell.openPath(fullPath);
			if (err) new Notice(`${t('openInDefaultAppFailed')}: ${err}`);
		} catch (err) {
			// Surface the real reason rather than a bare generic message —
			// "could not open" alone gives no signal on WHY (wrong path,
			// electron require failing, no app associated with .xlsx, ...).
			new Notice(`${t('openInDefaultAppFailed')}: ${err instanceof Error ? err.message : String(err)}`);
		}
	}

	/** The left-toolbar "convert to plain table" button (renderer.ts's
	 *  onDetachFromXlsx) — snapshots whatever `this.model`/`this.workbook`
	 *  CURRENTLY holds (the last successful load from the xlsx file — real
	 *  columns/rows/merges/styles, not a placeholder) and writes it into the
	 *  block as ordinary v2/v3 content with no `xlsxSource` field. Reuses
	 *  insertBlock rather than going through queueOp: there is no
	 *  StructuralOpV2/WorkbookOpV2 for "stop being xlsx-backed", and even if
	 *  there were, queueOp's isXlsxBacked guard would just drop it (correctly
	 *  — see that guard's own comment) — this needs the raw-splice write
	 *  every empty-block insert action already uses, not the reducer path.
	 *  Once this write lands, the next reprocess parses a block with no
	 *  xlsxSource at all, so isXlsxBacked comes back false and the table is a
	 *  normal, fully-editable rich-table from then on — no separate
	 *  "un-xlsx-ify" flag to maintain anywhere. */
	private async detachFromXlsx(): Promise<void> {
		if (!this.isXlsxBacked) return;
		if (this.workbook) await this.insertBlock(serializeWorkbook(this.workbook));
		else if (this.model) await this.insertBlock(serializeTable(this.model));
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
		// eslint-disable-next-line @typescript-eslint/no-require-imports -- same reasoning as openXlsxFileExternally's require('electron'); a dynamic import() does not resolve in Obsidian's desktop runtime. Bare 'fs/promises' (not 'node:fs/promises') — only the unprefixed form is in esbuild.config.mjs's builtinModules external list.
		const fs = require('fs/promises') as typeof import('fs/promises');
		await fs.writeFile(absolutePath, Buffer.from(buffer));
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

	/** renderer.ts's onSetViewWidth/onSetViewHeight for an xlsx-backed table —
	 *  mutate xlsxShell (the block's own real front-matter), never
	 *  this.model/this.workbook (the loaded xlsx content — see xlsxShell's own
	 *  doc comment for why that distinction matters here). */
	private async setXlsxViewWidth(width: number): Promise<void> {
		if (!this.isXlsxBacked || !this.xlsxShell) return;
		this.xlsxShell.viewWidth = width;
		await this.insertBlock(serializeTable(this.xlsxShell));
	}

	private async setXlsxViewHeight(height: number): Promise<void> {
		if (!this.isXlsxBacked || !this.xlsxShell) return;
		this.xlsxShell.viewHeight = height;
		await this.insertBlock(serializeTable(this.xlsxShell));
	}

	private async queueOp(pending: PendingOp): Promise<void> {
		if (!this.model && !this.workbook) return;
		// An xlsx-backed table's `this.model`/`this.workbook` is a SYNTHETIC
		// object built fresh from the external file on every render() call (see
		// the xlsx-loading branch there) — it was never derived from this code block's own
		// YAML and has nowhere honest to serialize back to (the block's real
		// content is just `xlsxSource: {...}`, a few bytes; the in-memory model
		// can be the entire spreadsheet). Guarding here — the single choke
		// point every write-back op (cell AND workbook) already funnels
		// through — is deliberate: gating each individual onOp/onWorkbookOp/
		// onSwitchSheet callback instead would need every current AND future
		// call site to separately remember this, and a single missed one would
		// silently replace the file reference with a giant inline dump.
		// Phase 1 of xlsx WRITE support (CLAUDE.md's "xlsx write support"
		// section) narrows this from an unconditional drop to a filtered one:
		// only `set-cell-content`/`set-col-name`/`merge-cells`/`unmerge-cells`
		// route to the real .xlsx file (`handleXlsxWrite`); every other op type
		// has no honest xlsx equivalent and is still dropped here exactly as
		// before. Workbook ops (sheet add/remove/reorder) aren't in the writable
		// set at all, so they fall through unchanged too.
		if (this.isXlsxBacked) {
			if (pending.kind === 'cell' && isXlsxWritableOp(pending.op)) await this.handleXlsxWrite(pending.op);
			return;
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
		renderCache.set(this.cacheKey, this.containerEl.cloneNode(true) as HTMLElement);
		// Freeze any running theme animations now — this root is about to be replaced by
		// the re-render this write triggers, so there's nothing to lose visually, and the
		// main thread is freed up to resolve the write promptly instead of competing with
		// continuous repaints (see .bt-write-pending in styles.css).
		this.renderedRoot?.addClass('bt-write-pending');

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
		await this.insertBlock(serializeTable(parseTable(getTemplateContent(templateId))));
	}

	private async insertBlank(rows: number, cols: number): Promise<void> {
		await this.insertBlock(serializeTable(buildBlankTable(rows, cols)));
	}

	/** Inserts a minimal v2 block that just points at an external .xlsx file
	 *  (see model.ts's `xlsxSource` doc comment) — no columns/rows of our own,
	 *  since the next render() picks the file's actual content up from disk
	 *  and never trusts anything written here as the real data. `file.path` is
	 *  a full vault-root-relative path, which `getFirstLinkpathDest` (used to
	 *  resolve it back in render()) always accepts unambiguously — same as
	 *  every other vault-relative reference in this plugin. */
	private async insertXlsxSource(file: TFile): Promise<void> {
		await this.insertBlock(serializeTable({
			version: 2, columns: [], rows: [], merges: [], styles: [],
			xlsxSource: { path: file.path },
		}));
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
		const content: Omit<TableModelV2, 'version'> = parseTable(getTemplateContent(templateId));
		await this.handleWorkbookOp({ type: 'set-sheet-content', sheetId: (sheet as SheetDefV2).id, content });
	}

	private async insertBlankIntoActiveSheet(rows: number, cols: number): Promise<void> {
		const sheet = this.activeModel;
		if (!sheet || !this.workbook) return;
		const content: Omit<TableModelV2, 'version'> = buildBlankTable(rows, cols);
		await this.handleWorkbookOp({ type: 'set-sheet-content', sheetId: (sheet as SheetDefV2).id, content });
	}
}
