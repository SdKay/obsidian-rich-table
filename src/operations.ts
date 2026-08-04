import type { TableModelV2, ColumnDefV2, RowDefV2, StyleRuleV2, MergeRangeV2, AggType, ViewDefV2 } from './model';
import { genId } from './idGen';
import { parseStyleTarget, serializeStyleTarget } from './styleTarget';

/**
 * Structural operations for v2 tables.
 *
 * All row/column references use stable string IDs, not positional indices.
 * afterRowId / afterColId = null means "insert at the beginning".
 * Row operations never include the header row (rows[] is data rows only).
 */
export type StructuralOpV2 =
	| { type: 'insert-row';      afterRowId: string | null }
	| { type: 'delete-row';      rowId: string }
	| { type: 'move-row';        fromRowId: string; toRowId: string }
	| { type: 'hide-row';        rowId: string }
	| { type: 'show-row-group';  rowIds: string[] }
	| { type: 'insert-col';      afterColId: string | null }
	| { type: 'delete-col';      colId: string }
	| { type: 'move-col';        fromColId: string; toColId: string }
	| { type: 'hide-col';        colId: string }
	| { type: 'show-col-group';  colIds: string[] }
	| { type: 'merge-cells';     anchorRowId: string; anchorColId: string; endRowId: string; endColId: string }
	| { type: 'unmerge-cells';   anchorRowId: string; anchorColId: string }
	/** Splits an unmerged cell into two stacked rows: inserts a real row right after
	 *  `rowId`, then extends/creates a merge for every OTHER column at `rowId` so
	 *  their content keeps looking like one unbroken block. No-ops if the target
	 *  cell is already part of a merge. */
	| { type: 'split-cell-row';  rowId: string; colId: string }
	/** Column-axis mirror of `split-cell-row`: inserts a column, extends/creates a
	 *  merge for every OTHER row at `colId`. */
	| { type: 'split-cell-col';  rowId: string; colId: string }
	| { type: 'set-cell-content'; rowId: string; colId: string; value: string }
	| { type: 'set-col-name';    colId: string; name: string }
	| { type: 'set-col-type';    colId: string; colType: string | undefined }
	| { type: 'set-col-width';   colId: string; width: number }
	| { type: 'set-col-align';   colId: string; align: 'left' | 'center' | 'right' | null }
	| { type: 'set-row-height';  rowId: string; height: number }
	| { type: 'set-cell-style';  rowId: string; colId: string; bg: string | null; color: string | null; size: number | null; bold: boolean | null; italic: boolean | null }
	| { type: 'set-range-style'; target: string; bg: string | null; color: string | null; size: number | null; bold: boolean | null; italic: boolean | null }
	| { type: 'split-range-style'; rangeTarget: string; excludeRowId: string; excludeColId: string }
	| { type: 'set-title';       title: string | undefined }
	| { type: 'set-footer';      footer: string | string[] | undefined }
	| { type: 'set-filter';      colId: string; values: string[] | null }
	/** Adds `agg` to the table-wide active summary rows if absent, removes it if present. */
	| { type: 'toggle-aggregate'; agg: AggType }
	/** Removes `agg` from the active summary rows — the "delete this summary row" action. */
	| { type: 'clear-aggregate'; agg: AggType }
	/** Sets the explicit render order for summary rows (drag-reorder in the row selector). */
	| { type: 'reorder-aggregate'; order: AggType[] }
	| { type: 'set-theme';       theme: string | null }
	| { type: 'toggle-lock' }
	| { type: 'toggle-collapse' }
	/** null = unfreeze rows entirely. A count that would split a vertical
	 *  merge across the boundary is rejected (model left unchanged) — see
	 *  canFreezeRows; callers should check that first to show the user why. */
	| { type: 'set-freeze-rows'; count: number | null }
	/** Column-axis mirror of `set-freeze-rows` — see canFreezeCols. */
	| { type: 'set-freeze-cols'; count: number | null }
	/** Manual view width/height in px; null resets to auto (see model.ts). */
	| { type: 'set-view-width';  width: number | null }
	| { type: 'set-view-height'; height: number | null }
	| { type: 'paste-values';   anchorRowId: string; anchorColId: string; values: string[][] }
	| { type: 'set-sort';       sort: { colId: string; dir: 'asc' | 'desc' } | null }
	/** One-time sort: physically commits the given row order to storage — the
	 *  caller (renderer.ts) computes `rowIds` since it owns the type-aware
	 *  comparators; the reducer just applies the already-decided order. */
	| { type: 'reorder-rows';   rowIds: string[] }
	/** Creates a new view and switches to it immediately (matches how a new
	 *  row/column is both created and left as the natural next target). */
	/** name omitted = derive the display name from groupByColId/dateColId's
	 *  current column header (see ViewDefV2's doc comment in model.ts).
	 *  groupByColId applies to viewType 'kanban', dateColId to 'calendar'. */
	| { type: 'create-view';    name?: string; viewType: 'table' | 'kanban' | 'calendar'; groupByColId?: string; dateColId?: string }
	| { type: 'delete-view';    viewId: string }
	| { type: 'rename-view';    viewId: string; name: string }
	/** Changes a kanban view's group-by column — a no-op for a non-kanban view. */
	| { type: 'set-view-group'; viewId: string; groupByColId: string }
	/** Changes a calendar view's date column — a no-op for a non-calendar view. */
	| { type: 'set-view-date-col'; viewId: string; dateColId: string }
	/** null/absent-matching id = switch back to the default Table view. */
	| { type: 'set-active-view'; viewId: string | null };

export function applyStructuralOpV2(model: TableModelV2, op: StructuralOpV2): void {
	switch (op.type) {

		// ── Row operations ────────────────────────────────────────────────────
		case 'insert-row': {
			const existing = new Set(model.rows.map(r => r.id));
			const newRow: RowDefV2 = { id: genId('r', existing), cells: {} };
			const idx = op.afterRowId === null
				? 0
				: model.rows.findIndex(r => r.id === op.afterRowId) + 1;
			model.rows.splice(Math.max(0, idx), 0, newRow);
			break;
		}
		case 'delete-row': {
			const idx = model.rows.findIndex(r => r.id === op.rowId);
			if (idx < 0) break;
			// Shrink (not remove) a merge that spans MORE than this one row and
			// happens to have this row as its literal top/bottom boundary — see
			// reanchorMergesForRowDeletion's doc comment. Must run BEFORE the
			// splice below, and before the endsWith-based filter, which still
			// correctly drops any merge that's left with nothing to anchor to
			// (a single-row span whose only row is the one being deleted).
			reanchorMergesForRowDeletion(model, op.rowId);
			model.rows.splice(idx, 1);
			// Remove merges that reference this row
			model.merges = model.merges.filter(m =>
				!m.anchor.startsWith(`${op.rowId}.`) && !m.end.startsWith(`${op.rowId}.`));
			pruneDegenerateMerges(model);
			// Remove cell-level styles referencing this row
			model.styles = model.styles.filter(s =>
				!s.target.startsWith(`${op.rowId}.`) && s.target !== op.rowId);
			break;
		}
		case 'move-row': {
			const fromIdx = model.rows.findIndex(r => r.id === op.fromRowId);
			const toIdx   = model.rows.findIndex(r => r.id === op.toRowId);
			if (fromIdx < 0 || toIdx < 0 || fromIdx === toIdx) break;
			const snapshots = snapshotRowMergesContaining(model, fromIdx);
			const [row] = model.rows.splice(fromIdx, 1);
			if (row) model.rows.splice(toIdx, 0, row);
			reanchorRowMerges(model, snapshots);
			break;
		}
		case 'hide-row': {
			const row = model.rows.find(r => r.id === op.rowId);
			if (row) row.hidden = true;
			break;
		}
		case 'show-row-group': {
			for (const id of op.rowIds) {
				const row = model.rows.find(r => r.id === id);
				if (row) delete row.hidden;
			}
			break;
		}

		// ── Column operations ─────────────────────────────────────────────────
		case 'insert-col': {
			const existing = new Set(model.columns.map(c => c.id));
			const newCol: ColumnDefV2 = { id: genId('c', existing), name: '' };
			const idx = op.afterColId === null
				? 0
				: model.columns.findIndex(c => c.id === op.afterColId) + 1;
			model.columns.splice(Math.max(0, idx), 0, newCol);
			break;
		}
		case 'delete-col': {
			const idx = model.columns.findIndex(c => c.id === op.colId);
			if (idx < 0) break;
			// Column-axis mirror of the delete-row fix above — see
			// reanchorMergesForColumnDeletion's doc comment.
			reanchorMergesForColumnDeletion(model, op.colId);
			model.columns.splice(idx, 1); // takes col.filter with it — no separate cleanup needed
			for (const row of model.rows) delete row.cells[op.colId];
			model.merges = model.merges.filter(m =>
				!m.anchor.endsWith(`.${op.colId}`) && !m.end.endsWith(`.${op.colId}`));
			pruneDegenerateMerges(model);
			model.styles = model.styles.filter(s =>
				!s.target.endsWith(`.${op.colId}`) && s.target !== op.colId);
			if (model.sort?.colId === op.colId) delete model.sort;
			removeViewsDependentOnColumn(model, op.colId);
			break;
		}
		case 'move-col': {
			const fromIdx = model.columns.findIndex(c => c.id === op.fromColId);
			const toIdx   = model.columns.findIndex(c => c.id === op.toColId);
			if (fromIdx < 0 || toIdx < 0 || fromIdx === toIdx) break;
			const snapshots = snapshotColMergesContaining(model, fromIdx);
			const [col] = model.columns.splice(fromIdx, 1);
			if (col) model.columns.splice(toIdx, 0, col);
			reanchorColMerges(model, snapshots);
			break;
		}
		case 'hide-col': {
			const col = model.columns.find(c => c.id === op.colId);
			if (col) col.hidden = true;
			break;
		}
		case 'show-col-group': {
			for (const id of op.colIds) {
				const col = model.columns.find(c => c.id === id);
				if (col) delete col.hidden;
			}
			break;
		}

		// ── Cell content ──────────────────────────────────────────────────────
		case 'set-cell-content': {
			const row = model.rows.find(r => r.id === op.rowId);
			if (!row) break;
			if (op.value === '') delete row.cells[op.colId];
			else row.cells[op.colId] = op.value;
			break;
		}
		case 'set-col-name': {
			const col = model.columns.find(c => c.id === op.colId);
			if (col) col.name = op.name;
			break;
		}
		case 'set-col-type': {
			const col = model.columns.find(c => c.id === op.colId);
			if (!col) break;
			const oldType = col.type;
			if (op.colType) col.type = op.colType; else delete col.type;
			// A kanban view needs its group column to stay a choice type, a calendar
			// view needs its date column to stay 'date' — any change at all (not just
			// away from a choice/date type specifically) invalidates a view depending
			// on this column, since operations.ts has no access to the choice registry
			// to judge whether a new type is "still choice-like".
			if (col.type !== oldType) removeViewsDependentOnColumn(model, op.colId);
			break;
		}

		// ── Merges ────────────────────────────────────────────────────────────
		case 'merge-cells': {
			const anchor = `${op.anchorRowId}.${op.anchorColId}`;
			const end    = `${op.endRowId}.${op.endColId}`;
			// Remove any existing merges that overlap (absorb them)
			model.merges = model.merges.filter(m => m.anchor !== anchor);
			model.merges.push({ anchor, end });
			break;
		}
		case 'unmerge-cells': {
			const anchor = `${op.anchorRowId}.${op.anchorColId}`;
			model.merges = model.merges.filter(m => m.anchor !== anchor);
			break;
		}
		case 'split-cell-row': {
			const covering0 = findMergeCoveringCell(model, op.rowId, op.colId);
			if (covering0) { splitMergedCellIntoRows(model, covering0); break; }
			const rowIdx = model.rows.findIndex(r => r.id === op.rowId);
			if (rowIdx < 0) break;
			const existingIds = new Set(model.rows.map(r => r.id));
			const newRow: RowDefV2 = { id: genId('r', existingIds), cells: {} };
			model.rows.splice(rowIdx + 1, 0, newRow);
			for (const col of model.columns) {
				if (col.id === op.colId) continue;
				const covering = findMergeCoveringCell(model, op.rowId, col.id);
				if (!covering) {
					model.merges.push({ anchor: `${op.rowId}.${col.id}`, end: `${newRow.id}.${col.id}` });
				} else {
					const [endRowId, endColId] = splitAnchor(covering.end);
					if (endRowId === op.rowId) covering.end = `${newRow.id}.${endColId}`;
					// else: the merge already extends past this row — the new row is
					// physically inside its span, so it's absorbed automatically (merges
					// resolve by ID, not position) and needs no change here.
				}
			}
			// Every OTHER column's merged span already resolves its style from the
			// unchanged anchor row (op.rowId), so it keeps looking right for free. The
			// split TARGET column's cell in the new row is the one genuinely new,
			// unmerged cell — carry over op.rowId's own row-level style so it doesn't
			// default to unstyled and visually break the row.
			extendStylesPastSplitRow(model, op.rowId, newRow.id);
			// The split target cell's OWN cell-specific style (if the user set one
			// directly on this exact cell, not row-wide) is the most common thing a
			// user actually tests first — carry it to the new row's "twin" cell too.
			duplicateCellStyle(model, op.rowId, op.colId, newRow.id, op.colId);
			break;
		}
		case 'split-cell-col': {
			const covering0 = findMergeCoveringCell(model, op.rowId, op.colId);
			if (covering0) { splitMergedCellIntoCols(model, covering0); break; }
			const colIdx = model.columns.findIndex(c => c.id === op.colId);
			if (colIdx < 0) break;
			const existingIds = new Set(model.columns.map(c => c.id));
			const newCol: ColumnDefV2 = { id: genId('c', existingIds), name: '' };
			model.columns.splice(colIdx + 1, 0, newCol);
			// The header row is never the split target — it's always "another row" whose
			// shape should be preserved, same as every data row below. 'header' is the
			// sentinel row ID resolveMergeRowIndex()/findMergeCoveringCell() treat as one
			// position before the first data row (see renderGridHelpers.ts).
			for (const rId of ['header', ...model.rows.map(r => r.id)]) {
				if (rId === op.rowId) continue;
				const covering = findMergeCoveringCell(model, rId, op.colId);
				if (!covering) {
					model.merges.push({ anchor: `${rId}.${op.colId}`, end: `${rId}.${newCol.id}` });
				} else {
					const [endRowId, endColId] = splitAnchor(covering.end);
					if (endColId === op.colId) covering.end = `${endRowId}.${newCol.id}`;
					// else: already extends past this column — absorbed automatically.
				}
			}
			// Column-axis mirror of the row-style carry-over above: every OTHER row's
			// merged span still resolves via the unchanged anchor column (op.colId);
			// only the split target row's new, unmerged cell in the new column needs
			// op.colId's own whole-column style copied over.
			extendStylesPastSplitCol(model, op.colId, newCol.id);
			// Column-axis mirror of the cell-specific carry-over above.
			duplicateCellStyle(model, op.rowId, op.colId, op.rowId, newCol.id);
			break;
		}

		// ── Styles ────────────────────────────────────────────────────────────
		case 'set-cell-style': {
			const target = `${op.rowId}.${op.colId}`;
			applyStylePropsV2(model, target, op.bg, op.color, op.size, op.bold, op.italic);
			break;
		}
		case 'set-range-style': {
			const { target, bg, color, size, bold, italic } = op;
			const isClearing = bg === null && color === null && size === null && bold === null && italic === null;
			if (isClearing) {
				// Remove all style rules that touch any cell in the cleared area.
				model.styles = model.styles.filter(rule => !styleRulesOverlapV2(rule.target, target, model));
				break;
			}
			applyStylePropsV2(model, target, bg, color, size, bold, italic);
			break;
		}
		case 'split-range-style': {
			splitRangeStyleV2(model, op.rangeTarget, op.excludeRowId, op.excludeColId);
			break;
		}

		// ── Dimensions ────────────────────────────────────────────────────────
		case 'set-col-width': {
			const col = model.columns.find(c => c.id === op.colId);
			if (col) col.width = op.width;
			break;
		}
		case 'set-col-align': {
			const col = model.columns.find(c => c.id === op.colId);
			if (!col) break;
			if (op.align) col.align = op.align;
			else delete col.align;
			break;
		}
		case 'set-row-height': {
			const row = model.rows.find(r => r.id === op.rowId);
			if (!row) break;
			if (op.height > 0) row.height = op.height;
			else delete row.height;
			break;
		}

		// ── Metadata ──────────────────────────────────────────────────────────
		case 'set-title': {
			if (op.title) model.title = op.title; else delete model.title;
			break;
		}
		case 'set-footer': {
			if (op.footer !== undefined) model.footer = op.footer; else delete model.footer;
			break;
		}
		case 'set-filter': {
			const { colId, values } = op;
			const col = model.columns.find(c => c.id === colId);
			if (!col) break;
			if (!values || values.length === 0) delete col.filter;
			else col.filter = values;
			break;
		}
		case 'toggle-aggregate': {
			const list = model.aggregate ?? [];
			const next = list.includes(op.agg) ? list.filter(a => a !== op.agg) : [...list, op.agg];
			if (next.length === 0) delete model.aggregate;
			else model.aggregate = next;
			break;
		}
		case 'clear-aggregate': {
			if (!model.aggregate) break;
			const next = model.aggregate.filter(a => a !== op.agg);
			if (next.length === 0) delete model.aggregate;
			else model.aggregate = next;
			break;
		}
		case 'reorder-aggregate': {
			if (op.order.length === 0) delete model.aggregate;
			else model.aggregate = op.order;
			break;
		}
		case 'set-theme':
			if (op.theme) model.theme = op.theme;
			else delete model.theme;
			break;
		case 'toggle-lock':
			model.locked = !model.locked || undefined;
			break;
		case 'toggle-collapse':
			model.collapsed = !model.collapsed || undefined;
			break;
		case 'set-freeze-rows':
			if (op.count === null) { delete model.freezeRows; break; }
			if (!canFreezeRows(model, op.count)) break; // see canFreezeRows' doc comment
			model.freezeRows = op.count;
			break;
		case 'set-freeze-cols':
			if (op.count === null) { delete model.freezeCols; break; }
			if (!canFreezeCols(model, op.count)) break;
			model.freezeCols = op.count;
			break;
		case 'set-view-width':
			if (op.width === null || !(op.width > 0)) delete model.viewWidth;
			else model.viewWidth = Math.round(op.width);
			break;
		case 'set-view-height':
			if (op.height === null || !(op.height > 0)) delete model.viewHeight;
			else model.viewHeight = Math.round(op.height);
			break;
		case 'set-sort':
			if (op.sort) model.sort = op.sort; else delete model.sort;
			break;
		case 'reorder-rows': {
			const byId = new Map(model.rows.map(r => [r.id, r]));
			const reordered = op.rowIds.map(id => byId.get(id)).filter((r): r is RowDefV2 => !!r);
			// Bail out rather than drop rows if the id set no longer matches exactly
			// (e.g. a row was deleted in the same batch before this op applied).
			if (reordered.length !== model.rows.length) break;
			model.rows = reordered;
			break;
		}

		// ── Views ────────────────────────────────────────────────────────────────
		case 'create-view': {
			// A second kanban/calendar view driven by the SAME column would look and
			// behave identically to the first one — views don't have their own
			// independent filter/sort yet (see ViewDefV2's doc comment in model.ts),
			// so there's nothing to actually differentiate them by. Switch to the
			// existing one instead of creating a confusing, functionally-duplicate view.
			if (op.viewType === 'kanban' && op.groupByColId) {
				const dupe = model.views?.find(v => v.type === 'kanban' && v.kanban?.groupByColId === op.groupByColId);
				if (dupe) { model.activeViewId = dupe.id; break; }
			}
			if (op.viewType === 'calendar' && op.dateColId) {
				const dupe = model.views?.find(v => v.type === 'calendar' && v.calendar?.dateColId === op.dateColId);
				if (dupe) { model.activeViewId = dupe.id; break; }
			}
			const existing = new Set((model.views ?? []).map(v => v.id));
			const id = genId('v', existing);
			const view: ViewDefV2 = { id, type: op.viewType };
			if (op.name) view.name = op.name;
			if (op.viewType === 'kanban' && op.groupByColId) view.kanban = { groupByColId: op.groupByColId };
			if (op.viewType === 'calendar' && op.dateColId) view.calendar = { dateColId: op.dateColId };
			model.views ??= [];
			model.views.push(view);
			model.activeViewId = id;
			break;
		}
		case 'delete-view': {
			if (!model.views) break;
			model.views = model.views.filter(v => v.id !== op.viewId);
			if (model.activeViewId === op.viewId) delete model.activeViewId;
			break;
		}
		case 'rename-view': {
			const view = model.views?.find(v => v.id === op.viewId);
			if (view) view.name = op.name;
			break;
		}
		case 'set-view-group': {
			const view = model.views?.find(v => v.id === op.viewId);
			if (view && view.type === 'kanban') view.kanban = { groupByColId: op.groupByColId };
			break;
		}
		case 'set-view-date-col': {
			const view = model.views?.find(v => v.id === op.viewId);
			if (view && view.type === 'calendar') view.calendar = { dateColId: op.dateColId };
			break;
		}
		case 'set-active-view': {
			const view = op.viewId ? model.views?.find(v => v.id === op.viewId) : undefined;
			if (view) model.activeViewId = view.id; else delete model.activeViewId;
			break;
		}

		// ── Paste (from Excel/clipboard) ────────────────────────────────────────
		case 'paste-values': {
			const { anchorRowId, anchorColId, values } = op;
			if (values.length === 0) break;
			const rowStart = model.rows.findIndex(r => r.id === anchorRowId);
			const colStart = model.columns.findIndex(c => c.id === anchorColId);
			if (rowStart < 0 || colStart < 0) break;
			const numRows = values.length;
			const numCols = values.reduce((max, r) => Math.max(max, r.length), 0);

			const existingRowIds = new Set(model.rows.map(r => r.id));
			while (model.rows.length < rowStart + numRows) {
				model.rows.push({ id: genId('r', existingRowIds), cells: {} });
			}
			const existingColIds = new Set(model.columns.map(c => c.id));
			while (model.columns.length < colStart + numCols) {
				model.columns.push({ id: genId('c', existingColIds), name: '' });
			}

			for (let r = 0; r < numRows; r++) {
				const row = model.rows[rowStart + r];
				const rowValues = values[r];
				if (!row || !rowValues) continue;
				for (let c = 0; c < rowValues.length; c++) {
					const col = model.columns[colStart + c];
					if (!col) continue;
					const value = rowValues[c] ?? '';
					if (value === '') delete row.cells[col.id];
					else row.cells[col.id] = value;
				}
			}
			break;
		}
	}
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Splits a merge anchor/end string ("rowId.colId") into its two ID parts. */
function splitAnchor(target: string): [string, string] {
	const dot = target.indexOf('.');
	return dot < 0 ? [target, ''] : [target.slice(0, dot), target.slice(dot + 1)];
}

/**
 * Resolves a merge anchor/end row-ID string to a 0-based row index, treating the
 * literal sentinel `'header'` (a header-only merge's row ID, see `renderer.ts`'s
 * header drag-to-select and `renderGridHelpers.ts`'s identical helper) as index
 * -1 — one position before the first data row. Real row IDs are never literally
 * `'header'` (they're generated as `r_xxxxxx`), so there's no collision.
 */
export function resolveMergeRowIndex(model: TableModelV2, id: string): number | undefined {
	if (id === 'header') return -1;
	const idx = model.rows.findIndex(r => r.id === id);
	return idx >= 0 ? idx : undefined;
}

/**
 * Whether freezing the header plus the first `count` data rows is valid —
 * false if it would split a VERTICAL merge (one spanning more than one row)
 * across the boundary. A merge confined to a single row — even one spanning
 * many columns — never crosses a row boundary at all and is always fine,
 * regardless of `count`; only a merge's row-span (not its column-span)
 * matters here. Callers (the reducer, and the UI before it dispatches so it
 * can tell the user why) should both go through this rather than
 * duplicating the check.
 */
export function canFreezeRows(model: TableModelV2, count: number): boolean {
	if (count < 0 || count > model.rows.length) return false;
	for (const m of model.merges) {
		const [anchorRowId] = splitAnchor(m.anchor);
		const [endRowId]    = splitAnchor(m.end);
		const r1 = resolveMergeRowIndex(model, anchorRowId);
		const r2 = resolveMergeRowIndex(model, endRowId);
		if (r1 === undefined || r2 === undefined) continue;
		const lo = Math.min(r1, r2), hi = Math.max(r1, r2);
		if (lo === hi) continue; // single row — can't cross a row boundary
		if (lo < count && hi >= count) return false;
	}
	return true;
}

/** Column-axis mirror of {@link canFreezeRows} — invalid if a HORIZONTAL
 *  merge (spanning more than one column) crosses the `count` boundary. A
 *  merge confined to a single column, however many rows it spans, is always
 *  fine. */
export function canFreezeCols(model: TableModelV2, count: number): boolean {
	if (count < 0 || count > model.columns.length) return false;
	for (const m of model.merges) {
		const [, anchorColId] = splitAnchor(m.anchor);
		const [, endColId]    = splitAnchor(m.end);
		const c1 = model.columns.findIndex(c => c.id === anchorColId);
		const c2 = model.columns.findIndex(c => c.id === endColId);
		if (c1 < 0 || c2 < 0) continue;
		const lo = Math.min(c1, c2), hi = Math.max(c1, c2);
		if (lo === hi) continue; // single column — can't cross a column boundary
		if (lo < count && hi >= count) return false;
	}
	return true;
}

/** Finds the merge (if any) whose rectangle currently contains (rowId, colId). */
function findMergeCoveringCell(model: TableModelV2, rowId: string, colId: string): MergeRangeV2 | undefined {
	const rIdx = resolveMergeRowIndex(model, rowId);
	const cIdx = model.columns.findIndex(c => c.id === colId);
	if (rIdx === undefined || cIdx < 0) return undefined;
	for (const m of model.merges) {
		const [anchorRowId, anchorColId] = splitAnchor(m.anchor);
		const [endRowId, endColId]       = splitAnchor(m.end);
		const r1 = resolveMergeRowIndex(model, anchorRowId);
		const c1 = model.columns.findIndex(c => c.id === anchorColId);
		const r2 = resolveMergeRowIndex(model, endRowId);
		const c2 = model.columns.findIndex(c => c.id === endColId);
		if (r1 === undefined || c1 < 0 || r2 === undefined || c2 < 0) continue;
		if (rIdx >= Math.min(r1, r2) && rIdx <= Math.max(r1, r2)
			&& cIdx >= Math.min(c1, c2) && cIdx <= Math.max(c1, c2)) return m;
	}
	return undefined;
}

/**
 * `split-cell-row`/`split-cell-col` on an ALREADY-merged cell — only two of
 * the three possible merge shapes make sense to split at all:
 *   - vertical-only  (rowSpan > 1, colSpan === 1): splitting into 2 COLUMNS
 *     is meaningful (each resulting column keeps its own copy of the same
 *     row-span merge) — splitting into 2 ROWS is not ("it's already a
 *     multi-row merge", nothing to gain).
 *   - horizontal-only (colSpan > 1, rowSpan === 1): the mirror image —
 *     splitting into 2 ROWS is meaningful, 2 COLUMNS is not.
 *   - both (rowSpan > 1 AND colSpan > 1): a true rectangular merge has no
 *     single axis left to split along without arbitrarily picking one, so
 *     neither operation is offered at all.
 * Deliberately produces TWO SEPARATE same-shaped merges (old column/row keeps
 * its original merge untouched, new column/row gets its own identical-shape
 * "twin") rather than growing the original into a rectangle — a rectangle
 * would immediately become the unsplittable "both" shape above, permanently
 * closing off further splits; two separate vertical/horizontal merges can
 * each still be split again later.
 */
function splitMergedCellIntoRows(model: TableModelV2, covering: MergeRangeV2): void {
	const [anchorRowId, anchorColId] = splitAnchor(covering.anchor);
	const [endRowId, endColId]       = splitAnchor(covering.end);
	const r1 = resolveMergeRowIndex(model, anchorRowId);
	const r2 = resolveMergeRowIndex(model, endRowId);
	const c1 = model.columns.findIndex(c => c.id === anchorColId);
	const c2 = model.columns.findIndex(c => c.id === endColId);
	if (r1 === undefined || r2 === undefined || c1 < 0 || c2 < 0) return;
	if (Math.abs(r2 - r1) + 1 > 1) return; // multi-row (± multi-col) — not eligible, see doc comment
	if (Math.abs(c2 - c1) + 1 <= 1) return; // not actually a horizontal merge
	if (anchorRowId === 'header') return; // no second header row to split into

	const rowIdx = model.rows.findIndex(r => r.id === anchorRowId);
	if (rowIdx < 0) return;
	const existingRowIds = new Set(model.rows.map(r => r.id));
	const newRow: RowDefV2 = { id: genId('r', existingRowIds), cells: {} };
	model.rows.splice(rowIdx + 1, 0, newRow);
	// The new row's "twin" merge — same column span, its own copy.
	model.merges.push({ anchor: `${newRow.id}.${anchorColId}`, end: `${newRow.id}.${endColId}` });

	// Every OTHER column (outside this merge's own span) behaves exactly like
	// the plain single-cell split-cell-row below: create-or-extend-or-absorb.
	const lo = Math.min(c1, c2), hi = Math.max(c1, c2);
	for (let ci = 0; ci < model.columns.length; ci++) {
		if (ci >= lo && ci <= hi) continue; // part of the merge being split — handled above
		const col = model.columns[ci];
		if (!col) continue;
		const other = findMergeCoveringCell(model, anchorRowId, col.id);
		if (!other) {
			model.merges.push({ anchor: `${anchorRowId}.${col.id}`, end: `${newRow.id}.${col.id}` });
		} else {
			const [otherEndRowId, otherEndColId] = splitAnchor(other.end);
			if (otherEndRowId === anchorRowId) other.end = `${newRow.id}.${otherEndColId}`;
			// else: already extends past this row — absorbed automatically.
		}
	}
	extendStylesPastSplitRow(model, anchorRowId, newRow.id);
	duplicateCellStyle(model, anchorRowId, anchorColId, newRow.id, anchorColId);
}

/** Column-axis mirror of {@link splitMergedCellIntoRows} — see its doc comment. */
function splitMergedCellIntoCols(model: TableModelV2, covering: MergeRangeV2): void {
	const [anchorRowId, anchorColId] = splitAnchor(covering.anchor);
	const [endRowId, endColId]       = splitAnchor(covering.end);
	const r1 = resolveMergeRowIndex(model, anchorRowId);
	const r2 = resolveMergeRowIndex(model, endRowId);
	const c1 = model.columns.findIndex(c => c.id === anchorColId);
	const c2 = model.columns.findIndex(c => c.id === endColId);
	if (r1 === undefined || r2 === undefined || c1 < 0 || c2 < 0) return;
	if (Math.abs(c2 - c1) + 1 > 1) return; // multi-col (± multi-row) — not eligible, see doc comment
	if (Math.abs(r2 - r1) + 1 <= 1) return; // not actually a vertical merge
	// (A vertical-only merge can never be header-anchored — a merge crossing
	// the header/data boundary is dropped elsewhere, not represented here.)

	const colIdx = model.columns.findIndex(c => c.id === anchorColId);
	if (colIdx < 0) return;
	const existingColIds = new Set(model.columns.map(c => c.id));
	const newCol: ColumnDefV2 = { id: genId('c', existingColIds), name: '' };
	model.columns.splice(colIdx + 1, 0, newCol);
	// The new column's "twin" merge — same row span, its own copy.
	model.merges.push({ anchor: `${anchorRowId}.${newCol.id}`, end: `${endRowId}.${newCol.id}` });

	// Every OTHER row (outside this merge's own span, including the header
	// sentinel) behaves exactly like the plain single-cell split-cell-col below.
	const lo = Math.min(r1, r2), hi = Math.max(r1, r2);
	for (const rId of ['header', ...model.rows.map(r => r.id)]) {
		const ri = resolveMergeRowIndex(model, rId);
		if (ri === undefined || (ri >= lo && ri <= hi)) continue; // part of the merge being split
		const other = findMergeCoveringCell(model, rId, anchorColId);
		if (!other) {
			model.merges.push({ anchor: `${rId}.${anchorColId}`, end: `${rId}.${newCol.id}` });
		} else {
			const [otherEndRowId, otherEndColId] = splitAnchor(other.end);
			if (otherEndColId === anchorColId) other.end = `${otherEndRowId}.${newCol.id}`;
			// else: already extends past this column — absorbed automatically.
		}
	}
	extendStylesPastSplitCol(model, anchorColId, newCol.id);
	duplicateCellStyle(model, anchorRowId, anchorColId, anchorRowId, newCol.id);
}

interface RowMergeSnapshot { merge: MergeRangeV2; memberIds: string[] }
interface ColMergeSnapshot { merge: MergeRangeV2; memberIds: string[] }

/** Row-spanning merges (anchor/end resolve to different row indices) whose
 *  CURRENT row range includes `rowIdx`, snapshotted by member row ID (stable
 *  identity) rather than position — see reanchorRowMerges for why. */
function snapshotRowMergesContaining(model: TableModelV2, rowIdx: number): RowMergeSnapshot[] {
	const snapshots: RowMergeSnapshot[] = [];
	for (const merge of model.merges) {
		const [anchorRowId] = splitAnchor(merge.anchor);
		const [endRowId]    = splitAnchor(merge.end);
		const r1 = resolveMergeRowIndex(model, anchorRowId);
		const r2 = resolveMergeRowIndex(model, endRowId);
		if (r1 === undefined || r2 === undefined || r1 === r2) continue;
		const lo = Math.min(r1, r2), hi = Math.max(r1, r2);
		if (rowIdx < lo || rowIdx > hi) continue;
		snapshots.push({ merge, memberIds: model.rows.slice(lo, hi + 1).map(r => r.id) });
	}
	return snapshots;
}

/**
 * Merges resolve by CURRENT INDEX RANGE between anchor/end (buildOccupied /
 * getMergeOrigin, renderGridHelpers.ts), not by an explicit member list — that
 * is what lets a plain insert-row landing mid-span get silently absorbed into
 * an existing merge for free. But it also means `move-row`, which just
 * relocates ONE row to a new index, can silently SHRINK a merge whenever the
 * moved row was a member (not the literal anchor/end row): its new position
 * can fall outside the anchor/end's now-current range even though the row
 * never left the group. Reported case: dragging one row past another inside
 * a 3-row merged block left the third, unmoved member behind.
 *
 * Fix: re-anchor each affected merge (snapshotted by snapshotRowMergesContaining
 * BEFORE the move) to its new topmost/bottommost member — but only if that
 * same set of member IDs is still exactly contiguous after the move, i.e. the
 * move stayed within the group rather than genuinely detaching from it. If
 * some other, non-member row now sits between two members (the moved row
 * landed far outside the old group), leave the merge as-is: blindly
 * re-anchoring then would swallow every row physically in between into the
 * merge, which would be a worse bug than the one being fixed here.
 */
function reanchorRowMerges(model: TableModelV2, snapshots: RowMergeSnapshot[]): void {
	for (const { merge, memberIds } of snapshots) {
		const indices = memberIds.map(id => model.rows.findIndex(r => r.id === id));
		if (indices.some(i => i < 0)) continue;
		const lo = Math.min(...indices), hi = Math.max(...indices);
		if (hi - lo + 1 !== memberIds.length) continue; // no longer contiguous — left the group
		const topId = model.rows[lo]?.id;
		const bottomId = model.rows[hi]?.id;
		if (!topId || !bottomId) continue;
		const [, anchorColId] = splitAnchor(merge.anchor);
		const [, endColId]    = splitAnchor(merge.end);
		merge.anchor = `${topId}.${anchorColId}`;
		merge.end    = `${bottomId}.${endColId}`;
	}
}

/** Column-axis mirror of snapshotRowMergesContaining. */
function snapshotColMergesContaining(model: TableModelV2, colIdx: number): ColMergeSnapshot[] {
	const snapshots: ColMergeSnapshot[] = [];
	for (const merge of model.merges) {
		const [, anchorColId] = splitAnchor(merge.anchor);
		const [, endColId]    = splitAnchor(merge.end);
		const c1 = model.columns.findIndex(c => c.id === anchorColId);
		const c2 = model.columns.findIndex(c => c.id === endColId);
		if (c1 < 0 || c2 < 0 || c1 === c2) continue;
		const lo = Math.min(c1, c2), hi = Math.max(c1, c2);
		if (colIdx < lo || colIdx > hi) continue;
		snapshots.push({ merge, memberIds: model.columns.slice(lo, hi + 1).map(c => c.id) });
	}
	return snapshots;
}

/** Column-axis mirror of reanchorRowMerges — see its doc comment. Works
 *  unchanged for a header column-range merge too (anchor/end row part is the
 *  literal `'header'` sentinel): this only ever rewrites the column-id half. */
function reanchorColMerges(model: TableModelV2, snapshots: ColMergeSnapshot[]): void {
	for (const { merge, memberIds } of snapshots) {
		const indices = memberIds.map(id => model.columns.findIndex(c => c.id === id));
		if (indices.some(i => i < 0)) continue;
		const lo = Math.min(...indices), hi = Math.max(...indices);
		if (hi - lo + 1 !== memberIds.length) continue; // no longer contiguous — left the group
		const leftId  = model.columns[lo]?.id;
		const rightId = model.columns[hi]?.id;
		if (!leftId || !rightId) continue;
		const [anchorRowId] = splitAnchor(merge.anchor);
		const [endRowId]    = splitAnchor(merge.end);
		merge.anchor = `${anchorRowId}.${leftId}`;
		merge.end    = `${endRowId}.${rightId}`;
	}
}

/** A merge whose anchor and end have settled on the exact same cell merges
 *  nothing (rowSpan/colSpan both resolve to 1 either way) and is dead data if
 *  left in place. This happens when `reanchorMergesForRowDeletion`/
 *  `ColumnDeletion` shrinks a wider merge inward across REPEATED deletions
 *  until only its last row/column is left — e.g. a merge spanning columns
 *  D-E-F shrinks to D-E after F is deleted, then to D-D after E is deleted
 *  too. The `endsWith`/`startsWith` filter that runs right after each
 *  deletion only drops a merge still referencing the row/col being deleted
 *  THIS time — a merge that was reanchored AWAY from it (onto the row/col
 *  that survives) never matches that filter, even once it degenerates to a
 *  single cell, so it silently accumulates as a no-op merge record instead
 *  of being removed (reported: an old-format table put through many manual
 *  row/column splits and deletions ended up with several of these). Called
 *  right after that filter in both `delete-row` and `delete-col`. */
function pruneDegenerateMerges(model: TableModelV2): void {
	model.merges = model.merges.filter(m => m.anchor !== m.end);
}

/**
 * `delete-row`'s own merge cleanup (the `endsWith`-based filter right after
 * this runs) unconditionally DROPS any merge whose anchor or end is the row
 * being deleted — correct for a merge that only spans that one row, but
 * wrong for one that spans MULTIPLE rows and merely happens to have this row
 * as its literal top or bottom boundary: reported case — a 3-column-wide,
 * 2-row-tall merge lost its entire merge (not just shrank by one row) when
 * the bottom row was deleted. The fix shrinks the boundary inward to the
 * next remaining row first, so the filter afterward no longer matches it at
 * all (its anchor/end no longer reference the deleted row).
 *
 * Deliberately NOT built on the same snapshot-and-recheck-contiguity mechanism
 * `reanchorRowMerges` (move-row) uses — that machinery exists to answer "did
 * this group scatter apart after a move", which doesn't apply here: a row
 * being permanently deleted can't scatter, it's simply gone, so only the two
 * boundary rows ever need adjusting, and a row in the MIDDLE of the span
 * needs no change at all (the merge already resolves by ID at render time —
 * removing a middle member just shrinks its rendered rowspan for free).
 */
function reanchorMergesForRowDeletion(model: TableModelV2, removedRowId: string): void {
	const removedIdx = resolveMergeRowIndex(model, removedRowId);
	if (removedIdx === undefined) return;
	for (const merge of model.merges) {
		const [anchorRowId, anchorColId] = splitAnchor(merge.anchor);
		const [endRowId, endColId]       = splitAnchor(merge.end);
		const r1 = resolveMergeRowIndex(model, anchorRowId);
		const r2 = resolveMergeRowIndex(model, endRowId);
		if (r1 === undefined || r2 === undefined) continue;
		const lo = Math.min(r1, r2), hi = Math.max(r1, r2);
		if (hi === lo) continue; // single-row span — the filter below already handles this correctly
		const anchorIsLeft = r1 <= r2; // which field (anchor vs end) holds the lo-side row
		if (removedIdx === lo) {
			const newTopId = model.rows[lo + 1]?.id;
			if (!newTopId) continue;
			if (anchorIsLeft) merge.anchor = `${newTopId}.${anchorColId}`;
			else              merge.end    = `${newTopId}.${endColId}`;
		} else if (removedIdx === hi) {
			const newBottomId = model.rows[hi - 1]?.id;
			if (!newBottomId) continue;
			if (anchorIsLeft) merge.end    = `${newBottomId}.${endColId}`;
			else              merge.anchor = `${newBottomId}.${anchorColId}`;
		}
		// else: removedIdx is strictly inside (lo, hi) — no boundary change needed.
	}
}

/** A kanban view groups by a column, a calendar view places by one — if that
 *  column is gone or has changed into something else entirely (`delete-col`,
 *  `set-col-type`), the view has nothing left to actually show and is
 *  removed outright, same as an explicit `delete-view`. Also clears
 *  `activeViewId` if it pointed at a removed view, matching `delete-view`'s
 *  own fallback (no replacement view is picked — render falls back to the
 *  plain table). */
function removeViewsDependentOnColumn(model: TableModelV2, colId: string): void {
	if (!model.views) return;
	const removedIds = new Set(
		model.views
			.filter(v => v.kanban?.groupByColId === colId || v.calendar?.dateColId === colId)
			.map(v => v.id),
	);
	if (removedIds.size === 0) return;
	model.views = model.views.filter(v => !removedIds.has(v.id));
	if (model.activeViewId && removedIds.has(model.activeViewId)) delete model.activeViewId;
}

/** Column-axis mirror of {@link reanchorMergesForRowDeletion} — same reasoning,
 *  called from `delete-col` before its own endsWith-based merge filter. */
function reanchorMergesForColumnDeletion(model: TableModelV2, removedColId: string): void {
	const removedIdx = model.columns.findIndex(c => c.id === removedColId);
	if (removedIdx < 0) return;
	for (const merge of model.merges) {
		const [anchorRowId, anchorColId] = splitAnchor(merge.anchor);
		const [endRowId, endColId]       = splitAnchor(merge.end);
		const c1 = model.columns.findIndex(c => c.id === anchorColId);
		const c2 = model.columns.findIndex(c => c.id === endColId);
		if (c1 < 0 || c2 < 0) continue;
		const lo = Math.min(c1, c2), hi = Math.max(c1, c2);
		if (hi === lo) continue; // single-column span — the filter below already handles this correctly
		const anchorIsLeft = c1 <= c2; // which field (anchor vs end) holds the lo-side column
		if (removedIdx === lo) {
			const newLeftId = model.columns[lo + 1]?.id;
			if (!newLeftId) continue;
			if (anchorIsLeft) merge.anchor = `${anchorRowId}.${newLeftId}`;
			else              merge.end    = `${endRowId}.${newLeftId}`;
		} else if (removedIdx === hi) {
			const newRightId = model.columns[hi - 1]?.id;
			if (!newRightId) continue;
			if (anchorIsLeft) merge.end    = `${endRowId}.${newRightId}`;
			else              merge.anchor = `${anchorRowId}.${newRightId}`;
		}
		// else: removedIdx is strictly inside (lo, hi) — no boundary change needed.
	}
}

/**
 * When a row is split (`split-cell-row`), carry over whatever whole-row style
 * `oldRowId` had so the new row doesn't default to unstyled and visually break
 * the row it was split from. Mirrors the exact three-way branch already used
 * for merges: duplicate a rule scoped exactly to `oldRowId` (row-range/rect
 * targets extend in place instead, since duplicating would incorrectly stop
 * covering the original row); a range/rect ending exactly at `oldRowId` gets
 * its end pushed to `newRowId`; a range/rect that already extends past
 * `oldRowId` needs no change — `newRowId` sits physically inside it and is
 * already covered once rendered (same ID-based resolution as merges).
 * Column-scoped/cell-scoped/header targets aren't row-axis-scoped and are left
 * alone — see the "other columns" merge loop above for why they don't need it.
 */
function extendStylesPastSplitRow(model: TableModelV2, oldRowId: string, newRowId: string): void {
	const additions: StyleRuleV2[] = [];
	for (const rule of model.styles) {
		const t = parseStyleTarget(rule.target);
		if (!t) continue;
		if (t.kind === 'row' && t.rowId === oldRowId) {
			additions.push({ ...rule, target: serializeStyleTarget({ kind: 'row', rowId: newRowId }) });
		} else if ((t.kind === 'row-range' || t.kind === 'rect') && t.endRowId === oldRowId) {
			rule.target = serializeStyleTarget({ ...t, endRowId: newRowId });
		}
	}
	model.styles.push(...additions);
}

/** Column-axis mirror of {@link extendStylesPastSplitRow}, for `split-cell-col`. */
function extendStylesPastSplitCol(model: TableModelV2, oldColId: string, newColId: string): void {
	const additions: StyleRuleV2[] = [];
	for (const rule of model.styles) {
		const t = parseStyleTarget(rule.target);
		if (!t) continue;
		if (t.kind === 'col' && t.colId === oldColId) {
			additions.push({ ...rule, target: serializeStyleTarget({ kind: 'col', colId: newColId }) });
		} else if ((t.kind === 'col-range' || t.kind === 'rect') && t.endColId === oldColId) {
			rule.target = serializeStyleTarget({ ...t, endColId: newColId });
		}
	}
	model.styles.push(...additions);
}

/**
 * Copies a single-cell style rule (`{ target: "rowId.colId" }`) from the split
 * target cell onto its new "twin" cell in the freshly-inserted row/column, if
 * one exists. The original cell keeps its own rule untouched — this only adds
 * a duplicate for the new cell, same duplicate-not-retarget reasoning as the
 * whole-row/whole-column case in {@link extendStylesPastSplitRow}.
 */
function duplicateCellStyle(
	model: TableModelV2,
	oldRowId: string, oldColId: string,
	newRowId: string, newColId: string,
): void {
	const rule = model.styles.find(s => s.target === `${oldRowId}.${oldColId}`);
	if (!rule) return;
	model.styles.push({ ...rule, target: `${newRowId}.${newColId}` });
}

function applyStylePropsV2(
	model: TableModelV2, target: string,
	bg: string | null, color: string | null, size: number | null,
	bold: boolean | null, italic: boolean | null,
): void {
	let rule = model.styles.find(s => s.target === target);
	if (!rule) {
		const r: StyleRuleV2 = { target };
		model.styles.push(r);
		rule = r;
	}
	if (bg !== null) rule.bg = bg; else delete rule.bg;
	if (color !== null) rule.color = color; else delete rule.color;
	if (size !== null) rule.size = size; else delete rule.size;
	if (bold) rule.bold = true; else delete rule.bold;
	if (italic) rule.italic = true; else delete rule.italic;
	if (!rule.bg && !rule.color && !rule.bold && !rule.italic && !rule.size)
		model.styles = model.styles.filter(s => s.target !== target);
}

/**
 * True if style rules with targets `a` and `b` share at least one cell in the model.
 * Used by set-range-style clearing to remove all overlapping rules.
 */
function styleRulesOverlapV2(targetA: string, targetB: string, model: TableModelV2): boolean {
	// Fast path: exact match
	if (targetA === targetB) return true;
	// Check via column×row iteration
	for (const row of model.rows) {
		for (const col of model.columns) {
			if (cellMatchesTargetV2(row.id, col.id, targetA, model) &&
			    cellMatchesTargetV2(row.id, col.id, targetB, model)) return true;
		}
	}
	return false;
}

/** True if (rowId, colId) is covered by the given v2 target string. */
export function cellMatchesTargetV2(rowId: string, colId: string, target: string, model: TableModelV2): boolean {
	if (target === rowId)             return true; // whole row
	if (target === colId)             return true; // whole col
	if (target === `${rowId}.${colId}`) return true; // single cell
	if (target === 'header')          return false; // header rule doesn't apply to data cells

	if (target.includes(':')) {
		const [l, r] = target.split(':', 2) as [string, string];
		if (l.includes('.') || r.includes('.')) {
			// rectangle
			const [ar, ac] = l.split('.'); const [er, ec] = r.split('.');
			const ri = model.rows.findIndex(x => x.id === rowId);
			const ci = model.columns.findIndex(x => x.id === colId);
			const ar_i = model.rows.findIndex(x => x.id === ar);
			const er_i = model.rows.findIndex(x => x.id === er);
			const ac_i = model.columns.findIndex(x => x.id === ac);
			const ec_i = model.columns.findIndex(x => x.id === ec);
			return ri >= Math.min(ar_i, er_i) && ri <= Math.max(ar_i, er_i)
			    && ci >= Math.min(ac_i, ec_i) && ci <= Math.max(ac_i, ec_i);
		}
		if (l.startsWith('r_') && r.startsWith('r_')) {
			// row range
			const ri  = model.rows.findIndex(x => x.id === rowId);
			const ri1 = model.rows.findIndex(x => x.id === l);
			const ri2 = model.rows.findIndex(x => x.id === r);
			return ri >= Math.min(ri1, ri2) && ri <= Math.max(ri1, ri2);
		}
		if (l.startsWith('c_') && r.startsWith('c_')) {
			// col range
			const ci  = model.columns.findIndex(x => x.id === colId);
			const ci1 = model.columns.findIndex(x => x.id === l);
			const ci2 = model.columns.findIndex(x => x.id === r);
			return ci >= Math.min(ci1, ci2) && ci <= Math.max(ci1, ci2);
		}
	}
	return false;
}

function splitRangeStyleV2(model: TableModelV2, rangeTarget: string, excludeRowId: string, excludeColId: string): void {
	const ruleIdx = model.styles.findIndex(s => s.target === rangeTarget);
	if (ruleIdx < 0) return;
	const [rule] = model.styles.splice(ruleIdx, 1);
	if (!rule) return;

	const m = /^(r_[^.]+)\.(c_[^:]+):(r_[^.]+)\.(c_.+)$/.exec(rangeTarget);
	if (!m) return; // only rectangle splits supported for now

	const ar = m[1], ac = m[2], er = m[3], ec = m[4];
	if (!ar || !ac || !er || !ec) return;
	const ar_i = model.rows.findIndex(x => x.id === ar);
	const er_i = model.rows.findIndex(x => x.id === er);
	const ac_i = model.columns.findIndex(x => x.id === ac);
	const ec_i = model.columns.findIndex(x => x.id === ec);

	for (let ri = Math.min(ar_i, er_i); ri <= Math.max(ar_i, er_i); ri++) {
		const row = model.rows[ri];
		if (!row || row.id === excludeRowId) continue;
		for (let ci = Math.min(ac_i, ec_i); ci <= Math.max(ac_i, ec_i); ci++) {
			const col = model.columns[ci];
			if (!col) continue;
			applyStylePropsV2(model, `${row.id}.${col.id}`,
				rule.bg ?? null, rule.color ?? null, rule.size ?? null,
				rule.bold ?? null, rule.italic ?? null);
		}
	}
}
