import { describe, it, expect } from 'vitest';
import { viewSpan } from '../src/renderGeometry';

const root = { left: 0, right: 1000 };
const LANE = 44;

describe('viewSpan', () => {
	it('fills root when the body already fills it', () => {
		expect(viewSpan(root, { left: 0, right: 1000 }, LANE, null)).toEqual({ left: 0, right: 1000, narrower: false });
	});
	it('hugs the body plus the left lane when the body is narrower', () => {
		const v = viewSpan(root, { left: 400, right: 600 }, LANE, 100);
		expect(v).toEqual({ left: 356, right: 600, narrower: true });
	});
	it('widens evenly around the middle when the status bar needs more room', () => {
		const v = viewSpan(root, { left: 400, right: 600 }, LANE, 400);
		expect(v.right - v.left).toBe(400);
		expect(Math.abs((v.left + v.right) / 2 - (356 + 600) / 2)).toBeLessThanOrEqual(0.5);
		expect(Number.isInteger(v.left) && Number.isInteger(v.right)).toBe(true);
	});
	it('never leaves root, even when the bar is wider than root', () => {
		const v = viewSpan(root, { left: 100, right: 200 }, LANE, 5000);
		expect(v.left).toBe(0);
		expect(v.right).toBe(1000);
	});
	it('is pushed back inside root near an edge', () => {
		const v = viewSpan(root, { left: 20, right: 120 }, LANE, 300);
		expect(v.left).toBeGreaterThanOrEqual(0);
		expect(v.right - v.left).toBe(300);
	});
});
