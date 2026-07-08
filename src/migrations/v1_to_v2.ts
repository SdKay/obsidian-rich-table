/**
 * v1 → v2 migration.
 *
 * Pure function: same source → same output (uses seqId, no Math.random).
 * This makes the migration reproducible and round-trip-testable.
 *
 * Key transformations:
 *  - Columns get sequential IDs  c_000000, c_000001, …
 *  - Data rows get sequential IDs r_000000, r_000001, …
 *  - Header row is NOT stored in rows[] — header content lives in columns[].name
 *  - merges:     coordinate ranges → rowId.colId anchor/end
 *  - styles:     Excel-style targets → ID-based targets
 *  - filter:     column letter keys → colId keys
 *  - hiddenRows: index array → row.hidden = true
 *  - rowHeights: index array → row.height = N
 */

import { parseTable } from '../history/v1/parser';
import { seqId } from '../idGen';
import { colLetterToIndex } from '../utils';
import type { ColumnDefV2, MergeRangeV2, RowDefV2, StyleRuleV2, TableModelV2 } from '../model';
import { serializeTable } from '../serializer';

export function migrateV1toV2(source: string): string {
	const v1 = parseTable(source);

	// ── Assign IDs ───────────────────────────────────────────────────────────
	const columns: ColumnDefV2[] = v1.columns.map((col, ci) => ({
		id:     seqId('c', ci),
		name:   col.name,
		...(col.hidden            ? { hidden: true }          : {}),
		...(col.type              ? { type: col.type }         : {}),
		...(col.width != null     ? { width: col.width }       : {}),
		...(col.align             ? { align: col.align }       : {}),
	}));

	const colIdByIdx = (ci: number): string => columns[ci]?.id ?? seqId('c', ci);

	// v1 rows[0] = header; data rows start at index 1
	const dataRowCount = v1.rows.length - 1;
	const rowIds: string[] = Array.from({ length: dataRowCount }, (_, i) => seqId('r', i));
	const rowIdByDataIdx = (di: number): string => rowIds[di] ?? seqId('r', di); // di = v1 rowIdx - 1

	// ── Rows ─────────────────────────────────────────────────────────────────
	const hiddenSet = new Set(v1.hiddenRows ?? []);
	const rows: RowDefV2[] = [];
	for (let ri = 1; ri < v1.rows.length; ri++) {
		const di   = ri - 1; // data index
		const rowId = rowIdByDataIdx(di);
		const cells: Record<string, string> = {};
		for (let ci = 0; ci < v1.columns.length; ci++) {
			cells[colIdByIdx(ci)] = v1.rows[ri]?.[ci] ?? '';
		}
		const row: RowDefV2 = { id: rowId, cells };
		if (hiddenSet.has(ri)) row.hidden = true;
		const h = v1.rowHeights?.[ri];
		if (h && h > 0) row.height = h;
		rows.push(row);
	}

	// ── Merges ───────────────────────────────────────────────────────────────
	const merges: MergeRangeV2[] = v1.merges
		.map(m => {
			// v1 uses 0-indexed rows where row 0 = header
			// data row di = v1 startRow - 1
			const anchorRowId = rowIdByDataIdx(m.startRow - 1);
			const endRowId    = rowIdByDataIdx(m.endRow   - 1);
			const anchorColId = colIdByIdx(m.startCol);
			const endColId    = colIdByIdx(m.endCol);
			if (!anchorRowId || !anchorColId || !endRowId || !endColId) return null;
			return {
				anchor: `${anchorRowId}.${anchorColId}`,
				end:    `${endRowId}.${endColId}`,
			};
		})
		.filter((m): m is MergeRangeV2 => m !== null);

	// ── Styles ────────────────────────────────────────────────────────────────
	const styles: StyleRuleV2[] = v1.styles
		.map(rule => {
			const t2 = convertTargetV1toV2(rule.target, colIdByIdx, rowIdByDataIdx, v1.columns.length);
			if (!t2) return null;
			const r: StyleRuleV2 = { target: t2 };
			if (rule.bg)     r.bg     = rule.bg;
			if (rule.color)  r.color  = rule.color;
			if (rule.bold)   r.bold   = rule.bold;
			if (rule.italic) r.italic = rule.italic;
			if (rule.size)   r.size   = rule.size;
			return r;
		})
		.filter((r): r is StyleRuleV2 => r !== null);

	// ── Filter ────────────────────────────────────────────────────────────────
	let filter: Record<string, string[]> | undefined;
	if (v1.filter && Object.keys(v1.filter).length > 0) {
		filter = {};
		for (const [letter, values] of Object.entries(v1.filter)) {
			const ci = colLetterToIndex(letter);
			const colId = colIdByIdx(ci);
			if (colId) filter[colId] = values;
		}
	}

	const v2: TableModelV2 = {
		version:  2,
		columns,
		rows,
		merges,
		styles,
		...(v1.title            ? { title: v1.title }   : {}),
		...(v1.footer           ? { footer: v1.footer } : {}),
		...(filter              ? { filter }             : {}),
		...(v1.locked           ? { locked: true }       : {}),
	};

	return serializeTable(v2);
}

// ── Target conversion ─────────────────────────────────────────────────────────

/**
 * Convert a v1 Excel-style target string to a v2 ID-based target string.
 * Returns null for targets that cannot be represented in v2 (e.g. header-only targets).
 *
 * v1 row indices are 1-based (row 1 = header).  Data rows start at row 2 (dataIdx 1).
 */
export function convertTargetV1toV2(
	target: string,
	colIdByIdx: (ci: number) => string,
	rowIdByDataIdx: (di: number) => string,
	colCount: number,
): string | null {
	// "B*"  whole column B
	const colWild = /^([A-Z]+)\*$/.exec(target);
	if (colWild) {
		const ci = colLetterToIndex(colWild[1] ?? '');
		return colIdByIdx(ci) ?? null;
	}

	// "*3"  whole row 3  (1-indexed, row 1 = header → skip)
	const rowWild = /^\*(\d+)$/.exec(target);
	if (rowWild) {
		const rowNum = parseInt(rowWild[1] ?? '1'); // 1-indexed
		if (rowNum <= 1) return null; // header row has no v2 representation
		return rowIdByDataIdx(rowNum - 2) ?? null; // di = rowNum - 2 (row2=di0, row3=di1, …)
	}

	// "1:1" or "2:4"  row range  (1-indexed)
	const rowRange = /^(\d+):(\d+)$/.exec(target);
	if (rowRange) {
		const r1 = parseInt(rowRange[1] ?? '1');
		const r2 = parseInt(rowRange[2] ?? '1');
		// "1:1" = header-only row range → v2 "header" target
		if (r1 <= 1 && r2 <= 1) return 'header';
		// Skip or clamp header (row 1)
		const dr1 = Math.max(r1, 2) - 2; // data index
		const dr2 = r2 - 2;
		if (dr1 > dr2) return null;
		const id1 = rowIdByDataIdx(dr1);
		const id2 = rowIdByDataIdx(dr2);
		if (!id1 || !id2) return null;
		return id1 === id2 ? id1 : `${id1}:${id2}`;
	}

	// "A:C"  column range
	const colRange = /^([A-Z]+):([A-Z]+)$/.exec(target);
	if (colRange) {
		const ci1 = colLetterToIndex(colRange[1] ?? '');
		const ci2 = colLetterToIndex(colRange[2] ?? '');
		const id1 = colIdByIdx(Math.min(ci1, ci2));
		const id2 = colIdByIdx(Math.max(ci1, ci2));
		if (!id1 || !id2) return null;
		return id1 === id2 ? id1 : `${id1}:${id2}`;
	}

	// "A1:C3"  cell range
	const cellRange = /^([A-Z]+)(\d+):([A-Z]+)(\d+)$/.exec(target);
	if (cellRange) {
		const ci1 = colLetterToIndex(cellRange[1] ?? '');
		const r1  = parseInt(cellRange[2] ?? '1');
		const ci2 = colLetterToIndex(cellRange[3] ?? '');
		const r2  = parseInt(cellRange[4] ?? '1');
		const dr1 = r1 - 2; const dr2 = r2 - 2;
		if (dr1 < 0 && dr2 < 0) return null; // entire range is in header
		const clampedDr1 = Math.max(0, dr1);
		const id_r1 = rowIdByDataIdx(clampedDr1);
		const id_r2 = rowIdByDataIdx(Math.max(clampedDr1, dr2));
		const id_c1 = colIdByIdx(Math.min(ci1, ci2));
		const id_c2 = colIdByIdx(Math.max(ci1, ci2));
		if (!id_r1 || !id_r2 || !id_c1 || !id_c2) return null;
		// Single cell
		if (id_r1 === id_r2 && id_c1 === id_c2) return `${id_r1}.${id_c1}`;
		// Always use rect format — collapsing to row/col range would expand coverage incorrectly
		return `${id_r1}.${id_c1}:${id_r2}.${id_c2}`;
	}

	// "B2"  single cell
	const single = /^([A-Z]+)(\d+)$/.exec(target);
	if (single) {
		const ci  = colLetterToIndex(single[1] ?? '');
		const row = parseInt(single[2] ?? '1');
		if (row <= 1) return null; // header cell
		const di  = row - 2;
		const rid = rowIdByDataIdx(di);
		const cid = colIdByIdx(ci);
		if (!rid || !cid) return null;
		return `${rid}.${cid}`;
	}

	return null;
}
