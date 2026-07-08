import { MarkdownView, Plugin } from 'obsidian';
import { BetterTableSettingTab, DEFAULT_SETTINGS } from './settings';
import { ChoiceRegistry } from './choiceRegistry';
import { TableBlock } from './tableBlock';
import type { BetterTableSettings } from './model';
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
