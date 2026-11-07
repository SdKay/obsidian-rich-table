/**
 * Layouts in a browser trace, told apart by who asked for them. The browser lays a page out once per frame when
 * something is dirty; a layout that happens inside a running script was forced by it, because the script read a
 * measurement (a rectangle, an offset) after having written a style. A gesture whose script keeps doing that lays
 * the whole table out again for each read-after-write, where once would have done.
 */
export interface TraceEvent { name: string; ph: string; ts: number; dur?: number; tid: number; pid: number }

/** Trace events that are script running: a function called, a handler dispatched, a frame or timer callback. */
const SCRIPT: ReadonlySet<string> = new Set(['FunctionCall', 'EvaluateScript', 'EventDispatch', 'FireAnimationFrame', 'TimerFire', 'v8.callFunction', 'v8.run']);

export interface LayoutCount {
	layouts: number;
	/** Of those, the layouts that happened inside a script. */
	forced: number;
}

export function countLayouts(events: readonly TraceEvent[]): LayoutCount {
	const timed = events.filter(e => e.ph === 'X' && e.dur !== undefined);
	const scripts = timed.filter(e => SCRIPT.has(e.name));
	const layouts = timed.filter(e => e.name === 'Layout');
	const inside = (e: TraceEvent) => scripts.some(s => s.tid === e.tid && s.pid === e.pid && s.ts <= e.ts && s.ts + s.dur! >= e.ts + e.dur!);
	return { layouts: layouts.length, forced: layouts.filter(inside).length };
}
