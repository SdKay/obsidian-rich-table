import { describe, it, expect } from 'vitest';
import { isTasksOp, tasksAccepts, withSort, currentSort, sortKeyOf, sortedQuery } from '../src/tasks/taskOps';
import type { StructuralOpV2 } from '../src/operations';

describe('isTasksOp', () => {
	const op = (type: string) => ({ type } as unknown as StructuralOpV2);

	it('lets the columns and the look of the table change', () => {
		for (const t of ['insert-col', 'delete-col', 'move-col', 'move-cols', 'set-col-name', 'set-col-width', 'set-title', 'set-theme', 'set-zoom', 'set-freeze-rows', 'set-view-width']) {
			expect(isTasksOp(op(t)), t).toBe(true);
		}
	});

	it('refuses everything that names a row or a cell, which a found row cannot take', () => {
		for (const t of ['insert-row', 'delete-row', 'move-row', 'move-rows', 'hide-row', 'set-row-height', 'set-cell-content', 'set-cell-style', 'set-range-style', 'fill-cells', 'paste-values', 'paste-values-with-header', 'merge-cells', 'unmerge-cells', 'reorder-rows', 'transpose', 'set-cell-formula']) {
			expect(isTasksOp(op(t)), t).toBe(false);
		}
	});
});

describe('withSort', () => {
	it('replaces every sort line with the one asked for, where the first was', () => {
		const q = 'not done\nsort by priority\ngroup by folder\nsort by due\n';
		expect(withSort(q, 'created', 'asc')).toBe('not done\nsort by created\ngroup by folder\n');
	});
	it('adds the line at the end when there was none', () => {
		expect(withSort('not done\ngroup by folder\n', 'due', 'asc')).toBe('not done\ngroup by folder\nsort by due\n');
		expect(withSort('', 'due', 'asc')).toBe('sort by due\n');
	});
	it('writes reverse for a descending sort', () => {
		expect(withSort('not done', 'due', 'desc')).toBe('not done\nsort by due reverse\n');
	});
	it('removes the sort lines and nothing else when there is no direction', () => {
		expect(withSort('not done\nsort by due\nlimit 5\n', 'due', null)).toBe('not done\nlimit 5\n');
		expect(withSort('sort by due\n', null, null)).toBe('');
	});
	it('does not touch a line that only looks like a sort', () => {
		expect(withSort('description includes sort by hand\n', 'due', 'asc')).toBe('description includes sort by hand\nsort by due\n');
	});
	it('ignores case and leading space when it finds the old lines', () => {
		expect(withSort('  Sort By Priority\nnot done\n', 'due', 'asc')).toBe('sort by due\nnot done\n');
	});
});

describe('currentSort', () => {
	it('reads the first sort line and its direction', () => {
		expect(currentSort('not done\nsort by due reverse\nsort by path')).toEqual({ key: 'due', dir: 'desc' });
		expect(currentSort('sort by due')).toEqual({ key: 'due', dir: 'asc' });
	});
	it('is null with no sort line', () => {
		expect(currentSort('not done')).toBeNull();
	});
});

describe('sortKeyOf / sortedQuery', () => {
	it('maps a column field to the sort line Tasks has for it', () => {
		expect(sortKeyOf('due')).toBe('due');
		expect(sortKeyOf('body')).toBe('description');
		expect(sortKeyOf('file')).toBe('filename');
	});
	it('has none for a field Tasks cannot sort by, and none for a column with no field', () => {
		expect(sortKeyOf('recurrence')).toBeNull();
		expect(sortKeyOf(undefined)).toBeNull();
		expect(sortedQuery('not done', 'recurrence', 'asc')).toBeNull();
	});
	it('rewrites the query for a field it can sort by', () => {
		expect(sortedQuery('not done\n', 'priority', 'desc')).toBe('not done\nsort by priority reverse\n');
		expect(sortedQuery('not done\nsort by priority\n', 'priority', null)).toBe('not done\n');
	});
});

describe('tasksAccepts', () => {
	it('agrees with isTasksOp on every operation a tasks table is asked about', () => {
		for (const t of ['insert-col', 'set-tasks-query', 'set-zoom', 'insert-row', 'set-cell-content', 'reorder-rows', 'set-sort']) {
			expect(tasksAccepts(t), t).toBe(isTasksOp({ type: t } as never));
		}
	});

	it('refuses the operations of a workbook, which a tasks table is not', () => {
		for (const t of ['create-sheet', 'delete-sheet', 'rename-sheet', 'set-active-sheet']) expect(tasksAccepts(t), t).toBe(false);
	});
});
