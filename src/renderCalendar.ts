import { Menu, setIcon } from 'obsidian';
import { t, calendarMoreEventsLabel } from './i18n';
import type { TableModelV2, ColumnDefV2, ViewDefV2 } from './model';
import type { ChoiceRegistry } from './choiceRegistry';
import type { StructuralOpHandler } from './renderTypes';
import { isRowFiltered, resolveCellValue } from './renderGridHelpers';
import { showMenuPinned } from './renderHoverPin';
import { createHandoff } from './renderStateHandoff';
import { renderTypedFieldValue } from './renderFieldValue';

/** Drag payload type for an event chip being dragged to a different day (or
 *  the Unscheduled tray, to clear its date) — mirrors Kanban's own
 *  'bt-drag-kanban-card' type, one dataTransfer type per view so their drag
 *  handlers can coexist on the same page without interfering. */
const DRAG_TYPE = 'bt-drag-cal-event';

/** Cap on how many event chips a single day cell shows before collapsing the
 *  rest behind a "+N more" affordance — see the "too many events per day"
 *  decision recorded in model.ts's ViewDefV2 doc comment's sibling design
 *  discussion. Kept small so a busy day doesn't blow out that week's row height. */
const MAX_EVENTS_PER_DAY = 3;

/**
 * Cross-rebuild memory of which month a Calendar view is currently showing.
 * Navigating months is a purely local DOM change (no onStructuralOp call, see
 * renderCalendarBoard) — but an UNRELATED structural op (e.g. editing some
 * other cell) still rebuilds the whole table from scratch, and a brand-new
 * TableBlock instance has no way to know what the old one had navigated to.
 * Without this, every rebuild would silently reset the view back to today's
 * month. tableBlock.ts's handleStructuralOp reads the year/month this module
 * stamps onto the render root's dataset (see the calendar branch in
 * renderer.ts) and registers it here, at write-back-trigger time, while the
 * old DOM is still live; the next render's renderCalendarBoard call takes it.
 */
const monthHandoff = createHandoff<{ year: number; month: number }>();

export function registerCalendarMonth(cacheKey: string, year: number, month: number): void {
	monthHandoff.register(cacheKey, { year, month });
}

/** Choice-registry-free: a date column is its own special type (SPECIAL_TYPES,
 *  renderTypes.ts), so eligibility here is just "is this a date column" —
 *  no eligibility list to intersect against, unlike Kanban's choice types. */
export function eligibleDateColumns(model: TableModelV2): ColumnDefV2[] {
	return model.columns.filter(c => c.type === 'date');
}

interface ParsedDate {
	year: number;
	month: number; // 0-based
	day: number;
}

/**
 * Strict local-date parse of a `type: date` cell's stored "YYYY-MM-DD" value.
 * Deliberately stricter than renderDateCell's own display-only parser (which
 * happily lets `new Date(y, m-1, d)` silently roll an invalid day into the
 * next month) — here the parse result decides which day an event is placed
 * on and whether a drag-drop rewrite should fire, so a malformed value must
 * come back as "no date" (→ Unscheduled), not a wrong day.
 */
function parseDateCell(value: string): ParsedDate | undefined {
	const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
	if (!match) return undefined;
	const year = Number(match[1]), month = Number(match[2]), day = Number(match[3]);
	const date = new Date(year, month - 1, day);
	if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return undefined;
	return { year, month: month - 1, day };
}

function formatDateCell(year: number, month: number, day: number): string {
	return `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function dateKey(year: number, month: number, day: number): string {
	return formatDateCell(year, month, day);
}

/** A variable 5-or-6-row grid of Date objects for `month` (0-based), padded
 *  with the previous/next month's trailing days so every week row is full —
 *  same "let Date roll over" trick used for padding as elsewhere in this file. */
function buildMonthGrid(year: number, month: number): Date[][] {
	const first = new Date(year, month, 1);
	const startOffset = first.getDay(); // 0 = Sunday
	const daysInMonth = new Date(year, month + 1, 0).getDate();
	const totalCells = Math.ceil((startOffset + daysInMonth) / 7) * 7;
	const cells: Date[] = [];
	for (let i = 0; i < totalCells; i++) cells.push(new Date(year, month, 1 - startOffset + i));
	const weeks: Date[][] = [];
	for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
	return weeks;
}

function weekdayLabels(): string[] {
	// 2024-01-07 is a Sunday — an arbitrary fixed anchor, only used to walk
	// through one full week for locale-correct short weekday names.
	return Array.from({ length: 7 }, (_, i) =>
		new Date(2024, 0, 7 + i).toLocaleDateString(undefined, { weekday: 'short' }));
}

interface CalEvent {
	rowId: string;
	label: string; // first non-empty field's value — used for the "+more" overflow menu's title
	fields: { label: string; value: string; colType?: string }[];
}

export interface RenderCalendarBoardOptions {
	model: TableModelV2; // already sort/filter-ready — same model renderTable() would hand the table body
	wrapper: HTMLElement;
	root: HTMLElement; // the .bt-render-root — displayed-month bookkeeping lives on its dataset
	view: ViewDefV2;
	registry: ChoiceRegistry;
	onStructuralOp?: StructuralOpHandler;
	cacheKey: string;
}

/**
 * Renders a table's rows as a month calendar, placed by one `type: date`
 * column's value. Deliberately v1-scoped (see the ViewDefV2 doc comment in
 * model.ts): shares the table's existing global filter/sort rather than
 * having its own — `model` here is the SAME already-filtered/sorted model
 * renderTable() would otherwise hand to the plain table body.
 */
export function renderCalendarBoard(opts: RenderCalendarBoardOptions): void {
	const { model, wrapper, root, view, registry, onStructuralOp, cacheKey } = opts;
	const dateColId = view.calendar?.dateColId;
	const dateCol = dateColId ? model.columns.find(c => c.id === dateColId) : undefined;
	if (!dateColId || !dateCol || dateCol.type !== 'date') {
		wrapper.createDiv({ cls: 'bt-view-empty', text: t('calendarNoDateCol') });
		return;
	}

	const locked = !!model.locked;
	// Event fields: every visible column except the date one — same "除日期列
	// 外的所有可见列" idea Kanban's card fields use, so an event chip shows the
	// same amount of information a kanban card would for the same row.
	const fieldCols: ColumnDefV2[] = model.columns.filter(c => !c.hidden && c.id !== dateColId);

	const byDate = new Map<string, CalEvent[]>();
	const unscheduled: CalEvent[] = [];
	model.rows.forEach((row, di) => {
		if (isRowFiltered(di + 1, model)) return;
		// resolveCellValue, not a raw row.cells read — see its doc comment
		// (renderGridHelpers.ts): a covered (non-anchor) row of a vertical merge
		// has a genuinely empty cell of its own, so every field needs the actual
		// resolved value, not the raw (possibly-empty) one.
		const fields = fieldCols
			.map(col => ({ label: col.name, value: resolveCellValue(model, row.id, col.id), colType: col.type }))
			.filter(f => f.value);
		const label = fields[0]?.value || t('untitledEvent');
		const ev: CalEvent = { rowId: row.id, label, fields };
		const parsed = parseDateCell(resolveCellValue(model, row.id, dateColId));
		if (!parsed) { unscheduled.push(ev); return; }
		const key = dateKey(parsed.year, parsed.month, parsed.day);
		if (!byDate.has(key)) byDate.set(key, []);
		byDate.get(key)!.push(ev);
	});

	const now = new Date();
	const remembered = monthHandoff.take(cacheKey);
	let year = remembered?.year ?? now.getFullYear();
	let month = remembered?.month ?? now.getMonth();

	const stampMonth = () => {
		root.dataset.btCalYear = String(year);
		root.dataset.btCalMonth = String(month);
	};
	stampMonth();

	const setDropTarget = (el: HTMLElement, onDrop: (rowId: string) => void) => {
		if (locked || !onStructuralOp) return;
		el.addEventListener('dragover', (evt: DragEvent) => {
			if (!evt.dataTransfer?.types.includes(DRAG_TYPE)) return;
			evt.preventDefault();
			el.addClass('bt-cal-dragover');
		});
		el.addEventListener('dragleave', () => el.removeClass('bt-cal-dragover'));
		el.addEventListener('drop', (evt: DragEvent) => {
			evt.preventDefault();
			el.removeClass('bt-cal-dragover');
			const rowId = evt.dataTransfer?.getData(DRAG_TYPE);
			if (rowId) onDrop(rowId);
		});
	};

	const makeChip = (container: HTMLElement, ev: CalEvent) => {
		const chip = container.createDiv({ cls: 'bt-cal-event' });
		if (ev.fields.length === 0) {
			chip.addClass('bt-cal-event-empty');
			chip.setText(t('untitledEvent'));
		} else {
			for (const f of ev.fields) {
				const field = chip.createDiv({ cls: 'bt-cal-event-field' });
				field.createSpan({ cls: 'bt-cal-event-field-label', text: f.label });
				const valueEl = field.createSpan({ cls: 'bt-cal-event-field-value' });
				renderTypedFieldValue(valueEl, f.colType, f.value, registry);
			}
		}
		if (!locked) {
			chip.setAttribute('draggable', 'true');
			chip.addEventListener('dragstart', (evt: DragEvent) => {
				evt.dataTransfer?.setData(DRAG_TYPE, ev.rowId);
				chip.addClass('bt-dragging');
			});
			chip.addEventListener('dragend', () => chip.removeClass('bt-dragging'));
		}
		return chip;
	};

	// ── Nav (prev / label / today / next) — a pure local DOM update, no
	// onStructuralOp: navigating months doesn't change the model at all. ──
	const nav = wrapper.createDiv({ cls: 'bt-cal-nav' });
	const prevBtn = nav.createDiv({ cls: 'bt-ctrl-btn', attr: { 'aria-label': t('calendarPrevMonth') } });
	setIcon(prevBtn, 'chevron-left');
	const navLabel = nav.createDiv({ cls: 'bt-cal-nav-label' });
	const todayBtn = nav.createDiv({ cls: 'bt-ctrl-btn', attr: { 'aria-label': t('calendarToday') } });
	setIcon(todayBtn, 'calendar');
	const nextBtn = nav.createDiv({ cls: 'bt-ctrl-btn', attr: { 'aria-label': t('calendarNextMonth') } });
	setIcon(nextBtn, 'chevron-right');

	const body = wrapper.createDiv({ cls: 'bt-cal-body' });

	const renderBody = () => {
		body.empty();
		navLabel.setText(new Date(year, month, 1).toLocaleDateString(undefined, { year: 'numeric', month: 'long' }));

		const grid = body.createDiv({ cls: 'bt-cal-grid' });
		for (const wd of weekdayLabels()) grid.createDiv({ cls: 'bt-cal-weekday', text: wd });

		const today = new Date();
		for (const week of buildMonthGrid(year, month)) {
			for (const day of week) {
				const isOutside = day.getMonth() !== month;
				const isToday = day.getFullYear() === today.getFullYear()
					&& day.getMonth() === today.getMonth() && day.getDate() === today.getDate();
				const cell = grid.createDiv({
					cls: 'bt-cal-day' + (isOutside ? ' bt-cal-day-outside' : '') + (isToday ? ' bt-cal-day-today' : ''),
				});
				cell.createDiv({ cls: 'bt-cal-day-num', text: String(day.getDate()) });
				const key = dateKey(day.getFullYear(), day.getMonth(), day.getDate());
				const events = byDate.get(key) ?? [];
				const eventsEl = cell.createDiv({ cls: 'bt-cal-day-events' });
				for (const ev of events.slice(0, MAX_EVENTS_PER_DAY)) makeChip(eventsEl, ev);
				const overflow = events.length - MAX_EVENTS_PER_DAY;
				if (overflow > 0) {
					const more = eventsEl.createDiv({ cls: 'bt-cal-more', text: calendarMoreEventsLabel(overflow) });
					more.addEventListener('click', (evt: MouseEvent) => {
						const menu = new Menu();
						for (const ev of events.slice(MAX_EVENTS_PER_DAY)) menu.addItem(item => item.setTitle(ev.label));
						showMenuPinned(menu, evt);
					});
				}
				setDropTarget(cell, (rowId) => {
					if (!onStructuralOp) return;
					onStructuralOp({
						type: 'set-cell-content', rowId, colId: dateColId,
						value: formatDateCell(day.getFullYear(), day.getMonth(), day.getDate()),
					});
				});
			}
		}

		// Unscheduled tray — always shown (even empty) so it stays a visible drop
		// target for "clear this event's date" per the confirmed undated-rows design.
		const tray = body.createDiv({ cls: 'bt-cal-unscheduled' });
		tray.createDiv({ cls: 'bt-cal-unscheduled-title', text: t('calendarUnscheduled') });
		const trayBody = tray.createDiv({ cls: 'bt-cal-unscheduled-body' });
		for (const ev of unscheduled) makeChip(trayBody, ev);
		setDropTarget(tray, (rowId) => {
			if (!onStructuralOp) return;
			onStructuralOp({ type: 'set-cell-content', rowId, colId: dateColId, value: '' });
		});
	};

	const goTo = (y: number, m: number) => {
		year = y; month = m;
		stampMonth();
		renderBody();
	};
	prevBtn.addEventListener('click', () => goTo(month === 0 ? year - 1 : year, month === 0 ? 11 : month - 1));
	nextBtn.addEventListener('click', () => goTo(month === 11 ? year + 1 : year, month === 11 ? 0 : month + 1));
	todayBtn.addEventListener('click', () => goTo(now.getFullYear(), now.getMonth()));

	renderBody();
}
