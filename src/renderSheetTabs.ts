import { Component, Menu, setIcon } from 'obsidian';
import { t, sheetFallbackName } from './i18n';
import type { SheetDefV2 } from './model';
import type { WorkbookOpV2 } from './workbookOperations';
import { createHandoff } from './renderStateHandoff';
import { bindPanelDismiss } from './renderPanel';

/** Drag payload type for reordering the tab strip — one dataTransfer type per
 *  drag-reorderable surface in this codebase (rows/cols/aggregate rows/kanban
 *  cards/calendar events all follow the same one-type-per-surface convention)
 *  so they coexist on the same page without cross-triggering each other's
 *  handlers. */
const DRAG_TYPE = 'bt-drag-sheet';

/** How long an ALREADY-ACTIVE tab's single click waits before entering rename
 *  — purely to avoid a brief "rename box flashes, then gets replaced by the
 *  menu" flicker on a genuine double-click/ctrl-click; renaming isn't
 *  destructive (no write-back/rebuild), so unlike an inactive tab's activate,
 *  there's no correctness reason for this delay, only a cosmetic one. */
const RENAME_DELAY_MS = 220;

/**
 * Cross-rebuild memory for "this sheet should auto-enter rename mode as soon
 * as it renders." Needed specifically for double-click/ctrl-click on an
 * INACTIVE tab, which both activates (dispatches `set-active-sheet`, which
 * triggers the normal write-back → full rebuild pipeline) AND wants to enter
 * rename mode — but by the time the SECOND click of that gesture fires, the
 * pending activation's rebuild may or may not have already landed (its
 * timing depends on vault I/O + Obsidian's file-watcher, not anything this
 * module controls). Rather than gamble on that race, the double-click/
 * ctrl-click handler always enters rename mode LOCALLY, immediately, on
 * whatever element it actually fired on (the original tab if the rebuild
 * hasn't landed yet, or the freshly-rebuilt one if it has — either way,
 * that's simply "this DOM node, right now") AND registers this handoff, so
 * that IF a rebuild lands moments later and destroys the in-progress rename,
 * the next render resumes it — the exact same fact-driven pattern already
 * proven for cell edits (renderEditHandoff.ts) and hover state
 * (renderHoverHandoff.ts), applied to sheet renaming.
 */
const renameHandoff = createHandoff<string>({ maxAgeMs: 5000 });

export interface RenderSheetTabBarOptions {
	container: HTMLElement;
	sheets: SheetDefV2[];
	activeSheetId: string;
	cacheKey: string;
	component: Component;
	/** Absent when the table is locked or editing is otherwise disallowed —
	 *  same "no handler = no interactive affordance" convention used
	 *  throughout renderer.ts (e.g. the views-switcher button). Gates rename/
	 *  drag-reorder/tab-style-menu specifically — NOT switching which sheet is
	 *  active, which stays available while locked (see onSwitchSheet): picking
	 *  which sheet to LOOK at isn't an edit, and a locked table is still
	 *  expected to be readable/navigable, just not editable. */
	onOp?: (op: WorkbookOpV2) => void;
	/** Always provided, lock or not — dispatches `set-active-sheet` directly.
	 *  Kept separate from onOp specifically so switching survives being
	 *  locked (reported: switching sheets stopped working entirely once
	 *  locked, alongside rename/drag/menu, which SHOULD be disabled — but
	 *  switching isn't an edit, it doesn't touch any sheet's content). */
	onSwitchSheet?: (sheetId: string) => void;
	/** The "+" button's own handler for adding a THIRD-or-later sheet, kept
	 *  separate from `onOp` purely for symmetry with the left-toolbar "add
	 *  sheet" button (renderer.ts/renderViews.ts) that creates the FIRST
	 *  additional one — both ultimately dispatch the same `create-sheet` op. */
	onCreateSheet?: () => void;
}

export function renderSheetTabBar(opts: RenderSheetTabBarOptions): void {
	const { container, sheets, activeSheetId, cacheKey, component, onOp, onSwitchSheet, onCreateSheet } = opts;
	const bar = container.createDiv({ cls: 'bt-sheet-tabbar' });
	const resumeRenameId = renameHandoff.take(cacheKey);

	sheets.forEach((sheet, idx) => {
		const isActive = sheet.id === activeSheetId;
		const tab = bar.createDiv({ cls: 'bt-sheet-tab' + (isActive ? ' bt-sheet-tab-active' : '') });
		if (sheet.tabColor)     tab.setCssProps({ '--bt-sheet-tab-bg': sheet.tabColor });
		if (sheet.tabTextColor) tab.setCssProps({ '--bt-sheet-tab-color': sheet.tabTextColor });
		const label = tab.createSpan({ cls: 'bt-sheet-tab-label', text: sheet.name || sheetFallbackName(idx + 1) });

		// Switching stays wired whenever onSwitchSheet exists at all (locked or
		// not); rename/drag/menu additionally require onOp, so they drop out
		// while locked without disabling activation too.
		if (onSwitchSheet || onOp) {
			if (onOp) bindTabDrag(tab, sheet.id, sheets, onOp);
			bindTabActivation(tab, {
				isActive: () => sheet.id === activeSheetId,
				onActivate: () => onSwitchSheet?.(sheet.id),
				onEnterRename: onOp ? () => {
					renameHandoff.register(cacheKey, sheet.id);
					enterSheetRename(tab, label, sheet, onOp, cacheKey);
				} : () => {},
				onOpenMenu: onOp ? (evt) => openTabMenu(evt, tab, label, sheet, component, onOp, cacheKey) : () => {},
			});
			if (onOp) {
				tab.addEventListener('contextmenu', (evt: MouseEvent) => {
					evt.preventDefault();
					openTabMenu(evt, tab, label, sheet, component, onOp, cacheKey);
				});
			}
		}

		if (onOp && resumeRenameId === sheet.id) enterSheetRename(tab, label, sheet, onOp, cacheKey);
	});

	if (onCreateSheet) {
		const addBtn = bar.createDiv({ cls: 'bt-sheet-tab-add', attr: { 'aria-label': t('newSheet'), 'data-tooltip-position': 'top' } });
		setIcon(addBtn, 'plus');
		addBtn.addEventListener('click', onCreateSheet);
	}
}

/**
 * Click/double-click/ctrl-click wiring for one tab. NOT a reuse of
 * renderCell.ts's `bindCellActivation` — that function's two modes (delayed-
 * single-click-then-primary / immediate-primary-with-ctrl-panel) don't cover
 * this shape (single click's action and delay both depend on active state;
 * double-click/ctrl-click's action ALSO depends on active state, and must
 * stay correct regardless of whether a just-dispatched activate's rebuild
 * has landed yet — see the renameHandoff doc comment above). The underlying
 * mechanics (mousedown detail-count cancels a pending timer) are the same
 * spirit, just re-derived for this specific combination.
 */
function bindTabActivation(tab: HTMLElement, opts: {
	isActive: () => boolean;
	onActivate: () => void;
	onEnterRename: () => void;
	onOpenMenu: (evt: MouseEvent) => void;
}): void {
	const isRenaming = () => tab.hasClass('bt-sheet-tab-renaming');
	let renameTimer: number | null = null;
	tab.addEventListener('mousedown', (evt: MouseEvent) => {
		if (evt.detail >= 2 && renameTimer !== null) { window.clearTimeout(renameTimer); renameTimer = null; }
	});
	tab.addEventListener('click', (evt: MouseEvent) => {
		if (isRenaming()) return;
		if (evt.detail >= 2) return; // dblclick handles it
		if (evt.ctrlKey || evt.metaKey) {
			// A single discrete event, no timing ambiguity — act as the
			// "confirmed double-click" alias immediately.
			if (opts.isActive()) opts.onOpenMenu(evt);
			else { opts.onActivate(); opts.onEnterRename(); }
			return;
		}
		if (opts.isActive()) {
			renameTimer = window.setTimeout(() => { renameTimer = null; opts.onEnterRename(); }, RENAME_DELAY_MS);
		} else {
			// Activation is idempotent (redundant dispatches to the same sheetId
			// are harmless) and non-competing with the dblclick handler below —
			// no need to delay/cancel this one.
			opts.onActivate();
		}
	});
	tab.addEventListener('dblclick', (evt: MouseEvent) => {
		if (isRenaming()) return;
		if (opts.isActive()) opts.onOpenMenu(evt);
		else { opts.onActivate(); opts.onEnterRename(); }
	});
}

function bindTabDrag(tab: HTMLElement, sheetId: string, sheets: SheetDefV2[], onOp: (op: WorkbookOpV2) => void): void {
	tab.setAttribute('draggable', 'true');
	tab.addEventListener('dragstart', (evt: DragEvent) => {
		evt.dataTransfer?.setData(DRAG_TYPE, sheetId);
		tab.addClass('bt-dragging');
	});
	tab.addEventListener('dragend', () => tab.removeClass('bt-dragging'));
	tab.addEventListener('dragover', (evt: DragEvent) => {
		if (!evt.dataTransfer?.types.includes(DRAG_TYPE)) return;
		evt.preventDefault();
		tab.addClass('bt-sheet-tab-dragover');
	});
	tab.addEventListener('dragleave', () => tab.removeClass('bt-sheet-tab-dragover'));
	tab.addEventListener('drop', (evt: DragEvent) => {
		evt.preventDefault();
		tab.removeClass('bt-sheet-tab-dragover');
		const draggedId = evt.dataTransfer?.getData(DRAG_TYPE);
		if (!draggedId || draggedId === sheetId) return;
		const ids = sheets.map(s => s.id);
		const from = ids.indexOf(draggedId);
		const to = ids.indexOf(sheetId);
		if (from < 0 || to < 0) return;
		ids.splice(to, 0, ...ids.splice(from, 1));
		onOp({ type: 'reorder-sheets', sheetIds: ids });
	});
}

/**
 * Swaps the tab's label for a text input, in place — mirrors the title/
 * footer inline editors' shape, not a floating panel, since a tab's name is
 * a short single word/phrase shown right where it's edited.
 */
function enterSheetRename(
	tab: HTMLElement, label: HTMLElement, sheet: SheetDefV2, onOp: (op: WorkbookOpV2) => void, cacheKey: string,
): void {
	if (tab.hasClass('bt-sheet-tab-renaming')) return;
	tab.addClass('bt-sheet-tab-renaming');
	const original = label.textContent ?? '';
	label.empty();
	const input = label.createEl('input', {
		cls: 'bt-sheet-tab-input',
		attr: { type: 'text', value: original },
	});
	input.focus();
	input.select();

	let done = false;
	const finish = (commit: boolean) => {
		if (done) return;
		done = true;
		// Clear the resume handoff — a rename that finished normally (commit
		// OR cancel) must not linger and get mistakenly "resumed" by some
		// later, unrelated render (e.g. switching to a DIFFERENT sheet moments
		// after this one finished renaming) — same "clear on save/cancel"
		// discipline as renderEditHandoff.ts's clearLiveEdit. Guarded to this
		// sheet's own id so it can't clear a DIFFERENT sheet's registration
		// that happened to overwrite this cacheKey's single slot in between.
		renameHandoff.clear(cacheKey, id => id === sheet.id);
		tab.removeClass('bt-sheet-tab-renaming');
		const next = commit ? input.value.trim() : '';
		label.empty();
		if (commit && next && next !== original) {
			onOp({ type: 'rename-sheet', sheetId: sheet.id, name: next });
			label.setText(next); // optimistic — the pending write-back's rebuild confirms it shortly
		} else {
			label.setText(original);
		}
	};

	input.addEventListener('keydown', (evt: KeyboardEvent) => {
		if (evt.key === 'Enter') { evt.preventDefault(); input.blur(); }
		else if (evt.key === 'Escape') { evt.preventDefault(); finish(false); }
	});
	input.addEventListener('blur', () => {
		// Deferred by one microtask, same discipline as renderEditMode.ts's
		// save() — a same-tick isConnected check inside a blur handler can't
		// tell a real user blur apart from one the browser fires as an
		// intermediate step of REMOVING the node (e.g. a pending "activate"
		// write-back rebuilding this tab bar mid-rename); both read
		// isConnected === true synchronously. One microtask later the removed
		// case has flipped to false. See CLAUDE.md's "Same-cell edit race".
		queueMicrotask(() => {
			if (!input.isConnected) return;
			finish(true);
		});
	});
}

function openTabMenu(
	evt: MouseEvent, tab: HTMLElement, label: HTMLElement, sheet: SheetDefV2,
	component: Component, onOp: (op: WorkbookOpV2) => void, cacheKey: string,
): void {
	const menu = new Menu();
	menu.addItem(item => {
		item.setTitle(t('renameSheet')).setIcon('pencil');
		item.onClick(() => enterSheetRename(tab, label, sheet, onOp, cacheKey));
	});
	menu.addItem(item => {
		item.setTitle(t('sheetTabStyle')).setIcon('palette');
		item.onClick(() => openTabStylePanel(tab, sheet, component, onOp));
	});
	menu.addSeparator();
	menu.addItem(item => {
		item.setTitle(t('deleteSheet')).setIcon('trash');
		item.onClick(() => onOp({ type: 'delete-sheet', sheetId: sheet.id }));
	});
	menu.showAtMouseEvent(evt);
}

/**
 * Small floating panel — deliberately not the shared `openCellPanel` (that
 * one is shaped for a cell's full style set — bg/text color/size/bold/
 * italic — a tab only ever needs the two colors).
 *
 * Every color input only PREVIEWS locally (sets the CSS vars directly on
 * `tab`) while open — it does NOT dispatch `set-sheet-tab-style` on every
 * 'input' event. That op would trigger the normal write-back → whole-block
 * rebuild, which constructs a brand-new TableBlock and unloads the current
 * one; `bindPanelDismiss`'s outside-click/Escape listeners are registered
 * via `component.registerDomEvent`, tied to THAT component's lifecycle, so
 * unloading it mid-interaction silently removes them — leaving the panel
 * with no way to ever dismiss itself again (reported: clicking outside/
 * Escape did nothing, and it even survived switching to a different note,
 * since nothing else was left to ever remove it). `openCellPanel`'s own
 * bg/color pickers avoid this the same way: their 'input' listeners only
 * call a local `preview()`, the real `onApplyStyle` dispatch (which DOES
 * trigger a rebuild) only fires once, synchronously inside the Apply/Clear
 * button's own click handler, in the same tick as `close()` — by the time
 * any rebuild could happen, the listeners are already detached. This panel
 * follows the exact same split, just committing on dismiss instead of a
 * dedicated Apply button (there's no separate "cancel", matching how a
 * native OS color picker has no undo once you've moved the swatch).
 */
function openTabStylePanel(
	tab: HTMLElement, sheet: SheetDefV2, component: Component, onOp: (op: WorkbookOpV2) => void,
): void {
	const panel = activeDocument.body.createDiv({ cls: 'bt-sheet-style-panel' });
	const r = tab.getBoundingClientRect();
	panel.setCssProps({ '--bt-tsp-top': `${r.bottom + 4}px`, '--bt-tsp-left': `${r.left}px` });

	let bgVal = sheet.tabColor ?? null;
	let colorVal = sheet.tabTextColor ?? null;
	const preview = () => {
		if (bgVal) tab.setCssProps({ '--bt-sheet-tab-bg': bgVal }); else tab.style.removeProperty('--bt-sheet-tab-bg');
		if (colorVal) tab.setCssProps({ '--bt-sheet-tab-color': colorVal }); else tab.style.removeProperty('--bt-sheet-tab-color');
	};

	const bgRow = panel.createDiv({ cls: 'bt-sheet-style-row' });
	bgRow.createSpan({ text: t('background') });
	const bgInput = bgRow.createEl('input', { attr: { type: 'color', value: bgVal ?? '#ffffff' } });
	bgInput.addEventListener('input', () => { bgVal = bgInput.value; preview(); });
	const bgClear = bgRow.createEl('button', { cls: 'bt-sheet-style-clear', text: '×' });
	bgClear.addEventListener('click', () => { bgVal = null; preview(); });

	const colorRow = panel.createDiv({ cls: 'bt-sheet-style-row' });
	colorRow.createSpan({ text: t('textColor') });
	const colorInput = colorRow.createEl('input', { attr: { type: 'color', value: colorVal ?? '#000000' } });
	colorInput.addEventListener('input', () => { colorVal = colorInput.value; preview(); });
	const colorClear = colorRow.createEl('button', { cls: 'bt-sheet-style-clear', text: '×' });
	colorClear.addEventListener('click', () => { colorVal = null; preview(); });

	let closed = false;
	let detach: (() => void) | null = null;
	const cleanup = () => { detach?.(); panel.remove(); };
	const close = () => {
		if (closed) return;
		closed = true;
		cleanup();
		onOp({ type: 'set-sheet-tab-style', sheetId: sheet.id, tabColor: bgVal, tabTextColor: colorVal });
	};
	detach = bindPanelDismiss(component, panel, close);
	// Belt-and-suspenders, same reasoning as pinHover's own component.register
	// use elsewhere (renderPanel.ts): if this table's DOM is torn down for any
	// OTHER reason while this panel is still open, nothing else would ever
	// call close(), leaking the panel permanently. Cleanup only, deliberately
	// NOT a commit — silently writing a half-picked color because the table
	// happened to rebuild (or the note got closed) out from under the user
	// would be a surprising side effect, not a helpful save.
	component.register(() => { if (!closed) { closed = true; cleanup(); } });
}
