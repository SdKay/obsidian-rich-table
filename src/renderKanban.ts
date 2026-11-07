import { t } from './i18n';
import type { TableModelV2, ColumnDefV2, ViewDefV2 } from './model';
import type { ChoiceRegistry } from './choiceRegistry';
import type { TableEdits } from './tableEdits';
import { isRowFiltered, resolveCellValue } from './renderGridHelpers';
import { renderTypedFieldValue } from './renderFieldValue';

/** Synthetic lane id for rows whose group-by cell is empty or not one of the
 *  column's defined choice options — every real option value is a real string
 *  from ChoiceRegistry, so this sentinel can never collide with one. */
const NO_VALUE_LANE = ' __no_value__';

export interface RenderKanbanBoardOptions {
	model: TableModelV2; // already sort/filter-ready — same model renderTable() would hand the table body
	wrapper: HTMLElement;
	view: ViewDefV2;
	registry: ChoiceRegistry;
	edits: TableEdits;
}

/**
 * Renders a table's rows as Kanban lanes, grouped by one choice-type column's
 * value. Deliberately v1-scoped (see the ViewDefV2 doc comment in model.ts):
 * shares the table's existing global filter/sort rather than having its own —
 * `model` here is the SAME already-filtered/sorted model renderTable() would
 * otherwise hand to the plain table body.
 */
export function renderKanbanBoard(opts: RenderKanbanBoardOptions): void {
	const { model, wrapper, view, registry, edits } = opts;
	const groupByColId = view.kanban?.groupByColId;
	if (!groupByColId) {
		wrapper.createDiv({ cls: 'bt-view-empty', text: t('kanbanNoGroupCol') });
		return;
	}
	const groupCol = model.columns.find(c => c.id === groupByColId);
	const choiceType = groupCol?.type ? registry.get(groupCol.type) : undefined;

	if (!groupCol || !choiceType) {
		wrapper.createDiv({ cls: 'bt-view-empty', text: t('kanbanNoGroupCol') });
		return;
	}

	const board = wrapper.createDiv({ cls: 'bt-kanban-board' });
	// Moving a card rewrites its group-by cell; the lock and the table's kind are both in this one answer.
	const movable = edits.can('set-cell-content');

	// Card fields: every visible column except the group-by one (per the "除
	// 分组列外的所有可见列" decision) — plain text, not markdown-rendered or
	// per-cell-styled; a v1 simplification, see ViewDefV2's doc comment.
	const cardFieldCols: ColumnDefV2[] = model.columns.filter(c => !c.hidden && c.id !== groupByColId);

	// Bucket rows into lanes: one per choice option (in defined order) plus a
	// trailing "no value" catch-all for empty/unmatched cells.
	const lanes = new Map<string, { rowId: string; row: TableModelV2['rows'][number] }[]>();
	for (const opt of choiceType.options) lanes.set(opt.value, []);
	lanes.set(NO_VALUE_LANE, []);

	model.rows.forEach((row, di) => {
		if (isRowFiltered(di + 1, model)) return;
		// resolveCellValue, not a raw row.cells read: if the group-by column is
		// itself vertically merged, every row but the merge's anchor has a
		// genuinely empty cell in the model (see resolveCellValue's doc comment)
		// — reading it raw would misfile every one of those rows into the
		// "no value" lane instead of the lane its merged value actually names.
		const raw = resolveCellValue(model, row.id, groupByColId).trim();
		const key = lanes.has(raw) ? raw : NO_VALUE_LANE;
		lanes.get(key)!.push({ rowId: row.id, row });
	});

	const laneDefs = [
		...choiceType.options.map(o => ({ value: o.value, label: o.label ?? o.value, color: o.color })),
		{ value: NO_VALUE_LANE, label: t('kanbanNoValue'), color: undefined },
	];

	for (const laneDef of laneDefs) {
		const laneEl = board.createDiv({ cls: 'bt-kanban-lane' });
		const header = laneEl.createDiv({ cls: 'bt-kanban-lane-header' });
		if (laneDef.color) {
			header.createSpan({ cls: 'bt-kanban-lane-dot' }).setCssProps({ '--bt-lane-dot': laneDef.color });
		}
		header.createSpan({ cls: 'bt-kanban-lane-title', text: laneDef.label });
		header.createSpan({ cls: 'bt-kanban-lane-count', text: String(lanes.get(laneDef.value)?.length ?? 0) });

		const body = laneEl.createDiv({ cls: 'bt-kanban-lane-body' });

		if (movable) {
			body.addEventListener('dragover', (evt: DragEvent) => {
				if (!evt.dataTransfer?.types.includes('bt-drag-kanban-card')) return;
				evt.preventDefault();
				laneEl.addClass('bt-kanban-lane-dragover');
			});
			body.addEventListener('dragleave', () => laneEl.removeClass('bt-kanban-lane-dragover'));
			body.addEventListener('drop', (evt: DragEvent) => {
				evt.preventDefault();
				laneEl.removeClass('bt-kanban-lane-dragover');
				const rowId = evt.dataTransfer?.getData('bt-drag-kanban-card');
				if (!rowId) return;
				const value = laneDef.value === NO_VALUE_LANE ? '' : laneDef.value;
				edits.run({ type: 'set-cell-content', rowId, colId: groupByColId, value });
			});
		}

		for (const { rowId, row } of lanes.get(laneDef.value) ?? []) {
			const card = body.createDiv({ cls: 'bt-kanban-card' });
			// Same color the choice pill uses for this exact value in table mode
			// (--bt-choice-bg, renderCell.ts) — laneDef.color IS that option's
			// color verbatim, so a card visually matches its own status/priority
			// pill without a second color lookup. The "no value" lane has no
			// color (nothing to match), so those cards keep the plain default.
			if (laneDef.color) card.setCssProps({ '--bt-kanban-card-bg': laneDef.color });
			if (movable) {
				card.setAttribute('draggable', 'true');
				card.addEventListener('dragstart', (evt: DragEvent) => {
					evt.dataTransfer?.setData('bt-drag-kanban-card', rowId);
					card.addClass('bt-dragging');
				});
				card.addEventListener('dragend', () => card.removeClass('bt-dragging'));
			}
			for (const col of cardFieldCols) {
				// resolveCellValue: a covered (non-anchor) row of a vertical merge has
				// a genuinely empty cell of its own — see resolveCellValue's doc
				// comment. Every card is an independent, unspanned box, unlike a
				// plain table row, so it needs the actual resolved value, not the
				// raw (possibly-empty) one.
				const value = resolveCellValue(model, row.id, col.id);
				if (!value) continue;
				const field = card.createDiv({ cls: 'bt-kanban-card-field' });
				field.createSpan({ cls: 'bt-kanban-card-field-label', text: col.name });
				const valueEl = field.createSpan({ cls: 'bt-kanban-card-field-value' });
				renderTypedFieldValue(valueEl, col.type, value, registry);
			}
			if (cardFieldCols.every(c => !resolveCellValue(model, row.id, c.id))) {
				card.addClass('bt-kanban-card-empty');
			}
		}
	}
}

/** Choice-type columns eligible as a Kanban group-by — anything registered in
 *  ChoiceRegistry (task-status, priority, custom types, …). Plain-text/date
 *  columns are excluded: they have no fixed set of "lanes" to group into. */
export function eligibleGroupByColumns(model: TableModelV2, registry: ChoiceRegistry): ColumnDefV2[] {
	return model.columns.filter(c => c.type && registry.get(c.type));
}
