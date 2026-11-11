import { describe, it, expect } from 'vitest';
import { parseTable } from '../src/parser';
import { scanTasks } from '../src/tasks/taskScan';
import { buildTasksTable } from '../src/tasks/taskTable';

const TODAY = '2026-11-04';
const shell = (query: string, columns = '  - { id: c_body, name: Task, field: body }\n  - { id: c_due, name: Due, field: due }\n  - { id: c_file, name: File, field: file }', groups = true) =>
	parseTable(`---\nversion: 2\ntasks:\n  query: ${JSON.stringify(query)}\n${groups ? '  groups: true\n' : ''}columns:\n${columns}\n---\n`);

const NOTES = [
	...scanTasks('proj/a.md', '# Plan\n- [ ] first 📅 2026-12-01\n- [x] done one ✅ 2026-01-01\n- [ ] second #q'),
	...scanTasks('proj/b.md', '- [ ] third 📅 2026-11-10'),
	...scanTasks('other/c.md', '- [ ] fourth #q'),
];

describe('buildTasksTable', () => {
	it('makes one row per found task, with a cell for each column', () => {
		const t = buildTasksTable(shell('not done\nsort by due'), NOTES, TODAY);
		expect(t.total).toBe(4);
		// The two without a due date tie on the sort line and fall to the path: other/ comes before proj/.
		expect(t.model.rows.map(r => r.cells.c_body)).toEqual(['third', 'first', 'fourth', 'second']);
		expect(t.model.rows[0]!.cells).toEqual({ c_body: 'third', c_due: '2026-11-10', c_file: 'b' });
	});

	it('names a row by where the task is, so it keeps its row across refreshes', () => {
		const t = buildTasksTable(shell('not done'), NOTES, TODAY);
		const row = t.model.rows.find(r => r.cells.c_body === 'third')!;
		expect(row.id).toBe('t_proj/b.md:0');
		expect(t.sources.get(row.id)).toEqual({ path: 'proj/b.md', line: 0 });
	});

	it('leaves the saved layout alone: columns, title, theme and styles', () => {
		const s = parseTable('---\nversion: 2\ntitle: My tasks\ntheme: grid\ntasks:\n  query: ""\ncolumns:\n  - { id: c_body, name: Task, field: body, width: 200 }\nstyles:\n  - { target: c_body, bold: true }\n---\n');
		const t = buildTasksTable(s, NOTES, TODAY);
		expect(t.model.columns).toBe(s.columns);
		expect(t.model).toMatchObject({ title: 'My tasks', theme: 'grid' });
		expect(t.model.styles[0]).toEqual({ target: 'c_body', bold: true });
	});

	it('does not change the shell it was given', () => {
		const s = shell('not done');
		buildTasksTable(s, NOTES, TODAY);
		expect(s.rows).toEqual([]);
		expect(s.merges).toEqual([]);
	});

	it('leaves a column without a field empty', () => {
		const s = shell('', '  - { id: c_a, name: A }\n  - { id: c_b, name: B, field: body }');
		const t = buildTasksTable(s, NOTES, TODAY);
		expect(t.model.rows.every(r => r.cells.c_a === '')).toBe(true);
	});

	describe('group by', () => {
		const t = buildTasksTable(shell('not done\ngroup by folder\nsort by due'), NOTES, TODAY);

		it('puts a heading row before each group, with the count', () => {
			const heads = t.model.rows.filter(r => r.id.startsWith('g_'));
			expect(heads.map(r => r.cells.c_body)).toEqual(['other/ (1)', 'proj/ (3)']);
		});

		it('merges a heading across the whole row and gives it a look', () => {
			expect(t.model.merges).toEqual([
				{ anchor: 'g_0.c_body', end: 'g_0.c_file' },
				{ anchor: 'g_1.c_body', end: 'g_1.c_file' },
			]);
			expect(t.model.styles.filter(s => s.target.startsWith('g_')).every(s => s.bold)).toBe(true);
		});

		it('has no source for a heading, so a click on it opens nothing', () => {
			expect(t.sources.has('g_0')).toBe(false);
			expect(t.sources.size).toBe(4);
		});

		it('keeps the tasks of a group together, in order, after its heading', () => {
			expect(t.model.rows.map(r => r.id.startsWith('g_') ? '#' : r.cells.c_body)).toEqual(['#', 'fourth', '#', 'third', 'first', 'second']);
		});
	});

	describe('with the headings off, which is the default', () => {
		const t = buildTasksTable(shell('not done\ngroup by folder\nsort by due', undefined, false), NOTES, TODAY);

		it('draws no heading row and merges nothing', () => {
			expect(t.model.rows.some(r => r.id.startsWith('g_'))).toBe(false);
			expect(t.model.merges).toEqual([]);
		});

		it('still keeps the tasks of a group together, in the order the groups give', () => {
			expect(t.model.rows.map(r => r.cells.c_body)).toEqual(['fourth', 'third', 'first', 'second']);
		});
	});

	it('draws no heading when nothing is grouped', () => {
		const t = buildTasksTable(shell('not done'), NOTES, TODAY);
		expect(t.model.rows.some(r => r.id.startsWith('g_'))).toBe(false);
		expect(t.model.merges).toEqual([]);
	});

	it('merges nothing for a one-column table, which has nothing to span', () => {
		const s = shell('group by folder', '  - { id: c_body, name: Task, field: body }');
		expect(buildTasksTable(s, NOTES, TODAY).model.merges).toEqual([]);
	});

	it('reports the lines it could not read and still applies the rest', () => {
		const t = buildTasksTable(shell('not done\nfilter by function task.isDone\nsort by due'), NOTES, TODAY);
		expect(t.errors).toEqual([{ line: 2, text: 'filter by function task.isDone', reason: 'JavaScript expressions are not supported' }]);
		expect(t.total).toBe(4);
	});

	it('gives an empty table for no tasks, and for a block with no columns', () => {
		expect(buildTasksTable(shell('not done'), [], TODAY).model.rows).toEqual([]);
		expect(buildTasksTable(shell('', ''), NOTES, TODAY).model.rows.length).toBeGreaterThan(0);
	});

	it('counts the tasks the query matched before the limit', () => {
		const t = buildTasksTable(shell('not done\nlimit 2'), NOTES, TODAY);
		expect(t.model.rows).toHaveLength(2);
		expect(t.total).toBe(4);
	});
});
