import { AbstractInputSuggest, App, TFile } from 'obsidian';

// Selection.modify is non-standard but available in Chromium/Electron
type SelectionWithModify = Selection & {
	modify(alter: 'move' | 'extend', direction: 'forward' | 'backward', granularity: 'character' | 'word' | 'line'): void;
};

type SuggestionItem =
	| { type: 'file';    file: TFile; linkText: string }
	| { type: 'heading'; file: TFile; heading: string; level: number; linkText: string }
	| { type: 'block';   file: TFile; blockId: string; linkText: string;
	    preview: string; lineEnd: number; existingId: boolean; sectionType: string };

function generateBlockId(): string {
	const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
	let id = '';
	for (let i = 0; i < 6; i++) id += chars[Math.floor(Math.random() * chars.length)];
	return id;
}

/**
 * Wikilink suggest for contenteditable cell editors.
 * Extends AbstractInputSuggest so the popup uses Obsidian's native UI.
 *
 * getValue() is overridden to return the cursor-aware query (text after [[),
 * which is what AbstractInputSuggest passes to getSuggestions().
 *
 * Bracket auto-pairing is handled via beforeinput + execCommand so the
 * resulting input events are isTrusted=true and AbstractInputSuggest
 * picks them up correctly.
 */
export class WikilinkInputSuggest extends AbstractInputSuggest<SuggestionItem> {
	/** Set by getValue() so getSuggestions() knows whether the trigger is active. */
	private triggered = false;

	constructor(
		app: App,
		private readonly divEl: HTMLDivElement,
		private readonly sourcePath: string,
	) {
		super(app, divEl);

		this.onSelect((item) => { this.insertItem(item); });

		divEl.addEventListener('beforeinput', (evt: InputEvent) => {
			this.handleBracketPairing(evt);
		});
	}

	// ── AbstractInputSuggest overrides ────────────────────────────────────────

	/**
	 * Returns the text between the last [[ and the cursor.
	 * Returns '' (with triggered=false) when the cursor is outside a [[ context.
	 */
	getValue(): string {
		const sel = activeWindow.getSelection();
		if (!sel || sel.rangeCount === 0 || !this.divEl.contains(sel.anchorNode)) {
			this.triggered = false;
			return '';
		}

		const range = sel.getRangeAt(0).cloneRange();
		range.selectNodeContents(this.divEl);
		const anchorNode = sel.anchorNode;
		if (!anchorNode) { this.triggered = false; return ''; }
		range.setEnd(anchorNode, sel.anchorOffset);

		const before   = range.toString();
		const lastOpen = before.lastIndexOf('[[');

		if (lastOpen === -1) { this.triggered = false; return ''; }

		const query = before.slice(lastOpen + 2);

		// Stop suggesting when user types | (alias) or is past a closed ]]
		if (query.includes('|') || query.includes(']]') || query.includes('\n')) {
			this.triggered = false;
			return '';
		}

		this.triggered = true;
		return query; // may be '' → show all files
	}

	getSuggestions(query: string): SuggestionItem[] | Promise<SuggestionItem[]> {
		if (!this.triggered) return [];

		// [[file#^id  → block ref (check #^ before plain #)
		const hashCaretIdx = query.indexOf('#^');
		// [[file#heading
		const hashIdx      = query.indexOf('#');
		// [[^ or [[file^ (legacy / shorthand, no # separator)
		const caretIdx     = query.indexOf('^');

		// [[file#^id  or  [[#^id (explicit current-file block ref)
		if (hashCaretIdx !== -1) return this.blockSuggestions(query.slice(0, hashCaretIdx), query.slice(hashCaretIdx + 2), false);
		// [[file#heading
		if (hashIdx      !== -1) return this.headingSuggestions(query.slice(0, hashIdx), query.slice(hashIdx + 1));
		if (caretIdx !== -1) {
			if (caretIdx > 0) {
				// [[file^query — file-specific block search
				return this.blockSuggestions(query.slice(0, caretIdx), query.slice(caretIdx + 1), false);
			}
			// [[^query — current file blocks
			return this.blockSuggestions('', query.slice(1), true);
		}
		return this.fileSuggestions(query);
	}

	renderSuggestion(item: SuggestionItem, el: HTMLElement): void {
		const content = el.createDiv({ cls: 'suggestion-content' });
		if (item.type === 'file') {
			content.createDiv({ cls: 'suggestion-title', text: item.file.basename });
			if (item.file.parent && !item.file.parent.isRoot()) {
				content.createDiv({ cls: 'suggestion-note', text: item.file.parent.path });
			}
		} else if (item.type === 'heading') {
			content.createDiv({ cls: 'suggestion-title', text: item.heading });
			content.createDiv({ cls: 'suggestion-note', text: '#'.repeat(item.level) + '  ' + item.file.basename });
		} else {
			content.createDiv({ cls: 'suggestion-title', text: item.preview });
			content.createDiv({
				cls: 'suggestion-note',
				text: (item.existingId ? '^' + item.blockId : '(new block)') + '  ' + item.file.basename,
			});
		}
	}

	// ── Insertion ─────────────────────────────────────────────────────────────

	private insertItem(item: SuggestionItem): void {
		// For new blocks: write ^id back to the target file
		if (item.type === 'block' && !item.existingId) {
			void this.writeBlockId(item.file, item.lineEnd, item.blockId, item.sectionType);
		}
		const fullText = this.divEl.textContent ?? '';
		const cursorPos = this.getCursorOffset();
		const before = fullText.slice(0, cursorPos);

		const lastOpen = before.lastIndexOf('[[');
		if (lastOpen === -1) return;

		// Preserve any alias the user typed (|alias part)
		const typed    = before.slice(lastOpen + 2);
		const pipeIdx  = typed.indexOf('|');
		const alias    = pipeIdx !== -1 ? typed.slice(pipeIdx) : '';

		const after = fullText.slice(cursorPos);
		// Consume ]] (full auto-pair) or a single orphaned ] (from [[| pairing)
		const trailing = after.startsWith(']]') ? after.slice(2) :
		                 after.startsWith(']')  ? after.slice(1) : after;

		this.divEl.textContent = fullText.slice(0, lastOpen) + `[[${item.linkText}${alias}]]` + trailing;
		this.setCursorOffset(lastOpen + 2 + item.linkText.length + alias.length + 2);
	}

	// ── Bracket auto-pairing ─────────────────────────────────────────────────

	/** Insert text at the current cursor position and fire an input event so
	 *  AbstractInputSuggest updates its suggestion list. */
	private insertAtCursor(text: string): void {
		const sel = activeWindow.getSelection();
		if (!sel || sel.rangeCount === 0) return;
		const range = sel.getRangeAt(0);
		range.deleteContents();
		const node = activeDocument.createTextNode(text);
		range.insertNode(node);
		range.setStartAfter(node);
		range.setEndAfter(node);
		sel.removeAllRanges();
		sel.addRange(range);
		this.divEl.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }));
	}

	private handleBracketPairing(evt: InputEvent): void {
		if (evt.data === '[') {
			evt.preventDefault();

			if (this.getCharBefore() === '[' && this.getCharAfter() === ']') {
				// Cursor between [|] → insert [ only, giving [[|]
				// Cursor ends up between [[ and ] immediately, so AbstractInputSuggest
				// receives the input event with triggered=true and opens the popup at once.
				// The orphaned ] is consumed by insertItem or skipped when user types ]].
				this.insertAtCursor('[');
			} else {
				// Normal → insert [|]
				this.insertAtCursor('[]');
				this.moveCursor('backward', 1);
			}
		} else if (evt.data === ']' && this.getCharAfter() === ']') {
			evt.preventDefault();
			this.moveCursor('forward', 1);
		}
	}

	// ── Cursor helpers ────────────────────────────────────────────────────────

	private getCursorOffset(): number {
		const sel = activeWindow.getSelection();
		if (!sel || sel.rangeCount === 0) return 0;
		const range = sel.getRangeAt(0).cloneRange();
		range.selectNodeContents(this.divEl);
		const anchorNode = sel.anchorNode;
		if (!anchorNode) return 0;
		range.setEnd(anchorNode, sel.anchorOffset);
		return range.toString().length;
	}

	private setCursorOffset(offset: number): void {
		const walker = activeDocument.createTreeWalker(this.divEl, NodeFilter.SHOW_TEXT);
		let remaining = offset;
		let targetNode: Node | null = null;
		let targetOffset = 0;

		while (walker.nextNode()) {
			const node = walker.currentNode as Text;
			if (remaining <= node.length) {
				targetNode = node;
				targetOffset = remaining;
				break;
			}
			remaining -= node.length;
		}

		const range = activeDocument.createRange();
		const sel   = activeWindow.getSelection();

		if (targetNode) {
			range.setStart(targetNode, targetOffset);
		} else {
			range.setStart(this.divEl, this.divEl.childNodes.length);
		}
		range.collapse(true);
		sel?.removeAllRanges();
		sel?.addRange(range);
	}

	private getCharAfter(): string {
		const sel = activeWindow.getSelection();
		if (!sel || sel.rangeCount === 0) return '';
		try {
			const r = sel.getRangeAt(0).cloneRange();
			r.collapse(false);
			r.setEnd(r.endContainer, r.endOffset + 1);
			return r.toString();
		} catch { return ''; }
	}

	private getCharBefore(): string {
		const sel = activeWindow.getSelection();
		if (!sel || sel.rangeCount === 0) return '';
		try {
			const r = sel.getRangeAt(0).cloneRange();
			r.collapse(true);
			r.setStart(r.startContainer, r.startOffset - 1);
			return r.toString();
		} catch { return ''; }
	}

	private moveCursor(direction: 'forward' | 'backward', count: number): void {
		// sel.modify is non-standard (Chromium/Electron)
		// eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion -- sel.modify is non-standard; cast needed to access Chromium/Electron extension
		const sel = activeWindow.getSelection() as unknown as SelectionWithModify | null;
		if (!sel) return;
		for (let i = 0; i < count; i++) {
			sel.modify('move', direction, 'character');
		}
	}

	// ── Suggestion builders ───────────────────────────────────────────────────

	private fileSuggestions(query: string): SuggestionItem[] {
		const q = query.toLowerCase();
		return this.app.vault.getMarkdownFiles()
			.filter(f =>
				f.basename.toLowerCase().includes(q) ||
				f.path.slice(0, -3).toLowerCase().includes(q),
			)
			.sort((a, b) => {
				const ap = a.basename.toLowerCase().startsWith(q) ? 0 : 1;
				const bp = b.basename.toLowerCase().startsWith(q) ? 0 : 1;
				return ap - bp || a.basename.localeCompare(b.basename);
			})
			.slice(0, 20)
			.map(f => ({ type: 'file' as const, file: f, linkText: this.shortestPath(f) }));
	}

	private headingSuggestions(filePart: string, headingQuery: string): SuggestionItem[] {
		const target = this.resolveFile(filePart);
		if (!target) return [];

		const hq       = headingQuery.toLowerCase();
		const headings = this.app.metadataCache.getFileCache(target)?.headings ?? [];
		const filePath = filePart === '' ? '' : this.shortestPath(target);

		return headings
			.filter(h => h.heading.toLowerCase().includes(hq))
			.slice(0, 20)
			.map(h => ({
				type:     'heading' as const,
				file:     target,
				heading:  h.heading,
				level:    h.level,
				linkText: `${filePath}#${h.heading}`,
			}));
	}

	/** Cross-vault search: all existing ^id blocks + current file untagged sections. */
	private async crossVaultBlockSuggestions(blockQuery: string): Promise<SuggestionItem[]> {
		const bq      = blockQuery.toLowerCase();
		const results: SuggestionItem[] = [];

		// 1. All files — existing block IDs (fast, metadata only)
		for (const file of this.app.vault.getMarkdownFiles()) {
			if (results.length >= 18) break;
			const blocks   = this.app.metadataCache.getFileCache(file)?.blocks ?? {};
			const filePath = this.shortestPath(file);
			for (const [id] of Object.entries(blocks)) {
				if (bq && !id.toLowerCase().includes(bq)) continue;
				results.push({
					type: 'block', file, blockId: id,
					linkText: `${filePath}#^${id}`,
					preview: `^${id}`, lineEnd: -1, existingId: true, sectionType: 'paragraph',
				});
				if (results.length >= 18) break;
			}
		}

		// 2. Current file — untagged sections (needs file read)
		if (results.length < 20) {
			const currentFile = this.app.vault.getAbstractFileByPath(this.sourcePath);
			if (currentFile instanceof TFile) {
				const more = await this.blockSuggestions('', blockQuery, true);
				for (const r of more) {
					if (r.type === 'block' && !r.existingId) results.push(r);
					if (results.length >= 20) break;
				}
			}
		}

		return results;
	}

	private async blockSuggestions(filePart: string, blockQuery: string, currentFileMode: boolean): Promise<SuggestionItem[]> {
		let target: TFile | undefined;
		if (currentFileMode) {
			const f = this.app.vault.getAbstractFileByPath(this.sourcePath);
			target = f instanceof TFile ? f : undefined;
		} else {
			target = this.resolveFile(filePart);
		}
		if (!target) return [];

		const cache    = this.app.metadataCache.getFileCache(target);
		const existing = Object.entries(cache?.blocks ?? {});
		const sections = cache?.sections ?? [];
		const bq       = blockQuery.toLowerCase();
		// [[file#^id]] — # is mandatory; [[#^id]] for current-file refs
		const filePath = currentFileMode ? '' : (filePart === '' ? '' : this.shortestPath(target));
		const prefix   = (id: string) => filePath ? `${filePath}#^${id}` : `#^${id}`;
		const results: SuggestionItem[] = [];

		// 1. Already-tagged blocks
		for (const [id] of existing) {
			if (bq && !id.toLowerCase().includes(bq)) continue;
			results.push({
				type: 'block', file: target, blockId: id,
				linkText: prefix(id),
				preview: `^${id}`, lineEnd: -1, existingId: true, sectionType: 'paragraph',
			});
		}

		// 2. All sections as potential targets
		const content = await this.app.vault.cachedRead(target);
		const lines   = content.split('\n');

		for (const section of sections) {
			if (results.length >= 50) break;

			const lineEnd  = section.position.end.line;
			const lastLine = lines[lineEnd] ?? '';
			if (/\^[a-zA-Z0-9-]+\s*$/.test(lastLine)) continue; // already tagged

			const sectionLines = lines.slice(section.position.start.line, lineEnd + 1);
			const preview = sectionLines.map(l => l.trim()).find(l => l.length > 0) ?? '';
			if (!preview) continue;
			if (bq && !preview.toLowerCase().includes(bq)) continue;

			const newId = generateBlockId();
			results.push({
				type: 'block', file: target, blockId: newId,
				linkText: prefix(newId),
				preview:  preview.length > 60 ? preview.slice(0, 60) + '…' : preview,
				lineEnd,
				existingId:  false,
				sectionType: section.type,
			});
		}

		return results;
	}

	/**
	 * Writes ^blockId to the target file.
	 * - code / blockquote / callout / html: insert on a NEW line after the block
	 * - paragraph / heading / list / etc.:  append to the end of the last line
	 */
	private async writeBlockId(
		file: TFile,
		lineEnd: number,
		blockId: string,
		sectionType: string,
	): Promise<void> {
		// Section types where the ID must go on its own line
		const needsNewLine = ['code', 'blockquote', 'callout', 'html'].includes(sectionType);

		await this.app.vault.process(file, content => {
			const lines = content.split('\n');
			const line  = lines[lineEnd];
			if (line === undefined || /\^[a-zA-Z0-9-]+\s*$/.test(line)) return content;

			if (needsNewLine) {
				lines.splice(lineEnd + 1, 0, '', '^' + blockId);
			} else {
				lines[lineEnd] = line.trimEnd() + ' ^' + blockId;
			}
			return lines.join('\n');
		});
	}

	private resolveFile(filePart: string): TFile | undefined {
		if (filePart === '') {
			const f = this.app.vault.getAbstractFileByPath(this.sourcePath);
			return f instanceof TFile ? f : undefined;
		}
		const fp  = filePart.toLowerCase();
		const all = this.app.vault.getMarkdownFiles();
		return (
			all.find(f => this.shortestPath(f).toLowerCase() === fp) ??
			all.find(f => f.basename.toLowerCase() === fp) ??
			all.find(f => this.shortestPath(f).toLowerCase().includes(fp))
		);
	}

	private shortestPath(file: TFile): string {
		const unique = this.app.vault.getMarkdownFiles()
			.filter(f => f.basename === file.basename).length === 1;
		return unique ? file.basename : file.path.slice(0, -3);
	}
}
