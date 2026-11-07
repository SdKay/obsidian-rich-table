import { describe, it, expect } from 'vitest';
import { COVERAGE } from './perf/coverage';
import { OPS, MIN_ROWS, MAX_REPS, FLIPS } from './perf/ops';
import { STATEFUL } from './perf/stateful';
import { GESTURE_IDS } from './perf/gestures';
import { tableSource } from './perf/tables';
import { parseSource } from '../src/parser';
import { applyOp } from '../src/core';
import type { TableOp } from '../src/tableEdits';

const rebuildOps = Object.entries(COVERAGE).filter(([, v]) => typeof v === 'string' && v.startsWith('rebuild:')).map(([k]) => k);
const gestureOps = Object.entries(COVERAGE).filter(([, v]) => typeof v === 'string' && !v.startsWith('rebuild:')) as [string, string][];

describe('the operations a performance scan repeats', () => {
	it('every operation measured by rebuilding the table has a generator, plain or needing a state', () => {
		const missing = rebuildOps.filter(op => !(op in OPS) && !(op in STATEFUL));
		expect(missing).toEqual([]);
	});

	it('names no operation twice, once as ready to generate and once as needing a state', () => {
		expect(Object.keys(OPS).filter(op => op in STATEFUL)).toEqual([]);
	});

	it('every gesture named for an operation is one the interaction scan runs', () => {
		expect(gestureOps.filter(([, id]) => !(GESTURE_IDS as readonly string[]).includes(id)).map(([op]) => op)).toEqual([]);
	});

	it('every repetition of every generated operation is valid, different from the others, and changes the table', () => {
		const rows = MIN_ROWS;
		for (const [type, make] of Object.entries(OPS)) {
			const doc = parseSource(tableSource(rows, 'plain'));
			let previous = '';
			let last = JSON.stringify(doc);
			for (let i = 0; i < MAX_REPS + 1; i++) {
				const op = make!(i, rows) as TableOp;
				expect(op.type, type).toBe(type);
				const key = JSON.stringify(op);
				// Two in a row alike change the note only for a flip, which changes what it finds.
				if (!FLIPS.has(type)) expect(key === previous, `${type} repeated itself at ${i}`).toBe(false);
				previous = key;
				applyOp(doc as never, op as never);
				const now = JSON.stringify(doc);
				expect(now !== last, `${type} changed nothing at repetition ${i}`).toBe(true);
				last = now;
			}
		}
	});

	it('every repetition changes the table whatever feature it has on, since the scan runs them on the combined one too', () => {
		for (const feature of ['plain', 'all'] as const) for (const [type, make] of Object.entries(OPS)) {
			const doc = parseSource(tableSource(MIN_ROWS, feature));
			let last = JSON.stringify(doc);
			for (let i = 0; i < MAX_REPS + 1; i++) {
				applyOp(doc as never, make!(i, MIN_ROWS) as never);
				const now = JSON.stringify(doc);
				expect(now !== last, `${type} changed nothing at repetition ${i} on the ${feature} table`).toBe(true);
				last = now;
			}
		}
	});

	it('a table of the smallest size has the rows every operation reaches for', () => {
		for (const make of Object.values(OPS)) {
			for (let i = 0; i < MAX_REPS + 1; i++) {
				const op = make!(i, MIN_ROWS) as unknown as Record<string, unknown>;
				const ids = JSON.stringify(op).match(/r_\d+/g) ?? [];
				for (const id of ids) expect(Number(id.slice(2)), JSON.stringify(op)).toBeLessThan(MIN_ROWS);
			}
		}
	});
});

describe('the tables the stateful operations are measured on', () => {
	const rows = MIN_ROWS;

	it('every one is a table the reducer takes its operations on, each repetition changing it', () => {
		for (const [type, s] of Object.entries(STATEFUL)) {
			const doc = parseSource(s!.source(rows));
			let last = JSON.stringify(doc);
			for (let i = 0; i < MAX_REPS + 1; i++) {
				applyOp(doc as never, s!.op(i, rows) as never);
				const now = JSON.stringify(doc);
				expect(now !== last, `${type} changed nothing at repetition ${i}`).toBe(true);
				last = now;
			}
		}
	});

	it('the column kinds a source asks for are in it: hidden, choice and date columns', () => {
		const text = tableSource(20, 'plain', { hidden: [6, 7], choice: [8], date: [9] });
		const doc = parseSource(text) as { columns: { id: string; hidden?: boolean; type?: string }[] };
		const col = (id: string) => doc.columns.find(c => c.id === id)!;
		expect(col('c_6').hidden).toBe(true);
		expect(col('c_7').hidden).toBe(true);
		expect(col('c_5').hidden).toBeUndefined();
		expect(col('c_8').type).toBe('task-status');
		expect(col('c_9').type).toBe('date');
	});
});

describe('the combined table keeps every feature it claims', () => {
	it('freezes the rows and the columns it asks for, after the model has been tidied as any operation tidies it', () => {
		for (const feature of ['freeze', 'all'] as const) {
			const doc = parseSource(tableSource(MIN_ROWS, feature)) as { freezeRows?: number; freezeCols?: number };
			// Any operation ends by dropping a freeze that would cut through a merge; one that changes nothing else shows it.
			applyOp(doc as never, { type: 'set-title', title: 'x' } as never);
			expect(doc.freezeRows, `${feature}: frozen rows`).toBe(2);
			expect(doc.freezeCols, `${feature}: frozen columns`).toBe(2);
		}
	});

	it('has merges in it as well', () => {
		const doc = parseSource(tableSource(MIN_ROWS, 'all')) as { merges: unknown[] };
		expect(doc.merges.length).toBeGreaterThan(5);
	});
});
