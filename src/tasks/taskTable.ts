/**
 * A tasks table's displayed model: the saved block (query, columns) plus the tasks the query finds.
 * Pure. The result is what the ordinary renderer draws; nothing here is written back.
 */
import type { ColumnDefV2, MergeRangeV2, RowDefV2, StyleRuleV2, TableModelV2 } from '../model';
import { fieldText, fieldById } from './taskFields';
import { currentSort } from './taskOps';
import { parseTaskQuery, type QueryError } from './taskQuery';
import { runTaskQuery, type LocatedTask } from './taskRun';

/** Where a displayed row came from, so a click can open the note at the task. */
export interface RowSource { path: string; line: number }

export interface TasksTable {
	model: TableModelV2;
	/** By row id; a group heading row has none. */
	sources: Map<string, RowSource>;
	/** Lines of the query that were not understood. */
	errors: QueryError[];
	/** Tasks matched before `limit`. */
	total: number;
}

const GROUP_BG = 'var(--background-secondary)';

/** The column the query sorts by, and which way. The first column showing the field that sort line names. */
function sortOfQuery(shell: TableModelV2): { colId: string; dir: 'asc' | 'desc' } | null {
	const cur = currentSort(shell.tasks?.query ?? '');
	if (!cur) return null;
	const key = cur.key === 'due date' ? 'due' : cur.key;
	const col = shell.columns.find(c => c.field && fieldById(c.field)?.sort === key);
	return col ? { colId: col.id, dir: cur.dir } : null;
}

/**
 * `shell` is the block as saved: it has `tasks`, the columns and the look (title, theme, widths), and no rows.
 * Row ids come from the task's place (`t_<path>:<line>`), so a task keeps its row across refreshes and styles
 * and selections that name a row keep naming the same one.
 */
export function buildTasksTable(shell: TableModelV2, tasks: readonly LocatedTask[], today: string): TasksTable {
	const query = parseTaskQuery(shell.tasks?.query ?? '');
	const result = runTaskQuery(tasks, query, today);
	const columns: ColumnDefV2[] = shell.columns;

	const rows: RowDefV2[] = [];
	const merges: MergeRangeV2[] = [];
	const styles: StyleRuleV2[] = [];
	const sources = new Map<string, RowSource>();
	const first = columns[0];
	const last = columns[columns.length - 1];
	const grouped = !!shell.tasks?.groups && result.groups.some(g => g.heading !== '');

	result.groups.forEach((group, gi) => {
		if (grouped && first && last) {
			const id = `g_${gi}`;
			const cells: Record<string, string> = {};
			cells[first.id] = `${group.heading} (${group.tasks.length})`;
			rows.push({ id, cells });
			if (first.id !== last.id) merges.push({ anchor: `${id}.${first.id}`, end: `${id}.${last.id}` });
			styles.push({ target: id, bg: GROUP_BG, bold: true });
		}
		for (const task of group.tasks) {
			const id = `t_${task.path}:${task.line}`;
			const cells: Record<string, string> = {};
			for (const col of columns) cells[col.id] = col.field ? fieldText(task, col.field) : '';
			rows.push({ id, cells });
			sources.set(id, { path: task.path, line: task.line });
		}
	});

	const model: TableModelV2 = { ...shell, rows, merges, styles: [...shell.styles, ...styles] };
	// The order lives in the query. Showing it as the table's live sort lets the header draw its sort mark and offer
	// "clear" with the machinery that is already there.
	const sort = sortOfQuery(shell);
	if (sort) model.sort = sort;
	else delete model.sort;
	return { model, sources, errors: query.errors, total: result.total };
}
