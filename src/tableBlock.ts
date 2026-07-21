import { MarkdownPostProcessorContext, MarkdownRenderChild, TFile, setIcon } from 'obsidian';
import { isZh, t, tableVersionTooHighMsg } from './i18n';
import { CURRENT_TABLE_VERSION, getTableVersion, migrateSource } from './tableVersion';
import type BetterTablePlugin from './main';
import type { TableModelV2 } from './model';
import { parseTable } from './parser';
import { serializeTable } from './serializer';
import { renderTable } from './renderer';
import { applyStructuralOpV2, type StructuralOpV2 } from './operations';
import zhTemplate from './templates/zh.yaml';
import enTemplate from './templates/en.yaml';

/**
 * Module-level render cache keyed by "sourcePath:lineStart".
 * When Obsidian rebuilds the code block after a write-back, the new instance
 * synchronously injects the cached DOM so the container is never blank —
 * same technique as drawio-view's contentCache.
 */
const renderCache = new Map<string, HTMLElement>();

function getEmptyTemplate(): string {
	return isZh() ? zhTemplate : enTemplate;
}


/** True when the table's YAML front-matter contains `noUpgrade: true`. */
function hasUpgradeSuppressed(source: string): boolean {
	const lines = source.split('\n');
	if (lines[0]?.trim() !== '---') return false;
	for (let i = 1; i < lines.length; i++) {
		if (lines[i]?.trim() === '---') break;
		if (/^noUpgrade:\s*true/.test(lines[i] ?? '')) return true;
	}
	return false;
}

export class TableBlock extends MarkdownRenderChild {
	private model: TableModelV2 | null = null;
	// Reference to the rendered bt-render-root element — used for instant theme updates.
	private renderedRoot: HTMLElement | null = null;
	// Serialised write chain — strictly ordered so concurrent writes never interleave.
	private writeChain: Promise<void> = Promise.resolve();
	// Batch queue: ops arriving in the same JS tick are applied together in one write.
	private pendingOps: StructuralOpV2[] = [];
	private writeBackScheduled = false;
	// True during the atomic DOM swap in render() — strips must not show while
	// containerEl is being rebuilt (stale or double-root rects are unreliable).
	private isRendering = false;

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
		// render completes, eliminating the blank flash on write-back re-renders.
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

		// ── Format-version gate ───────────────────────────────────────────────
		if (!isEmpty) {
			const tableV = getTableVersion(this.source);
			if (tableV > CURRENT_TABLE_VERSION) {
				// Table was written by a newer plugin — refuse to parse and tell the user.
				const banner = tmp.createDiv({ cls: 'bt-version-banner' });
				const icon = banner.createSpan({ cls: 'bt-version-banner-icon' });
				setIcon(icon, 'arrow-up-circle');
				const msg = banner.createDiv({ cls: 'bt-version-banner-body' });
				msg.createSpan({ text: tableVersionTooHighMsg(tableV, CURRENT_TABLE_VERSION) });
				const btn = msg.createEl('button', {
					cls: 'bt-version-banner-btn',
					text: isZh() ? '前往社区商店升级' : 'Open in Community Store',
				});
				btn.addEventListener('click', () => {
					window.open('obsidian://show-plugin?id=rich-table');
				});
				this.containerEl.empty();
				while (tmp.firstChild) this.containerEl.appendChild(tmp.firstChild);
				return;
			}
			if (tableV < CURRENT_TABLE_VERSION && !hasUpgradeSuppressed(this.source)) {
				// Table uses an older format — show upgrade banner; user must opt in.
				const banner = tmp.createDiv({ cls: 'bt-upgrade-banner' });
				const iconEl = banner.createSpan({ cls: 'bt-upgrade-banner-icon' });
				setIcon(iconEl, 'sparkles');
				const msg = banner.createDiv({ cls: 'bt-upgrade-banner-body' });
				msg.createSpan({
					text: isZh()
						? '该表格使用旧版格式，新版格式支持更多功能。转换时将自动修改表格代码块，可用 Ctrl+Z 撤回。'
						: 'This table uses an older format. The new format supports more features. Converting will update the code block — you can undo with Ctrl+Z.',
				});
				const btnRow = msg.createDiv({ cls: 'bt-upgrade-banner-btns' });
				const upgradeBtn = btnRow.createEl('button', {
					cls: 'bt-upgrade-banner-btn',
					text: isZh() ? '转换到新版格式' : 'Convert to new format',
				});
				upgradeBtn.addEventListener('click', () => void this.applyMigration(tableV));
				const ignoreBtn = btnRow.createEl('button', {
					cls: 'bt-upgrade-banner-btn bt-upgrade-banner-btn-muted',
					text: isZh() ? '继续使用旧版' : 'Keep old format',
				});
				ignoreBtn.addEventListener('click', () => void this.suppressUpgradeBanner());
				// Also render the table below the banner so it remains usable.
			}
		}

		// Defer one frame so containerEl is in its final DOM position.
		// On initial load and write-back re-renders, Obsidian calls the processor
		// BEFORE inserting containerEl into .markdown-reading-view, so an immediate
		// closest() check returns null. After rAF the DOM is settled.
		// Do NOT check isConnected — CM6 may destroy/recreate live-preview widgets
		// between the render call and the rAF; rendering to a detached el is harmless.
		await new Promise<void>(r => window.requestAnimationFrame(() => r()));

		// .markdown-reading-view is the correct selector — same as v1, works after rAF.
		const isReadingView = !!(this.containerEl.closest('.markdown-reading-view'));
		const editAllowed   = (!isReadingView || this.plugin.settings.allowReadingViewEdit);

		const source     = isEmpty ? getEmptyTemplate() : this.source;
		const tableV     = isEmpty ? CURRENT_TABLE_VERSION : getTableVersion(source);
		// isOldFormat: v1 tables are read-only until the user explicitly upgrades.
		// Also prevents the lock button from accidentally triggering a v1→v2 write-back.
		const isOldFormat   = !isEmpty && tableV < CURRENT_TABLE_VERSION;
		// lockAvailable: only for current-format tables in live-preview mode.
		const lockAvailable = !isReadingView && !isEmpty && !isOldFormat;

		try {
			if (tableV >= CURRENT_TABLE_VERSION) {
				// Current-format table: parse directly.
				this.model = parseTable(source);
			} else {
				// Older format: migrate in-memory for a read-only preview.
				this.model = parseTable(migrateSource(source, tableV));
			}
			const locked = this.model.locked ?? false;
			await renderTable(
				this.model,
				() => this.plugin.choiceRegistry,
				tmp,
				this.plugin.app,
				this.sourcePath,
				this,
				(isEmpty || !editAllowed || locked || isOldFormat) ? undefined : (op) => this.handleStructuralOp(op),
				lockAvailable ? () => this.handleStructuralOp({ type: 'toggle-lock' }) : undefined,
				(root) => { this.renderedRoot = root; },
				() => this.isRendering,
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

		// Atomic swap: guard so showEdgeStrips rejects any attempt to display strips
		// during the window between containerEl.empty() and the new root being in DOM.
		this.isRendering = true;
		this.containerEl.empty();
		while (tmp.firstChild) {
			this.containerEl.appendChild(tmp.firstChild);
		}
		// Force a synchronous reflow so the next getBoundingClientRect() reads the
		// settled layout, then clear the guard.
		void this.containerEl.getBoundingClientRect();
		this.isRendering = false;

		// Bridge --bt-title-mb-pull from root to sibling titleEl.
		// CSS custom properties only inherit to descendants; a theme sets the variable
		// on root to express its intent (e.g. 0px = no pull-close with visible border),
		// and the renderer propagates it to the title after the atomic swap so that
		// getComputedStyle() can read the live stylesheet value (detached elements
		// don't resolve stylesheet-declared custom properties).
		const rootEl = this.containerEl.querySelector<HTMLElement>('.bt-render-root');
		const titleEl = this.containerEl.querySelector<HTMLElement>('.bt-table-title');
		if (rootEl && titleEl) {
			const pull = getComputedStyle(rootEl).getPropertyValue('--bt-title-mb-pull').trim();
			if (pull) titleEl.style.setProperty('--bt-title-mb-pull', pull);
			else      titleEl.style.removeProperty('--bt-title-mb-pull');
		}
	}

	private async handleStructuralOp(op: StructuralOpV2): Promise<void> {
		if (!this.model) return;

		// Theme changes: apply the CSS class immediately so the switch is instant,
		// without waiting for write-back → re-render (which would cause a flash).
		// Also patch the render cache so the cache-inject path in the next onload()
		// already shows the new theme, preventing the A→B→A→B triple flash.
		if (op.type === 'set-theme' && this.renderedRoot) {
			const newClass = op.theme
				? `bt-render-root bt-theme-${op.theme}`
				: 'bt-render-root';
			this.renderedRoot.className = newClass;
			const cached = renderCache.get(this.cacheKey);
			if (cached) {
				const cachedRoot = cached.querySelector<HTMLElement>('.bt-render-root');
				if (cachedRoot) cachedRoot.className = newClass;
			}
		}

		// Same instant-apply treatment for collapse/expand — toggled onto the existing
		// class list (not overwritten) since a theme class may already be present.
		if (op.type === 'toggle-collapse' && this.renderedRoot) {
			const willCollapse = !this.model.collapsed;
			this.renderedRoot.toggleClass('bt-collapsed', willCollapse);
			const cachedRoot = renderCache.get(this.cacheKey)?.querySelector<HTMLElement>('.bt-render-root');
			cachedRoot?.toggleClass('bt-collapsed', willCollapse);
		}

		// Queue the op — it will be applied along with any other ops that
		// arrive in the same JS tick before the single write-back fires.
		this.pendingOps.push(op);
		if (this.writeBackScheduled) return; // already scheduled by an earlier op
		this.writeBackScheduled = true;
		// Freeze any running theme animations now — this root is about to be replaced by
		// the re-render this write triggers, so there's nothing to lose visually, and the
		// main thread is freed up to resolve the write promptly instead of competing with
		// continuous repaints (see .bt-write-pending in styles.css).
		this.renderedRoot?.addClass('bt-write-pending');

		await new Promise<void>(resolve => { window.setTimeout(resolve, 0); });
		this.writeBackScheduled = false;

		// Apply all queued ops to the v2 model in order.
		for (const pending of this.pendingOps) {
			applyStructuralOpV2(this.model, pending);
		}
		this.pendingOps = [];

		// Capture line info NOW (while containerEl is still attached to DOM).
		const file = this.plugin.app.vault.getAbstractFileByPath(this.sourcePath);
		if (!(file instanceof TFile)) return;
		const info = this.ctx.getSectionInfo(this.containerEl);

		// Serialize the updated v2 model and write it back.
		const newSource = serializeTable(this.model);
		this.writeChain = this.writeChain.then(
			() => this.writeRawSource(newSource, this.plugin.app.vault, file, info),
			() => this.writeRawSource(newSource, this.plugin.app.vault, file, info),
		);
	}

	/** Write a raw source string back into the vault, replacing the block content. */
	private async writeRawSource(
		newSource: string,
		vault: typeof this.plugin.app.vault,
		file: TFile,
		info: ReturnType<typeof this.ctx.getSectionInfo>,
	): Promise<void> {
		if (!info) return;
		await vault.process(file, content => {
			const lines = content.split('\n');
			return [
				...lines.slice(0, info.lineStart + 1),
				...newSource.trimEnd().split('\n'),
				...lines.slice(info.lineEnd),
			].join('\n');
		});
	}

	/** Write `noUpgrade: true` into the code block front-matter to suppress future banners. */
	private async suppressUpgradeBanner(): Promise<void> {
		const file = this.plugin.app.vault.getAbstractFileByPath(this.sourcePath);
		if (!(file instanceof TFile)) return;
		const info = this.ctx.getSectionInfo(this.containerEl);
		if (!info) return;
		await this.plugin.app.vault.process(file, content => {
			const lines = content.split('\n');
			const blockLines = lines.slice(info.lineStart + 1, info.lineEnd);
			if (blockLines[0]?.trim() === '---') {
				// Front-matter exists — insert noUpgrade after opening ---
				blockLines.splice(1, 0, 'noUpgrade: true');
			} else {
				// No front-matter yet — add a minimal one
				blockLines.unshift('---', 'noUpgrade: true', '---');
			}
			return [
				...lines.slice(0, info.lineStart + 1),
				...blockLines,
				...lines.slice(info.lineEnd),
			].join('\n');
		});
	}

	private async applyMigration(fromVersion: number): Promise<void> {
		const file = this.plugin.app.vault.getAbstractFileByPath(this.sourcePath);
		if (!(file instanceof TFile)) return;
		const info = this.ctx.getSectionInfo(this.containerEl);
		if (!info) return;
		const migratedSource = migrateSource(this.source, fromVersion);
		await this.plugin.app.vault.process(file, content => {
			const lines = content.split('\n');
			return [
				...lines.slice(0, info.lineStart + 1),
				...migratedSource.trimEnd().split('\n'),
				...lines.slice(info.lineEnd),
			].join('\n');
		});
	}

	private async insertTemplate(): Promise<void> {
		const file = this.plugin.app.vault.getAbstractFileByPath(this.sourcePath);
		if (!(file instanceof TFile)) return;
		const info = this.ctx.getSectionInfo(this.containerEl);
		if (!info) return;
		// Template is already v2 format — insert directly.
		const v2Template = getEmptyTemplate();
		await this.plugin.app.vault.process(file, content => {
			const lines = content.split('\n');
			return [
				...lines.slice(0, info.lineStart + 1),
				...v2Template.trimEnd().split('\n'),
				...lines.slice(info.lineEnd),
			].join('\n');
		});
	}
}

