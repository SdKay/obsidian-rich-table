import { measureZoomFactor } from './renderGeometry';
import { scrollToReveal } from './scrollToCell';

/** Where a search hit is: 1-based sheet coordinates, row 1 being the header row. */
export interface CellAnchor {
	sheet: string;
	row: number;
	col: number;
}

export function isCellAnchor(value: unknown): value is CellAnchor {
	if (typeof value !== 'object' || value === null) return false;
	const a = value as Record<string, unknown>;
	return typeof a.sheet === 'string' && Number.isInteger(a.row) && Number.isInteger(a.col) && (a.row as number) >= 1 && (a.col as number) >= 1;
}

/** The rendered cell for a sheet coordinate: `data-row`/`data-col` are the 0-based display indexes, the header being row 0. */
export function findAnchorCell(root: ParentNode, anchor: Pick<CellAnchor, 'row' | 'col'>): HTMLElement | null {
	return root.querySelector<HTMLElement>(`[data-row="${anchor.row - 1}"][data-col="${anchor.col - 1}"]`);
}

/** Scrolls the table's own scroll container so the cell is visible and not under the frozen rows and columns. */
export function revealCell(cell: HTMLElement): void {
	const wrapper = cell.closest<HTMLElement>('.bt-table-wrapper');
	if (!wrapper) return;
	const port = wrapper.getBoundingClientRect();
	const target = cell.getBoundingClientRect();
	let frozenLeft = 0;
	let frozenTop = 0;
	wrapper.querySelectorAll<HTMLElement>('.bt-frozen-col').forEach(el => { frozenLeft = Math.max(frozenLeft, el.getBoundingClientRect().right - port.left); });
	wrapper.querySelectorAll<HTMLElement>('.bt-frozen-row').forEach(el => { frozenTop = Math.max(frozenTop, el.getBoundingClientRect().bottom - port.top); });
	const next = scrollToReveal({
		port, target, frozenLeft, frozenTop,
		targetFrozenX: cell.hasClass('bt-frozen-col'),
		targetFrozenY: cell.hasClass('bt-frozen-row'),
		scrollLeft: wrapper.scrollLeft,
		scrollTop: wrapper.scrollTop,
		maxScrollLeft: wrapper.scrollWidth - wrapper.clientWidth,
		maxScrollTop: wrapper.scrollHeight - wrapper.clientHeight,
		zoom: measureZoomFactor(wrapper.closest<HTMLElement>('.bt-render-root') ?? wrapper),
	});
	wrapper.scrollLeft = next.left;
	wrapper.scrollTop = next.top;
}
