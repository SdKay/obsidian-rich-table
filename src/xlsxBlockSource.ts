/**
 * A block backed by an .xlsx file. The block holds only a small shell (`xlsxSource`, the view's size, the theme); the
 * table shown is the file's content, read again on every draw and never written into the note. Edits the file can
 * hold go to the file; the view's size goes to the shell; anything else is dropped. See blockSource.ts.
 */
import { FileSystemAdapter, Notice, Platform, TFile } from 'obsidian';
import { t, fmt } from './i18n';
import type { TableModelV2 } from './model';
import { serializeTable, serializeWorkbook } from './serializer';
import type { BlockSource, Loaded, Parsed, SourceHost, SourceKind } from './blockSource';
import type { EmptyEntry } from './emptyEntries';
import { openXlsxFilePicker } from './xlsxFilePicker';
import type { TableAction } from './renderTypes';
import type { TableOp, TableOpType } from './tableEdits';
import { readXlsxAsModel, writeXlsxOps, isXlsxWritableOp, type XlsxWritableOp } from './xlsxSource';
import { electronShell } from './nodeBridge';
import { watchXlsxFile, type XlsxFileWatch } from './xlsxFileWatch';

/** What a table backed by an .xlsx file takes besides what its file can hold: choosing a sheet and the view's size,
 *  which are the block's own state and are kept in the note. */
const ACCEPTED_OPS: ReadonlySet<string> = new Set(['set-active-sheet', 'set-view-width', 'set-view-height']);

export class XlsxBlockSource implements BlockSource {
	readonly exportable = false;
	/** The block's own front-matter as parsed: `{ xlsxSource, viewWidth?, viewHeight?, theme?, … }`, no rows. This is
	 *  what is honest to write back; the loaded content is the whole spreadsheet. */
	private shell: TableModelV2 | null = null;
	private file: TFile | null = null;
	/** What is shown now (the file's content), for "detach" and for the sheet a write lands on. */
	private shown: Parsed | null = null;
	/** The sheet the user last picked. Switching is in memory only (there is nothing to write), and every draw reads
	 *  the file afresh, so this is what puts the same sheet back. */
	private activeSheetId: string | undefined;
	/** Writes arriving in the same tick go to the file together. */
	private pending: XlsxWritableOp[] = [];
	private writeScheduled = false;
	/** Kept while the path is unchanged, so a change that arrived while a draw was still parsing keeps its refresh. */
	private watch: { path: string; watch: XlsxFileWatch } | null = null;

	constructor(private readonly host: SourceHost) {}

	/** Reads the file the shell names. Errors (missing file, unreadable xlsx) are thrown and shown as the block's error. */
	async load(parsed: Parsed): Promise<Loaded> {
		const shell = parsed.model;
		const ref = shell?.xlsxSource;
		if (!shell || !ref) throw new Error('xlsx source without xlsxSource');
		this.shell = shell;
		const dest = this.host.app.metadataCache.getFirstLinkpathDest(ref.path, this.host.sourcePath);
		if (!dest) throw new Error(fmt('xlsxNotFound', { path: ref.path }));
		const bytes = await this.host.app.vault.readBinary(dest);
		const loaded = await readXlsxAsModel(bytes, ref.sheet);
		this.file = dest;
		this.refreshWatch(dest.path);
		let shown: Parsed;
		if (loaded.version === 3) {
			if (this.activeSheetId && loaded.sheets.some(s => s.id === this.activeSheetId)) loaded.activeSheetId = this.activeSheetId;
			shown = { model: null, workbook: loaded };
		} else {
			shown = { model: loaded, workbook: null };
		}
		this.shown = shown;
		// The view's size and the theme are the block's, not a sheet's: every sheet shares the one set on the block.
		const active = shown.workbook
			? shown.workbook.sheets.find(s => s.id === shown.workbook?.activeSheetId) ?? shown.workbook.sheets[0]
			: shown.model;
		if (active) {
			if (shell.viewWidth !== undefined) active.viewWidth = shell.viewWidth;
			if (shell.viewHeight !== undefined) active.viewHeight = shell.viewHeight;
			// The theme picker is not offered here (it would need an op the file cannot hold), so a spreadsheet reads
			// best with gridlines; a theme written into the block by hand still wins.
			active.theme = shell.theme ?? 'grid';
		}
		return { kind: 'table', parsed: shown };
	}

	/** View-only outright: nothing to lock. */
	locked(): boolean { return false; }

	scenario(): 'xlsxRef' { return 'xlsxRef'; }

	accepts(type: TableOpType): boolean {
		return ACCEPTED_OPS.has(type) || isXlsxWritableOp({ type });
	}

	route(op: TableOp): true {
		if (op.type === 'set-active-sheet') { this.activeSheetId = op.sheetId; void this.host.rerender(); }
		else if (op.type === 'set-view-width') void this.setShellSize('viewWidth', op.width);
		else if (op.type === 'set-view-height') void this.setShellSize('viewHeight', op.height);
		else if (isXlsxWritableOp(op)) void this.write(op);
		// Anything else has no honest equivalent in the file and is dropped.
		return true;
	}

	actions(): TableAction[] {
		return [
			{ id: 'openExternal', label: t('openInDefaultApp'), place: 'first', run: () => void this.openExternally() },
			{ id: 'detachXlsx', label: t('detachFromXlsx'), place: 'first', run: () => void this.detach() },
		];
	}

	dispose(): void {
		this.watch?.watch.stop();
		this.watch = null;
	}

	private async setShellSize(field: 'viewWidth' | 'viewHeight', size: number | null): Promise<void> {
		if (!this.shell) return;
		if (size === null) delete this.shell[field];
		else this.shell[field] = size;
		await this.host.writeBlock(serializeTable(this.shell));
	}

	/** The sheet title a write targets: the one the file was read from. */
	private activeSheetName(): string | undefined {
		const wb = this.shown?.workbook;
		if (wb) return wb.sheets.find(s => s.id === wb.activeSheetId)?.name;
		return this.shell?.xlsxSource?.sheet;
	}

	/**
	 * Writes a batch of edits to the file: reads its current bytes, applies the batch, writes once. A successful write
	 * fires the vault's 'modify', which the watch turns into a redraw. A failed one fires nothing, and the cell would
	 * keep the text typed into it as if saved; so failure says so and draws again from the unchanged file.
	 */
	private async write(op: XlsxWritableOp): Promise<void> {
		this.pending.push(op);
		if (this.writeScheduled) return;
		this.writeScheduled = true;
		await new Promise<void>(resolve => { window.setTimeout(resolve, 0); });
		this.writeScheduled = false;
		const ops = this.pending;
		this.pending = [];
		const file = this.file;
		if (!file) return;
		try {
			const bytes = await this.host.app.vault.readBinary(file);
			const written = await writeXlsxOps(bytes, this.activeSheetName(), ops);
			const buffer = written.buffer.slice(written.byteOffset, written.byteOffset + written.byteLength) as ArrayBuffer;
			await this.host.chainWrite(() => this.host.app.vault.modifyBinary(file, buffer));
		} catch (err) {
			new Notice(`${t('xlsxWriteFailed')}: ${err instanceof Error ? err.message : String(err)}`);
			await this.host.rerender();
		}
	}

	/** Watches the bound file for external changes; replaced when the path changes (xlsxSource.path edited by hand). */
	private refreshWatch(path: string): void {
		if (this.watch?.path === path) return;
		this.watch?.watch.stop();
		// A rename does not update xlsxSource.path the way it does a [[link]]: it is plain text in the block. Rewrite it
		// right away. A refresh draws again in place: there is nothing to write that would make Obsidian reprocess.
		const watch = watchXlsxFile(this.host.app.vault, path, {
			onRefresh: () => { void this.host.rerender(); },
			onRenamed: (file) => { if (file instanceof TFile) void this.renamed(file); },
		});
		this.watch = { path, watch };
	}

	private async renamed(newFile: TFile): Promise<void> {
		if (!this.shell?.xlsxSource) return;
		this.shell.xlsxSource = { ...this.shell.xlsxSource, path: newFile.path };
		await this.host.writeBlock(serializeTable(this.shell));
	}

	/**
	 * Hands the file to whatever the OS opens .xlsx with. Desktop only: `shell.openPath` and a plain filesystem path
	 * (FileSystemAdapter.getFullPath) do not exist on mobile.
	 */
	private async openExternally(): Promise<void> {
		if (!this.file) return;
		if (!Platform.isDesktopApp) {
			new Notice(t('openInDefaultAppUnsupported'));
			return;
		}
		const adapter = this.host.app.vault.adapter;
		if (!(adapter instanceof FileSystemAdapter)) return;
		const fullPath = adapter.getFullPath(this.file.path);
		try {
			// A synchronous require (nodeBridge), not import('electron'): esbuild leaves a dynamic import of an external
			// module as a real import(), which Obsidian's loader cannot resolve.
			const err = await electronShell().openPath(fullPath);
			if (err) new Notice(`${t('openInDefaultAppFailed')}: ${err}`);
		} catch (err) {
			new Notice(`${t('openInDefaultAppFailed')}: ${err instanceof Error ? err.message : String(err)}`);
		}
	}

	/** Writes what is shown now (the last read of the file) into the block as an ordinary table, without xlsxSource. */
	private async detach(): Promise<void> {
		const shown = this.shown;
		if (shown?.workbook) await this.host.writeBlock(serializeWorkbook(shown.workbook));
		else if (shown?.model) await this.host.writeBlock(serializeTable(shown.model));
	}
}

/** Tables backed by an .xlsx file. */
export const xlsxSourceKind: SourceKind = {
	matches: (model) => !!model.xlsxSource,
	create: (host) => new XlsxBlockSource(host),
	entry: (host) => xlsxImportEntry(host),
};

/** The empty-block button for backing the block with an .xlsx file: a file picker opens on click. Whole blocks only. */
function xlsxImportEntry(host: SourceHost): EmptyEntry {
	return {
		key: 'xlsx-import',
		label: t('importFromXlsx'),
		preview: { hint: t('xlsxImportPreviewHint') },
		bind: (ctx) => {
			// A modal, unlike the grid picker, is not a hover flyout anchored to the button: click only, as every other
			// Obsidian file picker is opened.
			ctx.button.addEventListener('click', () => {
				if (ctx.inserting()) return;
				// The block names the file and nothing else: the next draw reads the file's content from disk.
				openXlsxFilePicker(host.app, (file) => ctx.insert(() => host.writeBlock(serializeTable({
					version: 2, columns: [], rows: [], merges: [], styles: [], xlsxSource: { path: file.path },
				}))));
			});
		},
	};
}
