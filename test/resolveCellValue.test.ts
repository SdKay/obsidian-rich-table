/**
 * resolveCellValue: a merge's value lives only on its anchor cell — every
 * other row/col it visually spans is genuinely empty in the model (the plain
 * table never needs to resolve this itself; it just skips rendering covered
 * cells via rowspan/colspan on the anchor). A non-tabular view like Kanban,
 * where each row becomes an independent card with no shared visual span,
 * needs the actual resolved value — reported as: a vertically-merged column
 * only showed its value on the first of the merged rows' cards.
 */
import { describe, it, expect } from 'vitest';
import { resolveCellValue } from '../src/renderGridHelpers';
import type { TableModelV2 } from '../src/model';

function baseModel(): TableModelV2 {
	return {
		version: 2,
		columns: [
			{ id: 'c_task', name: 'Task' },
			{ id: 'c_status', name: 'Status' },
		],
		rows: [
			{ id: 'r_0', cells: { c_task: 'zephyr', c_status: 'done' } },
			{ id: 'r_1', cells: { c_status: 'todo' } }, // c_task covered, genuinely empty
			{ id: 'r_2', cells: { c_status: 'pending' } }, // also covered
		],
		merges: [{ anchor: 'r_0.c_task', end: 'r_2.c_task' }],
		styles: [],
	};
}

describe('resolveCellValue', () => {
	it('returns a plain unmerged cell\'s own value', () => {
		const model = baseModel();
		expect(resolveCellValue(model, 'r_0', 'c_status')).toBe('done');
	});

	it('returns the anchor\'s own value unchanged', () => {
		const model = baseModel();
		expect(resolveCellValue(model, 'r_0', 'c_task')).toBe('zephyr');
	});

	it('resolves a covered row to the merge anchor\'s value', () => {
		const model = baseModel();
		expect(resolveCellValue(model, 'r_1', 'c_task')).toBe('zephyr');
		expect(resolveCellValue(model, 'r_2', 'c_task')).toBe('zephyr');
	});

	it('a genuinely empty, unmerged cell resolves to empty string', () => {
		const model = baseModel();
		model.rows.push({ id: 'r_3', cells: {} });
		expect(resolveCellValue(model, 'r_3', 'c_status')).toBe('');
	});

	it('a covered header column-range merge resolves too', () => {
		const model = baseModel();
		model.merges.push({ anchor: 'header.c_task', end: 'header.c_status' });
		// Header cells aren't stored in rows[]/cells — resolveCellValue only
		// operates on data rows, so this just confirms it doesn't throw or
		// misbehave when a merge references the 'header' sentinel elsewhere
		// in model.merges while resolving an unrelated data-row cell.
		expect(resolveCellValue(model, 'r_1', 'c_task')).toBe('zephyr');
	});
});
