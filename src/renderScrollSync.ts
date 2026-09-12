import { computeVisibleGeom, type VisibleGeom } from './renderGeometry';

/**
 * One rAF-coalesced `scroll` listener on `wrapper`, shared by every consumer
 * that repositions something off the table's visible-viewport geometry
 * (renderer.ts's edge-add strips, row/column selector strips, and ctrl
 * column). Each used to run its own independent scroll listener — every one
 * calling `computeVisibleGeom()` (3 getBoundingClientRect reads) and then
 * writing CSS custom properties, with no coordination between them. Two
 * costs came from that: redundant reads (up to 3x the same geometry per
 * frame) and, worse, the browser could be forced to re-run layout between a
 * write from one listener's rAF callback and a read from another's — classic
 * layout-thrashing, all avoidable since every consumer wants the exact same
 * numbers.
 *
 * This computes the geometry exactly once per coalesced frame — after
 * `isActive()` confirms at least one consumer's target is actually visible,
 * so an idle table (nothing hovered) pays nothing at all — and hands that
 * same object to every consumer in turn, so every read for the frame happens
 * before any consumer's writes.
 *
 * `table`/`root`/`wrapper` are read fresh on every call rather than closed
 * over once, matching `computeVisibleGeom`'s own contract (it takes them as
 * parameters for the same reason): cheap, and avoids this module ever having
 * a stale-element bug if a caller ever swapped one of them out.
 */
export function bindScrollSync(
	wrapper: HTMLElement,
	table: HTMLElement,
	root: HTMLElement,
	isActive: () => boolean,
	consumers: Array<(geom: VisibleGeom) => void>,
): void {
	let scheduled = false;
	wrapper.addEventListener('scroll', () => {
		if (!isActive()) return;
		if (scheduled) return;
		scheduled = true;
		window.requestAnimationFrame(() => {
			scheduled = false;
			// Stale-root guard, same reasoning as positionEdgeStrips' own: a
			// subsequent atomic swap may have already detached this closure's
			// root by the time the frame actually runs.
			if (!root.isConnected) return;
			const geom = computeVisibleGeom(table, root, wrapper);
			for (const consumer of consumers) consumer(geom);
		});
	});
}
