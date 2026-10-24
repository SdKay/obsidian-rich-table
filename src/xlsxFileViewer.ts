import { Component, Keymap, TFile, type App, type PaneType } from 'obsidian';
import type { TableModelV2, WorkbookV3 } from './model';
import { renderTable } from './renderer';
import { renderSheetTabBar } from './renderSheetTabs';
import { settleRenderedTables } from './renderAutofit';
import { readXlsxAsModel } from './xlsxSource';
import { watchXlsxFile, type XlsxFileWatch } from './xlsxFileWatch';
import type { ChoiceRegistry } from './choiceRegistry';
import { fmt, t } from './i18n';
import { bindCellLinks } from './cellLinks';
import type { MatchOptions, RichSearchHostApi } from './richSearchApi';
import { matchText } from './searchMatch';
import { markSpans } from './searchHighlight';
import { findAnchorCell, isCellAnchor, revealCell, type CellAnchor } from './searchReveal';

export interface XlsxFileViewerHost {
	app: App;
	choiceRegistry: ChoiceRegistry;
	/** The Rich Search plugin's matching API, when it is installed and enabled. Read each time, never cached. */
	searchHost?: () => RichSearchHostApi | undefined;
}

/** A search hit to show: where it is and the query that found it. */
export interface RevealRequest {
	anchor: CellAnchor;
	query: MatchOptions;
}

/**
 * A whole .xlsx file shown read-only in a container of its own, with no note and no code block.
 * Auto width and height, like an xlsx code block: the table takes the size of its content and
 * scrolls inside its own frame. Every edit callback is left out, so the table offers none.
 */
export class XlsxFileViewer extends Component {
	private file: TFile | null = null;
	private watch: XlsxFileWatch | null = null;
	private activeSheetId: string | null = null;
	private renderSeq = 0;
	/** Where an opened hit goes. One-shot: a later refresh from disk must not pull the scroll back to it. */
	private pendingNav: CellAnchor | null = null;
	/** The query that came with the hit. Marks follow `currentQuery()`; this is only used when the host has none. */
	private navQuery: MatchOptions | null = null;
	private clearHighlight: (() => void) | null = null;
	private unsubscribeQuery: (() => void) | null = null;
	private rendered = false;
	private sheets: { id: string; name: string }[] = [];
	private shownSheetId: string | null = null;
	private readonly cacheKey = `xlsx-file-view:${Math.random().toString(36).slice(2)}`;

	constructor(private readonly host: XlsxFileViewerHost, private readonly containerEl: HTMLElement) {
		super();
	}

	onload(): void {
		const unbind = bindCellLinks(this.containerEl, () => this.file?.path ?? '', {
			openInternal: (href, sourcePath, newLeaf) => { void this.host.app.workspace.openLinkText(href, sourcePath, newLeaf as PaneType | boolean); },
			openExternal: (href) => { window.open(href, '_blank'); },
			where: (evt) => Keymap.isModEvent(evt),
		});
		this.register(unbind);
	}

	/**
	 * Goes to a search hit. May arrive before the file has been drawn: it is then kept and applied when the
	 * drawing is done. Anything that is not a usable request is ignored. Which matches are marked is not
	 * decided here but by the search panel (`syncMarks`).
	 */
	reveal(request: unknown): void {
		const r = request as Partial<RevealRequest> | null;
		if (!r || !isCellAnchor(r.anchor) || typeof r.query?.query !== 'string') return;
		this.pendingNav = r.anchor;
		this.navQuery = r.query;
		if (this.rendered) void this.applyNav();
	}

	/** Takes the marks off the page. They come back on the next `syncMarks` if the search panel still has a query. */
	private clearMarks(): void {
		this.clearHighlight?.();
		this.clearHighlight = null;
	}

	onunload(): void {
		this.stop();
	}

	async open(file: TFile): Promise<void> {
		if (this.file && this.file.path !== file.path) {
			this.activeSheetId = null;
			this.pendingNav = null;
			this.navQuery = null;
			this.clearMarks();
		}
		this.file = file;
		this.watchFile(file);
		await this.render();
	}

	close(): void {
		this.stop();
		this.containerEl.empty();
	}

	private watchFile(file: TFile): void {
		this.watch?.stop();
		this.watch = watchXlsxFile(this.host.app.vault, file.path, {
			onRefresh: () => { void this.render(); },
			onRenamed: (renamed) => {
				if (!(renamed instanceof TFile)) return;
				this.file = renamed;
				this.watchFile(renamed);
			},
		});
	}

	private stop(): void {
		this.watch?.stop();
		this.watch = null;
		this.unsubscribe();
		this.clearMarks();
		this.renderSeq++;
		this.file = null;
	}

	/** Re-reads the file and replaces what is shown. A newer call supersedes one still reading. */
	async render(): Promise<void> {
		const file = this.file;
		if (!file) return;
		const seq = ++this.renderSeq;
		this.rendered = false;
		this.clearHighlight = null; // the old DOM is replaced below, taking its marks with it
		const tmp = createDiv();
		try {
			const bytes = await this.host.app.vault.readBinary(file);
			const loaded = await readXlsxAsModel(bytes);
			if (seq !== this.renderSeq) return;
			await this.renderLoaded(tmp, file, loaded);
		} catch (err) {
			if (seq !== this.renderSeq) return;
			tmp.empty();
			const exists = !!this.host.app.vault.getAbstractFileByPath(file.path);
			const detail = exists ? (err instanceof Error ? err.message : String(err)) : fmt('xlsxNotFound', { path: file.path });
			tmp.createDiv({ cls: 'bt-error', text: `Rich Table: ${detail}` });
		}
		if (seq !== this.renderSeq) return;
		this.containerEl.empty();
		while (tmp.firstChild) this.containerEl.appendChild(tmp.firstChild);
		settleRenderedTables(this.containerEl);
		this.rendered = true;
		this.subscribe();
		await this.applyNav();
	}

	/** The sheet id for a name; undefined when the file has a single sheet (nothing to switch), null when no such sheet exists. */
	private sheetIdFor(name: string): string | null | undefined {
		if (this.sheets.length <= 1) return undefined;
		return this.sheets.find(s => s.name === name)?.id ?? null;
	}

	/** Goes to the pending hit (sheet, then scroll), then lets the search panel decide what to mark. */
	private async applyNav(): Promise<void> {
		const anchor = this.pendingNav;
		if (anchor) {
			const sheetId = this.sheetIdFor(anchor.sheet);
			if (sheetId === null) {
				this.pendingNav = null;
			} else if (sheetId !== undefined && sheetId !== this.shownSheetId) {
				this.activeSheetId = sheetId;
				await this.render();
				return;
			} else {
				this.pendingNav = null;
				const cell = findAnchorCell(this.containerEl, anchor);
				if (cell) revealCell(cell);
			}
		}
		this.syncMarks();
	}

	/**
	 * Marks every match of the search that is on screen, on the sheet that is shown. The search panel owns the
	 * lifetime (contract 5.8): no query, no marks; clicking, editing and Escape change nothing. A Rich Search
	 * without `currentQuery` cannot say when to stop, so the query of the hit is marked once and left alone.
	 */
	private syncMarks(): void {
		this.clearMarks();
		if (!this.rendered) return;
		const host = this.host.searchHost?.();
		if (!host || host.apiVersion !== 1) return;
		const query = host.currentQuery ? host.currentQuery() : this.navQuery;
		if (!query || query.query === '') return;
		const undo: (() => void)[] = [];
		this.containerEl.querySelectorAll<HTMLElement>('td[data-row][data-col], th[data-row][data-col]').forEach(el => {
			const spans = matchText(el.textContent ?? '', query, host);
			if (spans.length > 0) undo.push(markSpans(el, spans));
		});
		this.clearHighlight = () => { for (const fn of undo) fn(); };
	}

	/** Follows the search panel. Called after every draw: it drops the old listener first, so there is always one. */
	private subscribe(): void {
		this.unsubscribe();
		const host = this.host.searchHost?.();
		if (!host || host.apiVersion !== 1 || !host.onQueryChange || !host.currentQuery) return;
		try {
			this.unsubscribeQuery = host.onQueryChange(() => this.syncMarks());
		} catch {
			this.unsubscribeQuery = null;
		}
	}

	private unsubscribe(): void {
		try { this.unsubscribeQuery?.(); } catch { /* a host that fails to unsubscribe is already gone */ }
		this.unsubscribeQuery = null;
	}

	private async renderLoaded(tmp: HTMLElement, file: TFile, loaded: TableModelV2 | WorkbookV3): Promise<void> {
		let workbook: WorkbookV3 | null = null;
		let active: TableModelV2 | null;
		this.sheets = loaded.version === 3 ? loaded.sheets.map(s => ({ id: s.id, name: s.name ?? '' })) : [];
		if (loaded.version === 3) {
			workbook = loaded;
			if (this.activeSheetId && workbook.sheets.some(s => s.id === this.activeSheetId)) workbook.activeSheetId = this.activeSheetId;
			active = workbook.sheets.find(s => s.id === workbook!.activeSheetId) ?? workbook.sheets[0] ?? null;
		} else {
			active = loaded;
		}
		if (!active || active.columns.length === 0) {
			tmp.createDiv({ cls: 'bt-empty-workbook', text: t('xlsxEmptyWorkbook') });
			return;
		}
		active.theme = 'grid';
		this.shownSheetId = workbook ? (workbook.activeSheetId ?? workbook.sheets[0]?.id ?? null) : null;

		const hasTabs = !!workbook && workbook.sheets.length > 1;
		await renderTable(
			active,
			() => this.host.choiceRegistry,
			tmp,
			this.host.app,
			file.path,
			this,
			/* onOp */ undefined,
			/* onToggleLock */ undefined,
			/* onRootReady */ undefined,
			/* isSwapping */ undefined,
			this.cacheKey,
			/* getSingleClickEdit */ undefined,
			/* onCreateSheet */ undefined,
			/* onOpenExternalFile */ undefined,
			/* onDetachFromXlsx */ undefined,
			/* onSetViewWidth */ undefined,
			/* onSetViewHeight */ undefined,
			/* onSnapshot */ undefined,
			/* onXlsxWrite */ undefined,
			/* onExportXlsx */ undefined,
			/* hiddenCtrlColButtons */ undefined,
			/* forceStatusBarPinned */ hasTabs,
		);

		if (workbook && hasTabs) {
			const statusTabs = tmp.querySelector<HTMLElement>('.bt-status-bar .bt-status-tabs');
			renderSheetTabBar({
				container: statusTabs ?? tmp,
				sheets: workbook.sheets,
				activeSheetId: workbook.activeSheetId ?? workbook.sheets[0]?.id ?? '',
				cacheKey: this.cacheKey,
				component: this,
				onSwitchSheet: (sheetId) => { this.activeSheetId = sheetId; void this.render(); },
			});
		}
	}
}
