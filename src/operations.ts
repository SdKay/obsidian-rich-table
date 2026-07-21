import type { TableModelV2, ColumnDefV2, RowDefV2, StyleRuleV2 } from './model';
import { genId } from './idGen';

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
	| { type: 'set-theme';       theme: string | null }
	| { type: 'toggle-lock' }
	| { type: 'toggle-collapse' }
	| { type: 'paste-values';   anchorRowId: string; anchorColId: string; values: string[][] }
	| { type: 'set-sort';       sort: { colId: string; dir: 'asc' | 'desc' } | null }
	/** One-time sort: physically commits the given row order to storage — the
	 *  caller (renderer.ts) computes `rowIds` since it owns the type-aware
	 *  comparators; the reducer just applies the already-decided order. */
	| { type: 'reorder-rows';   rowIds: string[] };

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
			model.rows.splice(idx, 1);
			// Remove merges that reference this row
			model.merges = model.merges.filter(m =>
				!m.anchor.startsWith(`${op.rowId}.`) && !m.end.startsWith(`${op.rowId}.`));
			// Remove cell-level styles referencing this row
			model.styles = model.styles.filter(s =>
				!s.target.startsWith(`${op.rowId}.`) && s.target !== op.rowId);
			break;
		}
		case 'move-row': {
			const fromIdx = model.rows.findIndex(r => r.id === op.fromRowId);
			const toIdx   = model.rows.findIndex(r => r.id === op.toRowId);
			if (fromIdx < 0 || toIdx < 0 || fromIdx === toIdx) break;
			const [row] = model.rows.splice(fromIdx, 1);
			if (row) model.rows.splice(toIdx, 0, row);
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
			model.columns.splice(idx, 1); // takes col.filter with it — no separate cleanup needed
			for (const row of model.rows) delete row.cells[op.colId];
			model.merges = model.merges.filter(m =>
				!m.anchor.endsWith(`.${op.colId}`) && !m.end.endsWith(`.${op.colId}`));
			model.styles = model.styles.filter(s =>
				!s.target.endsWith(`.${op.colId}`) && s.target !== op.colId);
			if (model.sort?.colId === op.colId) delete model.sort;
			break;
		}
		case 'move-col': {
			const fromIdx = model.columns.findIndex(c => c.id === op.fromColId);
			const toIdx   = model.columns.findIndex(c => c.id === op.toColId);
			if (fromIdx < 0 || toIdx < 0 || fromIdx === toIdx) break;
			const [col] = model.columns.splice(fromIdx, 1);
			if (col) model.columns.splice(toIdx, 0, col);
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
			if (op.colType) col.type = op.colType; else delete col.type;
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
