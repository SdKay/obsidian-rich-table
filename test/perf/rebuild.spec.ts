import fs from 'node:fs';
import { test } from '../e2e/common/test-base';
import { tableSource, evidenceFor, type Feature } from './tables';
import { chosen } from './tier';
import { rebuildDelay, median, ScenarioBroken } from './measure';
import { OPS, MAX_REPS } from './ops';
import { STATEFUL } from './stateful';
import type { Result } from './report';

// What the user waits for after an edit: the operation is written to the note and the table is drawn again from it.
// Each operation is run on tables of several sizes (and, for those that act on any table, with a feature on), to see
// which make the wait grow with the table. OP names one operation, a list, or `all`.
const SIZES = chosen.sizes;
const OUT = process.env.PERF_OUT ?? 'test-results/perf-rebuild.jsonl';
const ROUNDS = chosen.rounds;

const REQUESTED = process.env.OP ?? 'all';
// Every operation there is a generator for; those a gesture ends with (a drag, a slider) are rebuilt too, since the
// write-back that follows the release is a rebuild of its own.
const OP_LIST = REQUESTED === 'all' ? [...Object.keys(OPS), ...Object.keys(STATEFUL)] : REQUESTED.split(',');
// An operation that acts on any table is run with these features on: the plain table, and every feature at once.
const FEATURE_LIST = chosen.operationTables;

/**
 * A board view has no columns or rows to size: the edit this scan makes has nowhere to be made, and waiting for a
 * write that cannot come is what made a run hang. Skipped, and said so, rather than tried.
 */
const NOT_APPLICABLE: Partial<Record<Feature, string>> = {
	kanban: 'a board view has no column to resize',
	calendar: 'a calendar view has no column to resize',
};

interface Case { op: string; feature: string; source: (size: number) => string; evidence: string[]; whatFor: string[]; skip?: string }

function casesFor(op: string): Case[] {
	const state = STATEFUL[op as keyof typeof STATEFUL];
	if (state) {
		return [{ op, feature: 'state', source: state.source, evidence: (state.evidence ?? []).map(e => e.check), whatFor: (state.evidence ?? []).map(e => e.what) }];
	}
	return FEATURE_LIST.map(feature => ({
		op, feature, source: (size: number) => tableSource(size, feature),
		evidence: evidenceFor(feature).map(e => e.check), whatFor: evidenceFor(feature).map(e => e.what),
		skip: feature === 'kanban' || feature === 'calendar' ? NOT_APPLICABLE[feature] : undefined,
	}));
}

// Each case is run in rounds, one after the other over every case, so a round that meets a collection or a
// background task does not sit on one operation.
for (let round = 1; round <= ROUNDS; round++) for (const op of OP_LIST) for (const c of casesFor(op)) {
	for (const size of SIZES) {
		test(`rebuild after ${op}: ${c.feature}, ${size} rows (round ${round})`, async ({ page, renderBlock }) => {
			await page.setViewportSize({ width: 1200, height: 800 });
			const result: Result = { scenario: `rebuild:${op}`, feature: c.feature, size };
			const write = () => { fs.mkdirSync('test-results', { recursive: true }); fs.appendFileSync(OUT, JSON.stringify(result) + '\n'); };
			if (c.skip) { result.skipped = c.skip; write(); return; }
			try {
				// A small table first, written and rebuilt once and thrown away: the first rebuild of a page pays for fonts,
				// styles and JIT, and whichever case ran first in the run would carry that.
				await renderBlock(tableSource(40, 'plain'));
				await page.waitForTimeout(200);
				await rebuildDelay(page, [{ type: 'set-col-width', colId: 'c_3', width: 101 }, { type: 'set-col-width', colId: 'c_3', width: 102 }]);
				await renderBlock(c.source(size));
				await page.waitForTimeout(500);
				// The state and the feature must be there, or this measures a plain table under another name.
				for (let i = 0; i < c.evidence.length; i++) {
					if (!(await page.evaluate(c.evidence[i]!))) throw new ScenarioBroken(`the feature did not take effect: ${c.whatFor[i]}`);
				}
				const make = STATEFUL[op as keyof typeof STATEFUL]?.op ?? OPS[op as keyof typeof OPS];
				if (!make) throw new ScenarioBroken(`no generator for ${op}`);
				const ops = Array.from({ length: MAX_REPS + 1 }, (_, i) => make(i, size));
				result.ms = median(await rebuildDelay(page, ops));
			} catch (e) {
				if (!(e instanceof ScenarioBroken) && !/never (written|drawn)/.test((e as Error).message)) throw e;
				result.broken = (e as Error).message;
			}
			write();
		});
	}
}
