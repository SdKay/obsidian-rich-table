/**
 * The vault's tasks, kept current. The one Obsidian-facing piece of the tasks table: it reads notes, listens
 * for changes and tells the tables to redraw. Everything it computes is in the pure modules beside it.
 */
import { TFile, type App, type EventRef } from 'obsidian';
import { scanTasks, TaskIndex } from './taskScan';
import { DEFAULT_STATUSES, type StatusDef } from './taskParse';
import type { LocatedTask } from './taskRun';

/** Changes within this many ms are one redraw: typing in a note changes it on every keystroke. */
const SETTLE_MS = 600;

export class TaskSource {
	private readonly index = new TaskIndex();
	private readonly listeners = new Set<() => void>();
	private readonly refs: EventRef[] = [];
	private readonly queued = new Set<string>();
	private timer: number | null = null;
	private statuses: readonly StatusDef[] = DEFAULT_STATUSES;
	private ready: Promise<void> | null = null;

	constructor(private readonly app: App) {}

	/** Statuses the vault configures (the Tasks plugin's settings), or the defaults. */
	setStatuses(statuses: readonly StatusDef[]): void { this.statuses = statuses; }

	/** Starts listening and reads the whole vault once. Safe to call again. */
	start(): Promise<void> {
		if (this.ready) return this.ready;
		const { metadataCache, vault } = this.app;
		this.refs.push(
			// `changed` fires after Obsidian has re-read a note, so the cache and the text agree.
			metadataCache.on('changed', (file) => { if (isNote(file)) this.queue(file.path); }),
			vault.on('delete', (file) => { if (isNote(file)) { this.index.delete(file.path); this.notify(); } }),
			vault.on('rename', (file, from) => { if (isNote(file)) { this.index.rename(from, file.path); this.notify(); } }),
		);
		this.ready = this.scanAll();
		return this.ready;
	}

	stop(): void {
		for (const ref of this.refs.splice(0)) {
			this.app.metadataCache.offref(ref);
			this.app.vault.offref(ref);
		}
		if (this.timer !== null) window.clearTimeout(this.timer);
		this.timer = null;
		this.queued.clear();
		this.listeners.clear();
		this.index.clear();
		this.ready = null;
	}

	/** Resolves once the first full read is done. */
	whenReady(): Promise<void> { return this.start(); }

	tasks(): LocatedTask[] { return this.index.all(); }

	/** `fn` runs after tasks change; returns how to stop. */
	onChange(fn: () => void): () => void {
		this.listeners.add(fn);
		return () => { this.listeners.delete(fn); };
	}

	private async scanAll(): Promise<void> {
		for (const file of this.app.vault.getMarkdownFiles()) await this.readInto(file);
		this.notify();
	}

	private async readInto(file: TFile): Promise<void> {
		// cachedRead: the text Obsidian already holds, without a disk read for every note.
		const text = await this.app.vault.cachedRead(file);
		this.index.set(file.path, scanTasks(file.path, text, this.statuses));
	}

	private queue(path: string): void {
		this.queued.add(path);
		if (this.timer !== null) return;
		this.timer = window.setTimeout(() => {
			this.timer = null;
			const paths = [...this.queued];
			this.queued.clear();
			void Promise.all(paths.map(async p => {
				const f = this.app.vault.getAbstractFileByPath(p);
				if (f instanceof TFile) await this.readInto(f);
			})).then(() => this.notify());
		}, SETTLE_MS);
	}

	private notify(): void {
		for (const fn of Array.from(this.listeners)) {
			try { fn(); } catch (err) { console.error('[rich-table] tasks listener failed', err); }
		}
	}
}

const isNote = (f: unknown): f is TFile => f instanceof TFile && f.extension === 'md';
