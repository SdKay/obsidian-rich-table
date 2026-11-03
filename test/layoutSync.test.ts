import { describe, it, expect } from 'vitest';
import { createLayoutSync } from '../src/layoutSync';

// One place decides what moves when the table's layout changes, and in what order: everything that only
// reads comes first, then what writes without changing the layout, then what can change it, and the
// rebuild of the strip cells last, held back while one is being dragged.
// The layout is taken to change once per call to `run` unless a test says otherwise, and not to change
// because of what the consumers do.
const make = (opts: { signature?: () => string; busy?: () => boolean } = {}) => {
	let calls = 0;
	const log: string[] = [];
	const frames: (() => void)[] = [];
	const sync = createLayoutSync({
		signature: opts.signature ?? (() => `${calls}`),
		isBusy: opts.busy ?? (() => false),
		nextFrame: fn => { frames.push(fn); },
	});
	const run = sync.run;
	sync.run = o => { calls++; run(o); };
	const flushFrame = () => { const due = frames.splice(0); for (const fn of due) { calls++; fn(); } };
	return { log, sync, frames, flushFrame };
};

describe('createLayoutSync', () => {
	it('runs the phases in order whatever order they were registered in', () => {
		const { log, sync } = make();
		sync.register('rebuild', () => log.push('rebuild'));
		sync.register('reflow', () => log.push('reflow'));
		sync.register('place', () => log.push('place'));
		sync.register('measure', () => log.push('measure'));
		sync.run();
		expect(log).toEqual(['measure', 'place', 'reflow', 'rebuild']);
	});

	it('keeps registration order inside a phase', () => {
		const { log, sync } = make();
		sync.register('place', () => log.push('a'));
		sync.register('place', () => log.push('b'));
		sync.run();
		expect(log).toEqual(['a', 'b']);
	});

	it('does nothing when the layout signature has not changed', () => {
		const { log, sync } = make({ signature: () => 'same' });
		sync.register('place', () => log.push('place'));
		sync.run();
		sync.run();
		sync.run();
		expect(log).toEqual(['place']);
	});

	it('repeats the round in the same call when the round changed the layout, until it stops changing', () => {
		let size = 1;
		const { log, sync } = make({ signature: () => String(size) });
		sync.register('place', () => log.push(`place@${size}`));
		sync.register('reflow', () => { log.push('reflow'); size = 2; });
		sync.run();
		// What was placed before the reflow is placed again for the layout the reflow left.
		expect(log).toEqual(['place@1', 'reflow', 'place@2', 'reflow']);
		// The observer's report of that layout does not start another round.
		sync.run();
		expect(log).toHaveLength(4);
	});

	it('stops repeating a layout that never settles', () => {
		let size = 0;
		const { log, sync } = make({ signature: () => String(size) });
		sync.register('reflow', () => { log.push('reflow'); size++; });
		sync.run();
		expect(log).toEqual(['reflow', 'reflow', 'reflow']);
	});

	it('runs again when the signature changes', () => {
		let sig = 'a';
		const { log, sync } = make({ signature: () => sig });
		sync.register('place', () => log.push('place'));
		sync.run();
		sig = 'b';
		sync.run();
		expect(log).toEqual(['place', 'place']);
	});

	it('runs regardless of the signature when forced', () => {
		const { log, sync } = make({ signature: () => 'same' });
		sync.register('place', () => log.push('place'));
		sync.run();
		sync.run({ force: true });
		expect(log).toEqual(['place', 'place']);
	});

	it('holds the rebuild back while busy, and does it once when no longer busy', () => {
		let busy = true;
		let sig = 'a';
		const { log, sync } = make({ signature: () => sig, busy: () => busy });
		sync.register('place', () => log.push('place'));
		sync.register('rebuild', () => log.push('rebuild'));
		sync.run();
		sig = 'b';
		sync.run();
		expect(log, 'the rest still follows the layout while the rebuild waits').toEqual(['place', 'place']);
		busy = false;
		sync.settle();
		expect(log).toEqual(['place', 'place', 'rebuild']);
		sync.settle();
		expect(log, 'nothing is left to catch up on').toEqual(['place', 'place', 'rebuild']);
	});

	it('does not hold anything back when not busy', () => {
		const { log, sync } = make();
		sync.register('place', () => log.push('place'));
		sync.register('rebuild', () => log.push('rebuild'));
		sync.run();
		expect(log).toEqual(['place', 'rebuild']);
	});

	it('stops calling a consumer that was unregistered', () => {
		const { log, sync } = make();
		const off = sync.register('place', () => log.push('a'));
		sync.register('place', () => log.push('b'));
		off();
		sync.run({ force: true });
		expect(log).toEqual(['b']);
	});

	it('does not start a second round from inside a round', () => {
		let size = 1;
		const { log, sync } = make({ signature: () => String(size) });
		sync.register('reflow', () => { log.push('reflow'); size = 2; sync.run(); log.push('reflow end'); });
		sync.run();
		expect(log, 'the observer reporting a write mid-round does not nest another round').toEqual(['reflow', 'reflow end', 'reflow', 'reflow end']);
	});

	it('goes on with the other consumers when one throws', () => {
		const { log, sync } = make();
		sync.register('place', () => { throw new Error('boom'); });
		sync.register('place', () => log.push('after'));
		expect(() => sync.run()).not.toThrow();
		expect(log).toEqual(['after']);
	});

	describe('schedule', () => {
		it('runs once in the next frame however many times it is asked within one', () => {
			const { log, sync, frames, flushFrame } = make();
			sync.register('place', () => log.push('place'));
			sync.schedule();
			sync.schedule();
			sync.schedule();
			expect(log, 'nothing happens before the frame').toEqual([]);
			expect(frames).toHaveLength(1);
			flushFrame();
			expect(log).toEqual(['place']);
		});

		it('runs the frame it was asked for even if the layout looks the same', () => {
			const { log, sync, flushFrame } = make({ signature: () => 'same' });
			sync.register('place', () => log.push('place'));
			sync.run();
			sync.schedule();
			flushFrame();
			expect(log).toEqual(['place', 'place']);
		});

		it('can be asked again once the frame has run', () => {
			const { log, sync, frames, flushFrame } = make();
			sync.register('place', () => log.push('place'));
			sync.schedule();
			flushFrame();
			sync.schedule();
			expect(frames).toHaveLength(1);
			flushFrame();
			expect(log).toEqual(['place', 'place']);
		});
	});
});
