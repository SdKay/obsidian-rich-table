import { MarkdownPostProcessorContext, MarkdownRenderChild, TFile, setIcon } from 'obsidian';
import { isZh, t, tableVersionTooHighMsg } from './i18n';
import { CURRENT_TABLE_VERSION, MIN_STABLE_VERSION, getTableVersion, migrateSource } from './tableVersion';
import type BetterTablePlugin from './main';
import type { SheetDefV2, TableModelV2, WorkbookV3 } from './model';
import { parseTable, parseSource } from './parser';
import { serializeTable, serializeWorkbook } from './serializer';
import { renderTable } from './renderer';
import { applyStructuralOpV2, type StructuralOpV2 } from './operations';
import { applyWorkbookOp, type WorkbookOpV2 } from './workbookOperations';
import { renderSheetTabBar } from './renderSheetTabs';
import { genId } from './idGen';
import { registerHoverState, takeHoverState } from './renderHoverHandoff';
import { registerCalendarMonth } from './renderCalendar';
import { buildBlankTable } from './blankTable';
import { openGridSizePicker } from './gridSizePicker';
import zhTemplate from './templates/zh.yaml';
import enTemplate from './templates/en.yaml';

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

function getEmptyTemplate(): string {
	return isZh() ? zhTemplate : enTemplate;
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

	constructor(
		container: HTMLElement,
		private readonly source: string,
		private readonly plugin: BetterTablePlugin,
		private readonly sourcePath: string,
		private readonly ctx: MarkdownPostProcessorContext,
		private readonly cacheKey: string,
	) {
		super(container);
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
			const active = this.activeModel;
			const locked = active?.locked ?? false;
			const onWorkbookOp = (isEmpty || !editAllowed || locked || isOldFormat) ? undefined : (op: WorkbookOpV2) => void this.handleWorkbookOp(op);
			// Left-toolbar "add sheet" button — kept visible regardless of
			// whether the table already has its own bottom sheet-tab-bar (which
			// has its own "+" too); both dispatch the exact same create-sheet op,
			// this one just stays reachable without needing the tab bar in view.
			const onCreateSheet = onWorkbookOp ? () => onWorkbookOp({ type: 'create-sheet' }) : undefined;

			if (active) {
				await renderTable(
					active,
					() => this.plugin.choiceRegistry,
					tmp,
					this.plugin.app,
					this.sourcePath,
					this,
					(isEmpty || !editAllowed || locked || isOldFormat) ? undefined : (op) => this.handleStructuralOp(op),
					lockAvailable ? () => this.handleStructuralOp({ type: 'toggle-lock' }) : undefined,
					(root) => { this.renderedRoot = root; },
					() => this.isRendering,
					this.cacheKey,
					() => this.plugin.settings.singleClickEdit,
					onCreateSheet,
					!!this.workbook && this.workbook.sheets.length > 1,
				);
			}

			if (isEmpty) {
				this.renderEmptyBanner(tmp,
					() => this.insertTemplate(),
					(rows, cols) => this.insertBlank(rows, cols));
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
				this.renderEmptyBanner(tmp,
					() => this.workbook ? this.insertTemplateIntoActiveSheet() : this.insertTemplate(),
					(rows, cols) => this.workbook ? this.insertBlankIntoActiveSheet(rows, cols) : this.insertBlank(rows, cols));
			}

			// Sheet tab bar — workbook-level chrome, rendered OUTSIDE/AFTER
			// renderTable()'s own output (which only ever renders the ONE active
			// sheet, whatever render mode — table/kanban/calendar — that sheet
			// itself is showing) so it stays visible regardless of the active
			// sheet's own view. Bottom placement matches Excel's own tab strip.
			// Only shown once there are actually 2+ sheets to switch between —
			// a workbook that's been pared back down to a single sheet (or one
			// that never needed the bar in the first place) has nothing to
			// distinguish via tabs, so the bar would just be a single, pointless
			// pill; the left-toolbar "add sheet" button stays the entry point
			// for going from 1 sheet back up to 2.
			if (this.workbook && this.workbook.sheets.length > 1) {
				renderSheetTabBar({
					container: tmp,
					sheets: this.workbook.sheets,
					activeSheetId: this.workbook.activeSheetId ?? this.workbook.sheets[0]?.id ?? '',
					cacheKey: this.cacheKey,
					component: this,
					onOp: onWorkbookOp,
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
	 *  file vs populate just the active sheet's own content). */
	private renderEmptyBanner(
		tmp: HTMLElement,
		onTemplate: () => Promise<void>,
		onBlank: (rows: number, cols: number) => Promise<void>,
	): void {
		const banner = createDiv({ cls: 'bt-template-banner' });
		banner.createSpan({ text: t('templatePreview') });
		const btns = banner.createDiv({ cls: 'bt-template-btns' });
		const insertBtn = btns.createEl('button', {
			cls: 'bt-template-btn',
			text: t('insertTemplate'),
		});
		insertBtn.addEventListener('click', () => void onTemplate());
		const blankBtn = btns.createEl('button', {
			cls: 'bt-template-btn bt-template-btn-secondary',
			text: t('insertBlankTable'),
		});
		blankBtn.addEventListener('click', () => {
			openGridSizePicker({
				component: this,
				anchor: blankBtn,
				onConfirm: (rows, cols) => void onBlank(rows, cols),
			});
		});
		tmp.prepend(banner);
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

	private async queueOp(pending: PendingOp): Promise<void> {
		if (!this.model && !this.workbook) return;

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
				const newClass = op.theme
					? `bt-render-root bt-theme-${op.theme}`
					: 'bt-render-root';
				this.renderedRoot.className = newClass;
				const cached = renderCache.get(this.cacheKey);
				if (cached) {
					const cachedRoot = cached.querySelector<HTMLElement>('.bt-render-root');
					if (cachedRoot) cachedRoot.className = newClass;
				}
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
		registerHoverState(this.cacheKey,
			!!this.renderedRoot?.querySelector('.bt-strip-visible'));
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

	private async insertTemplate(): Promise<void> {
		// The template file's own pipe-table mirror is source-controlled by hand and
		// easy to forget to update after editing the YAML — regenerate it here via
		// the same parse→serialize round trip a real write-back uses, instead of
		// trusting the template file's mirror to already be correct.
		await this.insertBlock(serializeTable(parseTable(getEmptyTemplate())));
	}

	private async insertBlank(rows: number, cols: number): Promise<void> {
		await this.insertBlock(serializeTable(buildBlankTable(rows, cols)));
	}

	/** Shared by insertTemplate/insertBlank — both just splice fresh v2 content
	 *  into the (empty) code block's line range, same pattern as applyMigration. */
	private async insertBlock(v2Content: string): Promise<void> {
		const file = this.plugin.app.vault.getAbstractFileByPath(this.sourcePath);
		if (!(file instanceof TFile)) return;
		const info = this.ctx.getSectionInfo(this.containerEl);
		if (!info) return;
		await this.plugin.app.vault.process(file, content => {
			const lines = content.split('\n');
			return [
				...lines.slice(0, info.lineStart + 1),
				...v2Content.trimEnd().split('\n'),
				...lines.slice(info.lineEnd),
			].join('\n');
		});
	}

	/** Per-sheet analogue of insertTemplate — populates just the active (empty)
	 *  sheet's own content via a workbook op instead of splicing raw text into
	 *  the file, since the block already holds a real workbook the raw-text
	 *  path would clobber. */
	private async insertTemplateIntoActiveSheet(): Promise<void> {
		const sheet = this.activeModel;
		if (!sheet || !this.workbook) return;
		const content: Omit<TableModelV2, 'version'> = parseTable(getEmptyTemplate());
		await this.handleWorkbookOp({ type: 'set-sheet-content', sheetId: (sheet as SheetDefV2).id, content });
	}

	private async insertBlankIntoActiveSheet(rows: number, cols: number): Promise<void> {
		const sheet = this.activeModel;
		if (!sheet || !this.workbook) return;
		const content: Omit<TableModelV2, 'version'> = buildBlankTable(rows, cols);
		await this.handleWorkbookOp({ type: 'set-sheet-content', sheetId: (sheet as SheetDefV2).id, content });
	}
}
