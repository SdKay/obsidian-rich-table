import { App, Modal, Notice, Setting } from 'obsidian';
import { t, fmt } from './i18n';
import { buildSequence, validateFill, DEFAULT_FILL, type FillKind, type FillSpec } from './sequenceFill';

const KINDS: { kind: FillKind; label: 'fillKindNumber' | 'fillKindCircled' | 'fillKindRoman' | 'fillKindDate' }[] = [
	{ kind: 'number', label: 'fillKindNumber' },
	{ kind: 'circled', label: 'fillKindCircled' },
	{ kind: 'roman', label: 'fillKindRoman' },
	{ kind: 'date', label: 'fillKindDate' },
];

const UNITS: { unit: FillSpec['unit']; label: 'fillUnitDay' | 'fillUnitWeek' | 'fillUnitMonth' | 'fillUnitYear' }[] = [
	{ unit: 'day', label: 'fillUnitDay' },
	{ unit: 'week', label: 'fillUnitWeek' },
	{ unit: 'month', label: 'fillUnitMonth' },
	{ unit: 'year', label: 'fillUnitYear' },
];

const FIELD_ERROR = { start: 'fillErrorStart', step: 'fillErrorStep', startDate: 'fillErrorDate' } as const;

/** The last choices made, so filling a second column starts where the first ended. */
let remembered: FillSpec = { ...DEFAULT_FILL };

/** Asks how to fill `count` cells, then hands the finished values to `onFill`. */
export class FillSequenceModal extends Modal {
	private spec: FillSpec = { ...remembered };
	private preview!: HTMLElement;

	constructor(
		app: App,
		private readonly count: number,
		private readonly onFill: (values: string[]) => void,
	) {
		super(app);
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();
		this.setTitle(t('fillTitle'));

		new Setting(contentEl).setName(t('fillType')).addDropdown(d => {
			for (const { kind, label } of KINDS) d.addOption(kind, t(label));
			d.setValue(this.spec.kind).onChange(v => { this.spec.kind = v as FillKind; this.renderFields(fields); });
		});

		const fields = contentEl.createDiv();
		this.renderFields(fields);

		this.preview = contentEl.createDiv({ cls: 'bt-fill-preview' });
		this.updatePreview();

		new Setting(contentEl).addButton(b => b
			.setButtonText(t('fillSubmit'))
			.setCta()
			.onClick(() => this.submit()));
	}

	private renderFields(host: HTMLElement): void {
		host.empty();
		const isDate = this.spec.kind === 'date';

		if (isDate) {
			new Setting(host).setName(t('fillStartDate')).addText(x => {
				x.setPlaceholder('YYYY-MM-DD').setValue(this.spec.startDate).onChange(v => { this.spec.startDate = v.trim(); this.updatePreview(); });
			});
		} else {
			new Setting(host).setName(t('fillStart')).addText(x => {
				x.setValue(String(this.spec.start)).onChange(v => { this.spec.start = v.trim() === '' ? NaN : Number(v); this.updatePreview(); });
			});
		}

		new Setting(host).setName(t('fillStep')).addText(x => {
			x.setValue(String(this.spec.step)).onChange(v => { this.spec.step = v.trim() === '' ? NaN : Number(v); this.updatePreview(); });
		});

		if (isDate) {
			new Setting(host).setName(t('fillUnit')).addDropdown(d => {
				for (const { unit, label } of UNITS) d.addOption(unit, t(label));
				d.setValue(this.spec.unit).onChange(v => { this.spec.unit = v as FillSpec['unit']; this.updatePreview(); });
			});
		}
		this.updatePreview();
	}

	private updatePreview(): void {
		if (!this.preview) return;
		const problem = validateFill(this.spec);
		if (problem) { this.preview.setText(t(FIELD_ERROR[problem])); return; }
		const { values } = buildSequence(this.spec, Math.min(this.count, 4));
		this.preview.setText(`${values.join(', ')}${this.count > values.length ? ' …' : ''}`);
	}

	private submit(): void {
		const problem = validateFill(this.spec);
		if (problem) { new Notice(t(FIELD_ERROR[problem])); return; }
		const { values, fellBack } = buildSequence(this.spec, this.count);
		remembered = { ...this.spec };
		this.close();
		if (fellBack > 0) new Notice(fmt('fillFellBack', { n: fellBack }));
		this.onFill(values);
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
