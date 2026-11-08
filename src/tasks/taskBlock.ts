/**
 * The block a new tasks table starts as: no query yet, and the default columns. Pure, like buildBlankTable.
 */
import type { TableModelV2 } from '../model';
import { genId } from '../idGen';
import { DEFAULT_TASK_FIELDS, fieldById } from './taskFields';

/** A new tasks table starts without a query: the user writes one when it is inserted. */
export function buildTasksBlock(theme?: string): TableModelV2 {
	const ids = new Set<string>();
	const columns = DEFAULT_TASK_FIELDS.map(field => {
		const def = fieldById(field);
		return {
			id: genId('c', ids),
			name: def?.label ?? field,
			field,
			...(def?.align ? { align: def.align } : {}),
		};
	});
	return { version: 2, columns, rows: [], merges: [], styles: [], wrap: true, tasks: { query: '' }, ...(theme ? { theme } : {}) };
}

/**
 * Whether a query has a line that says something. A blank one, or one of only comments (`#` lines), has not been
 * written yet; the table asks for it rather than showing every task in the vault.
 */
export function hasQuery(query: string): boolean {
	return query.split('\n').some(line => {
		const text = line.trim();
		return text !== '' && !text.startsWith('#');
	});
}
