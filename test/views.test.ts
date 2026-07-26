/**
 * Views infrastructure (create/delete/rename/set-active-view, set-view-group)
 * and its cross-op cleanup: deleting a column a kanban view groups by must
 * fall the view back to a plain table rather than leaving a dangling
 * reference (same "clear the invalid reference, don't destroy the entity"
 * precedent already used for model.sort in delete-col — see operations.ts).
 */
import { describe, it, expect } from 'vitest';
import { applyStructuralOpV2 } from '../src/operations';
import { viewDisplayName } from '../src/renderKanban';
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

describe('delete-col cleans up a kanban view that grouped by it', () => {
	it('falls the view back to a plain table instead of leaving a dangling groupByColId', () => {
		const model = baseModel();
		applyStructuralOpV2(model, { type: 'create-view', name: 'K', viewType: 'kanban', groupByColId: 'c_status' });
		const viewId = model.activeViewId!;

		applyStructuralOpV2(model, { type: 'delete-col', colId: 'c_status' });

		const view = model.views!.find(v => v.id === viewId)!;
		expect(view.type).toBe('table');
		expect(view.kanban).toBeUndefined();
		// The view itself survives (not deleted) — same "clear the reference,
		// don't destroy the entity" precedent as model.sort.
		expect(model.views).toHaveLength(1);
	});

	it('a kanban view grouped by a DIFFERENT column is unaffected', () => {
		const model = baseModel();
		model.columns.push({ id: 'c_prio', name: 'Priority', type: 'priority' });
		applyStructuralOpV2(model, { type: 'create-view', name: 'K', viewType: 'kanban', groupByColId: 'c_prio' });

		applyStructuralOpV2(model, { type: 'delete-col', colId: 'c_status' });

		expect(model.views![0]!.type).toBe('kanban');
		expect(model.views![0]!.kanban).toEqual({ groupByColId: 'c_prio' });
	});
});
