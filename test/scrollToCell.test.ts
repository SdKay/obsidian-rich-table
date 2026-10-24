import { describe, it, expect } from 'vitest';
import { scrollToReveal, type ScrollRevealInput } from '../src/scrollToCell';

// Port 400 x 300 at the origin; frozen columns cover 100 px, frozen rows 40 px.
const base: ScrollRevealInput = {
	port: { left: 0, top: 0, right: 400, bottom: 300 },
	target: { left: 150, top: 100, right: 250, bottom: 140 },
	frozenLeft: 100, frozenTop: 40,
	targetFrozenX: false, targetFrozenY: false,
	scrollLeft: 200, scrollTop: 150,
	maxScrollLeft: 600, maxScrollTop: 500,
	zoom: 1,
};
const cell = (left: number, top: number, w = 100, h = 40) => ({ left, top, right: left + w, bottom: top + h });

describe('scrollToReveal', () => {
	it('leaves the scroll alone when the cell is already fully visible', () => {
		expect(scrollToReveal(base)).toEqual({ left: 200, top: 150 });
	});

	it('scrolls back when the cell is inside the port but under the frozen columns', () => {
		// Visible from x=100; the cell starts at 20, so 80 px short.
		expect(scrollToReveal({ ...base, target: cell(20, 100) })).toEqual({ left: 120, top: 150 });
	});

	it('scrolls back when the cell is under the frozen rows', () => {
		// Visible from y=40; the cell starts at 10, 30 px short.
		expect(scrollToReveal({ ...base, target: cell(150, 10) })).toEqual({ left: 200, top: 120 });
	});

	it('scrolls forward just enough when the cell overhangs the right and bottom edges', () => {
		// Right edge 480 vs 400 -> 80; bottom 360 vs 300 -> 60.
		expect(scrollToReveal({ ...base, target: cell(380, 320, 100, 40) })).toEqual({ left: 280, top: 210 });
	});

	it('aligns to the start edge when the cell is larger than the visible area', () => {
		// Visible width 300, cell width 350 at 380..730: align its left to 100.
		expect(scrollToReveal({ ...base, target: cell(380, 100, 350, 40) })).toEqual({ left: 480, top: 150 });
	});

	it('does not scroll an axis whose frozen band holds the cell', () => {
		expect(scrollToReveal({ ...base, target: cell(20, 500), targetFrozenX: true })).toEqual({ left: 200, top: 390 });
		expect(scrollToReveal({ ...base, target: cell(500, 5), targetFrozenY: true })).toEqual({ left: 400, top: 150 });
	});

	it('divides a visual shortfall by the zoom to get logical scroll', () => {
		// 80 visual px short at zoom 2 is 40 logical px.
		expect(scrollToReveal({ ...base, zoom: 2, target: cell(20, 100) })).toEqual({ left: 160, top: 150 });
	});

	it('never scrolls past 0 or the maximum', () => {
		expect(scrollToReveal({ ...base, target: cell(-500, -500) })).toEqual({ left: 0, top: 0 });
		expect(scrollToReveal({ ...base, target: cell(5000, 5000), maxScrollLeft: 600, maxScrollTop: 500 })).toEqual({ left: 600, top: 500 });
	});

	it('with no frozen band, a cell off the left edge aligns to the port edge', () => {
		expect(scrollToReveal({ ...base, frozenLeft: 0, frozenTop: 0, target: cell(-50, -10) })).toEqual({ left: 150, top: 140 });
	});
});
