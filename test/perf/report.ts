/**
 * The scan's results gathered and laid out as a table: one line per interaction and feature, the cost at each size,
 * and the verdict. Pure, so what counts as a finding is tested rather than eyeballed.
 */
import { judge, type Limits, type Point, type Verdict } from './fit';

export interface Result {
	scenario: string;
	feature: string;
	size: number;
	/** Milliseconds; absent when the scenario could not run, with the reason. */
	ms?: number;
	/** Milliseconds of script among them, when the scenario tells script from the browser's own style and layout. */
	script?: number;
	/** Layouts per repetition and how many of them the script forced, for a gesture. */
	layouts?: number;
	forced?: number;
	broken?: string;
	/** The interaction does not exist for this feature (a board has no column to resize); not a fault. */
	skipped?: string;
}

export interface Line {
	scenario: string;
	feature: string;
	points: Point[];
	verdict?: Verdict;
	/** Layouts per repetition the script forced, at the largest size, when the scenario counts them. */
	forced?: number;
	/** Whether that is more than the limit allows. */
	forcesLayouts?: boolean;
	/** Why there is no verdict: too few sizes ran. */
	broken?: string;
	skipped?: string;
}

export function group(results: readonly Result[], limits: (scenario: string) => Limits): Line[] {
	const by = new Map<string, Result[]>();
	for (const r of results) {
		const k = `${r.scenario}\u0000${r.feature}`;
		by.set(k, [...(by.get(k) ?? []), r]);
	}
	const lines: Line[] = [];
	for (const rs of by.values()) {
		const skipped = rs.find(r => r.skipped);
		if (skipped) { lines.push({ scenario: skipped.scenario, feature: skipped.feature, points: [], skipped: skipped.skipped }); continue; }
		const ok = rs.filter(r => r.ms !== undefined);
		// Several runs of one size are one point, their median: a single run can be hit by a collection or a background task.
		const sizes = [...new Set(ok.map(r => r.size))];
		const med = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]!;
		const line: Line = { scenario: rs[0]!.scenario, feature: rs[0]!.feature, points: sizes.map(size => ({ size, cost: med(ok.filter(r => r.size === size).map(r => r.ms!)) })) };
		const scripted = ok.filter(r => r.script !== undefined);
		const work = scripted.length === ok.length ? sizes.map(size => ({ size, cost: med(ok.filter(r => r.size === size).map(r => r.script!)) })) : undefined;
		const counted = ok.filter(r => r.forced !== undefined);
		if (counted.length > 0 && counted.length === ok.length) {
			const largest = Math.max(...sizes);
			line.forced = med(counted.filter(r => r.size === largest).map(r => r.forced!));
			const cap = limits(line.scenario).maxForced;
			line.forcesLayouts = cap !== undefined && line.forced > cap;
		}
		const bad = rs.find(r => r.broken);
		if (line.points.length >= 2) line.verdict = judge(line.points, limits(line.scenario), work);
		else line.broken = bad?.broken ?? 'fewer than two sizes ran';
		lines.push(line);
	}
	return lines.sort((a, b) => a.scenario.localeCompare(b.scenario) || a.feature.localeCompare(b.feature));
}

const f = (n: number) => n >= 100 ? n.toFixed(0) : n.toFixed(1);

export function render(lines: readonly Line[], sizes: readonly number[]): string {
	const head = ['scenario', 'feature', ...sizes.map(s => `${s} rows`), 'exponent', 'forced', 'verdict'];
	const rows = lines.map(l => {
		const cells = sizes.map(s => { const p = l.points.find(q => q.size === s); return p ? f(p.cost) : '-'; });
		const v = l.verdict;
		const verdict = l.skipped ? `n/a: ${l.skipped}` : l.broken ? `BROKEN: ${l.broken}`
			: [!v!.growing ? '' : 'GROWS', !v!.overBudget ? '' : 'SLOW', !l.forcesLayouts ? '' : 'FORCES'].filter(Boolean).join('+') || 'ok';
		return [l.scenario, l.feature, ...cells, v ? v.exponent.toFixed(2) : '-', l.forced !== undefined ? l.forced.toFixed(1) : '-', verdict];
	});
	const widths = head.map((h, i) => Math.max(h.length, ...rows.map(r => r[i]!.length)));
	const line = (r: string[]) => r.map((c, i) => c.padEnd(widths[i]!)).join('  ');
	return [line(head), line(widths.map(w => '-'.repeat(w))), ...rows.map(line)].join('\n');
}

/** What fails the run: a line that grows or is over budget. A broken line does too, since it measured nothing. */
export function findings(lines: readonly Line[]): Line[] {
	return lines.filter(l => !l.skipped && (l.broken !== undefined || l.forcesLayouts === true || (l.verdict !== undefined && !l.verdict.ok)));
}
