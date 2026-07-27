/**
 * createHandoff: the generic cross-rebuild local-UI-state relay factory that
 * renderEditHandoff.ts, renderHoverHandoff.ts, and the calendar view's
 * displayed-month memory are all built on. Each of those has its own
 * behavioral tests through its own wrapper API (e.g. renderEditHandoff.test.ts);
 * this file tests the shared primitive directly/generically.
 */
import { describe, it, expect, vi } from 'vitest';
import { createHandoff } from '../src/renderStateHandoff';

describe('createHandoff', () => {
	it('registers and takes a value for a cacheKey', () => {
		const h = createHandoff<string>();
		h.register('k1', 'hello');
		expect(h.take('k1')).toBe('hello');
	});

	it('take is consuming — a second take returns undefined', () => {
		const h = createHandoff<number>();
		h.register('k1', 42);
		expect(h.take('k1')).toBe(42);
		expect(h.take('k1')).toBeUndefined();
	});

	it('different cacheKeys are independent', () => {
		const h = createHandoff<string>();
		h.register('a', 'x');
		expect(h.take('b')).toBeUndefined();
		expect(h.take('a')).toBe('x');
	});

	it('a new registration for the same cacheKey replaces the previous one', () => {
		const h = createHandoff<string>();
		h.register('k1', 'first');
		h.register('k1', 'second');
		expect(h.take('k1')).toBe('second');
	});

	it('a guard mismatch on take returns undefined WITHOUT consuming the entry', () => {
		const h = createHandoff<{ id: number }>();
		h.register('k1', { id: 5 });
		expect(h.take('k1', v => v.id === 9)).toBeUndefined();
		expect(h.take('k1', v => v.id === 5)).toEqual({ id: 5 });
	});

	it('clear with a guard only removes a matching entry', () => {
		const h = createHandoff<{ id: number }>();
		h.register('k1', { id: 5 });
		h.clear('k1', v => v.id === 9); // mismatch — must not clear
		expect(h.take('k1')).toEqual({ id: 5 });

		h.register('k1', { id: 5 });
		h.clear('k1', v => v.id === 5); // match — clears
		expect(h.take('k1')).toBeUndefined();
	});

	it('clear with no guard always removes', () => {
		const h = createHandoff<string>();
		h.register('k1', 'x');
		h.clear('k1');
		expect(h.take('k1')).toBeUndefined();
	});

	it('with no maxAgeMs configured, an entry never goes stale', () => {
		vi.useFakeTimers();
		vi.setSystemTime(0);
		const h = createHandoff<string>();
		h.register('k1', 'x');
		vi.setSystemTime(1_000_000);
		expect(h.take('k1')).toBe('x');
		vi.useRealTimers();
	});

	it('with maxAgeMs configured, an entry older than it is treated as absent', () => {
		vi.useFakeTimers();
		vi.setSystemTime(0);
		const h = createHandoff<string>({ maxAgeMs: 5000 });
		h.register('k1', 'x');
		vi.setSystemTime(6000);
		expect(h.take('k1')).toBeUndefined();
		vi.useRealTimers();
	});

	it('with maxAgeMs configured, an entry within the window still resolves', () => {
		vi.useFakeTimers();
		vi.setSystemTime(0);
		const h = createHandoff<string>({ maxAgeMs: 5000 });
		h.register('k1', 'x');
		vi.setSystemTime(4000);
		expect(h.take('k1')).toBe('x');
		vi.useRealTimers();
	});
});
