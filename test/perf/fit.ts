/**
 * How a cost grows with the size of the table. An operation whose cost follows what changed stays flat as the table
 * grows; one that follows the size of the table rises with it. The exponent of the power law that fits the points
 * (the slope on log-log axes) says which, without depending on how fast the machine is: 0 is flat, 1 is linear in the
 * size, 2 is quadratic.
 */
export interface Point { size: number; cost: number }

/** Costs below this many milliseconds are noise; a cost is never read as smaller, so a flat near-zero line fits as flat. */
const FLOOR_MS = 0.5;

/** Least-squares slope of log(cost) on log(size). Needs two sizes at least. */
export function growthExponent(points: readonly Point[]): number {
	if (points.length < 2) throw new Error('growth needs at least two sizes');
	const xs = points.map(p => Math.log(p.size));
	const ys = points.map(p => Math.log(Math.max(p.cost, FLOOR_MS)));
	const mx = xs.reduce((a, b) => a + b, 0) / xs.length;
	const my = ys.reduce((a, b) => a + b, 0) / ys.length;
	const num = xs.reduce((s, x, i) => s + (x - mx) * (ys[i]! - my), 0);
	const den = xs.reduce((s, x) => s + (x - mx) ** 2, 0);
	if (den === 0) throw new Error('growth needs different sizes');
	return num / den;
}

export interface Verdict {
	exponent: number;
	/** The cost at the largest size, in milliseconds. */
	atLargest: number;
	/** Grows with the table beyond what drawing its cells accounts for. */
	growing: boolean;
	/** Costs more than the budget at the largest size, whatever its growth. */
	overBudget: boolean;
	ok: boolean;
}

export interface Limits {
	/** The largest exponent still read as not growing with the table. */
	maxExponent: number;
	/** The most a single operation may cost at the largest size, in milliseconds. */
	budgetMs: number;
	/** The most layouts a script may force per step of a gesture, when they are counted. */
	maxForced?: number;
}

/**
 * A line that is small everywhere may have a steep slope that means nothing (0.6 ms to 1.4 ms), so a cost under the
 * floor at the largest size does not count as growing however it got there.
 */
export function judge(points: readonly Point[], limits: Limits, work?: readonly Point[]): Verdict {
	const sorted = [...points].sort((a, b) => a.size - b.size);
	// Growth is read from the work the plugin's own code does when that is given apart from the total: the browser's
	// style and layout of a larger table grow with it whatever the plugin does, and are not the plugin's to fix.
	const grown = work && work.length >= 2 ? [...work].sort((a, b) => a.size - b.size) : sorted;
	const exponent = growthExponent(grown);
	const atLargest = sorted[sorted.length - 1]!.cost;
	const growing = grown[grown.length - 1]!.cost > FLOOR_MS * 4 && exponent > limits.maxExponent;
	const overBudget = atLargest > limits.budgetMs;
	return { exponent, atLargest, growing, overBudget, ok: !growing && !overBudget };
}
