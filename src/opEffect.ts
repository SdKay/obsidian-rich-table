/**
 * What each operation changes. A table's policy (editPolicy.ts) decides by this, not by operation name, so a
 * new operation is classed once here and every rule that is about "changes to data" or "changes to the
 * look" follows it.
 *
 * The maps are typed over the operation unions, so an operation without a class does not compile.
 */
import type { StructuralOpV2 } from './operations';
import type { WorkbookOpV2 } from './workbookOperations';

export type OpEffect =
	/** The text in the cells, headers included. */
	| 'content'
	/** Which rows, columns, merges and sheets exist, and in what order. */
	| 'structure'
	/** How the table is drawn; no cell changes. */
	| 'look'
	/** A view over the data (filter, sort, summary rows): the data itself is as it was. */
	| 'derived'
	/** The table's own switches. Locking has to be possible on a locked table. */
	| 'state'
	/** Looking at another part of the same table (another sheet). Allowed on a locked table. */
	| 'navigate';

const STRUCTURAL: { [K in StructuralOpV2['type']]: OpEffect } = {
	'insert-row': 'structure', 'delete-row': 'structure', 'move-row': 'structure', 'move-rows': 'structure',
	'hide-row': 'structure', 'show-row-group': 'structure',
	'insert-col': 'structure', 'delete-col': 'structure', 'move-col': 'structure', 'move-cols': 'structure',
	'hide-col': 'structure', 'show-col-group': 'structure',
	'merge-cells': 'structure', 'unmerge-cells': 'structure', 'split-cell-row': 'structure', 'split-cell-col': 'structure',
	'reorder-rows': 'structure', 'transpose': 'structure',
	// A column's type changes how its cells are read and sorted, so the data itself is reinterpreted.
	'set-col-type': 'structure',
	// The query decides which rows there are.
	'set-tasks-query': 'structure',

	'set-cell-content': 'content', 'fill-cells': 'content', 'set-cell-formula': 'content',
	'paste-values': 'content', 'paste-values-with-header': 'content',
	// A header is a cell with text in it.
	'set-col-name': 'content',

	'set-col-width': 'look', 'set-col-align': 'look', 'set-row-height': 'look',
	'set-cell-style': 'look', 'set-range-style': 'look', 'split-range-style': 'look', 'set-align': 'look',
	'set-title': 'look', 'set-footer': 'look', 'set-theme': 'look',
	'toggle-collapse': 'look', 'set-freeze-rows': 'look', 'set-freeze-cols': 'look',
	'set-view-width': 'look', 'set-view-height': 'look', 'set-status-bar-mode': 'look', 'set-status-bar-scroll-width': 'look',
	'set-zoom': 'look',
	'create-view': 'look', 'delete-view': 'look', 'rename-view': 'look', 'set-view-group': 'look', 'set-view-date-col': 'look', 'set-active-view': 'look',

	'set-filter': 'derived', 'set-sort': 'derived',
	'toggle-aggregate': 'derived', 'clear-aggregate': 'derived', 'reorder-aggregate': 'derived',

	'toggle-lock': 'state',
};

const WORKBOOK: { [K in WorkbookOpV2['type']]: OpEffect } = {
	'create-sheet': 'structure', 'delete-sheet': 'structure', 'rename-sheet': 'structure', 'reorder-sheets': 'structure',
	'set-sheet-content': 'structure',
	'set-sheet-tab-style': 'look',
	'set-active-sheet': 'navigate',
};

export const effectOf = (op: StructuralOpV2): OpEffect => STRUCTURAL[op.type];
export const effectOfWorkbook = (op: WorkbookOpV2): OpEffect => WORKBOOK[op.type];

/** The two unions name no operation in common, so one map answers for both. */
const ALL: { [K in StructuralOpV2['type'] | WorkbookOpV2['type']]: OpEffect } = { ...STRUCTURAL, ...WORKBOOK };
export const effectOfType = (type: StructuralOpV2['type'] | WorkbookOpV2['type']): OpEffect => ALL[type];
