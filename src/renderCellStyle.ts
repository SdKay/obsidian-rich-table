import type { ColumnDefV2, StyleRuleV2, TableModelV2 } from './model';
import {
	resolveStylesV2, resolveHeaderStylesV2, parseStyleTarget, matchesHeaderCell, matchesCell,
	type ResolvedStyleV2,
} from './styleTarget';
import type { StructuralOpHandler } from './renderTypes';
import { getMergeOrigin } from './renderGridHelpers';

/**
 * Apply a ResolvedStyleV2 to an element via inline style + CSS classes.
 *
 * Every value is set with 'important' priority: a user-set per-cell style must
 * always win over a theme's own decoration, no matter how a given theme happens
 * to be written. Themes are free to use `!important` for their own effects (e.g.
 * academic's blanket `background: none !important` for a booktabs look, or
 * plain's animated header `color: #fff !important`) — inline !important still
 * outranks stylesheet !important in the cascade, so this is the one place that
 * needs to encode the invariant, rather than relying on every theme file to avoid
 * !important on properties users can also set.
 */
export function applyResolvedStyle(el: HTMLElement, rs: ResolvedStyleV2): void {
	if (rs.bg)    el.style.setProperty('background-color', rs.bg, 'important');
	if (rs.color) el.style.setProperty('color', rs.color, 'important');
	if (rs.size) {
		el.style.setProperty('font-size', `${rs.size}px`, 'important');
		el.style.setProperty('--bt-cell-font-size', `${rs.size}px`, 'important');
	}
	if (rs.bold)   el.addClass('bt-bold');
	if (rs.italic) el.addClass('bt-italic');
	// !important here specifically also has to outrank applyColStyle's own
	// `bt-align-*` class (a plain stylesheet rule, no !important) — that class
	// still reflects only the column-wide default, so a cell/header-cell
	// override resolved here must win over it the same way it wins over a theme.
	if (rs.align) el.style.setProperty('text-align', rs.align, 'important');
}

/** Effective style of a cell, using v2 priority cascade. */
export function cellEffectiveStyle(
	model: TableModelV2, rowIdx: number, colIdx: number,
): ResolvedStyleV2 {
	const col = model.columns[colIdx];
	if (!col) return {};
	if (rowIdx === 0) return resolveHeaderStylesV2(model.styles, col.id, model);
	const row = model.rows[rowIdx - 1];
	if (!row) return {};
	return resolveStylesV2(model.styles, row.id, col.id, model);
}

/**
 * Style a cell inherits when the exact cell/header-cell rule is excluded.
 * Used as the "inherited" preview fallback in the style panel.
 */
export function cellInheritedStyle(
	model: TableModelV2, rowIdx: number, colIdx: number,
	exactTarget?: string,
): ResolvedStyleV2 {
	const col = model.columns[colIdx];
	if (!col) return {};
	const defaultExact = rowIdx === 0 ? `header.${col.id}` : (() => {
		const row = model.rows[rowIdx - 1];
		return row ? `${row.id}.${col.id}` : '';
	})();
	const target = exactTarget ?? defaultExact;
	const filtered = model.styles.filter(s => s.target !== target);
	if (rowIdx === 0) return resolveHeaderStylesV2(filtered, col.id, model);
	const row = model.rows[rowIdx - 1];
	if (!row) return {};
	return resolveStylesV2(filtered, row.id, col.id, model);
}

export type ApplyStyleFn = (bg: string | null, color: string | null, size: number | null, bold: boolean | null, italic: boolean | null) => void;

/**
 * Builds the style-panel context for a data cell:
 * - Merge origin  → sTarget is the merge range; Apply uses set-range-style.
 * - Non-merge cell with a range rule (e.g. "D5:D7") → Apply splits the range
 *   to isolate this cell, then sets a cell-specific rule.
 * - Plain cell    → Apply uses set-cell-style directly.
 */
export function buildCellStyleContext(
	rowIdx: number, colIdx: number,
	model: TableModelV2,
	onStructuralOp: StructuralOpHandler,
): { sTarget: string; exactTarget: string; isMerge: boolean; rangeRule: StyleRuleV2 | null; applyStyle: ApplyStyleFn } {
	const col = model.columns[colIdx];
	const row = rowIdx > 0 ? model.rows[rowIdx - 1] : null;
	if (!col || (rowIdx > 0 && !row)) {
		return { sTarget: '', exactTarget: '', isMerge: false, rangeRule: null, applyStyle: () => {} };
	}
	const rId = row?.id ?? '';
	const cId = col.id;
	const single = rId ? `${rId}.${cId}` : `header.${cId}`;

	const merge = getMergeOrigin(rowIdx, colIdx, model);
	const sTarget = merge
		? `${merge.anchorRowId}.${merge.anchorColId}:${merge.endRowId}.${merge.endColId}`
		: single;

	const rangeRule = !merge
		? (model.styles.find(s => {
			if (s.target === single) return false;
			const t = parseStyleTarget(s.target);
			if (!t) return false;
			return rId ? matchesCell(t, rId, cId, model) : matchesHeaderCell(t, cId, model);
		}) ?? null)
		: null;
	const exactTarget = merge ? sTarget : (rangeRule?.target ?? single);

	const applyStyle: ApplyStyleFn = (bg, color, size, bold, italic) => {
		if (merge) {
			void onStructuralOp({ type: 'set-range-style', target: sTarget, bg, color, size, bold, italic });
		} else if (rangeRule) {
			void onStructuralOp({ type: 'split-range-style', rangeTarget: rangeRule.target, excludeRowId: rId, excludeColId: cId });
			void onStructuralOp({ type: 'set-cell-style', rowId: rId, colId: cId, bg, color, size, bold, italic });
		} else {
			void onStructuralOp({ type: 'set-cell-style', rowId: rId, colId: cId, bg, color, size, bold, italic });
		}
	};
	return { sTarget, exactTarget, isMerge: !!merge, rangeRule, applyStyle };
}

/** Raw stored value of a display cell — r=0 is the header (column name), r>=1 is a data row. */
export function cellRawValue(model: TableModelV2, r: number, c: number): string {
	const col = model.columns[c];
	if (!col) return '';
	return r === 0 ? (col.name ?? '') : (model.rows[r - 1]?.cells[col.id] ?? '');
}

export function applyColStyle(el: HTMLElement, col: ColumnDefV2): void {
	// Width is now controlled solely by <colgroup>/<col> — no CSS variable needed
	if (col.align) el.addClass(`bt-align-${col.align}`);
}

export function applyStyleRulesV2(el: HTMLElement, rowIdx: number, colIdx: number, model: TableModelV2): void {
	const col = model.columns[colIdx];
	if (!col) return;
	let rs: ResolvedStyleV2;
	if (rowIdx === 0) {
		rs = resolveHeaderStylesV2(model.styles, col.id, model);
	} else {
		const row = model.rows[rowIdx - 1];
		if (!row) return;
		rs = resolveStylesV2(model.styles, row.id, col.id, model);
	}
	applyResolvedStyle(el, rs);
}
