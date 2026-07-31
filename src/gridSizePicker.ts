import { Component } from 'obsidian';
import { t, gridSizeCaption } from './i18n';
import { clampPanelToViewport, bindPanelDismiss } from './renderPanel';

const MAX_GRID_ROWS = 6;
const MAX_GRID_COLS = 8;
/** Sanity ceiling for the manual row/col inputs — mirrors the pipe-table
 *  mirror's own MIRROR_LIMIT precedent (serializer.ts): a typo like an extra
 *  zero shouldn't be able to make renderTable() build an unresponsive grid. */
const MAX_CUSTOM_SIZE = 50;

export interface GridSizePickerOptions {
	component: Component;
	/** Element the picker is positioned below (falls back to above/clamped if
	 *  there's no room — see clampPanelToViewport). */
	anchor: HTMLElement;
	onConfirm: (rows: number, cols: number) => void;
	/** Fires on open (with the initial 1×1 highlight) and again every time the
	 *  hovered cell changes — lets a caller mirror the picker's own live size
	 *  (e.g. the empty-block banner's preview area) without waiting for confirm. */
	onHover?: (rows: number, cols: number) => void;
	/** Called whenever the picker closes, for any reason (confirm, dismiss,
	 *  Escape, or a teardown via the belt-and-suspenders `component.register`
	 *  below) — lets a caller that changed some UI state to open this (e.g. the
	 *  empty-block banner locking its live preview to "blank table") restore it
	 *  once the picker is gone, regardless of how it closed. */
	onClose?: () => void;
}

/**
 * Word/Sheets-style "insert table" size picker: an 8×6 grid where hovering
 * highlights the rectangle from the top-left corner to the hovered cell and
 * shows a live "R × C" caption; clicking a cell confirms that size
 * immediately. A pair of number inputs below it is the precise/overflow path
 * for sizes past the visible grid (matches Word's own "Insert Table..."
 * dialog fallback next to its hover grid).
 *
 * Appended to document.body (position:fixed, measured against the anchor's
 * getBoundingClientRect), not nested as a normal DOM child of the anchor —
 * CONFIRMED necessary, not just historical caution: a DOM-nested version (CSS
 * :hover alone handling show/hide, no JS open/close state at all) was tried
 * and measured directly. Obsidian wraps every rendered code-block's content
 * in a container (`.cm-preview-code-block.cm-embed-block...`) with
 * `contain: paint` + `overflow: hidden`. Per the CSS Containment spec,
 * `contain: paint` (like `layout`/`strict`/`content`) makes that element the
 * containing block for `position: fixed` (and `absolute`) descendants — the
 * same mechanism as a `transform` ancestor, just a different trigger
 * property. Logged the picker's actual rect plus every ancestor's computed
 * transform/filter/will-change/contain/overflow/position/rect from inside a
 * real Obsidian Live Preview instance to confirm this (not guessed): no
 * ancestor had transform/filter/will-change, but `.cm-preview-code-block` had
 * `contain: paint` at rect {x:386.5, y:360.575, w:988.7, h:126.6}, and the
 * measured `top` the JS wrote (399.375px, meant as "from the viewport top")
 * landed at 360.575 + 399.375 = 759.95 — matching the picker's actual
 * measured y (759.9500...) to five decimal places. Since that same container
 * also has `overflow: hidden` (and paint containment itself implies
 * descendants can't paint outside the container's border box), no CSS
 * position value fixes this while nested inside it — position:fixed and
 * position:absolute fail the same way once their containing block is a
 * ~127px-tall box instead of the viewport. Appending to document.body is the
 * only way out of that specific container, which is why this needs the
 * dismiss-logic complexity below instead of letting CSS :hover handle it.
 *
 * The cost of that is real: "stays open moving from the anchor into the
 * picker" can't be answered by CSS anymore (they're not DOM neighbors), so
 * it's reconstructed here — see the tracking-mousemove comment below for how,
 * and for why the three approaches tried before it (padded rects, their
 * union, and relatedTarget classification) each failed for a different
 * geometric reason.
 */
export function openGridSizePicker(opts: GridSizePickerOptions): void {
	const { component, anchor, onConfirm, onHover, onClose } = opts;

	const panel = activeDocument.body.createDiv({ cls: 'bt-grid-picker' });
	const ar = anchor.getBoundingClientRect();
	// Initial guess-positioned (clamped again below once the panel has real content).
	panel.setCssProps({ '--bt-gp-top': `${ar.bottom + 4}px`, '--bt-gp-left': `${ar.left}px` });

	const caption = panel.createDiv({ cls: 'bt-gp-caption', text: gridSizeCaption(1, 1) });

	const grid = panel.createDiv({ cls: 'bt-gp-grid' });
	grid.setCssProps({ '--bt-gp-cols': `${MAX_GRID_COLS}` });
	const cells: HTMLElement[] = [];
	for (let r = 0; r < MAX_GRID_ROWS; r++) {
		for (let c = 0; c < MAX_GRID_COLS; c++) {
			const cell = grid.createDiv({ cls: 'bt-gp-cell' });
			cell.dataset.r = String(r);
			cell.dataset.c = String(c);
			cells.push(cell);
		}
	}

	const highlight = (hoverR: number, hoverC: number) => {
		for (const cell of cells) {
			const r = Number(cell.dataset.r);
			const c = Number(cell.dataset.c);
			cell.toggleClass('is-active', r <= hoverR && c <= hoverC);
		}
		caption.setText(gridSizeCaption(hoverR + 1, hoverC + 1));
		onHover?.(hoverR + 1, hoverC + 1);
	};
	highlight(0, 0);

	const close = () => {
		stopTracking();
		panel.remove();
		detach();
		anchor.removeEventListener('mouseleave', startTracking);
		anchor.removeEventListener('mouseenter', stopTracking);
		onClose?.();
	};

	// Auto-dismiss — it's a transient hover-to-preview flyout (itself opened by
	// hover, not a click), not a settings panel the user might need to step
	// away from mid-interaction (that's what bindPanelDismiss's click-outside/
	// Escape path is for; kept as a fallback here too).
	//
	// Three single-instant approaches were tried and each failed for a
	// different geometric reason: padding the anchor/panel rects by a fixed
	// margin leaked sideways into whatever sits next to the anchor (a
	// neighboring template button), so slowly crossing into THAT button's
	// bounds still read as "close enough" and never closed. Their union didn't
	// fix it either — once clampPanelToViewport pushes the panel's left edge
	// further left than the anchor's own (anchor near the viewport edge, panel
	// wider than it), the union's left edge follows the panel outward and
	// swallows neighboring buttons whole. Judging a leave's relatedTarget
	// (sibling button = leaving, ancestor = still in the gap) got closer, but
	// the CSS gap between flex buttons hit-tests to their shared parent (an
	// ancestor of the anchor), so a diagonal move that clips that gap en route
	// to a sibling button still read as "still in the gap" and got stuck open.
	//
	// The fix isn't a better single-instant check, it's not making it a single
	// instant at all: a "bridge" rectangle scoped to the anchor's OWN
	// horizontal width — never padded outward past it, never inheriting the
	// panel's own (possibly wider, possibly viewport-clamped-elsewhere) extent
	// — spanning just the real vertical gap between the anchor and the panel.
	// That can't leak sideways (it's exactly as wide as the anchor) and can't
	// get dragged off by clampPanelToViewport (it doesn't use the panel's own
	// horizontal bounds at all). Tracked via a real mousemove sample rather
	// than guessed at a single leave event, so a diagonal path through the gap
	// is checked at every point along it, not just its endpoints.
	const inBridge = (x: number, y: number): boolean => {
		const ar2 = anchor.getBoundingClientRect();
		const pr = panel.getBoundingClientRect();
		if (x < ar2.left || x > ar2.right) return false;
		if (ar2.bottom <= pr.top) return y >= ar2.bottom && y <= pr.top; // panel below anchor (usual case)
		if (pr.bottom <= ar2.top) return y >= pr.bottom && y <= ar2.top; // panel flipped above anchor (near viewport bottom)
		return false; // anchor/panel overlap vertically — no gap to bridge
	};
	const inRect = (r: DOMRect, x: number, y: number) => x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
	let tracking = false;
	const onMove = (evt: MouseEvent) => {
		const { clientX: x, clientY: y } = evt;
		if (inRect(anchor.getBoundingClientRect(), x, y) || inRect(panel.getBoundingClientRect(), x, y) || inBridge(x, y)) return;
		close();
	};
	const startTracking = () => {
		if (tracking) return;
		tracking = true;
		activeDocument.addEventListener('mousemove', onMove);
	};
	const stopTracking = () => {
		if (!tracking) return;
		tracking = false;
		activeDocument.removeEventListener('mousemove', onMove);
	};
	anchor.addEventListener('mouseleave', startTracking);
	anchor.addEventListener('mouseenter', stopTracking);
	panel.addEventListener('mouseenter', stopTracking);
	// Once genuinely inside the panel, leaving it is unambiguous — no bridge
	// needed on the way out, close right away.
	panel.addEventListener('mouseleave', () => close());

	grid.addEventListener('mouseover', (evt: MouseEvent) => {
		const cell = (evt.target as HTMLElement).closest<HTMLElement>('.bt-gp-cell');
		if (!cell) return;
		highlight(Number(cell.dataset.r), Number(cell.dataset.c));
	});
	grid.addEventListener('click', (evt: MouseEvent) => {
		const cell = (evt.target as HTMLElement).closest<HTMLElement>('.bt-gp-cell');
		if (!cell) return;
		onConfirm(Number(cell.dataset.r) + 1, Number(cell.dataset.c) + 1);
		close();
	});

	// Manual rows/cols entry — the precise/overflow path for sizes past the grid.
	const customRow = panel.createDiv({ cls: 'bt-gp-custom' });
	const rowsInput = customRow.createEl('input', {
		cls: 'bt-gp-input',
		attr: { type: 'number', min: '1', max: String(MAX_CUSTOM_SIZE), value: '3', 'aria-label': t('gridPickerRows') },
	});
	customRow.createSpan({ cls: 'bt-gp-x', text: '×' });
	const colsInput = customRow.createEl('input', {
		cls: 'bt-gp-input',
		attr: { type: 'number', min: '1', max: String(MAX_CUSTOM_SIZE), value: '3', 'aria-label': t('gridPickerCols') },
	});
	const insertBtn = customRow.createEl('button', { cls: 'bt-gp-insert-btn', text: t('gridPickerInsert') });

	const confirmCustom = () => {
		const clamp = (raw: string) => Math.max(1, Math.min(MAX_CUSTOM_SIZE, parseInt(raw, 10) || 1));
		onConfirm(clamp(rowsInput.value), clamp(colsInput.value));
		close();
	};
	insertBtn.addEventListener('click', confirmCustom);
	panel.addEventListener('keydown', (evt: KeyboardEvent) => {
		if (evt.key === 'Enter' && (evt.target === rowsInput || evt.target === colsInput)) {
			evt.preventDefault();
			confirmCustom();
		}
	});

	const detach = bindPanelDismiss(component, panel, close);
	// Belt-and-suspenders: if the empty-block banner that opened this picker gets
	// torn down (e.g. the block stops being empty from elsewhere) before the user
	// acts, nothing else would call close() — leaking the panel and its listeners.
	component.register(() => panel.remove());

	clampPanelToViewport(panel, ar, {
		top: '--bt-gp-top', left: '--bt-gp-left', maxHeight: '--bt-gp-maxh',
	});
}
