/**
 * The toolbar on the left of a table: lock, auto-fit, transpose, select all, theme, statistics, collapse, view
 * settings, views and new sheet, plus the actions the kind of table offers (open its file, detach from it, snapshot,
 * export). A button is drawn when the table can do what it does, and the user can hide any of them in the settings.
 */
import { Menu, setIcon } from 'obsidian';
import { ctrlColButtonIcon, type TableModelV2, type CtrlColButtonId } from './model';
import type { ChoiceRegistry } from './choiceRegistry';
import type { TableAction } from './renderTypes';
import type { VisibleGeom } from './renderGeometry';
import type { TableEdits, TableOpType } from './tableEdits';
import { t, pick, aggLabel } from './i18n';
import { BUILTIN_THEMES } from './themes/index';
import { AGG_ORDER } from './renderAggregate';
import { buildViewSwitcherMenu, VIEW_SWITCHER_OPS } from './renderViews';
import { showMenuPinned } from './renderHoverPin';

export interface RenderCtrlColContext {
	model: TableModelV2;
	edits: TableEdits;
	actions: readonly TableAction[];
	hiddenCtrlColButtons: ReadonlySet<CtrlColButtonId> | undefined;
	forceStatusBarPinned: boolean | undefined;
	registry: ChoiceRegistry;
	hooks: { repositionCtrlCol: (geom?: VisibleGeom) => void };
	root: HTMLElement;
	view: { zoom: number };
	wrapper: HTMLElement;
	computeVisibleGeom: () => VisibleGeom;
	ctrlColLeftGap: number;
	reserveLeftPad: () => void;
	visibleCols: { colEl: HTMLElement; colIdx: number }[];
	sel: { start: { row: number; col: number } | null; end: { row: number; col: number } | null };
	updateHighlights: () => void;
	showSelectionPanel: () => void;
	/** Whether the selection panel has anything to offer, so that "select all" leads somewhere. */
	canEditSelection: boolean;
}

/** One of the table's own buttons: what it is, when it is drawn, and what a click does. */
interface CtrlButton {
	id: CtrlColButtonId;
	label: string;
	/** Drawn while the table is collapsed; the others act on the body, which is not shown then. */
	whileCollapsed?: boolean;
	/** The operations a click can lead to; drawn when the table can do any of them. */
	emits: readonly TableOpType[];
	onClick: (evt: MouseEvent) => void;
}

/** Draws the toolbar; returns whether it has any button. */
export function renderCtrlCol(ctx: RenderCtrlColContext): boolean {
	const { model, edits, actions, hiddenCtrlColButtons, forceStatusBarPinned, registry, hooks, root, view, wrapper, computeVisibleGeom, reserveLeftPad, visibleCols, sel, updateHighlights, showSelectionPanel, canEditSelection } = ctx;
	const CTRL_COL_LEFT_GAP = ctx.ctrlColLeftGap;
	const run = edits.run;
	const menuAt = (evt: MouseEvent, fill: (menu: Menu) => void) => {
		const menu = new Menu();
		fill(menu);
		showMenuPinned(menu, evt);
	};

	const own: CtrlButton[] = [
		{ id: 'lock', label: model.locked ? t('unlockTable') : t('lockTable'), emits: ['toggle-lock'],
			onClick: () => run({ type: 'toggle-lock' }) },
		// Clears every visible column's width and every row's height rather than writing a measured number: an auto
		// column follows its content on every render from here on (applyAutoColWidths), not just at this click.
		{ id: 'autoFit', label: t('autoFitAll'), emits: ['set-col-width', 'set-row-height'], onClick: () => {
			for (const { colIdx } of visibleCols) {
				const col = model.columns[colIdx];
				if (col) run({ type: 'set-col-width', colId: col.id, width: 0 });
			}
			for (const row of model.rows) run({ type: 'set-row-height', rowId: row.id, height: 0 });
		} },
		// A one-shot rewrite like any other structural op, not a reversible view: undone through the file history.
		{ id: 'transpose', label: t('transposeTable'), emits: ['transpose'], onClick: () => run({ type: 'transpose' }) },
		// Selects every cell, header included, and opens the panel a drag across the whole table would.
		{ id: 'selectAll', label: t('selectAllOpenMenu'), emits: canEditSelection ? ['set-cell-content'] : [], onClick: () => {
			sel.start = { row: 0, col: 0 };
			sel.end   = { row: model.rows.length, col: model.columns.length - 1 };
			updateHighlights();
			showSelectionPanel();
		} },
		{ id: 'theme', label: t('changeTheme'), emits: ['set-theme'], onClick: (evt) => menuAt(evt, menu => {
			const themes = [{ id: null as string | null, label: t('themeDefault') }, ...BUILTIN_THEMES.map(th => ({ id: th.id, label: pick(th.labels) }))];
			for (const { id, label } of themes) {
				menu.addItem(item => item.setTitle(label).setChecked((model.theme ?? null) === id)
					.onClick(() => run({ type: 'set-theme', theme: id })));
			}
		}) },
		// The same statistics the column strip's menu toggles, reachable without selecting a column first.
		{ id: 'aggregate', label: t('aggMore'), emits: ['toggle-aggregate'], onClick: (evt) => menuAt(evt, menu => {
			const active = new Set(model.aggregate ?? []);
			for (const agg of AGG_ORDER) {
				menu.addItem(item => item.setTitle(aggLabel(agg)).setChecked(active.has(agg))
					.onClick(() => run({ type: 'toggle-aggregate', agg })));
			}
		}) },
		{ id: 'collapse', label: model.collapsed ? t('expandTable') : t('collapseTable'), whileCollapsed: true, emits: ['toggle-collapse'],
			onClick: () => run({ type: 'toggle-collapse' }) },
		// Auto width/height (undoing a drag-resize) and the only way to add a title or footer to a table without one.
		{ id: 'viewSettings', label: t('viewSettings'), emits: ['set-view-width', 'set-view-height', 'set-status-bar-mode', 'set-title', 'set-footer'], onClick: (evt) => menuAt(evt, menu => {
			// Unchecking pins the size the view has right now, so it doesn't jump.
			const wrapperRect = wrapper.getBoundingClientRect();
			const item = (can: boolean, fill: Parameters<Menu['addItem']>[0]) => { if (can) menu.addItem(fill); };
			item(edits.can('set-view-width'), i => i.setTitle(t('autoWidth')).setIcon('move-horizontal')
				.setChecked(model.viewWidth === undefined)
				.onClick(() => run({ type: 'set-view-width', width: model.viewWidth === undefined ? Math.round(wrapperRect.width / view.zoom) : null })));
			item(edits.can('set-view-height'), i => i.setTitle(t('autoHeight')).setIcon('move-vertical')
				.setChecked(model.viewHeight === undefined)
				.onClick(() => run({ type: 'set-view-height', height: model.viewHeight === undefined ? Math.round(wrapperRect.height / view.zoom) : null })));
			// A 2+-sheet workbook always shows the bar (its tabs live there), so the toggle would do nothing.
			item(!forceStatusBarPinned && edits.can('set-status-bar-mode'), i => i.setTitle(t('showStatusBar')).setIcon('panel-bottom')
				.setChecked(model.statusBarMode !== 'hover')
				.onClick(() => run({ type: 'set-status-bar-mode', mode: model.statusBarMode !== 'hover' ? 'hover' : null })));
			const addTitle = model.title === undefined && edits.can('set-title');
			const addFooter = (!model.footer || (Array.isArray(model.footer) && model.footer.length === 0)) && edits.can('set-footer');
			if (addTitle || addFooter) menu.addSeparator();
			item(addTitle, i => i.setTitle(t('addTitle')).setIcon('heading')
				.onClick(() => run({ type: 'set-title', title: t('titlePlaceholder') })));
			item(addFooter, i => i.setTitle(t('addFooter')).setIcon('panel-bottom')
				.onClick(() => run({ type: 'set-footer', footer: t('footerPlaceholder') })));
		}) },
		// The same menu as a board view's own views button, so both offer the same views.
		{ id: 'views', label: t('views'), whileCollapsed: true, emits: VIEW_SWITCHER_OPS,
			onClick: (evt) => showMenuPinned(buildViewSwitcherMenu(model, registry, edits), evt) },
		// Makes the table a workbook, or adds a sheet to one. Kept next to the sheet tabs' own "+" so a single sheet
		// can get its second.
		{ id: 'newSheet', label: t('newSheet'), whileCollapsed: true, emits: ['create-sheet'],
			onClick: () => run({ type: 'create-sheet' }) },
	];

	const ctrlCol = root.createDiv({ cls: 'bt-ctrl-col' + (model.locked ? ' is-locked' : '') });
	let buttons = 0;
	// Hiding a button in the settings only hides it; what the table can do is unchanged.
	const shown = (id: CtrlColButtonId) => !hiddenCtrlColButtons?.has(id);
	const addButton = (id: CtrlColButtonId, label: string, onClick: (evt: MouseEvent) => void) => {
		const btn = ctrlCol.createDiv({
			cls: 'bt-ctrl-btn' + (id === 'lock' && model.locked ? ' is-locked' : ''),
			attr: { 'aria-label': label, 'data-tooltip-position': 'right' },
		});
		setIcon(btn, ctrlColButtonIcon(id, id === 'lock' && model.locked ? 'locked' : 'unlocked', model.collapsed));
		btn.addEventListener('click', onClick);
		buttons++;
	};
	const addAction = (action: TableAction) => {
		if (!shown(action.id)) return;
		const { run: act } = action;
		addButton(action.id, action.label, typeof act === 'function' ? () => act() : (evt) => menuAt(evt, menu => {
			for (const entry of act) menu.addItem(i => i.setTitle(entry.label).setIcon(entry.icon).onClick(entry.run));
		}));
	};

	// An action about the table's file comes before everything about the table itself; snapshot and export, which
	// apply whatever the table's state, come after.
	actions.filter(a => a.place === 'first').forEach(addAction);
	for (const b of own) {
		if (!shown(b.id) || (model.collapsed && !b.whileCollapsed) || !edits.canAny(b.emits)) continue;
		addButton(b.id, b.label, b.onClick);
	}
	actions.filter(a => a.place === 'last').forEach(addAction);

	// Placed just left of the row selector (or of the table, when it has none), against the VISIBLE left edge so it
	// stays on screen while a wide table is scrolled.
	const positionCtrlCol = (geom: VisibleGeom = computeVisibleGeom()) => {
		const g = geom;
		if (g.tr.width === 0) return;
		// Capped to the table's height so a short table's tall stack scrolls instead of being clipped by Obsidian's
		// container. Pinned to the visible band (vt) so it stays in view while the table scrolls inside the wrapper;
		// the cap uses the wrapper's own height, which does not change with the scroll position as the visible band
		// does at its ends.
		ctrlCol.setCssProps({
			'--cc-top':  `${g.vt + 2}px`,
			'--cc-left': `${g.vl - CTRL_COL_LEFT_GAP}px`,
			'--cc-maxh': `${Math.max(Math.min(g.th, wrapper.clientHeight) - 4, 0)}px`,
		});
	};
	// A locked table shows its toolbar without hover, so the room it needs on a wide table is reserved from the start.
	if (model.locked) reserveLeftPad();
	window.requestAnimationFrame(() => positionCtrlCol());
	hooks.repositionCtrlCol = positionCtrlCol;
	return buttons > 0;
}
