import { Menu, setIcon } from 'obsidian';
import { t } from './i18n';
import type { TableModelV2, ViewDefV2 } from './model';
import type { ChoiceRegistry } from './choiceRegistry';
import type { StructuralOpHandler, ToggleLockHandler } from './renderTypes';
import { showMenuPinned } from './renderHoverPin';
import { eligibleGroupByColumns } from './renderKanban';
import { eligibleDateColumns } from './renderCalendar';

/** A view's own `name` wins if the user ever set one explicitly (rename-view);
 *  otherwise a kanban/calendar view is labeled after its group-by/date
 *  column's CURRENT header, so renaming that column also relabels the view
 *  with no separate bookkeeping — see ViewDefV2's doc comment, model.ts. */
export function viewDisplayName(model: TableModelV2, view: ViewDefV2): string {
	if (view.name) return view.name;
	if (view.kanban) {
		const col = model.columns.find(c => c.id === view.kanban!.groupByColId);
		if (col) return col.name;
	}
	if (view.calendar) {
		const col = model.columns.find(c => c.id === view.calendar!.dateColId);
		if (col) return col.name;
	}
	return t('untitledView');
}

/**
 * The views switcher: default Table + every existing view (checked = active),
 * then one "new kanban view, grouped by X" entry per eligible choice-type
 * column and one "new calendar view, by X" entry per eligible date column
 * (Obsidian's Menu API has no submenus, so each column PICKER is flattened
 * into this same menu rather than nested behind a second click), then — only
 * when a non-default view is active — a delete-this-view entry. Shared by the
 * table-mode ctrlCol button and every view-mode toolbar's own button so all
 * three surfaces stay in sync by construction rather than by keeping copies
 * updated in parallel.
 */
export function buildViewSwitcherMenu(
	model: TableModelV2, registry: ChoiceRegistry, onStructuralOp: StructuralOpHandler,
): Menu {
	const menu = new Menu();
	menu.addItem(item => {
		item.setTitle(t('defaultTableView'));
		if (!model.activeViewId) item.setChecked(true);
		item.onClick(() => onStructuralOp({ type: 'set-active-view', viewId: null }));
	});
	for (const view of model.views ?? []) {
		menu.addItem(item => {
			item.setTitle(viewDisplayName(model, view));
			if (model.activeViewId === view.id) item.setChecked(true);
			item.onClick(() => onStructuralOp({ type: 'set-active-view', viewId: view.id }));
		});
	}

	// Exclude columns that already have a matching view — a second one would
	// look and behave identically (views share the table-wide filter/sort, see
	// ViewDefV2's doc comment), and it's already reachable above via its own
	// entry in this same menu, so there's nothing to gain by offering to create
	// a duplicate (create-view's own reducer guard also declines this, but the
	// menu shouldn't dangle an action that just switches views on click while
	// claiming to create something new).
	const groupedCols = new Set(
		(model.views ?? []).filter(v => v.type === 'kanban' && v.kanban).map(v => v.kanban!.groupByColId),
	);
	const dateCols = new Set(
		(model.views ?? []).filter(v => v.type === 'calendar' && v.calendar).map(v => v.calendar!.dateColId),
	);
	const eligibleKanban = eligibleGroupByColumns(model, registry).filter(c => !groupedCols.has(c.id));
	const eligibleCalendar = eligibleDateColumns(model).filter(c => !dateCols.has(c.id));

	if (eligibleKanban.length > 0 || eligibleCalendar.length > 0) menu.addSeparator();
	for (const col of eligibleKanban) {
		menu.addItem(item => {
			item.setTitle(`${t('newKanbanView')} ${col.name}`);
			item.setIcon('layout-grid');
			item.onClick(() => onStructuralOp({
				// name omitted — let it follow the column header automatically.
				type: 'create-view', viewType: 'kanban', groupByColId: col.id,
			}));
		});
	}
	for (const col of eligibleCalendar) {
		menu.addItem(item => {
			item.setTitle(`${t('newCalendarView')} ${col.name}`);
			item.setIcon('calendar-days');
			item.onClick(() => onStructuralOp({
				type: 'create-view', viewType: 'calendar', dateColId: col.id,
			}));
		});
	}

	const active = model.activeViewId ? model.views?.find(v => v.id === model.activeViewId) : undefined;
	if (active) {
		menu.addSeparator();
		menu.addItem(item => {
			item.setTitle(t('deleteView'));
			item.setIcon('trash');
			item.onClick(() => onStructuralOp({ type: 'delete-view', viewId: active.id }));
		});
	}
	return menu;
}

export interface RenderViewToolbarOptions {
	root: HTMLElement;
	model: TableModelV2;
	registry: ChoiceRegistry;
	onStructuralOp?: StructuralOpHandler;
	onToggleLock?: ToggleLockHandler;
	activeView: ViewDefV2;
}

/**
 * Shared header for every non-table view (Kanban, Calendar, …): an icon
 * column on the left (lock + back-to-table + view switcher) — same visual
 * role and position as the table's own `.bt-ctrl-col`, though not its
 * hover-reveal absolute-positioning mechanism, which is anchored to the
 * `<table>` element's own rect (see positionCtrlCol/computeVisibleGeom in
 * renderer.ts) and doesn't exist outside table mode; a plain in-flow column
 * sidesteps that geometry entirely. To its right, the view's name as a
 * centered title (same role as the table's own `.bt-table-title` for
 * `model.title`) above wherever the caller renders its own view — returns
 * that "main" region so the caller's content ends up centered under the
 * title rather than under the icon column too, and so a view type needing
 * its own extra toolbar controls (e.g. Calendar's month prev/next/today) can
 * append them into `main` before rendering its board.
 */
export function renderViewToolbar(opts: RenderViewToolbarOptions): HTMLElement {
	const { root, model, registry, onStructuralOp, onToggleLock, activeView } = opts;
	const layout = root.createDiv({ cls: 'bt-view-layout' });

	if (onToggleLock || onStructuralOp) {
		const icons = layout.createDiv({ cls: 'bt-view-toolbar-icons' });

		if (onToggleLock) {
			const lockBtn = icons.createDiv({
				cls: 'bt-ctrl-btn' + (model.locked ? ' is-locked' : ''),
				attr: { 'aria-label': model.locked ? t('unlockTable') : t('lockTable') },
			});
			setIcon(lockBtn, model.locked ? 'lock' : 'lock-open');
			lockBtn.addEventListener('click', () => void onToggleLock());
		}

		if (onStructuralOp) {
			// Getting INTO a non-table view is a menu action (pick/create among
			// several options), but getting back OUT of one is the single most
			// common next action from here — worth its own one-click button rather
			// than making it "open the views menu, then find and click Table" every time.
			const backBtn = icons.createDiv({ cls: 'bt-ctrl-btn', attr: { 'aria-label': t('defaultTableView') } });
			setIcon(backBtn, 'table');
			backBtn.addEventListener('click', () => onStructuralOp({ type: 'set-active-view', viewId: null }));

			const viewsBtn = icons.createDiv({ cls: 'bt-ctrl-btn', attr: { 'aria-label': t('views') } });
			setIcon(viewsBtn, 'layout-grid');
			viewsBtn.addEventListener('click', (evt: MouseEvent) =>
				showMenuPinned(buildViewSwitcherMenu(model, registry, onStructuralOp), evt));
		}
	}

	const main = layout.createDiv({ cls: 'bt-view-main' });
	main.createDiv({ cls: 'bt-view-toolbar-title', text: viewDisplayName(model, activeView) });
	return main;
}
