import type { ColumnDefV2, RowDefV2, TableModelV2 } from './model';
import type { ChoiceRegistry } from './choiceRegistry';

/** True if any merge spans more than one row — sorting would scatter its rows apart. */
export function hasRowSpanningMerge(model: TableModelV2): boolean {
	return model.merges.some(m => m.anchor.split('.')[0] !== m.end.split('.')[0]);
}

/** Parses the "YYYY-MM-DD" value stored for a `date`-type cell (same parsing as
 *  renderDateCell) into a timestamp; NaN for empty/unparseable values. */
function parseDateCellValue(v: string): number {
	if (!v.trim()) return NaN;
	const [y, m, d] = v.split('-').map(Number);
	if (y === undefined || m === undefined || d === undefined) return NaN;
	return new Date(y, m - 1, d).getTime();
}

/** Default comparator for untyped/text/number cell values — shared fallback below. */
function compareGenericCellValue(av: string, bv: string): number {
	// Number(), not parseFloat() — parseFloat truncates at the first non-numeric
	// character ("1.8/3.3" → 1.8), silently mis-sorting values like ratios or
	// ranges as if they were clean numbers. Number() requires the whole
	// trimmed string to be numeric, so those correctly fall through to text sort.
	const an = Number(av.trim()), bn = Number(bv.trim());
	const bothNumeric = av.trim() !== '' && bv.trim() !== '' && Number.isFinite(an) && Number.isFinite(bn);
	return bothNumeric ? an - bn : av.localeCompare(bv, undefined, { numeric: true, sensitivity: 'base' });
}

/**
 * Per-column-type comparators for sort. `date` compares as actual dates (a plain
 * string/numeric compare breaks the moment a value isn't zero-padded, e.g.
 * "2026-7-5"). Every other registered choice type (task-status, priority, ...,
 * and any custom type) compares by the type's own defined option ORDER, not
 * alphabetically — e.g. task-status naturally orders todo → pending →
 * in-progress → done → cancel, which alphabetical order would scramble.
 * Falls through to compareGenericCellValue() for untyped/unknown-type columns.
 */
const TYPE_COMPARATORS: Record<string, (av: string, bv: string, registry: ChoiceRegistry, typeId: string) => number> = {
	date: (av, bv) => {
		const at = parseDateCellValue(av), bt = parseDateCellValue(bv);
		const aValid = !Number.isNaN(at), bValid = !Number.isNaN(bt);
		return aValid && bValid ? at - bt : aValid ? -1 : bValid ? 1 : 0; // empty dates sort last
	},
};

function compareChoiceCellValue(av: string, bv: string, registry: ChoiceRegistry, typeId: string): number {
	const options = registry.get(typeId)?.options;
	if (!options) return compareGenericCellValue(av, bv);
	const ai = options.findIndex(o => o.value === av.trim());
	const bi = options.findIndex(o => o.value === bv.trim());
	if (ai < 0 && bi < 0) return 0;
	if (ai < 0) return 1;  // value not in the option list sorts last
	if (bi < 0) return -1;
	return ai - bi;
}

/**
 * Sorts a COPY of `rows` by the given column, picking a type-aware comparator
 * the same way for both the live display sort and a one-time commit — the two
 * modes must agree on ordering, or "sort once" would visibly differ from what
 * "keep sorted" would have shown for the same column/direction.
 */
export function sortRowsByColumn(
	rows: RowDefV2[], columns: ColumnDefV2[], sortColId: string, dir: 'asc' | 'desc', registry: ChoiceRegistry,
): RowDefV2[] {
	const typeId = columns.find(c => c.id === sortColId)?.type;
	const compare = typeId
		? (TYPE_COMPARATORS[typeId] ?? ((av, bv) => compareChoiceCellValue(av, bv, registry, typeId)))
		: compareGenericCellValue;
	const sorted = [...rows];
	sorted.sort((a, b) => {
		const av = a.cells[sortColId] ?? '';
		const bv = b.cells[sortColId] ?? '';
		const cmp = compare(av, bv, registry, typeId ?? '');
		return dir === 'asc' ? cmp : -cmp;
	});
	return sorted;
}

/**
 * Reorders a LOCAL copy of `rows` to match `model.sort`, for rendering only — the
 * object returned here is never the one the caller writes back, so this can never
 * persist a reorder. No-ops (returns `model` unchanged) while any merge spans
 * multiple rows, since a rowspan requires its rows to stay physically adjacent.
 */
export function applySortForDisplay(model: TableModelV2, registry: ChoiceRegistry): TableModelV2 {
	// A tasks table arrives in its final order, the query's, with group headings between the rows; `sort` is only
	// there so the header can show it.
	if (!model.sort || model.tasks || hasRowSpanningMerge(model)) return model;
	const { colId: sortColId, dir } = model.sort;
	return { ...model, rows: sortRowsByColumn(model.rows, model.columns, sortColId, dir, registry) };
}
