import type { RichTableDoc } from './core';
import type { TableModelV2 } from './model';

const ROW_FIELDS = ['rowId', 'afterRowId', 'beforeRowId', 'fromRowId', 'toRowId', 'anchorRowId', 'endRowId', 'excludeRowId'] as const;
const COL_FIELDS = ['colId', 'afterColId', 'beforeColId', 'fromColId', 'toColId', 'anchorColId', 'endColId', 'excludeColId', 'groupByColId', 'dateColId'] as const;
const ROW_LISTS = ['rowIds'] as const;
const COL_LISTS = ['colIds'] as const;

/** `header` stands for the header row wherever a row id is accepted. */
const HEADER = 'header';

/** The string ids in a field; `null` ("none", e.g. insert at the top) and absent fields name nothing. */
function ids(value: unknown): string[] {
	return (Array.isArray(value) ? value : [value]).filter((v): v is string => typeof v === 'string');
}

/**
 * Problems with the ids an operation names, found before anything is changed. The reducer
 * quietly ignores an id it cannot find, which is right for the plugin but means a caller
 * that mistyped one is told nothing. Returns one message per problem; empty means fine.
 */
export function checkOpIds(table: TableModelV2, op: object): string[] {
	const fields = op as Record<string, unknown>;
	const rowIds = new Set(table.rows.map(r => r.id));
	const colIds = new Set(table.columns.map(c => c.id));
	const problems: string[] = [];
	const verify = (field: string, values: string[], known: Set<string>, kind: string) => {
		for (const v of values) if (!known.has(v) && !(kind === 'row' && v === HEADER)) problems.push(`${field}: no ${kind} "${v}" in this table`);
	};
	for (const f of ROW_FIELDS) verify(f, ids(fields[f]), rowIds, 'row');
	for (const f of ROW_LISTS) verify(f, ids(fields[f]), rowIds, 'row');
	for (const f of COL_FIELDS) verify(f, ids(fields[f]), colIds, 'column');
	for (const f of COL_LISTS) verify(f, ids(fields[f]), colIds, 'column');
	const cells = fields['cells'];
	if (Array.isArray(cells)) {
		cells.forEach((c, i) => {
			const cell = c as { rowId?: unknown; colId?: unknown } | null;
			verify(`cells[${i}].rowId`, ids(cell?.rowId), rowIds, 'row');
			verify(`cells[${i}].colId`, ids(cell?.colId), colIds, 'column');
		});
	}
	return problems;
}

/** The table an operation will act on: the document itself, or one sheet of a workbook. */
export function targetTable(doc: RichTableDoc, sheetId: string | undefined): TableModelV2 | undefined {
	if (!('sheets' in doc)) return doc;
	return doc.sheets.find(s => s.id === (sheetId ?? doc.activeSheetId)) ?? doc.sheets[0];
}
