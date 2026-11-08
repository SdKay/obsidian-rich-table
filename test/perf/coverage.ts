/**
 * Every operation the plugin can carry out, and the scenario that measures what it costs or the reason it is left out.
 * Typed over the operation unions, so an operation added without a line here does not compile, as with opEffect.ts.
 */
import type { TableOpType } from '../../src/tableEdits';

/**
 * - `rebuild:<op>`  the operation is written to the note and the table is drawn again from it; what the user waits for.
 * - a gesture id    the scenario for the gesture that leads to the operation (a drag, a menu pick).
 * - `{ exempt }`    not measured, and why.
 */
export type Coverage = string | { exempt: string };

export const COVERAGE: { [K in TableOpType]: Coverage } = {
	// ── structure
	'insert-row': 'rebuild:insert-row', 'delete-row': 'rebuild:delete-row', 'move-row': 'rebuild:move-row', 'move-rows': 'rebuild:move-rows',
	'hide-row': 'rebuild:hide-row', 'show-row-group': 'rebuild:show-row-group',
	'insert-col': 'rebuild:insert-col', 'delete-col': 'rebuild:delete-col', 'move-col': 'rebuild:move-col', 'move-cols': 'rebuild:move-cols',
	'hide-col': 'rebuild:hide-col', 'show-col-group': 'rebuild:show-col-group',
	'merge-cells': 'rebuild:merge-cells', 'unmerge-cells': 'rebuild:unmerge-cells',
	'split-cell-row': 'rebuild:split-cell-row', 'split-cell-col': 'rebuild:split-cell-col',
	'reorder-rows': 'rebuild:reorder-rows', 'transpose': 'rebuild:transpose', 'set-col-type': 'rebuild:set-col-type',
	// ── content
	'set-cell-content': 'rebuild:set-cell-content', 'fill-cells': 'rebuild:fill-cells', 'set-cell-formula': 'rebuild:set-cell-formula',
	'paste-values': 'rebuild:paste-values', 'paste-values-with-header': 'rebuild:paste-values-with-header', 'set-col-name': 'rebuild:set-col-name',
	// ── look
	'set-col-width': 'drag-col-width', 'set-col-align': 'rebuild:set-col-align', 'set-row-height': 'drag-row-height',
	'set-cell-style': 'rebuild:set-cell-style', 'set-range-style': 'rebuild:set-range-style', 'split-range-style': 'rebuild:split-range-style',
	'set-align': 'rebuild:set-align', 'set-title': 'rebuild:set-title', 'set-footer': 'rebuild:set-footer', 'set-theme': 'rebuild:set-theme',
	'toggle-collapse': 'rebuild:toggle-collapse', 'set-freeze-rows': 'rebuild:set-freeze-rows', 'set-freeze-cols': 'rebuild:set-freeze-cols',
	'set-view-width': 'drag-view-size', 'set-view-height': 'drag-view-size',
	'set-status-bar-mode': 'rebuild:set-status-bar-mode', 'set-status-bar-scroll-width': 'drag-status-divider', 'set-zoom': 'zoom-slider',
	'create-view': 'rebuild:create-view', 'delete-view': 'rebuild:delete-view', 'rename-view': 'rebuild:rename-view',
	'set-view-group': 'rebuild:set-view-group', 'set-view-date-col': 'rebuild:set-view-date-col', 'set-active-view': 'rebuild:set-active-view',
	// ── derived
	'set-filter': 'rebuild:set-filter', 'set-sort': 'rebuild:set-sort',
	'toggle-aggregate': 'rebuild:toggle-aggregate', 'clear-aggregate': 'rebuild:clear-aggregate', 'reorder-aggregate': 'rebuild:reorder-aggregate',
	// ── state
	'toggle-lock': 'rebuild:toggle-lock',
	// ── workbook
	'create-sheet': 'rebuild:create-sheet', 'delete-sheet': 'rebuild:delete-sheet', 'rename-sheet': 'rebuild:rename-sheet',
	'reorder-sheets': 'rebuild:reorder-sheets', 'set-active-sheet': 'rebuild:set-active-sheet', 'set-sheet-tab-style': 'rebuild:set-sheet-tab-style',
	'set-tasks-query': { exempt: 'acts only on a table that shows a task query, whose rows come from the vault; the scan has no vault of tasks to measure it on' },
	'set-sheet-content': { exempt: 'only written when a new sheet is filled from a template or a blank grid, once; its cost is that of building the sheet' },
};
