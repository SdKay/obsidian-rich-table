import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { TFile } from 'obsidian';
import { TaskSource } from '../src/tasks/taskSource';

type Handler = (...args: never[]) => void;

/** One emitter standing for both the vault and the metadata cache, which is all TaskSource asks of either. */
function fakeApp(notes: Record<string, string>) {
	const handlers = new Map<string, Set<Handler>>();
	const emitter = {
		on(name: string, cb: Handler) {
			if (!handlers.has(name)) handlers.set(name, new Set());
			handlers.get(name)!.add(cb);
			return { name, cb };
		},
		offref(ref: { name: string; cb: Handler }) { handlers.get(ref.name)?.delete(ref.cb); },
		emit(name: string, ...args: unknown[]) { for (const cb of [...(handlers.get(name) ?? [])]) (cb as (...a: unknown[]) => void)(...args); },
		count: () => [...handlers.values()].reduce((n, s) => n + s.size, 0),
	};
	const files = new Map<string, TFile>();
	const fileFor = (path: string, extension = 'md'): TFile => {
		let f = files.get(path);
		if (!f) { f = Object.assign(new TFile(), { path, extension }); files.set(path, f); }
		return f;
	};
	const reads: string[] = [];
	const app = {
		vault: {
			on: emitter.on, offref: emitter.offref,
			getMarkdownFiles: () => Object.keys(notes).map(p => fileFor(p)),
			getAbstractFileByPath: (p: string) => (p in notes ? fileFor(p) : null),
			cachedRead: async (f: TFile) => { reads.push(f.path); return notes[f.path] ?? ''; },
		},
		metadataCache: { on: emitter.on, offref: emitter.offref },
	};
	return { app, emitter, notes, fileFor, reads };
}

const TASK = (text: string) => `- [ ] ${text}\n`;
const bodies = (s: TaskSource) => s.tasks().map(t => t.path + ': ' + t.description).sort();

describe('TaskSource', () => {
	beforeEach(() => {
		vi.useFakeTimers();
		vi.stubGlobal('window', { setTimeout: globalThis.setTimeout, clearTimeout: globalThis.clearTimeout });
	});
	afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

	it('reads every note once at the start and holds their tasks', async () => {
		const { app } = fakeApp({ 'a.md': TASK('one'), 'b.md': TASK('two') + TASK('three') });
		const source = new TaskSource(app as never);
		await source.whenReady();
		expect(bodies(source)).toEqual(['a.md: one', 'b.md: three', 'b.md: two']);
	});

	it('tells the tables once the first read is done, and not before', async () => {
		const { app } = fakeApp({ 'a.md': TASK('one') });
		const source = new TaskSource(app as never);
		const seen: number[] = [];
		source.onChange(() => seen.push(source.tasks().length));
		await source.whenReady();
		expect(seen).toEqual([1]);
	});

	it('reads the vault only once however many tables ask', async () => {
		const { app, reads } = fakeApp({ 'a.md': TASK('one') });
		const source = new TaskSource(app as never);
		await Promise.all([source.whenReady(), source.whenReady(), source.whenReady()]);
		expect(reads).toEqual(['a.md']);
	});

	it('picks up a note that changed, after the changes settle, and tells the tables once', async () => {
		const { app, emitter, notes, fileFor } = fakeApp({ 'a.md': TASK('one') });
		const source = new TaskSource(app as never);
		await source.whenReady();
		const seen: string[][] = [];
		source.onChange(() => seen.push(bodies(source)));
		notes['a.md'] = TASK('one') + TASK('added');
		// Typing changes the note on every keystroke: all of them are one redraw.
		for (let i = 0; i < 5; i++) { emitter.emit('changed', fileFor('a.md')); await vi.advanceTimersByTimeAsync(100); }
		expect(seen, 'nothing yet: the changes have not settled').toEqual([]);
		await vi.advanceTimersByTimeAsync(1000);
		expect(seen).toEqual([['a.md: added', 'a.md: one']]);
	});

	it('reads a note that changed again and again only once', async () => {
		const { app, emitter, fileFor, reads } = fakeApp({ 'a.md': TASK('one') });
		const source = new TaskSource(app as never);
		await source.whenReady();
		reads.length = 0;
		for (let i = 0; i < 4; i++) emitter.emit('changed', fileFor('a.md'));
		await vi.advanceTimersByTimeAsync(1000);
		expect(reads).toEqual(['a.md']);
	});

	it('drops the tasks of a deleted note at once', async () => {
		const { app, emitter, fileFor } = fakeApp({ 'a.md': TASK('one'), 'b.md': TASK('two') });
		const source = new TaskSource(app as never);
		await source.whenReady();
		const seen: string[][] = [];
		source.onChange(() => seen.push(bodies(source)));
		emitter.emit('delete', fileFor('a.md'));
		expect(seen).toEqual([['b.md: two']]);
	});

	it('moves the tasks of a renamed note to its new path', async () => {
		const { app, emitter, fileFor } = fakeApp({ 'a.md': TASK('one') });
		const source = new TaskSource(app as never);
		await source.whenReady();
		emitter.emit('rename', fileFor('moved.md'), 'a.md');
		expect(bodies(source)).toEqual(['moved.md: one']);
	});

	it('ignores a file that is not a note', async () => {
		const { app, emitter, fileFor, reads } = fakeApp({ 'a.md': TASK('one') });
		const source = new TaskSource(app as never);
		await source.whenReady();
		reads.length = 0;
		const seen: number[] = [];
		source.onChange(() => seen.push(1));
		emitter.emit('changed', fileFor('data.xlsx', 'xlsx'));
		emitter.emit('delete', fileFor('data.xlsx', 'xlsx'));
		await vi.advanceTimersByTimeAsync(1000);
		expect(seen).toEqual([]);
		expect(reads).toEqual([]);
	});

	it('stops telling a table that stopped listening', async () => {
		const { app, emitter, fileFor } = fakeApp({ 'a.md': TASK('one') });
		const source = new TaskSource(app as never);
		await source.whenReady();
		const seen: number[] = [];
		const stop = source.onChange(() => seen.push(1));
		stop();
		emitter.emit('delete', fileFor('a.md'));
		expect(seen).toEqual([]);
	});

	it('lets go of the vault and forgets everything when stopped', async () => {
		const { app, emitter, fileFor } = fakeApp({ 'a.md': TASK('one') });
		const source = new TaskSource(app as never);
		await source.whenReady();
		expect(emitter.count()).toBeGreaterThan(0);
		source.stop();
		expect(emitter.count(), 'no listener is left on the vault').toBe(0);
		expect(source.tasks()).toEqual([]);
		emitter.emit('delete', fileFor('a.md'));
		expect(source.tasks()).toEqual([]);
	});

	it('reads the vault again when asked after it was stopped', async () => {
		const { app, reads } = fakeApp({ 'a.md': TASK('one') });
		const source = new TaskSource(app as never);
		await source.whenReady();
		source.stop();
		reads.length = 0;
		await source.whenReady();
		expect(reads).toEqual(['a.md']);
		expect(bodies(source)).toEqual(['a.md: one']);
	});

	it('goes on telling the other tables when one of them fails', async () => {
		const { app, emitter, fileFor } = fakeApp({ 'a.md': TASK('one') });
		const source = new TaskSource(app as never);
		await source.whenReady();
		const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
		const seen: number[] = [];
		source.onChange(() => { throw new Error('boom'); });
		source.onChange(() => seen.push(1));
		emitter.emit('delete', fileFor('a.md'));
		expect(seen).toEqual([1]);
		error.mockRestore();
	});
});
