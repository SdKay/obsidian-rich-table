import { describe, it, expect } from 'vitest';
import { applyStructuralOpV2 } from '../src/operations';
import type { TableModelV2 } from '../src/model';
import { tasksAccepts } from '../src/tasks/taskOps';

// A tasks table's column shows one property of each task (its field). Choosing the field from the column menu sends
// set-col-field. The column is named for its field unless the user named it.
const table = (cols: TableModelV2['columns']): TableModelV2 => ({ version: 2, columns: cols, rows: [], merges: [], styles: [], tasks: { query: 'not done' } });

describe('set-col-field', () => {
	it('sets the field of a new, unnamed column and names it for the field', () => {
		const m = table([{ id: 'c_1', name: '' }]);
		applyStructuralOpV2(m, { type: 'set-col-field', colId: 'c_1', field: 'due' });
		expect(m.columns[0]).toEqual({ id: 'c_1', name: 'Due', field: 'due' });
	});

	it('renames a column still called after its old field', () => {
		const m = table([{ id: 'c_1', name: 'Due', field: 'due' }]);
		applyStructuralOpV2(m, { type: 'set-col-field', colId: 'c_1', field: 'priority' });
		expect(m.columns[0]).toEqual({ id: 'c_1', name: 'Priority', field: 'priority' });
	});

	it('gives a column the alignment its field reads best in, as a new table does', () => {
		const m = table([{ id: 'c_1', name: '' }]);
		applyStructuralOpV2(m, { type: 'set-col-field', colId: 'c_1', field: 'tags' });
		expect(m.columns[0]).toEqual({ id: 'c_1', name: 'Tags', field: 'tags', align: 'left' });
		applyStructuralOpV2(m, { type: 'set-col-field', colId: 'c_1', field: 'due' });
		expect(m.columns[0]).toEqual({ id: 'c_1', name: 'Due', field: 'due' });
	});

	it('keeps an alignment the user gave the column', () => {
		const m = table([{ id: 'c_1', name: 'Due', field: 'due', align: 'right' }]);
		applyStructuralOpV2(m, { type: 'set-col-field', colId: 'c_1', field: 'tags' });
		expect(m.columns[0]).toEqual({ id: 'c_1', name: 'Tags', field: 'tags', align: 'right' });
	});

	it('keeps a name the user gave the column', () => {
		const m = table([{ id: 'c_1', name: 'When', field: 'due' }]);
		applyStructuralOpV2(m, { type: 'set-col-field', colId: 'c_1', field: 'scheduled' });
		expect(m.columns[0]).toEqual({ id: 'c_1', name: 'When', field: 'scheduled' });
	});

	it('clears the field, and the name it was given for it', () => {
		const m = table([{ id: 'c_1', name: 'Due', field: 'due' }]);
		applyStructuralOpV2(m, { type: 'set-col-field', colId: 'c_1', field: null });
		expect(m.columns[0]).toEqual({ id: 'c_1', name: '' });
	});

	it('does nothing for a column that is not there', () => {
		const m = table([{ id: 'c_1', name: '' }]);
		applyStructuralOpV2(m, { type: 'set-col-field', colId: 'c_gone', field: 'due' });
		expect(m.columns[0]).toEqual({ id: 'c_1', name: '' });
	});

	it('keeps a field the plugin does not know, without naming the column after it', () => {
		const m = table([{ id: 'c_1', name: '' }]);
		applyStructuralOpV2(m, { type: 'set-col-field', colId: 'c_1', field: 'custom' });
		expect(m.columns[0]).toEqual({ id: 'c_1', name: '', field: 'custom' });
	});
});

describe('what a tasks table takes for its columns', () => {
	it('takes choosing a column’s field', () => {
		expect(tasksAccepts('set-col-field')).toBe(true);
	});
	it('does not take a column type: a task’s field decides what a cell shows', () => {
		expect(tasksAccepts('set-col-type')).toBe(false);
	});
});
