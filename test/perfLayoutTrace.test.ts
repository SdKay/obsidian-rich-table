import { describe, it, expect } from 'vitest';
import { countLayouts, type TraceEvent } from './perf/layoutTrace';

const ev = (name: string, ts: number, dur: number, tid = 1, pid = 1): TraceEvent => ({ name, ph: 'X', ts, dur, tid, pid });

describe('countLayouts', () => {
	it('counts a layout inside a running script as forced, and one in the frame after it as not', () => {
		const r = countLayouts([ev('FunctionCall', 0, 100), ev('Layout', 40, 20), ev('Layout', 200, 20)]);
		expect(r).toEqual({ layouts: 2, forced: 1 });
	});

	it('counts every layout a script forces, one per read after a write', () => {
		const r = countLayouts([ev('EventDispatch', 0, 500), ev('Layout', 10, 5), ev('Layout', 100, 5), ev('Layout', 300, 5)]);
		expect(r).toEqual({ layouts: 3, forced: 3 });
	});

	it('does not count a layout that starts inside a script but ends after it', () => {
		expect(countLayouts([ev('FunctionCall', 0, 100), ev('Layout', 90, 30)])).toEqual({ layouts: 1, forced: 0 });
	});

	it('does not count a script on another thread or process as the cause', () => {
		expect(countLayouts([ev('FunctionCall', 0, 100, 2), ev('Layout', 10, 5, 1)]).forced).toBe(0);
		expect(countLayouts([ev('FunctionCall', 0, 100, 1, 2), ev('Layout', 10, 5, 1, 1)]).forced).toBe(0);
	});

	it('reads a frame callback and a timer as script too', () => {
		expect(countLayouts([ev('FireAnimationFrame', 0, 50), ev('Layout', 5, 5)]).forced).toBe(1);
		expect(countLayouts([ev('TimerFire', 0, 50), ev('Layout', 5, 5)]).forced).toBe(1);
	});

	it('ignores events that are not complete (no duration) and events that are not layouts', () => {
		const begin: TraceEvent = { name: 'Layout', ph: 'B', ts: 5, tid: 1, pid: 1 };
		expect(countLayouts([ev('FunctionCall', 0, 100), begin, ev('UpdateLayoutTree', 10, 5)])).toEqual({ layouts: 0, forced: 0 });
	});

	it('finds none in an empty trace', () => {
		expect(countLayouts([])).toEqual({ layouts: 0, forced: 0 });
	});
});
