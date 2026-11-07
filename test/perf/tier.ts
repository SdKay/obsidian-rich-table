/**
 * How much of the scan a run covers. Set with PERF_TIER; a variable named below still overrides what the tier chose.
 * `quick` is a screen, not a verdict: two sizes give a slope but not a bend, and one round cannot tell a slow operation
 * from a moment the machine was busy (the same operation read three times its usual cost in one run and not in the
 * next). A line it flags is confirmed with `standard`, which takes the median of three rounds, before it is acted on.
 */
import type { Feature } from './tables';
import { FEATURES } from './tables';

export type Tier = 'quick' | 'standard' | 'full';

interface Plan {
	sizes: number[];
	rounds: number;
	/** Tables the gestures are tried on. */
	gestureTables: readonly Feature[];
	/** Tables an operation that acts on any table is tried on. */
	operationTables: readonly Feature[];
}

const PLANS: Record<Tier, Plan> = {
	quick: { sizes: [200, 800], rounds: 1, gestureTables: ['plain', 'all'], operationTables: ['plain'] },
	standard: { sizes: [200, 400, 800], rounds: 3, gestureTables: ['plain', 'all'], operationTables: ['plain'] },
	full: { sizes: [200, 400, 800], rounds: 3, gestureTables: FEATURES, operationTables: ['plain', 'all'] },
};

export function tierFrom(name: string | undefined): Tier {
	if (name === undefined || name === '') return 'quick';
	if (name === 'quick' || name === 'standard' || name === 'full') return name;
	throw new Error(`PERF_TIER is "${name}"; it must be quick, standard or full`);
}

export interface Chosen {
	tier: Tier;
	sizes: number[];
	rounds: number;
	gestureTables: readonly Feature[];
	operationTables: readonly Feature[];
}

export function choose(env: Record<string, string | undefined>): Chosen {
	const tier = tierFrom(env.PERF_TIER);
	const plan = PLANS[tier];
	const list = <T extends string>(v: string | undefined): T[] | undefined => (v ? (v.split(',') as T[]) : undefined);
	return {
		tier,
		sizes: list<string>(env.SIZES)?.map(Number) ?? plan.sizes,
		rounds: env.ROUNDS ? Number(env.ROUNDS) : plan.rounds,
		gestureTables: list<Feature>(env.FEATURES) ?? plan.gestureTables,
		operationTables: list<Feature>(env.FEATURES) ?? plan.operationTables,
	};
}

export const chosen = choose(process.env);
