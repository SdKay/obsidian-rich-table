import { describe, it, expect } from 'vitest';
import { placePanel } from '../src/panelPlace';

const at = (anchorTop: number, anchorBottom: number, height: number, viewportHeight = 720) =>
	placePanel({ anchorTop, anchorBottom, height, viewportHeight });
const covers = (p: { top: number; maxHeight: number | null }, h: number, anchorTop: number, anchorBottom: number) => {
	const bottom = p.top + Math.min(h, p.maxHeight ?? h);
	return p.top < anchorBottom && bottom > anchorTop;
};

describe('placePanel', () => {
	it('goes below the anchor when it fits there', () => {
		expect(at(28, 50, 300)).toEqual({ top: 54, maxHeight: null });
	});
	it('goes above when only that side has room', () => {
		expect(at(600, 622, 300)).toEqual({ top: 296, maxHeight: null });
	});
	it('when it fits neither way, takes the roomier side, shortened, and never covers the anchor', () => {
		const below = at(28, 50, 700);
		expect(below).toEqual({ top: 54, maxHeight: 658 });
		expect(covers(below, 700, 28, 50)).toBe(false);
		const above = at(680, 702, 700);
		expect(above.maxHeight).toBe(668);
		expect(covers(above, 700, 680, 702)).toBe(false);
	});
	it('never covers the anchor, wherever the anchor is and however tall the panel', () => {
		for (let top = 0; top <= 700; top += 7) for (let h = 50; h <= 712; h += 37) {
			const p = at(top, top + 22, h);
			expect(covers(p, h, top, top + 22), `anchor ${top}, panel ${h}`).toBe(false);
			expect(p.top, `anchor ${top}, panel ${h}`).toBeGreaterThanOrEqual(0);
		}
	});
});
