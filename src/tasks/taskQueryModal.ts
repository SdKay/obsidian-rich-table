/**
 * Where the query of a tasks table is written: a box of several lines, one condition per line. Saving hands the text
 * on; closing the dialog any other way changes nothing.
 */
import { App, Modal, Setting } from 'obsidian';
import { t } from '../i18n';

export class TaskQueryModal extends Modal {
	private text: string;

	constructor(app: App, query: string, private readonly onSave: (query: string) => void) {
		super(app);
		this.text = query;
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();
		this.setTitle(t('tasksQueryTitle'));
		contentEl.createEl('p', { cls: 'bt-tasks-query-help', text: t('tasksQueryHelp') });
		const input = contentEl.createEl('textarea', { cls: 'bt-tasks-query-input', attr: { rows: '8', spellcheck: 'false' } });
		input.value = this.text;
		input.placeholder = t('tasksQueryPlaceholder');
		input.addEventListener('input', () => { this.text = input.value; });
		// Ctrl/Cmd+Enter saves, as in Obsidian's other multi-line inputs; Enter alone is a new line.
		input.addEventListener('keydown', e => {
			if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); this.save(); }
		});
		new Setting(contentEl).addButton(b => b.setButtonText(t('tasksQuerySave')).setCta().onClick(() => this.save()));
		window.setTimeout(() => input.focus(), 0);
	}

	private save(): void {
		const query = this.text.trim();
		this.close();
		this.onSave(query === '' ? '' : `${query}\n`);
	}
}
