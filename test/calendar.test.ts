/**
 * Calendar view ops (create/delete/set-view-date-col) and its cross-op
 * cleanup — the calendar-axis mirror of test/views.test.ts's kanban coverage.
 */
import { describe, it, expect } from 'vitest';
import { applyStructuralOpV2 } from '../src/operations';
import { viewDisplayName } from '../src/renderViews';
import { eligibleDateColumns } from '../src/renderCalendar';
import type { TableModelV2 } from '../src/model';

function baseModel(): TableModelV2 {
	return {
		version: 2,
		columns: [
			{ id: 'c_due', name: 'Due', type: 'date' },
			{ id: 'c_note', name: 'Note' },
		],
		rows: [
			{ id: 'r_0', cells: { c_due: '2026-07-01', c_note: 'a' } },
			{ id: 'r_1', cells: { c_due: '', c_note: 'b' } },
		],
		merges: [],
		styles: [],
	};
}

describe('eligibleDateColumns', () => {
	it('returns only type: date columns', () => {
		const model = baseModel();
		expect(eligibleDateColumns(model).map(c => c.id)).toEqual(['c_due']);
	});
});

describe('create-view / set-active-view (calendar)', () => {
	it('creates a calendar view and switches to it immediately', () => {
		const model = baseModel();
		applyStructuralOpV2(model, { type: 'create-view', name: 'By due date', viewType: 'calendar', dateColId: 'c_due' });

		expect(model.views).toHaveLength(1);
		const view = model.views![0]!;
		expect(view.type).toBe('calendar');
		expect(view.calendar).toEqual({ dateColId: 'c_due' });
		expect(model.activeViewId).toBe(view.id);
	});

	it('creating a second calendar view for the same column switches to the existing one instead of duplicating it', () => {
		const model = baseModel();
		applyStructuralOpV2(model, { type: 'create-view', name: 'By due date', viewType: 'calendar', dateColId: 'c_due' });
		const firstId = model.activeViewId;
		applyStructuralOpV2(model, { type: 'set-active-view', viewId: null }); // switch away

		applyStructuralOpV2(model, { type: 'create-view', name: 'By due date again', viewType: 'calendar', dateColId: 'c_due' });

		expect(model.views).toHaveLength(1); // no duplicate created
		expect(model.activeViewId).toBe(firstId); // switched back to the original
		expect(model.views![0]!.name).toBe('By due date'); // original name untouched
	});

	it('a calendar view for a DIFFERENT date column is still created normally', () => {
		const model = baseModel();
		model.columns.push({ id: 'c_start', name: 'Start', type: 'date' });
		applyStructuralOpV2(model, { type: 'create-view', name: 'By due', viewType: 'calendar', dateColId: 'c_due' });
		applyStructuralOpV2(model, { type: 'create-view', name: 'By start', viewType: 'calendar', dateColId: 'c_start' });

		expect(model.views).toHaveLength(2);
	});

	it('a kanban view and a calendar view can coexist as separate views', () => {
		const model = baseModel();
		model.columns.push({ id: 'c_status', name: 'Status', type: 'task-status' });
		applyStructuralOpV2(model, { type: 'create-view', name: 'Board', viewType: 'kanban', groupByColId: 'c_status' });
		applyStructuralOpV2(model, { type: 'create-view', name: 'Calendar', viewType: 'calendar', dateColId: 'c_due' });

		expect(model.views).toHaveLength(2);
		expect(model.views!.map(v => v.type).sort()).toEqual(['calendar', 'kanban']);
	});
});

describe('delete-view / rename-view / set-view-date-col', () => {
	it('delete-view removes it and clears activeViewId if it was active', () => {
		const model = baseModel();
		applyStructuralOpV2(model, { type: 'create-view', name: 'Cal', viewType: 'calendar', dateColId: 'c_due' });
		const viewId = model.activeViewId!;
		applyStructuralOpV2(model, { type: 'delete-view', viewId });
		expect(model.views).toHaveLength(0);
		expect(model.activeViewId).toBeUndefined();
	});

	it('rename-view updates the name without touching anything else', () => {
		const model = baseModel();
		applyStructuralOpV2(model, { type: 'create-view', name: 'Cal', viewType: 'calendar', dateColId: 'c_due' });
		const viewId = model.activeViewId!;
		applyStructuralOpV2(model, { type: 'rename-view', viewId, name: 'My calendar' });
		expect(model.views![0]!.name).toBe('My calendar');
	});

	it('set-view-date-col changes which column a calendar view places rows by', () => {
		const model = baseModel();
		model.columns.push({ id: 'c_start', name: 'Start', type: 'date' });
		applyStructuralOpV2(model, { type: 'create-view', name: 'Cal', viewType: 'calendar', dateColId: 'c_due' });
		const viewId = model.activeViewId!;
		applyStructuralOpV2(model, { type: 'set-view-date-col', viewId, dateColId: 'c_start' });
		expect(model.views![0]!.calendar).toEqual({ dateColId: 'c_start' });
	});

	it('set-view-date-col is a no-op for a non-calendar view', () => {
		const model = baseModel();
		model.columns.push({ id: 'c_status', name: 'Status', type: 'task-status' });
		applyStructuralOpV2(model, { type: 'create-view', name: 'Board', viewType: 'kanban', groupByColId: 'c_status' });
		const viewId = model.activeViewId!;
		applyStructuralOpV2(model, { type: 'set-view-date-col', viewId, dateColId: 'c_due' });
		expect(model.views![0]!.calendar).toBeUndefined();
		expect(model.views![0]!.kanban).toEqual({ groupByColId: 'c_status' });
	});
});

describe('viewDisplayName follows the date column header until explicitly renamed', () => {
	it('a view created with no name derives its display name from the column header', () => {
		const model = baseModel();
		applyStructuralOpV2(model, { type: 'create-view', viewType: 'calendar', dateColId: 'c_due' });
		const view = model.views![0]!;

		expect(view.name).toBeUndefined();
		expect(viewDisplayName(model, view)).toBe('Due');
	});

	it('renaming the date column updates the display name automatically', () => {
		const model = baseModel();
		applyStructuralOpV2(model, { type: 'create-view', viewType: 'calendar', dateColId: 'c_due' });
		const view = model.views![0]!;

		applyStructuralOpV2(model, { type: 'set-col-name', colId: 'c_due', name: 'Deadline' });

		expect(view.name).toBeUndefined();
		expect(viewDisplayName(model, view)).toBe('Deadline');
	});
});

describe('delete-col removes a calendar view that placed rows by it', () => {
	it('deletes the view outright, same as an explicit delete-view', () => {
		const model = baseModel();
		applyStructuralOpV2(model, { type: 'create-view', name: 'Cal', viewType: 'calendar', dateColId: 'c_due' });
		const viewId = model.activeViewId!;

		applyStructuralOpV2(model, { type: 'delete-col', colId: 'c_due' });

		expect(model.views).toHaveLength(0);
		expect(model.views!.find(v => v.id === viewId)).toBeUndefined();
		expect(model.activeViewId).toBeUndefined();
	});

	it('a calendar view placed by a DIFFERENT date column is unaffected', () => {
		const model = baseModel();
		model.columns.push({ id: 'c_start', name: 'Start', type: 'date' });
		applyStructuralOpV2(model, { type: 'create-view', name: 'Cal', viewType: 'calendar', dateColId: 'c_start' });

		applyStructuralOpV2(model, { type: 'delete-col', colId: 'c_due' });

		expect(model.views![0]!.type).toBe('calendar');
		expect(model.views![0]!.calendar).toEqual({ dateColId: 'c_start' });
	});
});
