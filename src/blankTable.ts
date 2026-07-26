import type { TableModelV2 } from './model';
import { genId } from './idGen';

/** A fresh N-row × M-col table with no content, styles, merges, or type —
 *  the "start from scratch" counterpart to the full-featured demo template
 *  (see getEmptyTemplate in tableBlock.ts). Kept in its own module (no
 *  renderer/DOM dependencies) so it stays trivially unit-testable. */
export function buildBlankTable(rows: number, cols: number): TableModelV2 {
	const colIds = new Set<string>();
	const rowIds = new Set<string>();
	const columns = Array.from({ length: cols }, () => ({ id: genId('c', colIds), name: '' }));
	const dataRows = Array.from({ length: rows }, () => {
		const cells: Record<string, string> = {};
		for (const col of columns) cells[col.id] = '';
		return { id: genId('r', rowIds), cells };
	});
	return { version: 2, columns, rows: dataRows, merges: [], styles: [] };
}
