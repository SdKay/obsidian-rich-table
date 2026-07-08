import type { StyleRuleV2, TableModelV2 } from './model';

// ── Target parsing ────────────────────────────────────────────────────────────

export type StyleTargetV2 =
	| { kind: 'cell';        rowId: string; colId: string }
	| { kind: 'row';         rowId: string }
	| { kind: 'col';         colId: string }
	| { kind: 'row-range';   startRowId: string; endRowId: string }
	| { kind: 'col-range';   startColId: string; endColId: string }
	| { kind: 'rect';        startRowId: string; startColId: string; endRowId: string; endColId: string }
	/** Entire header row. Serialized as the string "header". */
	| { kind: 'header' }
	/** Single header cell. Serialized as "header.c_xxxxxx". */
	| { kind: 'header-cell'; colId: string };

/**
 * Parse a v2 style target string into a typed object.
 *
 * Disambiguation order (must not be reordered):
 *   1. Contains ":"  → range (subdivided by whether parts contain ".")
 *   2. Contains "."  → single cell  "r_abc.c_def"
 *   3. Starts "r_"   → whole row
 *   4. Starts "c_"   → whole col
 */
export function parseStyleTarget(target: string): StyleTargetV2 | null {
	if (target.includes(':')) {
		const [left, right] = target.split(':', 2) as [string, string];
		const leftHasDot  = left.includes('.');
		const rightHasDot = right.includes('.');
		if (leftHasDot || rightHasDot) {
			// rectangle  "r_abc.c_def:r_xyz.c_ghi"
			const [startRowId, startColId] = left.split('.', 2)  as [string, string];
			const [endRowId,   endColId]   = right.split('.', 2) as [string, string];
			if (!startRowId || !startColId || !endRowId || !endColId) return null;
			return { kind: 'rect', startRowId, startColId, endRowId, endColId };
		}
		if (left.startsWith('r_') && right.startsWith('r_')) {
			return { kind: 'row-range', startRowId: left, endRowId: right };
		}
		if (left.startsWith('c_') && right.startsWith('c_')) {
			return { kind: 'col-range', startColId: left, endColId: right };
		}
		return null; // malformed
	}

	if (target === 'header') return { kind: 'header' };

	if (target.includes('.')) {
		const [left, right] = target.split('.', 2) as [string, string];
		if (!left || !right) return null;
		// "header.c_xxx" → header-cell
		if (left === 'header') return { kind: 'header-cell', colId: right };
		return { kind: 'cell', rowId: left, colId: right };
	}

	if (target.startsWith('r_')) return { kind: 'row', rowId: target };
	if (target.startsWith('c_')) return { kind: 'col', colId: target };

	return null;
}

/** Serialize a typed target back to a string. */
export function serializeStyleTarget(t: StyleTargetV2): string {
	switch (t.kind) {
		case 'cell':        return `${t.rowId}.${t.colId}`;
		case 'row':         return t.rowId;
		case 'col':         return t.colId;
		case 'row-range':   return `${t.startRowId}:${t.endRowId}`;
		case 'col-range':   return `${t.startColId}:${t.endColId}`;
		case 'rect':        return `${t.startRowId}.${t.startColId}:${t.endRowId}.${t.endColId}`;
		case 'header':      return 'header';
		case 'header-cell': return `header.${t.colId}`;
	}
}

// ── Matching ──────────────────────────────────────────────────────────────────

/**
 * True if a style rule whose target is `t` applies to a DATA cell (rowId, colId).
 * Header cells are never matched here — use matchesHeaderCell for the header row.
 */
export function matchesCell(t: StyleTargetV2, rowId: string, colId: string, model: TableModelV2): boolean {
	switch (t.kind) {
		case 'header':
		case 'header-cell':
			return false; // header targets don't apply to data cells
		case 'cell':
			return t.rowId === rowId && t.colId === colId;
		case 'row':
			return t.rowId === rowId;
		case 'col':
			return t.colId === colId;
		case 'row-range': {
			const startIdx = model.rows.findIndex(r => r.id === t.startRowId);
			const endIdx   = model.rows.findIndex(r => r.id === t.endRowId);
			const rowIdx   = model.rows.findIndex(r => r.id === rowId);
			return rowIdx >= 0 && rowIdx >= Math.min(startIdx, endIdx) && rowIdx <= Math.max(startIdx, endIdx);
		}
		case 'col-range': {
			const startIdx = model.columns.findIndex(c => c.id === t.startColId);
			const endIdx   = model.columns.findIndex(c => c.id === t.endColId);
			const colIdx   = model.columns.findIndex(c => c.id === colId);
			return colIdx >= 0 && colIdx >= Math.min(startIdx, endIdx) && colIdx <= Math.max(startIdx, endIdx);
		}
		case 'rect': {
			const sRi = model.rows.findIndex(r => r.id === t.startRowId);
			const eRi = model.rows.findIndex(r => r.id === t.endRowId);
			const sCi = model.columns.findIndex(c => c.id === t.startColId);
			const eCi = model.columns.findIndex(c => c.id === t.endColId);
			const ri  = model.rows.findIndex(r => r.id === rowId);
			const ci  = model.columns.findIndex(c => c.id === colId);
			return ri >= 0 && ci >= 0
				&& ri >= Math.min(sRi, eRi) && ri <= Math.max(sRi, eRi)
				&& ci >= Math.min(sCi, eCi) && ci <= Math.max(sCi, eCi);
		}
	}
}

// ── Priority ──────────────────────────────────────────────────────────────────

/**
 * Cascade priority (higher number = wins):
 *   1  whole row / whole col
 *   2  row-range / col-range
 *   3  rect
 *   4  single cell
 *
 * Per-attribute merge: more specific wins per property (not whole-rule replace).
 */
/** True if a style rule applies to a header cell (colId). */
export function matchesHeaderCell(t: StyleTargetV2, colId: string): boolean {
	switch (t.kind) {
		case 'header':      return true;  // applies to all header cells
		case 'header-cell': return t.colId === colId;
		case 'col':         return t.colId === colId; // column-wide rules cover header too
		default:            return false;
	}
}

function targetPriority(t: StyleTargetV2): number {
	switch (t.kind) {
		case 'header':
		case 'row':
		case 'col':         return 1;
		case 'row-range':
		case 'col-range':   return 2;
		case 'rect':        return 3;
		case 'cell':
		case 'header-cell': return 4;
	}
}

export interface ResolvedStyleV2 {
	bg?: string;
	color?: string;
	bold?: boolean;
	italic?: boolean;
	size?: number;
}

/**
 * Resolve the effective style for (rowId, colId) by merging all matching
 * rules in priority order (low-priority first, high-priority last-wins per
 * attribute).
 */
export function resolveStylesV2(
	styles: StyleRuleV2[],
	rowId: string,
	colId: string,
	model: TableModelV2,
): ResolvedStyleV2 {
	const matching: { priority: number; rule: StyleRuleV2 }[] = [];
	for (const rule of styles) {
		const t = parseStyleTarget(rule.target);
		if (!t) continue;
		if (!matchesCell(t, rowId, colId, model)) continue;
		matching.push({ priority: targetPriority(t), rule });
	}
	// Sort ascending so higher priority overwrites lower (last-wins)
	matching.sort((a, b) => a.priority - b.priority);

	const result: ResolvedStyleV2 = {};
	for (const { rule } of matching) {
		if (rule.bg)     result.bg     = rule.bg;
		if (rule.color)  result.color  = rule.color;
		if (rule.bold)   result.bold   = rule.bold;
		if (rule.italic) result.italic = rule.italic;
		if (rule.size)   result.size   = rule.size;
	}
	return result;
}

/**
 * Resolve the effective style for a header cell (colId).
 * Matches "header", "header.colId", and whole-column rules.
 */
export function resolveHeaderStylesV2(
	styles: StyleRuleV2[],
	colId: string,
): ResolvedStyleV2 {
	const matching: { priority: number; rule: StyleRuleV2 }[] = [];
	for (const rule of styles) {
		const t = parseStyleTarget(rule.target);
		if (!t || !matchesHeaderCell(t, colId)) continue;
		matching.push({ priority: targetPriority(t), rule });
	}
	matching.sort((a, b) => a.priority - b.priority);
	const result: ResolvedStyleV2 = {};
	for (const { rule } of matching) {
		if (rule.bg)     result.bg     = rule.bg;
		if (rule.color)  result.color  = rule.color;
		if (rule.bold)   result.bold   = rule.bold;
		if (rule.italic) result.italic = rule.italic;
		if (rule.size)   result.size   = rule.size;
	}
	return result;
}
