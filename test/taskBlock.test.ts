import { describe, it, expect } from 'vitest';
import { buildTasksBlock, hasQuery } from '../src/tasks/taskBlock';
import { DEFAULT_TASK_FIELDS, fieldById } from '../src/tasks/taskFields';
import { serializeTable } from '../src/serializer';
import { parseTable } from '../src/parser';

describe('buildTasksBlock', () => {
	it('shows the default fields in order, each column named for its field', () => {
		const m = buildTasksBlock();
		expect(m.columns.map(c => c.field)).toEqual([...DEFAULT_TASK_FIELDS]);
		for (const c of m.columns) expect(c.name, c.field).toBe(fieldById(c.field!)!.label);
	});

	it('begins without a query: the user writes one when it is inserted', () => {
		expect(buildTasksBlock().tasks).toEqual({ query: '' });
	});

	it('has no rows of its own: they are found, not stored', () => {
		expect(buildTasksBlock().rows).toEqual([]);
	});

	it('gives every column an id of its own', () => {
		const ids = buildTasksBlock().columns.map(c => c.id);
		expect(new Set(ids).size).toBe(ids.length);
		for (const id of ids) expect(id).toMatch(/^c_/);
	});

	it('carries the theme it is given', () => {
		expect(buildTasksBlock('grid').theme).toBe('grid');
		expect(buildTasksBlock().theme).toBeUndefined();
	});

	it('is written and read back as the same table', () => {
		const m = buildTasksBlock('grid');
		const back = parseTable(serializeTable(m));
		expect(back.tasks).toEqual(m.tasks);
		expect(back.columns.map(c => [c.name, c.field, c.width])).toEqual(m.columns.map(c => [c.name, c.field, c.width]));
		expect(back.theme).toBe('grid');
	});
});

describe('hasQuery', () => {
	it('a query with a line that says something has been written', () => {
		expect(hasQuery('not done')).toBe(true);
		expect(hasQuery('\n  sort by due\n')).toBe(true);
		expect(hasQuery('# mine\nnot done')).toBe(true);
	});
	it('a blank query, or one of only comments, has not', () => {
		expect(hasQuery('')).toBe(false);
		expect(hasQuery('  \n\t\n')).toBe(false);
		expect(hasQuery('# to do later\n  # still nothing')).toBe(false);
	});
});

describe('the columns a new tasks table starts with', () => {
	const byField = (f: string) => buildTasksBlock().columns.find(c => c.field === f)!;
	it('gives no column a width: each is as wide as its header and content need, and the text wraps', () => {
		for (const c of buildTasksBlock().columns) expect(c.width, c.field).toBeUndefined();
		expect(buildTasksBlock().wrap).toBe(true);
	});
	it('reads text from the left and leaves marks and dates centred', () => {
		for (const f of ['body', 'tags', 'file']) expect(byField(f).align, f).toBe('left');
		for (const f of ['status', 'due', 'priority']) expect(byField(f).align, f).toBeUndefined();
	});
});
