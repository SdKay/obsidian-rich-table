import { App, PluginSettingTab, Setting } from 'obsidian';
import type BetterTablePlugin from './main';
import type { BetterTableSettings, ChoiceType } from './model';

export const DEFAULT_SETTINGS: BetterTableSettings = {
	customChoices: [],
	allowReadingViewEdit: false,
	singleClickEdit: false,
};

export class BetterTableSettingTab extends PluginSettingTab {
	plugin: BetterTablePlugin;

	constructor(app: App, plugin: BetterTablePlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		new Setting(containerEl)
			.setName('Allow editing in reading view')
			.setDesc(
				'When off (default), all interactive behaviour — hover selector strips, ' +
				'click-to-edit, double-click panels, choice dropdowns — is disabled in ' +
				"Obsidian's reading view. Live preview / source mode is always interactive.",
			)
			.addToggle(toggle =>
				toggle
					.setValue(this.plugin.settings.allowReadingViewEdit)
					.onChange(async (value) => {
						this.plugin.settings.allowReadingViewEdit = value;
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName('Single-click to edit')
			.setDesc(
				'When on, a single click on a cell enters edit mode immediately (no ~200ms delay), ' +
				'and the style panel opens with Ctrl/Cmd+click instead of double-click. Speeds up ' +
				'rapid consecutive editing. When off (default), single click enters edit after a short ' +
				'delay and double click opens the style panel.',
			)
			.addToggle(toggle =>
				toggle
					.setValue(this.plugin.settings.singleClickEdit)
					.onChange(async (value) => {
						this.plugin.settings.singleClickEdit = value;
						await this.plugin.saveSettings();
					}),
			);

		// ── Built-in types (informational) ───────────────────────────────────
		new Setting(containerEl).setName('Built-in types').setHeading();

		const builtinInfo = containerEl.createDiv({ cls: 'bt-builtin-info' });

		// Special types (non-choice)
		const dateRow = builtinInfo.createDiv({ cls: 'bt-builtin-row' });
		dateRow.createSpan({ cls: 'bt-builtin-id', text: 'date' });
		dateRow.createSpan({ cls: 'bt-builtin-pills', text: 'Date picker (YYYY-MM-DD)' });

		// Choice types
		const builtin = this.plugin.choiceRegistry.getAllTypes()
			.filter(t => this.plugin.choiceRegistry.getBuiltinIds().has(t.id));

		for (const type of builtin) {
			const row = builtinInfo.createDiv({ cls: 'bt-builtin-row' });
			row.createSpan({ cls: 'bt-builtin-id', text: type.id });
			const pills = row.createSpan({ cls: 'bt-builtin-pills' });
			for (const opt of type.options) {
				const pill = pills.createSpan({ cls: 'bt-choice bt-builtin-pill', text: opt.label ?? opt.value });
				if (opt.color) pill.setCssProps({ '--bt-choice-bg': opt.color });
			}
		}

		// ── Custom types ──────────────────────────────────────────────────────
		new Setting(containerEl).setName('Custom types').setHeading();

		const listEl = containerEl.createDiv({ cls: 'bt-custom-types-list' });
		this.renderList(listEl);
	}

	private renderList(listEl: HTMLElement): void {
		listEl.empty();

		for (let i = 0; i < this.plugin.settings.customChoices.length; i++) {
			this.renderType(listEl, i);
		}

		new Setting(listEl).addButton(btn =>
			btn.setButtonText('Add type').setCta().onClick(async () => {
				this.plugin.settings.customChoices.push({
					id: `type-${this.plugin.settings.customChoices.length + 1}`,
					options: [{ value: 'option-1', label: 'Option 1 (edit me)', color: '#a0c4ff' }],
				});
				await this.plugin.saveSettings();
				this.renderList(listEl);
			}),
		);
	}

	private renderType(listEl: HTMLElement, typeIdx: number): void {
		const type = this.plugin.settings.customChoices[typeIdx];
		if (!type) return;

		const typeEl = listEl.createDiv({ cls: 'bt-type-block' });

		// Type ID row
		new Setting(typeEl)
			.setName('Type ID')
			.addText(text =>
				text
					.setValue(type.id)
					.setPlaceholder('My-type')
					.onChange(async (v) => {
						type.id = v;
						await this.plugin.saveSettings();
					}),
			)
			.addExtraButton(btn =>
				btn
					.setIcon('trash')
					.setTooltip('Delete type')
					.onClick(async () => {
						this.plugin.settings.customChoices.splice(typeIdx, 1);
						await this.plugin.saveSettings();
						this.renderList(listEl);
					}),
			);

		// Options header
		typeEl.createEl('p', {
			cls: 'bt-options-header',
			text: 'Options (value · display label · color)',
		});

		// Options list
		const optionsEl = typeEl.createDiv({ cls: 'bt-options-list' });
		for (let i = 0; i < type.options.length; i++) {
			this.renderOption(optionsEl, type, typeIdx, i);
		}

		// Add option button
		new Setting(typeEl).addButton(btn =>
			btn.setButtonText('Add option').onClick(async () => {
				type.options.push({ value: '', label: '', color: '#e0e0e0' });
				await this.plugin.saveSettings();
				// Append only the new option row (no full re-render — keeps focus)
				this.renderOption(optionsEl, type, typeIdx, type.options.length - 1);
			}),
		);

		// Divider
		listEl.createEl('hr', { cls: 'bt-type-divider' });
	}

	private renderOption(
		optionsEl: HTMLElement,
		type: ChoiceType,
		typeIdx: number,
		optIdx: number,
	): void {
		const opt = type.options[optIdx];
		if (!opt) return;

		const row = optionsEl.createDiv({ cls: 'bt-option-row' });

		// Value
		const valueInput = row.createEl('input', {
			attr: { type: 'text', placeholder: 'Value', value: opt.value },
			cls: 'bt-opt-text',
		});
		valueInput.addEventListener('change', () => {
			const o = this.plugin.settings.customChoices[typeIdx]?.options[optIdx];
			if (o) o.value = valueInput.value;
			void this.plugin.saveSettings();
		});

		// Label
		const labelInput = row.createEl('input', {
			attr: { type: 'text', placeholder: 'Label', value: opt.label ?? '' },
			cls: 'bt-opt-text',
		});
		labelInput.addEventListener('change', () => {
			const o = this.plugin.settings.customChoices[typeIdx]?.options[optIdx];
			if (o) o.label = labelInput.value;
			void this.plugin.saveSettings();
		});

		// Color swatch + native picker
		const colorWrap = row.createDiv({ cls: 'bt-opt-color-wrap' });
		const colorInput = colorWrap.createEl('input', {
			attr: { type: 'color', value: hexFromColor(opt.color) },
			cls: 'bt-opt-color',
		});
		colorInput.addEventListener('change', () => {
			const o = this.plugin.settings.customChoices[typeIdx]?.options[optIdx];
			if (o) o.color = colorInput.value;
			void this.plugin.saveSettings();
		});

		// Delete option
		const del = row.createEl('button', { cls: 'bt-opt-delete', attr: { 'aria-label': 'Delete option' } });
		del.setText('×');
		del.addEventListener('click', () => {
			this.plugin.settings.customChoices[typeIdx]?.options.splice(optIdx, 1);
			void this.plugin.saveSettings();
			row.remove();
		});
	}
}

/** Converts any CSS color string to a #rrggbb hex for <input type=color>. Falls back to #808080. */
function hexFromColor(color: string | undefined): string {
	if (!color) return '#808080';
	// Already hex
	if (/^#[0-9a-f]{6}$/i.test(color)) return color;
	// Simple rgba → approximate hex (strip alpha, round)
	const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(color);
	if (m) {
		const r = parseInt(m[1] ?? '128').toString(16).padStart(2, '0');
		const g = parseInt(m[2] ?? '128').toString(16).padStart(2, '0');
		const b = parseInt(m[3] ?? '128').toString(16).padStart(2, '0');
		return `#${r}${g}${b}`;
	}
	return '#808080';
}
