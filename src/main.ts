import { Editor, MarkdownView, Plugin, parseYaml, stringifyYaml } from 'obsidian';
import { XlsxFileView, XLSX_VIEW_TYPE } from './xlsxFileView';
import { enableXlsxView, disableXlsxView, type ViewRegistryLike } from './xlsxViewRegistration';
import { setYamlAdapter } from './yamlAdapter';
import { BetterTableSettingTab, DEFAULT_SETTINGS } from './settings';
import { ChoiceRegistry } from './choiceRegistry';
import { TableBlock, refreshAllTableBlocks, waitForBlockAt } from './tableBlock';
import type { BetterTableSettings } from './model';
import { planRichTableBlockInsertion } from './insertRichTableBlock';
import { planMarkdownTableConversion, type MarkdownTableConversionPlan } from './convertMarkdownTable';
import { ChangelogModal, shouldShowChangelog } from './changelogModal';
import { t } from './i18n';
import { resolveDefaultTheme } from './themes';
import { computeCacheKey } from './blockCacheKey';
import { setNativeEditorEnabled } from './nativeCellEditor';
import { watchNoteScroll } from './noteScroll';
import { applyCellPadding } from './cellPadding';
import { addCellHighlightItems, clearCellPickOutside } from './renderEditorMenu';
import { createRichSearchProvider } from './richSearchProvider';
import type { RichSearchHostApi, RichSearchProvider } from './richSearchApi';
import { SearchPanelFollower } from './searchPanel';
export default class BetterTablePlugin extends Plugin {
	settings!: BetterTableSettings;
	choiceRegistry!: ChoiceRegistry;
	/** The Rich Search plugin's matching API, when it is installed and enabled. Looked up on every call. */
	private searchHost = (): RichSearchHostApi | undefined => {
		const plugins = (this.app as unknown as { plugins?: { plugins?: Record<string, { api?: RichSearchHostApi } | undefined> } }).plugins;
		return plugins?.plugins?.['rich-search']?.api;
	};
	/** Follows the search panel for everything that marks matches. */
	readonly searchPanel = new SearchPanelFollower(() => this.searchHost());
	/** Read by the Rich Search plugin (`app.plugins.plugins['rich-table'].richSearch`) to search workbook text. */
	richSearch!: RichSearchProvider;
	/** Whether this plugin's own `.xlsx` file view is registered. False until that view exists. */
	private xlsxViewRegistered = false;
	/** True when the user wants the view but Obsidian refused the extension (another plugin owns it). */
	xlsxViewRefused = false;
	/** True when turning the view off needs a reload because Obsidian's internals are not as expected. */
	xlsxViewNeedsReload = false;

	async onload(): Promise<void> {
		setYamlAdapter({ parse: parseYaml, stringify: stringifyYaml });
		await this.loadSettings();
		await this.maybeShowChangelog();
		this.choiceRegistry = new ChoiceRegistry(this.settings.customChoices);
		this.richSearch = createRichSearchProvider({
			viewRegistered: () => this.xlsxViewRegistered,
			revealInNote: async (leaf, fromLine, anchor, query) => {
				const view = leaf.view;
				if (!(view instanceof MarkdownView)) return false;
				const path = view.file?.path;
				if (!path) return false;
				// The note is still the one in this tab: a slow wait must not act on a note the user has left.
				const found = await waitForBlockAt(path, fromLine, view.containerEl, () => leaf.view === view && view.file?.path === path);
				return found ? found.block.revealSearchHit(anchor, query, found.framesLeft) : false;
			},
		});

		this.registerMarkdownCodeBlockProcessor('rich-table', (source, el, ctx) => {
			const info = ctx.getSectionInfo(el);
			const cacheKey = computeCacheKey(ctx.sourcePath, info, () => Math.random().toString(36).slice(2));
			const block = new TableBlock(el, source, this, ctx.sourcePath, ctx, cacheKey);
			ctx.addChild(block);
		});

		this.syncXlsxView();

		// Every window has its own document: the main one now, each pop-out as it opens.
		const stopWatching = new Map<Window, () => void>();
		const watchWindow = (win: Window) => { if (!stopWatching.has(win)) stopWatching.set(win, watchNoteScroll(win.document)); };
		watchWindow(window);
		this.registerEvent(this.app.workspace.on('window-open', (_w, win) => watchWindow(win)));
		this.registerEvent(this.app.workspace.on('window-close', (_w, win) => { stopWatching.get(win)?.(); stopWatching.delete(win); }));
		this.register(() => { for (const stop of stopWatching.values()) stop(); stopWatching.clear(); });

		this.addSettingTab(new BetterTableSettingTab(this.app, this));

		// Three entry points for the one action, per user request — a command
		// (which is also how a user assigns their own hotkey, via Settings →
		// Hotkeys, so that request needs no separate mechanism here), a ribbon
		// icon for a click-to-insert workflow, and an editor context-menu entry
		// for reaching it without leaving the keyboard/mouse flow of writing.
		this.addCommand({
			id: 'insert-block',
			name: t('insertRichTableBlock'),
			editorCallback: (editor) => this.insertRichTableBlock(editor),
		});
		this.addRibbonIcon('table', t('insertRichTableBlock'), () => {
			const editor = this.app.workspace.getActiveViewOfType(MarkdownView)?.editor;
			if (editor) this.insertRichTableBlock(editor);
		});
		// Command-palette entry point (also assignable a hotkey under Settings →
		// Hotkeys) is the reliable way to reach this: Obsidian's own Live Preview
		// renders a plain Markdown table as an interactive widget with its OWN
		// right-click menu (cut/copy/paste, align, clear/delete cell), which
		// consumes the event before it ever reaches the 'editor-menu' workspace
		// hook — the editor-menu item below is added too, for Source Mode and
		// any other case where that widget isn't in the way, but it can't be
		// the only entry point. editorCheckCallback greys the command out
		// (rather than acting as a no-op) when the cursor isn't on a table.
		this.addCommand({
			id: 'convert-markdown-table',
			name: t('convertToRichTable'),
			editorCheckCallback: (checking, editor) => {
				const plan = this.planMarkdownTableConversionAt(editor);
				if (checking) return plan !== null;
				if (plan) this.applyMarkdownTableConversion(editor, plan);
				return true;
			},
		});
		this.registerDomEvent(activeDocument, 'contextmenu', clearCellPickOutside, true);
		this.registerEvent(this.app.workspace.on('editor-menu', (menu, editor) => {
			addCellHighlightItems(menu);
			menu.addItem(item => item
				.setTitle(t('insertRichTableBlock'))
				.setIcon('table')
				.onClick(() => this.insertRichTableBlock(editor)));

			// Only offered when the cursor is actually on a plain Markdown table —
			// unlike "Insert rich-table block" above, this action has nothing to
			// do when there's no table there, so it stays out of the menu instead
			// of appearing as a no-op (see "Evaluating feature requests" in
			// CLAUDE.md: match how comparable tools only show contextual actions
			// when they apply).
			const plan = this.planMarkdownTableConversionAt(editor);
			if (plan) {
				menu.addItem(item => item
					.setTitle(t('convertToRichTable'))
					.setIcon('table')
					.onClick(() => this.applyMarkdownTableConversion(editor, plan)));
			}
		}));

		this.addCommand({
			id: 'show-changelog',
			name: t('showChangelogCommand'),
			callback: () => new ChangelogModal(this.app).open(),
		});
	}

	/** Inserts an empty rich-table block at the cursor — the existing empty-block
	 *  template-picker banner (tableBlock.ts's isEmpty path) takes it from there. */
	insertRichTableBlock(editor: Editor): void {
		const cursor = editor.getCursor();
		const plan = planRichTableBlockInsertion(cursor, editor.getLine(cursor.line));
		editor.replaceRange(plan.text, cursor);
		editor.setCursor(plan.cursorAfter);
		editor.focus();
	}

	private planMarkdownTableConversionAt(editor: Editor): MarkdownTableConversionPlan | null {
		const cursor = editor.getCursor();
		const lines = Array.from({ length: editor.lineCount() }, (_, i) => editor.getLine(i));
		return planMarkdownTableConversion(lines, cursor.line, resolveDefaultTheme(this.settings.defaultTheme));
	}

	private applyMarkdownTableConversion(editor: Editor, plan: MarkdownTableConversionPlan): void {
		editor.replaceRange(
			plan.blockText,
			{ line: plan.startLine, ch: 0 },
			{ line: plan.endLine, ch: editor.getLine(plan.endLine).length },
		);
	}

	/** Shows the full changelog once per version bump — skipped on a brand-new
	 *  install (nothing to summarize yet), and skipped again until the NEXT
	 *  version change once shown, by recording the current version as seen
	 *  either way. */
	private async maybeShowChangelog(): Promise<void> {
		const current = this.manifest.version;
		const seen = this.settings.lastSeenVersion;
		if (shouldShowChangelog(seen, current)) new ChangelogModal(this.app).open();
		if (seen !== current) {
			this.settings.lastSeenVersion = current;
			await this.saveSettings();
		}
	}

	/** Brings the registration in line with the setting, at load and whenever the setting changes. */
	syncXlsxView(): void {
		const registry = (this.app as unknown as { viewRegistry?: ViewRegistryLike }).viewRegistry;
		const want = this.settings.ownXlsxFiles;
		if (want && !this.xlsxViewRegistered) {
			// Obsidian throws, before changing anything, when another plugin owns the extension.
			// Claiming it first means a refusal leaves no orphan view type behind.
			const state = enableXlsxView({
				register: () => {
					this.registerExtensions(['xlsx'], XLSX_VIEW_TYPE);
					this.registerView(XLSX_VIEW_TYPE, (leaf) => new XlsxFileView(leaf, this));
				},
				registry, extension: 'xlsx', viewType: XLSX_VIEW_TYPE,
			});
			this.xlsxViewRegistered = state.kind === 'owned';
			this.xlsxViewRefused = state.kind === 'refused';
			if (state.kind === 'refused') console.warn('Rich Table: could not register the .xlsx view', state.error);
		} else if (!want && this.xlsxViewRegistered) {
			const change = disableXlsxView({ registry, extension: 'xlsx', viewType: XLSX_VIEW_TYPE });
			this.xlsxViewRegistered = change.kind === 'needs-reload';
			this.xlsxViewNeedsReload = change.kind === 'needs-reload';
		} else if (want) {
			this.xlsxViewNeedsReload = false;
		} else {
			this.xlsxViewRefused = false;
		}
	}

	async loadSettings(): Promise<void> {
		this.settings = Object.assign(
			{},
			DEFAULT_SETTINGS,
			(await this.loadData()) as Partial<BetterTableSettings>,
		);
		setNativeEditorEnabled(this.settings.nativeCellEditor);
		applyCellPadding(this.settings.cellPaddingY);
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
		setNativeEditorEnabled(this.settings.nativeCellEditor);
		applyCellPadding(this.settings.cellPaddingY);
		this.syncXlsxView();
		this.choiceRegistry = new ChoiceRegistry(this.settings.customChoices);
		// Re-render all open reading views so allowReadingViewEdit takes effect
		// immediately without requiring the user to close and reopen the note.
		this.app.workspace.getLeavesOfType('markdown').forEach(leaf => {
			const view = leaf.view;
			if (view instanceof MarkdownView && view.getMode() === 'preview') {
				view.previewMode.rerender(true);
			}
		});
		// Live Preview tables aren't touched by the rerender above (CM6 widgets,
		// not part of the reading-view pane it tears down) — refresh every
		// currently-mounted table directly so e.g. a left-toolbar button
		// visibility change takes effect immediately there too.
		refreshAllTableBlocks();
	}
}
