import { Editor, MarkdownView, Plugin } from 'obsidian';
import { BetterTableSettingTab, DEFAULT_SETTINGS } from './settings';
import { ChoiceRegistry } from './choiceRegistry';
import { TableBlock } from './tableBlock';
import type { BetterTableSettings } from './model';
import { planRichTableBlockInsertion } from './insertRichTableBlock';
import { t } from './i18n';
export default class BetterTablePlugin extends Plugin {
	settings!: BetterTableSettings;
	choiceRegistry!: ChoiceRegistry;

	async onload(): Promise<void> {
		await this.loadSettings();
		this.choiceRegistry = new ChoiceRegistry(this.settings.customChoices);

		this.registerMarkdownCodeBlockProcessor('rich-table', (source, el, ctx) => {
			const info = ctx.getSectionInfo(el);
			const cacheKey = info ? `${ctx.sourcePath}:${info.lineStart}` : ctx.sourcePath;
			const block = new TableBlock(el, source, this, ctx.sourcePath, ctx, cacheKey);
			ctx.addChild(block);
		});

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
		this.registerEvent(this.app.workspace.on('editor-menu', (menu, editor) => {
			menu.addItem(item => item
				.setTitle(t('insertRichTableBlock'))
				.setIcon('table')
				.onClick(() => this.insertRichTableBlock(editor)));
		}));
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

	async loadSettings(): Promise<void> {
		this.settings = Object.assign(
			{},
			DEFAULT_SETTINGS,
			(await this.loadData()) as Partial<BetterTableSettings>,
		);
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
		this.choiceRegistry = new ChoiceRegistry(this.settings.customChoices);
		// Re-render all open reading views so allowReadingViewEdit takes effect
		// immediately without requiring the user to close and reopen the note.
		this.app.workspace.getLeavesOfType('markdown').forEach(leaf => {
			const view = leaf.view;
			if (view instanceof MarkdownView && view.getMode() === 'preview') {
				view.previewMode.rerender(true);
			}
		});
	}
}
