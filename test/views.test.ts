/**
 * Views infrastructure (create/delete/rename/set-active-view, set-view-group)
 * and its cross-op cleanup: deleting or retyping a column a kanban/calendar
 * view depends on removes that view outright, same as an explicit
 * delete-view — see removeViewsDependentOnColumn in operations.ts.
 */
import { describe, it, expect } from 'vitest';
import { applyStructuralOpV2 } from '../src/operations';
import { viewDisplayName } from '../src/renderViews';
import type { TableModelV2 } from '../src/model';

function baseModel(): TableModelV2 {
	return {
		version: 2,
		columns: [
			{ id: 'c_status', name: 'Status', type: 'task-status' },
			{ id: 'c_note', name: 'Note' },
		],
		rows: [
			{ id: 'r_0', cells: { c_status: 'done', c_note: 'a' } },
			{ id: 'r_1', cells: { c_status: 'todo', c_note: 'b' } },
		],
		merges: [],
		styles: [],
	};
}

describe('create-view / set-active-view', () => {
	it('creates a kanban view and switches to it immediately', () => {
		const model = baseModel();
		applyStructuralOpV2(model, { type: 'create-view', name: 'Kanban (Status)', viewType: 'kanban', groupByColId: 'c_status' });

		expect(model.views).toHaveLength(1);
		const view = model.views![0]!;
		expect(view.type).toBe('kanban');
		expect(view.kanban).toEqual({ groupByColId: 'c_status' });
		expect(model.activeViewId).toBe(view.id);
	});

	it('creating a second kanban view for the same column switches to the existing one instead of duplicating it', () => {
		const model = baseModel();
		applyStructuralOpV2(model, { type: 'create-view', name: 'Kanban (Status)', viewType: 'kanban', groupByColId: 'c_status' });
		const firstId = model.activeViewId;
		applyStructuralOpV2(model, { type: 'set-active-view', viewId: null }); // switch away

		applyStructuralOpV2(model, { type: 'create-view', name: 'Kanban (Status) again', viewType: 'kanban', groupByColId: 'c_status' });

		expect(model.views).toHaveLength(1); // no duplicate created
		expect(model.activeViewId).toBe(firstId); // switched back to the original
		expect(model.views![0]!.name).toBe('Kanban (Status)'); // original name untouched
	});

	it('a kanban view for a DIFFERENT column is still created normally', () => {
		const model = baseModel();
		model.columns.push({ id: 'c_prio', name: 'Priority', type: 'priority' });
		applyStructuralOpV2(model, { type: 'create-view', name: 'By status', viewType: 'kanban', groupByColId: 'c_status' });
		applyStructuralOpV2(model, { type: 'create-view', name: 'By priority', viewType: 'kanban', groupByColId: 'c_prio' });

		expect(model.views).toHaveLength(2);
	});

	it('switching back to the default view clears activeViewId', () => {
		const model = baseModel();
		applyStructuralOpV2(model, { type: 'create-view', name: 'K', viewType: 'kanban', groupByColId: 'c_status' });
		applyStructuralOpV2(model, { type: 'set-active-view', viewId: null });
		expect(model.activeViewId).toBeUndefined();
	});

	it('switching to an unknown view id falls back to the default view', () => {
		const model = baseModel();
		applyStructuralOpV2(model, { type: 'set-active-view', viewId: 'v_does_not_exist' });
		expect(model.activeViewId).toBeUndefined();
	});
});

describe('delete-view / rename-view / set-view-group', () => {
	it('delete-view removes it and clears activeViewId if it was active', () => {
		const model = baseModel();
		applyStructuralOpV2(model, { type: 'create-view', name: 'K', viewType: 'kanban', groupByColId: 'c_status' });
		const viewId = model.activeViewId!;
		applyStructuralOpV2(model, { type: 'delete-view', viewId });
		expect(model.views).toHaveLength(0);
		expect(model.activeViewId).toBeUndefined();
	});

	it('rename-view updates the name without touching anything else', () => {
		const model = baseModel();
		applyStructuralOpV2(model, { type: 'create-view', name: 'K', viewType: 'kanban', groupByColId: 'c_status' });
		const viewId = model.activeViewId!;
		applyStructuralOpV2(model, { type: 'rename-view', viewId, name: 'My board' });
		expect(model.views![0]!.name).toBe('My board');
	});

	it('set-view-group changes which column a kanban view groups by', () => {
		const model = baseModel();
		model.columns.push({ id: 'c_prio', name: 'Priority', type: 'priority' });
		applyStructuralOpV2(model, { type: 'create-view', name: 'K', viewType: 'kanban', groupByColId: 'c_status' });
		const viewId = model.activeViewId!;
		applyStructuralOpV2(model, { type: 'set-view-group', viewId, groupByColId: 'c_prio' });
		expect(model.views![0]!.kanban).toEqual({ groupByColId: 'c_prio' });
	});
});

describe('viewDisplayName follows the group-by column header until explicitly renamed', () => {
	it('a view created with no name derives its display name from the column header', () => {
		const model = baseModel();
		applyStructuralOpV2(model, { type: 'create-view', viewType: 'kanban', groupByColId: 'c_status' });
		const view = model.views![0]!;

		expect(view.name).toBeUndefined(); // nothing frozen into storage
		expect(viewDisplayName(model, view)).toBe('Status');
	});

	it('renaming the group-by column updates the display name automatically', () => {
		const model = baseModel();
		applyStructuralOpV2(model, { type: 'create-view', viewType: 'kanban', groupByColId: 'c_status' });
		const view = model.views![0]!;

		applyStructuralOpV2(model, { type: 'set-col-name', colId: 'c_status', name: 'Task status' });

		expect(view.name).toBeUndefined(); // still nothing stored on the view
		expect(viewDisplayName(model, view)).toBe('Task status');
	});

	it('an explicit rename-view detaches the view from the column and survives further column renames', () => {
		const model = baseModel();
		applyStructuralOpV2(model, { type: 'create-view', viewType: 'kanban', groupByColId: 'c_status' });
		const viewId = model.activeViewId!;

		applyStructuralOpV2(model, { type: 'rename-view', viewId, name: 'My board' });
		applyStructuralOpV2(model, { type: 'set-col-name', colId: 'c_status', name: 'Task status' });

		const view = model.views!.find(v => v.id === viewId)!;
		expect(viewDisplayName(model, view)).toBe('My board');
	});
});

describe('delete-col removes a kanban/calendar view that depended on it', () => {
	it('deletes the view outright, same as an explicit delete-view', () => {
		const model = baseModel();
		applyStructuralOpV2(model, { type: 'create-view', name: 'K', viewType: 'kanban', groupByColId: 'c_status' });
		const viewId = model.activeViewId!;

		applyStructuralOpV2(model, { type: 'delete-col', colId: 'c_status' });

		expect(model.views).toHaveLength(0);
		expect(model.views!.find(v => v.id === viewId)).toBeUndefined();
	});

	it('clears activeViewId if the removed view was active', () => {
		const model = baseModel();
		applyStructuralOpV2(model, { type: 'create-view', name: 'K', viewType: 'kanban', groupByColId: 'c_status' });
		expect(model.activeViewId).toBeDefined();

		applyStructuralOpV2(model, { type: 'delete-col', colId: 'c_status' });

		expect(model.activeViewId).toBeUndefined();
	});

	it('a kanban view grouped by a DIFFERENT column is unaffected', () => {
		const model = baseModel();
		model.columns.push({ id: 'c_prio', name: 'Priority', type: 'priority' });
		applyStructuralOpV2(model, { type: 'create-view', name: 'K', viewType: 'kanban', groupByColId: 'c_prio' });

		applyStructuralOpV2(model, { type: 'delete-col', colId: 'c_status' });

		expect(model.views).toHaveLength(1);
		expect(model.views![0]!.type).toBe('kanban');
		expect(model.views![0]!.kanban).toEqual({ groupByColId: 'c_prio' });
	});
});

describe('set-col-type removes a kanban/calendar view that depended on the retyped column', () => {
	it('retyping a kanban view\'s group column away deletes the view', () => {
		const model = baseModel();
		applyStructuralOpV2(model, { type: 'create-view', name: 'K', viewType: 'kanban', groupByColId: 'c_status' });

		applyStructuralOpV2(model, { type: 'set-col-type', colId: 'c_status', colType: 'priority' });

		expect(model.views).toHaveLength(0);
		expect(model.activeViewId).toBeUndefined();
	});

	it('retyping a calendar view\'s date column away deletes the view', () => {
		const model = baseModel();
		model.columns.push({ id: 'c_due', name: 'Due', type: 'date' });
		applyStructuralOpV2(model, { type: 'create-view', name: 'C', viewType: 'calendar', dateColId: 'c_due' });

		applyStructuralOpV2(model, { type: 'set-col-type', colId: 'c_due', colType: undefined });

		expect(model.views).toHaveLength(0);
	});

	it('setting the SAME type again is a no-op — the view survives', () => {
		const model = baseModel();
		applyStructuralOpV2(model, { type: 'create-view', name: 'K', viewType: 'kanban', groupByColId: 'c_status' });

		applyStructuralOpV2(model, { type: 'set-col-type', colId: 'c_status', colType: 'task-status' });

		expect(model.views).toHaveLength(1);
	});

	it('retyping an unrelated column is unaffected', () => {
		const model = baseModel();
		applyStructuralOpV2(model, { type: 'create-view', name: 'K', viewType: 'kanban', groupByColId: 'c_status' });

		applyStructuralOpV2(model, { type: 'set-col-type', colId: 'c_note', colType: 'priority' });

		expect(model.views).toHaveLength(1);
	});
});
