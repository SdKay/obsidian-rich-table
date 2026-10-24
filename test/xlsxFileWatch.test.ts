import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { watchXlsxFile, XLSX_REFRESH_DELAY_MS } from '../src/xlsxFileWatch';

type Handler = (...args: never[]) => void;

function fakeVault() {
	const handlers = new Map<string, Set<Handler>>();
	return {
		on(name: string, cb: Handler) {
			if (!handlers.has(name)) handlers.set(name, new Set());
			handlers.get(name)!.add(cb);
			return { name, cb };
		},
		offref(ref: { name: string; cb: Handler }) { handlers.get(ref.name)?.delete(ref.cb); },
		emit(name: string, ...args: unknown[]) { for (const cb of [...(handlers.get(name) ?? [])]) (cb as (...a: unknown[]) => void)(...args); },
		count: () => [...handlers.values()].reduce((n, s) => n + s.size, 0),
	};
}

const file = (path: string) => ({ path });

describe('watchXlsxFile', () => {
	beforeEach(() => {
		vi.useFakeTimers();
		vi.stubGlobal('window', { setTimeout: globalThis.setTimeout, clearTimeout: globalThis.clearTimeout });
	});
	afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

	const start = () => {
		const vault = fakeVault();
		const onRefresh = vi.fn();
		const onRenamed = vi.fn();
		const watch = watchXlsxFile(vault as never, 'data/a.xlsx', { onRefresh, onRenamed });
		return { vault, onRefresh, onRenamed, watch };
	};

	it('refreshes once after the delay when the file is modified', () => {
		const { vault, onRefresh } = start();
		vault.emit('modify', file('data/a.xlsx'));
		expect(onRefresh).not.toHaveBeenCalled();
		vi.advanceTimersByTime(XLSX_REFRESH_DELAY_MS);
		expect(onRefresh).toHaveBeenCalledTimes(1);
	});

	it('collapses a burst of modifies into one refresh', () => {
		const { vault, onRefresh } = start();
		vault.emit('modify', file('data/a.xlsx'));
		vi.advanceTimersByTime(XLSX_REFRESH_DELAY_MS - 50);
		vault.emit('modify', file('data/a.xlsx'));
		vi.advanceTimersByTime(XLSX_REFRESH_DELAY_MS - 50);
		expect(onRefresh).not.toHaveBeenCalled();
		vi.advanceTimersByTime(50);
		expect(onRefresh).toHaveBeenCalledTimes(1);
	});

	it('refreshes when the file is deleted, so the error shows promptly', () => {
		const { vault, onRefresh } = start();
		vault.emit('delete', file('data/a.xlsx'));
		vi.advanceTimersByTime(XLSX_REFRESH_DELAY_MS);
		expect(onRefresh).toHaveBeenCalledTimes(1);
	});

	it('ignores other files', () => {
		const { vault, onRefresh, onRenamed } = start();
		vault.emit('modify', file('data/b.xlsx'));
		vault.emit('delete', file('data/b.xlsx'));
		vault.emit('rename', file('data/c.xlsx'), 'data/b.xlsx');
		vi.advanceTimersByTime(XLSX_REFRESH_DELAY_MS * 2);
		expect(onRefresh).not.toHaveBeenCalled();
		expect(onRenamed).not.toHaveBeenCalled();
	});

	it('reports a rename at once with the new file, and does not refresh', () => {
		const { vault, onRefresh, onRenamed } = start();
		const moved = file('moved/a.xlsx');
		vault.emit('rename', moved, 'data/a.xlsx');
		expect(onRenamed).toHaveBeenCalledWith(moved);
		vi.advanceTimersByTime(XLSX_REFRESH_DELAY_MS * 2);
		expect(onRefresh).not.toHaveBeenCalled();
	});

	it('stop unbinds every listener and cancels a pending refresh', () => {
		const { vault, onRefresh, onRenamed, watch } = start();
		expect(vault.count()).toBe(3);
		vault.emit('modify', file('data/a.xlsx'));
		watch.stop();
		expect(vault.count()).toBe(0);
		vi.advanceTimersByTime(XLSX_REFRESH_DELAY_MS * 2);
		expect(onRefresh).not.toHaveBeenCalled();
		vault.emit('rename', file('x.xlsx'), 'data/a.xlsx');
		expect(onRenamed).not.toHaveBeenCalled();
	});

	it('works without an onRenamed handler', () => {
		const vault = fakeVault();
		watchXlsxFile(vault as never, 'a.xlsx', { onRefresh: () => {} });
		expect(() => vault.emit('rename', file('b.xlsx'), 'a.xlsx')).not.toThrow();
	});
});
