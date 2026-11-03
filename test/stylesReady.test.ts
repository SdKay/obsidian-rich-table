import { describe, it, expect } from 'vitest';
import { whenStylesReady } from '../src/stylesReady';

// Runs once the plugin's stylesheet styles the element, polling one frame at a time, and gives up after a
// number of frames rather than polling for ever when the stylesheet never comes.
const make = (readyAfter: number | null) => {
	let frame = 0;
	const queue: (() => void)[] = [];
	const opts = {
		isReady: () => readyAfter !== null && frame >= readyAfter,
		nextFrame: (fn: () => void) => { queue.push(fn); },
		maxFrames: 5,
	};
	const tick = () => { frame++; const due = queue.splice(0); for (const fn of due) fn(); };
	return { opts, tick, queue };
};

describe('whenStylesReady', () => {
	it('runs at once when the stylesheet is already there', () => {
		const { opts } = make(0);
		let ran = 0;
		whenStylesReady(() => { ran++; }, opts);
		expect(ran).toBe(1);
	});

	it('waits for the frame in which the stylesheet arrives', () => {
		const { opts, tick } = make(3);
		let ran = 0;
		whenStylesReady(() => { ran++; }, opts);
		tick(); tick();
		expect(ran).toBe(0);
		tick();
		expect(ran).toBe(1);
		tick();
		expect(ran, 'it runs once').toBe(1);
	});

	it('stops polling when the stylesheet never comes', () => {
		const { opts, tick, queue } = make(null);
		let ran = 0;
		whenStylesReady(() => { ran++; }, opts);
		for (let i = 0; i < 20; i++) tick();
		expect(ran).toBe(0);
		expect(queue).toHaveLength(0);
	});
});
