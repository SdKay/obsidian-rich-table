import { describe, it, expect } from 'vitest';
import { choose, tierFrom } from './perf/tier';
import { FEATURES } from './perf/tables';

describe('the scan tiers', () => {
	it('runs the quick tier when none is named', () => {
		expect(tierFrom(undefined)).toBe('quick');
		expect(tierFrom('')).toBe('quick');
	});

	it('refuses a tier it does not know, rather than quietly running another', () => {
		expect(() => tierFrom('thorough')).toThrow(/quick, standard or full/);
	});

	it('quick looks at two sizes once, standard at three sizes three times, full at every feature', () => {
		const quick = choose({}), standard = choose({ PERF_TIER: 'standard' }), full = choose({ PERF_TIER: 'full' });
		expect([quick.sizes, quick.rounds]).toEqual([[200, 800], 1]);
		expect([standard.sizes, standard.rounds]).toEqual([[200, 400, 800], 3]);
		expect(full.gestureTables).toEqual(FEATURES);
		expect(standard.gestureTables).toEqual(['plain', 'all']);
		expect(full.operationTables).toEqual(['plain', 'all']);
		expect(quick.operationTables).toEqual(['plain']);
	});

	it('a variable named explicitly overrides what the tier chose', () => {
		const c = choose({ PERF_TIER: 'full', SIZES: '100,300', ROUNDS: '2', FEATURES: 'merges' });
		expect(c.sizes).toEqual([100, 300]);
		expect(c.rounds).toBe(2);
		expect(c.gestureTables).toEqual(['merges']);
		expect(c.operationTables).toEqual(['merges']);
	});

	it('every tier gives the slope at least two sizes, since one has none', () => {
		for (const tier of ['quick', 'standard', 'full']) expect(choose({ PERF_TIER: tier }).sizes.length).toBeGreaterThanOrEqual(2);
	});
});
