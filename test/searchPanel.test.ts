import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SearchPanelFollower, PANEL_DEBOUNCE_MS } from '../src/searchPanel';
import type { MatchOptions, OpenedHit, RichSearchHostApi } from '../src/richSearchApi';

function fakeHost(over: Partial<RichSearchHostApi> = {}) {
	let current: MatchOptions | null = null;
	let opened: OpenedHit | null = null;
	const listeners = new Set<(q: MatchOptions | null) => void>();
	const hitListeners = new Set<(h: OpenedHit | null) => void>();
	const host: RichSearchHostApi = {
		apiVersion: 1,
		matchLine: () => [],
		currentQuery: () => current,
		onQueryChange: (fn) => { listeners.add(fn); return () => { listeners.delete(fn); }; },
		currentHit: () => opened,
		onHitChange: (fn) => { hitListeners.add(fn); return () => { hitListeners.delete(fn); }; },
		...over,
	};
	return {
		host, listeners, hitListeners,
		type: (q: MatchOptions | null) => { current = q; for (const fn of [...listeners]) fn(q); },
		open: (h: OpenedHit | null) => { opened = h; for (const fn of [...hitListeners]) fn(h); },
	};
}

describe('SearchPanelFollower', () => {
	beforeEach(() => {
		vi.useFakeTimers();
		vi.stubGlobal('window', { setTimeout: globalThis.setTimeout, clearTimeout: globalThis.clearTimeout });
	});
	afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

	it('reports the query on screen, and none when the panel is closed', () => {
		const h = fakeHost();
		const f = new SearchPanelFollower(() => h.host);
		expect(f.state()).toEqual({ kind: 'none' });
		h.type({ query: 'apple', wholeWord: true });
		expect(f.state()).toEqual({ kind: 'query', query: { query: 'apple', wholeWord: true } });
		h.type(null);
		expect(f.state()).toEqual({ kind: 'none' });
	});

	it('treats an empty query as no query', () => {
		const h = fakeHost();
		const f = new SearchPanelFollower(() => h.host);
		h.type({ query: '' });
		expect(f.state()).toEqual({ kind: 'none' });
	});

	it('says none without a Rich Search or with an apiVersion it does not know', () => {
		expect(new SearchPanelFollower(() => undefined).state()).toEqual({ kind: 'none' });
		const future = fakeHost({ apiVersion: 2 as never });
		future.type({ query: 'x' });
		expect(new SearchPanelFollower(() => future.host).state()).toEqual({ kind: 'none' });
		expect(new SearchPanelFollower(() => future.host).host()).toBeNull();
	});

	it('says unknown for a Rich Search that predates currentQuery, which cannot say when a search ends', () => {
		const old = fakeHost({ currentQuery: undefined, onQueryChange: undefined });
		const f = new SearchPanelFollower(() => old.host);
		expect(f.state()).toEqual({ kind: 'unknown' });
		expect(f.host()).toBe(old.host);
	});

	it('a host whose currentQuery throws means none', () => {
		const h = fakeHost({ currentQuery: () => { throw new Error('boom'); } });
		expect(new SearchPanelFollower(() => h.host).state()).toEqual({ kind: 'none' });
	});

	it('tells a follower once typing pauses, not on every key', () => {
		const h = fakeHost();
		const f = new SearchPanelFollower(() => h.host);
		const seen = vi.fn();
		f.follow(seen);
		h.type({ query: 'a' });
		vi.advanceTimersByTime(PANEL_DEBOUNCE_MS - 10);
		h.type({ query: 'ap' });
		vi.advanceTimersByTime(PANEL_DEBOUNCE_MS - 10);
		h.type({ query: 'app' });
		expect(seen).not.toHaveBeenCalled();
		vi.advanceTimersByTime(PANEL_DEBOUNCE_MS);
		expect(seen).toHaveBeenCalledTimes(1);
	});

	it('listens to the host once however many follow, and tells them all', () => {
		const h = fakeHost();
		const f = new SearchPanelFollower(() => h.host);
		const a = vi.fn(), b = vi.fn(), c = vi.fn();
		f.follow(a); f.follow(b); f.follow(c);
		expect(h.listeners.size).toBe(1);
		h.type({ query: 'x' });
		vi.advanceTimersByTime(PANEL_DEBOUNCE_MS);
		expect([a, b, c].map(fn => fn.mock.calls.length)).toEqual([1, 1, 1]);
	});

	it('a follower that stops is not told, and the host is left when the last one stops', () => {
		const h = fakeHost();
		const f = new SearchPanelFollower(() => h.host);
		const a = vi.fn(), b = vi.fn();
		const stopA = f.follow(a);
		const stopB = f.follow(b);
		stopA();
		expect(h.listeners.size).toBe(1);
		h.type({ query: 'x' });
		vi.advanceTimersByTime(PANEL_DEBOUNCE_MS);
		expect(a).not.toHaveBeenCalled();
		expect(b).toHaveBeenCalledTimes(1);
		stopB();
		expect(h.listeners.size).toBe(0);
	});

	it('stopping the last follower cancels a notification still waiting', () => {
		const h = fakeHost();
		const f = new SearchPanelFollower(() => h.host);
		const seen = vi.fn();
		const stop = f.follow(seen);
		h.type({ query: 'x' });
		expect(vi.getTimerCount()).toBe(1);
		stop();
		expect(vi.getTimerCount()).toBe(0);
		vi.advanceTimersByTime(PANEL_DEBOUNCE_MS * 2);
		expect(seen).not.toHaveBeenCalled();
	});

	it('picks up a Rich Search enabled after the first follower, once asked to look again', () => {
		const h = fakeHost();
		let present = false;
		const f = new SearchPanelFollower(() => (present ? h.host : undefined));
		const seen = vi.fn();
		f.follow(seen);
		expect(h.listeners.size).toBe(0);
		present = true;
		f.connect();
		expect(h.listeners.size).toBe(1);
		h.type({ query: 'x' });
		vi.advanceTimersByTime(PANEL_DEBOUNCE_MS);
		expect(seen).toHaveBeenCalledTimes(1);
	});

	it('moves to a replaced host and lets go of the old one', () => {
		const first = fakeHost();
		const second = fakeHost();
		let which = first;
		const f = new SearchPanelFollower(() => which.host);
		f.follow(() => undefined);
		which = second;
		f.connect();
		expect(first.listeners.size).toBe(0);
		expect(second.listeners.size).toBe(1);
	});

	it('asking again while the host is unchanged does not subscribe again', () => {
		let subscriptions = 0;
		const h = fakeHost();
		const counted: RichSearchHostApi = { ...h.host, onQueryChange: (fn) => { subscriptions++; return h.host.onQueryChange!(fn); } };
		const f = new SearchPanelFollower(() => counted);
		f.follow(() => undefined);
		f.connect(); f.connect();
		expect(subscriptions).toBe(1);
		expect(h.listeners.size).toBe(1);
	});

	it('does nothing when the host refuses to subscribe', () => {
		const h = fakeHost({ onQueryChange: () => { throw new Error('no'); } });
		const f = new SearchPanelFollower(() => h.host);
		expect(() => f.follow(() => undefined)).not.toThrow();
	});

	it('does not subscribe before anyone follows', () => {
		const h = fakeHost();
		const f = new SearchPanelFollower(() => h.host);
		f.connect();
		expect(h.listeners.size).toBe(0);
	});

	describe('the opened match', () => {
		const hit: OpenedHit = { path: 'a.md', line: 7, index: 0, block: { fromLine: 7, anchor: { kind: 'title' } } };

		it('reports the match the user opened, and none once it is cleared', () => {
			const h = fakeHost();
			const f = new SearchPanelFollower(() => h.host);
			expect(f.hit()).toBeNull();
			h.open(hit);
			expect(f.hit()).toEqual(hit);
			h.open(null);
			expect(f.hit()).toBeNull();
		});

		it('has none without a Rich Search, with an unknown apiVersion, or one that predates currentHit', () => {
			expect(new SearchPanelFollower(() => undefined).hit()).toBeNull();
			const future = fakeHost({ apiVersion: 2 as never });
			future.open(hit);
			expect(new SearchPanelFollower(() => future.host).hit()).toBeNull();
			const old = fakeHost({ currentHit: undefined, onHitChange: undefined });
			expect(new SearchPanelFollower(() => old.host).hit()).toBeNull();
		});

		it('a host whose currentHit throws means none', () => {
			const h = fakeHost({ currentHit: () => { throw new Error('boom'); } });
			expect(new SearchPanelFollower(() => h.host).hit()).toBeNull();
		});

		it('tells followers a change of the opened match at once, saying it was only the match', () => {
			const h = fakeHost();
			const f = new SearchPanelFollower(() => h.host);
			const seen: string[] = [];
			f.follow(c => seen.push(c));
			h.open(hit);
			expect(seen).toEqual(['hit']);
		});

		it('tells a change of the search after typing pauses, saying it was the search', () => {
			const h = fakeHost();
			const f = new SearchPanelFollower(() => h.host);
			const seen: string[] = [];
			f.follow(c => seen.push(c));
			h.type({ query: 'x' });
			expect(seen).toEqual([]);
			vi.advanceTimersByTime(PANEL_DEBOUNCE_MS);
			expect(seen).toEqual(['query']);
		});

		it('does not hold a change of the opened match back for a search still being typed', () => {
			const h = fakeHost();
			const f = new SearchPanelFollower(() => h.host);
			const seen: string[] = [];
			f.follow(c => seen.push(c));
			h.type({ query: 'x' });
			h.open(hit);
			expect(seen).toEqual(['hit']);
			vi.advanceTimersByTime(PANEL_DEBOUNCE_MS);
			expect(seen).toEqual(['hit', 'query']);
		});

		it('listens once for the search and once for the opened match however many follow, and stops both', () => {
			const h = fakeHost();
			const f = new SearchPanelFollower(() => h.host);
			const stops = [f.follow(() => undefined), f.follow(() => undefined), f.follow(() => undefined)];
			expect(h.listeners.size).toBe(1);
			expect(h.hitListeners.size).toBe(1);
			stops.forEach(stop => stop());
			expect(h.listeners.size).toBe(0);
			expect(h.hitListeners.size).toBe(0);
		});

		it('follows the search alone on a Rich Search that predates the opened match', () => {
			const h = fakeHost({ currentHit: undefined, onHitChange: undefined });
			const f = new SearchPanelFollower(() => h.host);
			const seen: string[] = [];
			f.follow(c => seen.push(c));
			expect(h.listeners.size).toBe(1);
			h.type({ query: 'x' });
			vi.advanceTimersByTime(PANEL_DEBOUNCE_MS);
			expect(seen).toEqual(['query']);
		});

		it('leaves nothing subscribed when the second subscription fails', () => {
			const h = fakeHost({ onHitChange: () => { throw new Error('no'); } });
			const f = new SearchPanelFollower(() => h.host);
			expect(() => f.follow(() => undefined)).not.toThrow();
			expect(h.listeners.size).toBe(0);
		});

		it('stops each subscription exactly once, however often the host is looked at again', () => {
			const stopped: string[] = [];
			const counted = (name: string): Partial<RichSearchHostApi> => ({
				onQueryChange: () => () => { stopped.push(`${name}-query`); },
				onHitChange: () => () => { stopped.push(`${name}-hit`); },
			});
			const first = fakeHost(counted('first'));
			const second = fakeHost(counted('second'));
			let which = first;
			const f = new SearchPanelFollower(() => which.host);
			const stop = f.follow(() => undefined);
			which = second;
			f.connect(); f.connect();
			stop();
			expect(stopped.sort()).toEqual(['first-hit', 'first-query', 'second-hit', 'second-query']);
		});

		it('moves both subscriptions to a replaced host', () => {
			const first = fakeHost();
			const second = fakeHost();
			let which = first;
			const f = new SearchPanelFollower(() => which.host);
			f.follow(() => undefined);
			which = second;
			f.connect();
			expect([first.listeners.size, first.hitListeners.size, second.listeners.size, second.hitListeners.size]).toEqual([0, 0, 1, 1]);
		});
	});
});
