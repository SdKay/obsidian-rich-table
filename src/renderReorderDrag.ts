import { ownCells, ownCols } from './renderOwnScope';
import { planBlockReorder, type ReorderAxis, type ReorderPlan, type AxisItem, type Span } from './reorderPlan';

export interface BlockLift {
	move(clientPos: number): void;
	/** Settles the block and returns the insert-before index, or null if nothing moved. */
	drop(): number | null;
	cancel(): void;
}

/** Clears the leftover transforms if the table was never rebuilt (e.g. the write failed). */
const STALE_CLEAR_MS = 2500;

/**
 * Lifts the rows/columns `lo..hi` so they follow the pointer while the others
 * slide aside, using CSS transforms only (no re-render per frame). After a
 * drop the transforms stay in place: the write-back's live snapshot then
 * shows the new order immediately, until the rebuilt table replaces it.
 */
export function liftBlock(
	table: HTMLElement, axis: ReorderAxis, lo: number, hi: number, count: number, startClient: number, zoom: number,
	floor: number, spans: Span[],
): BlockLift {
	const nodes: HTMLElement[][] = Array.from({ length: count }, () => []);
	const aggCells = axis === 'col'
		? Array.from(table.querySelectorAll<HTMLElement>(':scope > tbody > tr.bt-agg-row > td[data-col]'))
		: [];
	for (const cell of [...ownCells(table), ...aggCells]) {
		const i = parseInt((axis === 'row' ? cell.dataset.row : cell.dataset.col) ?? '-1');
		if (i < 0 || i >= count) continue;
		const node = axis === 'row' ? cell.closest<HTMLElement>('tr') : cell;
		if (node && !nodes[i]!.includes(node)) nodes[i]!.push(node);
	}
	const cols = ownCols(table);
	const items: (AxisItem | undefined)[] = nodes.map((group, i) => {
		const r = (axis === 'row' ? group[0] : cols[i])?.getBoundingClientRect();
		if (!r) return undefined;
		return axis === 'row' ? { start: r.top / zoom, size: r.height / zoom } : { start: r.left / zoom, size: r.width / zoom };
	});

	table.addClass('bt-reordering', `bt-reordering-${axis}`);
	nodes.forEach((group, i) => group.forEach(n => {
		n.addClass('bt-reorder-item');
		if (i >= lo && i <= hi) n.addClass('bt-reorder-lifted');
	}));

	const applied: number[] = nodes.map(() => 0);
	let plan: ReorderPlan = planBlockReorder(items, lo, hi, 0, floor, spans);
	const apply = (offset: number) => {
		nodes.forEach((group, i) => {
			const shift = i >= lo && i <= hi ? offset : plan.shifts[i] ?? 0;
			if (shift === applied[i]) return;
			applied[i] = shift;
			group.forEach(n => n.setCssProps({ '--bt-reorder-shift': `${shift}px` }));
		});
	};

	const clear = () => {
		table.removeClass('bt-reordering', `bt-reordering-${axis}`, 'bt-reorder-settling');
		for (const group of nodes) for (const n of group) {
			n.removeClass('bt-reorder-item', 'bt-reorder-lifted');
			n.style.removeProperty('--bt-reorder-shift');
		}
	};
	const settle = (offset: number) => {
		table.addClass('bt-reorder-settling');
		apply(offset);
	};

	return {
		move(clientPos) {
			plan = planBlockReorder(items, lo, hi, (clientPos - startClient) / zoom, floor, spans);
			apply(plan.offset);
		},
		drop() {
			if (plan.slot === lo) { plan = planBlockReorder(items, lo, hi, 0, floor, spans); settle(0); window.setTimeout(clear, 200); return null; }
			settle(plan.settle);
			window.setTimeout(() => { if (table.isConnected) clear(); }, STALE_CLEAR_MS);
			return plan.slot;
		},
		cancel() {
			plan = planBlockReorder(items, lo, hi, 0, floor, spans);
			settle(0);
			window.setTimeout(clear, 200);
		},
	};
}
