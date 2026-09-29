import type { TableModelV2 } from './model';
import { resolveMergeBounds, computeHeaderRowSpan } from './renderGridHelpers';

export type ReorderAxis = 'row' | 'col';

/** One row/column along the axis, in logical px. Zero-size items (filtered out) are skipped. */
export interface AxisItem { start: number; size: number }

export interface ReorderPlan {
	/** Where the lifted block sits relative to its original spot. */
	offset: number;
	/** Offset the block settles at once released. */
	settle: number;
	/** Insert-before index among the original items; `lo` means "stays put". */
	slot: number;
	/** Per-item shift making room for the block (0 for the block itself). */
	shifts: number[];
}

/**
 * `items` is indexed like the selector strip (rows: 0 = header, columns: 0-based),
 * `floor` is the first index a block may occupy, `delta` how far the pointer
 * has moved since the block was lifted. `spans` (see axisSpans) are the groups
 * that move as one piece; the block `lo..hi` must line up with them.
 */
export function planBlockReorder(
	items: (AxisItem | undefined)[], lo: number, hi: number, delta: number, floor: number, spans?: Span[],
): ReorderPlan {
	const groups = spans ?? items.map((_, i): Span => [i, i]);
	const shifts = items.map(() => 0);
	const extent = ([a, b]: Span) => {
		const real = items.slice(a, b + 1).filter((it): it is AxisItem => !!it && it.size > 0);
		if (real.length === 0) return null;
		return { start: real[0]!.start, end: real[real.length - 1]!.start + real[real.length - 1]!.size };
	};
	const own = extent([lo, hi]);
	if (!own) return { offset: 0, settle: 0, slot: lo, shifts };

	const size = own.end - own.start;
	const movable = groups.filter(g => g[0] >= floor).map(extent).filter((e): e is { start: number; end: number } => !!e);
	const minOffset = (movable[0]?.start ?? own.start) - own.start;
	const maxOffset = Math.max(minOffset, (movable[movable.length - 1]?.end ?? own.end) - own.end);
	const offset = Math.min(maxOffset, Math.max(minOffset, delta));
	const leadingForward = own.end + offset, leadingBackward = own.start + offset;

	let slot = lo, settle = 0;
	for (const g of groups) {
		const [a, b] = g;
		const e = extent(g);
		if (!e || a < floor || (a >= lo && b <= hi)) continue;
		const mid = (e.start + e.end) / 2;
		const apply = (shift: number) => { for (let i = a; i <= b; i++) shifts[i] = shift; };
		if (a > hi && leadingForward > mid) { apply(-size); slot = b + 1; settle = e.end - own.end; }
		if (b < lo && leadingBackward < mid) {
			apply(size);
			if (slot === lo || a < slot) { slot = a; settle = e.start - own.start; }
		}
	}
	return { offset, settle, slot, shifts };
}

export type ReorderBlock = 'header' | 'sort' | 'freeze' | 'hidden' | 'merge';

export type Span = [lo: number, hi: number];

/**
 * Splits the axis (rows: 0 = header, 1..N data; columns: 0-based) into units
 * that can't be pulled apart: each index on its own, except indices joined by
 * a merge that spans them (merges that overlap or touch chain into one unit).
 */
export function axisSpans(model: TableModelV2, axis: ReorderAxis): Span[] {
	const count = axis === 'row' ? model.rows.length + 1 : model.columns.length;
	const joined = resolveMergeBounds(model)
		.map((b): Span => axis === 'row' ? [b.rowLo, b.rowHi] : [b.colLo, b.colHi])
		.filter(([lo, hi]) => hi > lo)
		.sort((a, b) => a[0] - b[0]);
	const spans: Span[] = [];
	let i = 0;
	while (i < count) {
		let hi = i;
		for (const [mlo, mhi] of joined) if (mlo <= hi && mhi > hi) hi = mhi;
		spans.push([i, Math.min(hi, count - 1)]);
		i = Math.min(hi, count - 1) + 1;
	}
	return spans;
}

/** First index a dragged block may occupy: below the header (and anything a
 *  header merge reaches into) and below any frozen rows / right of frozen columns. */
export function blockFloor(model: TableModelV2, axis: ReorderAxis): number {
	return axis === 'row'
		? Math.max(computeHeaderRowSpan(model), (model.freezeRows ?? 0) + 1)
		: model.freezeCols ?? 0;
}

/**
 * Why a selected block of rows/columns can't be lifted and dragged, or null
 * when it can. A block is fine next to frozen rows/columns or merges as long as
 * it stays out of the frozen area and doesn't cut a merge in half. Hidden rows
 * and columns and live sort stay excluded: their placeholder rows / derived
 * order have no stable position to animate.
 */
export function blockReorderBlocker(model: TableModelV2, axis: ReorderAxis, lo: number, hi: number): ReorderBlock | null {
	const count = axis === 'row' ? model.rows.length + 1 : model.columns.length;
	if (lo < 0 || hi >= count) return 'header';
	if (axis === 'row') {
		if (lo < computeHeaderRowSpan(model)) return 'header';
		if (model.sort) return 'sort';
		if (model.rows.some(r => r.hidden)) return 'hidden';
	} else if (model.columns.some(c => c.hidden)) return 'hidden';
	if (lo < blockFloor(model, axis)) return 'freeze';
	const spans = axisSpans(model, axis);
	const first = spans.find(([a, b]) => lo >= a && lo <= b);
	const last = spans.find(([a, b]) => hi >= a && hi <= b);
	return first?.[0] === lo && last?.[1] === hi ? null : 'merge';
}

export const canBlockReorder = (model: TableModelV2, axis: ReorderAxis, lo: number, hi: number): boolean =>
	blockReorderBlocker(model, axis, lo, hi) === null;
