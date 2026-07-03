import { MarkdownPostProcessorContext, MarkdownRenderChild, TFile } from 'obsidian';
import { isZh, t } from './i18n';
import type BetterTablePlugin from './main';
import type { TableModel } from './model';
import { parseTable } from './parser';
import { renderTable } from './renderer';
import { writeBackModel } from './writeBack';
import { applyStructuralOp, type StructuralOp } from './operations';

/**
 * Module-level render cache keyed by "sourcePath:lineStart".
 * When Obsidian rebuilds the code block after a write-back, the new instance
 * synchronously injects the cached DOM so the container is never blank —
 * same technique as drawio-view's contentCache.
 */
const renderCache = new Map<string, HTMLElement>();

function getEmptyTemplate(): string {
	if (isZh()) {
		return `\
---
title: 我的表格
columns:
  - { name: 功能, width: 190 }
  - { name: 使用方式, width: 240 }
  - { name: 状态, type: task-status }
  - { name: 备注, width: 160 }
merges:
  - D3:D4
styles:
  - { target: "1:1", bold: true, bg: "#e8f0fe" }
  - { target: "A2:A7", bold: true }
  - { target: "B3", bg: "#f0fdf4" }
  - { target: "D3:D4", bg: "#fef9c3", italic: true, size: 12 }
footer: "单击编辑 · 双击弹出操作菜单 · 拖拽 ⠿ 排序"
---
| 功能       | 使用方式                                         | 状态    | 备注              |
| ---------- | ------------------------------------------------ | ------- | ----------------- |
| 编辑单元格 | 单击任意单元格开始编辑                           | done    |                   |
| 双链补全   | 编辑器内输入 [[ 触发文件自动补全                 | done    | 合并单元格+字号12 |
| 类型列     | 单击有类型的单元格选择值                         | pending |                   |
| 合并单元格 | 拖拽选中多个格 → 双击弹窗点 Merge                | todo    |                   |
| 样式设置   | 双击 → 设置背景色/颜色/字号                      | todo    |                   |
| 拖拽排序   | 拖拽行左侧或列顶部的 ⠿ 手柄                     | todo    |                   |
| 调整宽高   | 拖拽列标题右边缘调列宽 · 拖拽行底边缘调行高      | todo    |                   |
`;
	}
	return `\
---
title: My Table
columns:
  - { name: Feature, width: 190 }
  - { name: How, width: 240 }
  - { name: Status, type: task-status }
  - { name: Note, width: 160 }
merges:
  - D3:D4
styles:
  - { target: "1:1", bold: true, bg: "#e8f0fe" }
  - { target: "A2:A7", bold: true }
  - { target: "B3", bg: "#f0fdf4" }
  - { target: "D3:D4", bg: "#fef9c3", italic: true, size: 12 }
footer: "Single-click to edit · double-click for cell menu · drag ⠿ to reorder"
---
| Feature       | How                                              | Status  | Note              |
| ------------- | ------------------------------------------------ | ------- | ----------------- |
| Edit cell     | Single-click any cell to start editing           | done    |                   |
| Wikilinks     | Type [[ inside editor for file autocomplete      | done    | Merged & size 12  |
| Choice column | Single-click typed cell to pick from dropdown    | pending |                   |
| Merge cells   | Drag-select → Merge in the double-click popup    | todo    |                   |
| Cell style    | Double-click → set bg / color / font size        | todo    |                   |
| Reorder       | Drag ⠿ handle on row left side or column top    | todo    |                   |
| Resize        | Drag column header right edge · row bottom edge  | todo    |                   |
`;
}


export class TableBlock extends MarkdownRenderChild {
	private model: TableModel | null = null;
	// Serialised write chain — every write is chained so they execute
	// strictly in order and can never interleave (same pattern as
	// obsidian-better-tables' queueWrite).
	private writeChain: Promise<void> = Promise.resolve();
	// Batch queue: ops that arrive in the same JS tick are collected so
	// only a single vault.process call is made for the whole batch.
	private pendingOps: StructuralOp[] = [];
	private writeBackScheduled = false;

	constructor(
		container: HTMLElement,
		private readonly source: string,
		private readonly plugin: BetterTablePlugin,
		private readonly sourcePath: string,
		private readonly ctx: MarkdownPostProcessorContext,
		private readonly cacheKey: string,
	) {
		super(container);
	}

	onload(): void {
		// Synchronous cache hit: keeps the container non-blank while async
		// render completes, eliminating the flash on write-back re-renders.
		const cached = renderCache.get(this.cacheKey);
		if (cached) {
			const clone = cached.cloneNode(true) as HTMLElement;
			while (clone.firstChild) {
				this.containerEl.appendChild(clone.firstChild);
			}
		}
		void this.render();
	}

	private async render(): Promise<void> {
		const tmp = createDiv();
		const isEmpty = this.source.trim() === '';
		try {
			const source = isEmpty ? getEmptyTemplate() : this.source;
			this.model = parseTable(source);
			await renderTable(
				this.model,
				() => this.plugin.choiceRegistry,
				tmp,
				this.plugin.app,
				this.sourcePath,
				this,
				isEmpty ? undefined : (row, col, value) => this.handleCellChange(row, col, value),
				isEmpty ? undefined : (colIdx, newType) => this.handleColTypeChange(colIdx, newType),
				isEmpty ? undefined : (op) => this.handleStructuralOp(op),
			);
			if (isEmpty) {
				const banner = createDiv({ cls: 'bt-template-banner' });
				banner.createSpan({ text: t('templatePreview') });
				const insertBtn = banner.createEl('button', {
					cls: 'bt-template-btn',
					text: t('insertTemplate'),
				});
				insertBtn.addEventListener('click', () => void this.insertTemplate());
				tmp.prepend(banner);
			}
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			tmp.empty();
			tmp.createDiv({ cls: 'bt-error', text: `Rich Table: ${msg}` });
		}

		// Update cache with the freshly rendered (non-interactive) snapshot
		renderCache.set(this.cacheKey, tmp.cloneNode(true) as HTMLElement);

		// Atomic swap: replace whatever is in containerEl (stale cache or nothing)
		this.containerEl.empty();
		while (tmp.firstChild) {
			this.containerEl.appendChild(tmp.firstChild);
		}
	}

	private async handleStructuralOp(op: StructuralOp): Promise<void> {
		if (!this.model) return;
		// Queue the op — it will be applied along with any other ops that
		// arrive in the same JS tick before the single write-back fires.
		this.pendingOps.push(op);
		if (this.writeBackScheduled) return; // already scheduled by an earlier op
		this.writeBackScheduled = true;

		await new Promise<void>(resolve => { window.setTimeout(resolve, 0); });
		this.writeBackScheduled = false;

		// Apply all queued ops at once.
		for (const pending of this.pendingOps) applyStructuralOp(this.model, pending);
		this.pendingOps = [];

		// Capture line info NOW (while containerEl is still attached to DOM).
		const file = this.plugin.app.vault.getAbstractFileByPath(this.sourcePath);
		if (!(file instanceof TFile)) return;
		const info = this.ctx.getSectionInfo(this.containerEl);

		// Chain onto the write queue so concurrent write-backs never interleave.
		const model = this.model;
		const ctx   = this.ctx;
		const el    = this.containerEl;
		const vault = this.plugin.app.vault;
		this.writeChain = this.writeChain.then(
			() => writeBackModel(model, el, ctx, vault, file, info),
			() => writeBackModel(model, el, ctx, vault, file, info),
		);
	}

	private async handleColTypeChange(colIdx: number, newType: string | undefined): Promise<void> {
		if (!this.model) return;

		const col = this.model.columns[colIdx];
		if (!col) return;

		col.type = newType;

		const file = this.plugin.app.vault.getAbstractFileByPath(this.sourcePath);
		if (!(file instanceof TFile)) return;

		await writeBackModel(this.model, this.containerEl, this.ctx, this.plugin.app.vault, file);
	}

	private async handleCellChange(row: number, col: number, value: string): Promise<void> {
		if (!this.model) return;

		const rowArr = this.model.rows[row];
		if (!rowArr) return;

		while (rowArr.length <= col) rowArr.push('');
		rowArr[col] = value;

		// Keep column definition in sync when the header row is edited
		if (row === 0) {
			const colDef = this.model.columns[col];
			if (colDef) colDef.name = value;
		}

		const file = this.plugin.app.vault.getAbstractFileByPath(this.sourcePath);
		if (!(file instanceof TFile)) return;

		await writeBackModel(this.model, this.containerEl, this.ctx, this.plugin.app.vault, file);
	}

	private async insertTemplate(): Promise<void> {
		const file = this.plugin.app.vault.getAbstractFileByPath(this.sourcePath);
		if (!(file instanceof TFile)) return;
		const info = this.ctx.getSectionInfo(this.containerEl);
		if (!info) return;
		await this.plugin.app.vault.process(file, content => {
			const lines = content.split('\n');
			return [
				...lines.slice(0, info.lineStart + 1),
				...getEmptyTemplate().trimEnd().split('\n'),
				...lines.slice(info.lineEnd),
			].join('\n');
		});
	}
}
