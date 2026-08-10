import type { App } from 'obsidian';
import { WikilinkInputSuggest } from './wikilinkInputSuggest';
import type { CellChangeHandler, EditNavigateHandler, EditNavigateMove, StructuralOpHandler } from './renderTypes';
import { registerLiveEdit, clearLiveEdit } from './renderEditHandoff';
import type { TableModelV2 } from './model';
import { labelFormulaToIds } from './formulaLabel';

/**
 * Bundles everything formula-mode editing needs, so enterEditMode's already-
 * long parameter list gains exactly one new optional param instead of four.
 * Only passed for plain untyped columns (renderCell.ts's existing fallthrough
 * already restricts formula editing to those).
 */
export interface FormulaEditHooks {
	model: TableModelV2;
	rowId: string;
	colId: string;
	onStructuralOp: StructuralOpHandler;
	/** Fired once when the editor's content becomes formula-mode-eligible —
	 *  either the content is now exactly "=" (fresh formula being typed) or
	 *  the cell already held a formula being reopened. The renderer uses
	 *  `insertText` to wire "click another cell inserts a reference token at
	 *  the caret" for as long as formula mode stays active. */
	onEnterFormulaMode: (insertText: (label: string) => void) => void;
	onExitFormulaMode: () => void;
}

/**
 * `cacheKey` + `initialValue` are only present when this call is itself a
 * resume of an edit that a write-back-triggered rebuild interrupted (see
 * renderEditHandoff.ts) — `initialValue` then holds the draft text/date the
 * user had typed but not yet committed, instead of the cell's actual stored
 * value. `cacheKey` alone (with `initialValue` omitted) is what a normal,
 * first-time edit passes so this edit can register itself for a FUTURE
 * rebuild to resume, if one happens before this edit commits.
 */
export function enterDateEditMode(
	el: HTMLElement,
	currentValue: string,
	rowIdx: number,
	colIdx: number,
	onCellChange: CellChangeHandler,
	cacheKey?: string,
	initialValue?: string,
	onEditNavigate?: EditNavigateHandler,
): void {
	const savedNodes = Array.from(el.childNodes).map(n => n.cloneNode(true));
	el.empty();
	el.addClass('bt-editing');
	// Drops a hover tint the mouseover handler (renderer.ts) already applied
	// BEFORE this click — the common case, since a click happens with the
	// mouse already sitting on the cell — as an inline `!important` box-shadow.
	// `setHoverShadow`'s own `.bt-editing` guard only stops a FUTURE call from
	// re-applying it; it can't undo one already set, and no fresh `mouseover`
	// fires here since the pointer never actually moved. Removing it directly
	// is what actually matches Excel (reported: a grey-tinted cell that's
	// being edited still showed a "hover" wash mismatched against the editor's
	// own opaque background). `hoverShadowBase`'s cached pre-hover value is
	// untouched, so a later real mouseleave still restores it correctly.
	el.style.removeProperty('box-shadow');

	const input = el.createEl('input', {
		cls: 'bt-date-input',
		attr: { type: 'date', value: initialValue ?? currentValue },
	});

	if (cacheKey) registerLiveEdit(cacheKey, rowIdx, colIdx, () => input.value);

	let committed = false;

	/** See enterEditMode's save() for what `move` means. */
	const save = (move?: EditNavigateMove) => {
		if (committed) return;
		// A write-back rebuild tearing down this cell's old DOM detaches this
		// input while it's still focused, which fires a real `blur` — but the
		// browser's "remove a node" algorithm dispatches that `blur` as an
		// INTERMEDIATE step, before the node's connectedness is actually updated,
		// so `input.isConnected` still reads `true` here, synchronously, even
		// when this element is mid-removal (confirmed empirically: checking again
		// one microtask later correctly flips to `false`). A same-tick check
		// can't tell a teardown blur from a real user blur; deferring by one
		// microtask can, without any user-visible delay (nothing else can run in
		// between — microtasks drain before the next real event). See the
		// matching comment in enterEditMode's save() for the full story.
		queueMicrotask(() => {
			if (committed) return;
			if (!input.isConnected) return; // teardown blur — ignore; don't touch the registry
			committed = true;
			if (cacheKey) clearLiveEdit(cacheKey, rowIdx, colIdx);
			el.removeClass('bt-editing');
			// Before the commit — see the matching comment in enterEditMode's save().
			if (move) onEditNavigate?.(rowIdx, colIdx, move);
			if (input.value !== currentValue) {
				void onCellChange(rowIdx, colIdx, input.value);
			} else {
				el.empty();
				for (const node of savedNodes) el.appendChild(node);
			}
		});
	};

	/** Wrapper so a FocusEvent is never passed as save()'s `move` argument. */
	const onBlur = () => save();

	const cancel = (toSelected = false) => {
		if (committed) return;
		committed = true;
		if (cacheKey) clearLiveEdit(cacheKey, rowIdx, colIdx);
		input.removeEventListener('blur', onBlur);
		el.removeClass('bt-editing');
		el.empty();
		for (const node of savedNodes) el.appendChild(node);
		// See the matching comment in enterEditMode's cancel().
		if (toSelected) onEditNavigate?.(rowIdx, colIdx, 'stay');
	};

	input.addEventListener('blur', onBlur);
	input.addEventListener('keydown', (evt: KeyboardEvent) => {
		if (evt.key === 'Tab') {
			// Same commit-then-move contract as the text editor. Arrow keys are NOT
			// intercepted here at all: a native <input type="date"> already gives
			// ←/→ (move between the day/month/year segments) and ↑/↓ (step the
			// focused segment) meanings that are more useful than the text editor's
			// jump-to-start/end would be, and there is no free-text caret to
			// preserve either.
			evt.preventDefault();
			save(evt.shiftKey ? 'prev' : 'next');
			input.blur();
			return;
		}
		if (evt.key === 'Enter') { evt.preventDefault(); save('stay'); input.blur(); }
		if (evt.key === 'Escape') { evt.preventDefault(); cancel(true); }
	});

	input.focus();
}

/**
 * Inline editor for title (single-line) and footer (multi-line).
 * Single-line: Enter = save, Escape = cancel.
 * Multi-line:  Enter = newline, Shift+Enter = save, Escape = cancel.
 */
export function enterLineEdit(
	el: HTMLElement,
	currentText: string,
	onSave: (newText: string) => void,
	multiLine = false,
): void {
	const savedNodes = Array.from(el.childNodes).map(n => n.cloneNode(true));
	el.empty();
	el.addClass('bt-editing');

	let committed = false;

	if (multiLine) {
		const textarea = el.createEl('textarea', { cls: 'bt-inline-editor bt-inline-editor-multi' });
		textarea.value = currentText;
		textarea.rows  = Math.max(2, currentText.split('\n').length);

		const save = () => {
			if (committed) return;
			committed = true;
			el.removeClass('bt-editing');
			const newVal = textarea.value.trim();
			if (newVal !== currentText) onSave(newVal);
			else { el.empty(); for (const n of savedNodes) el.appendChild(n); }
		};
		const cancel = () => {
			if (committed) return;
			committed = true;
			textarea.removeEventListener('blur', save);
			el.removeClass('bt-editing');
			el.empty();
			for (const n of savedNodes) el.appendChild(n);
		};

		textarea.addEventListener('blur', save);
		textarea.addEventListener('keydown', (evt: KeyboardEvent) => {
			if (evt.key === 'Escape') { evt.preventDefault(); cancel(); }
			if (evt.key === 'Enter' && evt.shiftKey) { evt.preventDefault(); textarea.blur(); }
		});
		textarea.focus();
		// Move cursor to end so Enter adds a line break rather than replacing all text
		textarea.setSelectionRange(textarea.value.length, textarea.value.length);
		return;
	}

	const editor = el.createDiv({
		cls: 'bt-inline-editor',
		attr: { contenteditable: 'true' },
	});
	editor.textContent = currentText;

	const save = () => {
		if (committed) return;
		committed = true;
		el.removeClass('bt-editing');
		const newVal = (editor.textContent ?? '').trim();
		if (newVal !== currentText) onSave(newVal);
		else { el.empty(); for (const n of savedNodes) el.appendChild(n); }
	};

	const cancel = () => {
		if (committed) return;
		committed = true;
		editor.removeEventListener('blur', save);
		el.removeClass('bt-editing');
		el.empty();
		for (const n of savedNodes) el.appendChild(n);
	};

	editor.addEventListener('blur', save);
	editor.addEventListener('keydown', (evt: KeyboardEvent) => {
		if (evt.key === 'Enter') { evt.preventDefault(); editor.blur(); }
		if (evt.key === 'Escape') { evt.preventDefault(); cancel(); }
	});

	editor.focus();
	if (activeDocument.contains(editor)) {
		const range = activeDocument.createRange();
		range.selectNodeContents(editor);
		activeWindow.getSelection()?.removeAllRanges();
		activeWindow.getSelection()?.addRange(range);
	}
}

/**
 * Replaces cell content with a contenteditable div wired to WikilinkInputSuggest
 * (AbstractInputSuggest subclass) for native Obsidian wikilink suggestions.
 * Save on blur/Enter, cancel on Escape; pre-edit nodes restored on cancel.
 */
export function enterEditMode(
	el: HTMLElement,
	rawValue: string,
	rowIdx: number,
	colIdx: number,
	app: App,
	sourcePath: string,
	onCellChange: CellChangeHandler,
	onPasteGrid?: (values: string[][]) => void,
	cacheKey?: string,
	initialText?: string,
	onEditNavigate?: EditNavigateHandler,
	formulaHooks?: FormulaEditHooks,
): void {
	const savedNodes = Array.from(el.childNodes).map(n => n.cloneNode(true));

	const restoreNodes = () => {
		el.empty();
		for (const node of savedNodes) el.appendChild(node);
	};

	el.empty();
	el.addClass('bt-editing');
	// See the matching comment in enterDateEditMode — drops a hover tint the
	// mouseover handler may have already applied before this click.
	el.style.removeProperty('box-shadow');

	// contenteditable div — accepted by AbstractInputSuggest natively
	const editor = el.createDiv({
		cls: 'bt-cell-editor',
		attr: { contenteditable: 'true' },
	});
	editor.textContent = initialText ?? rawValue;

	// WikilinkInputSuggest attaches to the div directly (no hacks needed)
	new WikilinkInputSuggest(app, editor, sourcePath);

	if (cacheKey) registerLiveEdit(cacheKey, rowIdx, colIdx, () => editor.textContent ?? '');

	// ── Formula mode ──────────────────────────────────────────────────────
	let inFormulaMode = false;

	/** Inserts text at the current caret (replacing any live selection) and
	 *  leaves the caret right after it. Falls back to appending at the end
	 *  when the current selection isn't inside this editor at all — e.g. the
	 *  user just clicked ANOTHER cell to insert a reference, which steals
	 *  focus/selection away from this editor until this function's own
	 *  editor.focus() call reclaims it. */
	const insertTextAtCaret = (text: string) => {
		editor.focus();
		const sel = activeWindow.getSelection();
		let range: Range;
		if (sel && sel.rangeCount > 0 && editor.contains(sel.getRangeAt(0).commonAncestorContainer)) {
			range = sel.getRangeAt(0);
		} else {
			range = activeDocument.createRange();
			range.selectNodeContents(editor);
			range.collapse(false);
		}
		range.deleteContents();
		const node = activeDocument.createTextNode(text);
		range.insertNode(node);
		range.setStartAfter(node);
		range.collapse(true);
		sel?.removeAllRanges();
		sel?.addRange(range);
	};

	const enterFormulaMode = () => {
		if (inFormulaMode || !formulaHooks) return;
		inFormulaMode = true;
		formulaHooks.onEnterFormulaMode(insertTextAtCaret);
	};
	const exitFormulaMode = () => {
		if (!inFormulaMode) return;
		inFormulaMode = false;
		formulaHooks?.onExitFormulaMode();
	};

	// Reopening a cell that already holds a formula (initialText/rawValue
	// already starts with "=", converted to friendly-label form by the
	// caller) — start in formula mode immediately, don't wait for an input
	// event that will never fire.
	if ((initialText ?? rawValue).startsWith('=')) enterFormulaMode();

	// Fresh formula: the FIRST character typed becomes "=". Checking the
	// input event (not keydown) means this also covers the seedChar path
	// (typing while Selected) and a manual click-then-type into an empty
	// cell — both land here as "content is now exactly '='".
	editor.addEventListener('input', () => {
		if (!inFormulaMode && editor.textContent === '=') enterFormulaMode();
	});

	let committed = false;

	/**
	 * `move` is what should happen to the keyboard selection once this commit
	 * lands — 'stay' for Enter (finish editing, keep the cell Selected),
	 * 'next'/'prev' for Tab/Shift+Tab. Left undefined for a plain blur (clicking
	 * elsewhere), which shouldn't select anything.
	 */
	const save = (move?: EditNavigateMove) => {
		if (committed) return;
		// A write-back rebuild tearing down this cell's old DOM detaches this
		// editor while it's still focused, which fires a real `blur` — but the
		// browser's "remove a node" algorithm dispatches that `blur` as an
		// INTERMEDIATE step, before the node's connectedness is actually updated,
		// so `editor.isConnected` still reads `true` here, synchronously, even
		// when this element is mid-removal (confirmed empirically: checking
		// again one microtask later correctly flips to `false`). A same-tick
		// check can't tell a teardown blur from a real user blur; deferring by
		// one microtask can, without any user-visible delay (nothing else can
		// run in between — microtasks drain before the next real event).
		queueMicrotask(() => {
			if (committed) return;
			if (!editor.isConnected) return; // teardown blur — ignore; don't touch the registry
			committed = true;
			if (cacheKey) clearLiveEdit(cacheKey, rowIdx, colIdx);
			el.removeClass('bt-editing');
			// Selection BEFORE the commit, and the order is load-bearing: a value
			// change queues a write-back, and queueOp reads the selection straight
			// out of the live DOM (renderSelectionHandoff.ts) synchronously, inside
			// this very call. Committing first would let it snapshot the selection as
			// it was before this move, so the rebuilt table would restore the
			// highlight to the wrong cell — or to none at all.
			const newValue = editor.textContent ?? '';
			if (move) onEditNavigate?.(rowIdx, colIdx, move);
			if (inFormulaMode && formulaHooks) {
				exitFormulaMode();
				if (newValue.startsWith('=') && newValue !== '=') {
					const idsFormula = labelFormulaToIds(formulaHooks.model, newValue);
					void formulaHooks.onStructuralOp({
						type: 'set-cell-formula', rowId: formulaHooks.rowId, colId: formulaHooks.colId, formula: idsFormula,
					});
				} else {
					// Backspaced down to just "=" (or somehow lost the leading =) —
					// treat as "no formula here anymore", same as clearing it outright.
					void formulaHooks.onStructuralOp({
						type: 'set-cell-formula', rowId: formulaHooks.rowId, colId: formulaHooks.colId, formula: null,
					});
					if (newValue !== rawValue) void onCellChange(rowIdx, colIdx, newValue);
					else restoreNodes();
				}
			} else if (newValue !== rawValue) {
				void onCellChange(rowIdx, colIdx, newValue);
			} else {
				restoreNodes();
			}
		});
	};

	/** Wrapper so a FocusEvent is never passed as save()'s `move` argument. */
	const onBlur = () => save();

	const cancel = (toSelected = false) => {
		if (committed) return;
		committed = true;
		exitFormulaMode();
		if (cacheKey) clearLiveEdit(cacheKey, rowIdx, colIdx);
		editor.removeEventListener('blur', onBlur);
		el.removeClass('bt-editing');
		restoreNodes();
		// Escape leaves the cell Selected rather than deselected — this is the only
		// way into Selected state, since a plain click enters Editing and its own
		// mouseup clears the drag range behind it.
		if (toSelected) onEditNavigate?.(rowIdx, colIdx, 'stay');
	};

	editor.addEventListener('blur', onBlur);
	if (onPasteGrid) {
		// Only intercept clipboard content that actually came from a spreadsheet
		// (Excel/Sheets always emit an HTML <table> alongside the plain text) —
		// otherwise leave ordinary multi-line text paste as native single-cell text.
		editor.addEventListener('paste', (evt: ClipboardEvent) => {
			const html = evt.clipboardData?.getData('text/html') ?? '';
			if (!/<table[\s>]/i.test(html)) return;
			const text = evt.clipboardData?.getData('text/plain');
			if (!text) return;
			evt.preventDefault();
			cancel();
			const rows = text.split(/\r\n|\n|\r/);
			if (rows.length > 1 && rows[rows.length - 1] === '') rows.pop();
			onPasteGrid(rows.map(r => r.split('\t')));
		});
	}
	/**
	 * Where the caret sits within the cell's text, or null when there's a
	 * selection rather than a caret (or the caret isn't in this editor at all).
	 * Measured in characters of `textContent`, so a `<br>` counts for nothing on
	 * either side and the two ends line up consistently.
	 */
	const caretAtEdge = (): { atStart: boolean; atEnd: boolean } | null => {
		const s = activeWindow.getSelection();
		if (!s || s.rangeCount === 0 || !s.isCollapsed) return null;
		const r = s.getRangeAt(0);
		if (!editor.contains(r.startContainer)) return null;
		const before = activeDocument.createRange();
		before.selectNodeContents(editor);
		before.setEnd(r.startContainer, r.startOffset);
		const offset = before.toString().length;
		return { atStart: offset === 0, atEnd: offset >= (editor.textContent ?? '').length };
	};

	editor.addEventListener('keydown', (evt: KeyboardEvent) => {
		// Stop Ctrl/Meta combos from bubbling to Obsidian's CodeMirror handlers.
		// The browser handles Ctrl+V / Ctrl+Z / Ctrl+A natively for contenteditable,
		// so blocking propagation only prevents Obsidian shortcuts (e.g. Ctrl+Shift+V
		// "paste without formatting") from accidentally firing on the code block.
		if (evt.ctrlKey || evt.metaKey) evt.stopPropagation();

		if (evt.key === 'ArrowLeft' || evt.key === 'ArrowRight') {
			// Inside the text, these are ordinary caret movement and are left alone.
			// AT the first/last character they become cell navigation, taking the same
			// commit-and-move path as Tab.
			//
			// This is not a convenience: left to the browser, an arrow key at the edge
			// of a contenteditable moves the insertion point OUT of it. In Live
			// Preview that editor is nested in a CodeMirror widget, so the caret lands
			// in the surrounding note and the keyboard leaves the table altogether —
			// behaviour we neither chose nor control, and which differs between
			// Obsidian's view modes. Claiming the key at the boundary makes it
			// deterministic and keeps the keyboard in the grid.
			const edge = caretAtEdge();
			const leaving = edge && (evt.key === 'ArrowLeft' ? edge.atStart : edge.atEnd);
			if (!leaving) return;   // still room to move within the text
			evt.preventDefault();
			save(evt.key === 'ArrowLeft' ? 'prev' : 'next');
			editor.blur();
			return;
		}

		if (evt.key === 'Tab') {
			// Commits and moves, same as an arrow key at the text's edge above.
			evt.preventDefault();
			save(evt.shiftKey ? 'prev' : 'next');
			editor.blur();
		} else if (evt.key === 'Enter' && !evt.shiftKey) {
			// Commit and stay on this cell as Selected. save() is queued first so its
			// microtask is the one that sets `committed`; the blur() below then just
			// drops focus off an editor that's already finished.
			evt.preventDefault();
			save('stay');
			editor.blur();
		} else if (evt.key === 'Escape') {
			evt.preventDefault();
			cancel(true);
		} else if (evt.key === 'ArrowUp' || evt.key === 'ArrowDown') {
			// Same two-stage rule as ←/→, one step coarser: the first press jumps to
			// the very start / end of the content (rather than the browser's
			// "previous/next visual line", which does nothing at all on a single-line
			// cell), and pressing again from there commits and moves to the cell
			// above / below.
			const up = evt.key === 'ArrowUp';
			const edge = caretAtEdge();
			evt.preventDefault();
			if (edge && (up ? edge.atStart : edge.atEnd)) {
				save(up ? 'up' : 'down');
				editor.blur();
				return;
			}
			const range = activeDocument.createRange();
			range.selectNodeContents(editor);
			range.collapse(up);
			activeWindow.getSelection()?.removeAllRanges();
			activeWindow.getSelection()?.addRange(range);
		}
	});

	editor.focus();
	if (activeDocument.contains(editor)) {
		const range = activeDocument.createRange();
		range.selectNodeContents(editor);
		// Select-all vs caret-at-end turns on whether the user has already started
		// typing. Opening a cell on its stored value (a click, or Enter from the
		// Selected state) selects it all, so the next keystroke replaces it — the
		// familiar spreadsheet gesture. But `initialText` means typing is already
		// underway: either a character typed while the cell was merely Selected,
		// which seeds the editor with it, or a draft resumed after a rebuild
		// interrupted the edit (renderEditHandoff.ts). Selecting either of those
		// would make the very next keystroke wipe what the user just typed.
		if (initialText !== undefined) range.collapse(false);
		activeWindow.getSelection()?.removeAllRanges();
		activeWindow.getSelection()?.addRange(range);
	}
}
