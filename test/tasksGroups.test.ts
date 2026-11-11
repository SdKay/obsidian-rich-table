import { describe, it, expect } from 'vitest';
import { parseTable } from '../src/parser';
import { serializeTable } from '../src/serializer';
import { applyStructuralOpV2 } from '../src/operations';
import { tasksAccepts } from '../src/tasks/taskOps';

// A tasks table can draw a heading row before each `group by` group. It is a choice of the table, saved with the query.
const block = (groups: string) => `---\nversion: 2\ntasks:\n  query: "not done"\n${groups}columns:\n  - { id: c_a, name: Task, field: body }\n---\n`;

describe('tasks.groups', () => {
	it('reads on, and off when it is absent or not a boolean', () => {
		expect(parseTable(block('  groups: true\n')).tasks).toEqual({ query: 'not done', groups: true });
		expect(parseTable(block('')).tasks).toEqual({ query: 'not done' });
		expect(parseTable(block('  groups: "yes"\n')).tasks).toEqual({ query: 'not done' });
	});

	it('is written only when on, so a table that never had it is saved as it was', () => {
		expect(serializeTable(parseTable(block('  groups: true\n')))).toContain('groups: true');
		expect(serializeTable(parseTable(block('')))).not.toContain('groups');
	});

	it('is turned on and off by set-tasks-groups', () => {
		const m = parseTable(block(''));
		applyStructuralOpV2(m, { type: 'set-tasks-groups', groups: true });
		expect(m.tasks).toEqual({ query: 'not done', groups: true });
		applyStructuralOpV2(m, { type: 'set-tasks-groups', groups: false });
		expect(m.tasks).toEqual({ query: 'not done' });
	});

	it('survives a change of the query', () => {
		const m = parseTable(block('  groups: true\n'));
		applyStructuralOpV2(m, { type: 'set-tasks-query', query: 'done' });
		expect(m.tasks).toEqual({ query: 'done', groups: true });
	});

	it('is taken by a tasks table', () => {
		expect(tasksAccepts('set-tasks-groups')).toBe(true);
	});

	it('does nothing in a table that has no tasks', () => {
		const m = parseTable('---\nversion: 2\ncolumns:\n  - { id: c_a, name: A }\nrows:\n  - { id: r_a, cells: { c_a: x } }\n---\n');
		applyStructuralOpV2(m, { type: 'set-tasks-groups', groups: true });
		expect(m.tasks).toBeUndefined();
	});
});
