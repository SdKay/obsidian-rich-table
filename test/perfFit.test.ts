import { describe, it, expect } from 'vitest';
import { growthExponent, judge } from './perf/fit';

const sizes = [100, 200, 400, 800];
const line = (f: (n: number) => number) => sizes.map(size => ({ size, cost: f(size) }));

describe('growthExponent', () => {
	it('a cost that does not depend on the size has exponent 0', () => {
		expect(growthExponent(line(() => 12))).toBeCloseTo(0, 5);
	});

	it('a cost proportional to the size has exponent 1, whatever the constant', () => {
		expect(growthExponent(line(n => n * 0.07))).toBeCloseTo(1, 5);
		expect(growthExponent(line(n => n * 3))).toBeCloseTo(1, 5);
	});

	it('a cost proportional to the square of the size has exponent 2', () => {
		expect(growthExponent(line(n => n * n / 1000))).toBeCloseTo(2, 5);
	});

	it('a fixed cost plus a growing one sits between: the exponent says how much is the growing part', () => {
		const e = growthExponent(line(n => 200 + n * 0.5));
		expect(e).toBeGreaterThan(0.1);
		expect(e).toBeLessThan(0.6);
	});

	it('does not depend on how fast the machine is', () => {
		const slow = growthExponent(line(n => n * n / 100));
		const fast = growthExponent(line(n => n * n / 1000));
		expect(slow).toBeCloseTo(fast, 8);
	});

	it('reads costs under the noise floor as the floor, so a flat near-zero line is flat', () => {
		expect(growthExponent(line(n => (n === 100 ? 0.01 : 0.2)))).toBeCloseTo(0, 5);
	});

	it('refuses a single size or sizes that are all alike', () => {
		expect(() => growthExponent([{ size: 100, cost: 1 }])).toThrow();
		expect(() => growthExponent([{ size: 100, cost: 1 }, { size: 100, cost: 2 }])).toThrow();
	});
});

describe('judge', () => {
	const limits = { maxExponent: 0.5, budgetMs: 100 };

	it('passes a flat and cheap operation', () => {
		expect(judge(line(() => 4), limits).ok).toBe(true);
	});

	it('flags an operation that grows with the table, even while it is still cheap', () => {
		const v = judge(line(n => n * 0.08), limits);
		expect(v.growing).toBe(true);
		expect(v.overBudget).toBe(false);
		expect(v.ok).toBe(false);
	});

	it('flags an operation that is over budget even though it does not grow', () => {
		const v = judge(line(() => 400), limits);
		expect(v.growing).toBe(false);
		expect(v.overBudget).toBe(true);
	});

	it('does not read a steep slope between tiny costs as growth', () => {
		expect(judge(line(n => (n === 100 ? 0.4 : n === 800 ? 1.6 : 0.8)), limits).growing).toBe(false);
	});

	it('takes the points in any order', () => {
		const pts = [...line(n => n * n / 1000)].reverse();
		expect(judge(pts, limits).exponent).toBeCloseTo(2, 5);
	});
});

describe('judge, with the plugin\'s own work apart from the total', () => {
	const limits = { maxExponent: 1.2, budgetMs: 100 };

	it('does not call a gesture growing when only the browser\'s share does: a larger table takes longer to lay out whatever the plugin does', () => {
		// 3 ms of script at every size; the rest the browser's, which grew faster than the table (as zoom was seen to).
		const v = judge(line(n => 3 + n ** 1.6 / 500), limits, line(() => 3));
		expect(v.growing).toBe(false);
		expect(v.ok).toBe(true);
		// Read as a total, the same figures do outgrow the table.
		expect(judge(line(n => 3 + n ** 1.6 / 500), limits).growing).toBe(true);
	});

	it('calls it growing when the plugin\'s own script grows faster than the table', () => {
		const v = judge(line(n => n * n / 5000), limits, line(n => n * n / 6000));
		expect(v.growing).toBe(true);
	});

	it('lets script grow in step with the table: a selection marks the cells it covers', () => {
		const v = judge(line(n => n * 0.09), limits, line(n => n * 0.04));
		expect(v.growing).toBe(false);
	});

	it('still holds the total to the budget, whatever the script did', () => {
		const v = judge(line(n => n * 0.4), limits, line(() => 3));
		expect(v.growing).toBe(false);
		expect(v.overBudget).toBe(true);
		expect(v.ok).toBe(false);
	});

	it('without a separate figure for the script it judges the total as before', () => {
		expect(judge(line(n => n * n / 5000), limits).growing).toBe(true);
	});
});
