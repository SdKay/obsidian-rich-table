/**
 * What a tasks table lets the user change, and how a sort becomes a change to the query. Pure.
 *
 * The rows of a tasks table are found, not stored, so an op that names a row or a cell has nothing to act on.
 * The columns, the look of the table and the query itself are the table's own and stay editable.
 */
import type { StructuralOpV2 } from '../operations';
import { fieldById } from './taskFields';

/** Ops that act on columns or on the table as a whole, and mean the same without stored rows. */
const ALLOWED = new Set<StructuralOpV2['type']>([
	'insert-col', 'delete-col', 'move-col', 'move-cols', 'hide-col', 'show-col-group',
	'set-col-name', 'set-col-width', 'set-col-align', 'set-col-wrap', 'set-table-wrap', 'set-col-field',
	'set-title', 'set-tasks-query', 'set-tasks-groups', 'set-footer', 'set-theme', 'toggle-lock', 'toggle-collapse',
	'set-freeze-rows', 'set-freeze-cols', 'set-view-width', 'set-view-height',
	'set-status-bar-mode', 'set-status-bar-scroll-width', 'set-zoom',
]);

export const isTasksOp = (op: StructuralOpV2): boolean => ALLOWED.has(op.type);

/** Whether a tasks table takes an operation of this type; any other (a workbook's, or one on rows) is refused. */
export const tasksAccepts = (type: string): boolean => (ALLOWED as ReadonlySet<string>).has(type);

// ── Sorting: the query is the one place the order is kept ────────────────────────────────

export type SortDir = 'asc' | 'desc';

const SORT_LINE = /^\s*sort by\b/i;

/**
 * The query with its `sort by` lines replaced by one for `sortKey` (ascending, or reversed), or with none when
 * `dir` is null. The other lines stay as they were, in their place; the new line goes where the first old one
 * was, or at the end when there was none.
 */
export function withSort(query: string, sortKey: string | null, dir: SortDir | null): string {
	// Trailing blank lines are not part of the query; an empty query has no lines at all.
	const trimmed = query.replace(/\s+$/, '');
	const lines = trimmed === '' ? [] : trimmed.split('\n');
	const at = lines.findIndex(l => SORT_LINE.test(l));
	const kept = lines.filter(l => !SORT_LINE.test(l));
	const next = sortKey && dir ? [`sort by ${sortKey}${dir === 'desc' ? ' reverse' : ''}`] : [];
	const insertAt = at < 0 ? kept.length : lines.slice(0, at).filter(l => !SORT_LINE.test(l)).length;
	kept.splice(insertAt, 0, ...next);
	// A query that is only blank lines is the empty query.
	return kept.every(l => l.trim() === '') ? '' : `${kept.join('\n')}\n`;
}

/** The sort the query asks for first, as the column menu shows it: the key and its direction. */
export function currentSort(query: string): { key: string; dir: SortDir } | null {
	for (const line of query.split('\n')) {
		const m = /^\s*sort by ([a-z. ]+?)( reverse)?\s*$/i.exec(line);
		if (m) return { key: m[1]!.toLowerCase(), dir: m[2] ? 'desc' : 'asc' };
	}
	return null;
}

/** The Tasks sort key of a column's field, or null when Tasks has no sort for it. */
export function sortKeyOf(field: string | undefined): string | null {
	const key = field ? fieldById(field)?.sort : undefined;
	return key ?? null;
}

/**
 * What `set-sort` on `field`'s column does to the query: ascending, then descending, then none. Choosing the
 * menu's explicit direction sets exactly that.
 */
export function sortedQuery(query: string, field: string | undefined, dir: SortDir | null): string | null {
	const key = sortKeyOf(field);
	if (!key) return null;
	return withSort(query, key, dir);
}
