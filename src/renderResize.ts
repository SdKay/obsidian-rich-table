import type { Component } from 'obsidian';
import type { TableModelV2 } from './model';
import type { ChoiceRegistry } from './choiceRegistry';
import type { StructuralOpHandler } from './renderTypes';
import { colMinWidth, colRightX } from './renderAutofit';

/**
 * Wire a handle element to resize column `colIdx`: hover/drag indicator line,
 * live <col> width update, table-width re-pin, double-click auto-fit, and commit.
 * The boundary is computed from <col> geometry (colRightX) so it works even when
 * the column is covered by a header merge and has no individual header cell.
 */
export function setupColResize(
	handle: HTMLElement,
	tbl: HTMLElement,
	colIdx: number,
	getRegistry: () => ChoiceRegistry,
	model: TableModelV2,
	onStructuralOp: StructuralOpHandler,
	component?: Component,
): void {
	const col = model.columns[colIdx];
	const thisCol = tbl.querySelector<HTMLElement>(`col[data-col="${colIdx}"]`);
	if (!col || !thisCol) return;
	const allCols = Array.from(tbl.querySelectorAll<HTMLElement>('col[data-col]'));
	const nextCol = allCols.find(c => parseInt(c.dataset.col ?? '-1') > colIdx) ?? null;

	handle.addEventListener('click', e => e.stopPropagation());

	let colLine: HTMLElement | null = null;
	let colDragging = false;
	const hideColLine = () => { colLine?.remove(); colLine = null; };
	component?.register(hideColLine);

	// Appended as a sibling of `tbl` inside .bt-table-content-row (positioned
	// relative to it — see the CSS), not document.body: this makes the line
	// share the table's own coordinate space AND its clipping ancestor. Its
	// span exactly matches the table's own rendered box (no reach into
	// addRowBtn/the scrollbar beyond it), so wherever .bt-table-wrapper's own
	// overflow clips the table it clips the line identically for free — no
	// separate viewport-rect math needed (an earlier version tried to compute
	// this via getBoundingClientRect deltas against the wrapper/add-strip and
	// kept needing another special case for another scroll/view-size
	// combination; matching the table's own DOM-nested geometry sidesteps the
	// whole class of bug instead).
	const makeColLine = (): HTMLElement => {
		const parent = tbl.parentElement!;
		const parentRect = parent.getBoundingClientRect();
		const tblRect = tbl.getBoundingClientRect();
		const line = parent.createDiv({ cls: 'bt-resize-indicator bt-resize-indicator-col' });
		line.setCssProps({
			'--ri-x':      `${tblRect.left - parentRect.left + colRightX(tbl, colIdx)}px`,
			'--ri-top':    `${tblRect.top - parentRect.top}px`,
			'--ri-height': `${tblRect.height}px`,
		});
		return line;
	};

	handle.addEventListener('mouseenter', () => {
		if (colLine || colDragging) return;
		colLine = makeColLine();
		colLine.setCssProps({ '--bt-ri-opacity': '0.4' });
	});
	handle.addEventListener('mouseleave', () => {
		if (!colDragging) hideColLine();
	});

	handle.addEventListener('dblclick', (e: MouseEvent) => {
		e.stopPropagation();
		e.preventDefault();
		hideColLine();
		// Clears the column's own width rather than computing and writing a
		// specific number — an auto column (operations.ts's set-col-width
		// treats 0/absent the same way set-row-height already did) tracks its
		// own content on every render from here on, rather than being pinned to
		// whatever its content happened to need at the moment of this click.
		void onStructuralOp({ type: 'set-col-width', colId: col.id, width: 0 });
	});

	handle.addEventListener('pointerdown', (e: PointerEvent) => {
		if (e.button !== 0) return;
		e.stopPropagation();
		e.preventDefault();
		handle.setPointerCapture(e.pointerId);
		colDragging = true;

		const startX     = e.clientX;
		const MIN        = colMinWidth();
		const startW     = parseInt(thisCol.style.width) || col.width || MIN;
		const nextColIdx = nextCol ? parseInt(nextCol.dataset.col ?? '-1') : -1;
		const startNextW = nextCol
			? (parseInt(nextCol.style.width) || colMinWidth())
			: null;

		if (colLine) colLine.setCssProps({ '--bt-ri-opacity': '0.75' });
		else { colLine = makeColLine(); colLine.setCssProps({ '--bt-ri-opacity': '0.75' }); }

		const onMove = (ev: PointerEvent) => {
			// Rounded to a whole pixel — PointerEvent.clientX carries sub-pixel
			// precision under fractional display scaling (Windows 125%/150%
			// etc.), and an unrounded delta here flows straight into the
			// committed width below. A fractional <col> width is invisible at
			// integer DPR (confirmed: Chromium's own sub-pixel layout renders
			// it cleanly) but reportedly visibly misaligns real column content
			// on the reporter's actual (fractionally-scaled) display — same
			// class of issue as row-resize's own Math.round just below,
			// applied here for consistency rather than because it was ever
			// independently re-derived as necessary for THIS code path.
			const delta = Math.round(ev.clientX - startX);
			const newW  = Math.max(MIN, startW + delta);
			thisCol.style.setProperty('width', `${newW}px`);
			if (nextCol && startNextW !== null) {
				// The neighbor mirrors how much THIS column actually moved (newW - startW),
				// not the raw pointer delta — once this column is clamped at its own
				// minimum, further dragging keeps enlarging `delta` with nothing left of
				// it reflected in newW, and mirroring the raw delta anyway grew the
				// neighbor with no corresponding shrink on this side, drifting the
				// table's total width. Clamping the mirrored amount the same way this
				// column's own width already is makes the neighbor stop moving too.
				const actualDelta = newW - startW;
				nextCol.style.setProperty('width', `${Math.max(colMinWidth(), startNextW - actualDelta)}px`);
			}
			const sum = Array.from(tbl.querySelectorAll<HTMLElement>('col'))
				.reduce((s, c) => s + (parseInt(c.style.width) || 0), 0);
			tbl.style.setProperty('width', `${sum}px`);

			if (colLine) {
				const parentLeft = tbl.parentElement!.getBoundingClientRect().left;
				colLine.setCssProps({ '--ri-x': `${tbl.getBoundingClientRect().left - parentLeft + colRightX(tbl, colIdx)}px` });
			}
			// Grid auto-updates edge-add strip sizes — no manual repositioning needed.
			tbl.dispatchEvent(new CustomEvent('bt-layout-changed'));
		};

		const onUp = (ev: PointerEvent) => {
			handle.removeEventListener('pointermove', onMove);
			colDragging = false;
			hideColLine();
			const delta = Math.round(ev.clientX - startX);
			if (delta === 0) return;
			const newW = Math.max(MIN, startW + delta);
			void onStructuralOp({ type: 'set-col-width', colId: col.id, width: newW });
			if (nextCol && startNextW !== null && nextColIdx >= 0) {
				const nextColDef = model.columns[nextColIdx];
				if (nextColDef) {
					// Same clamped-mirror reasoning as onMove above.
					const actualDelta = newW - startW;
					void onStructuralOp({ type: 'set-col-width', colId: nextColDef.id, width: Math.max(colMinWidth(), startNextW - actualDelta) });
				}
			}
		};

		handle.addEventListener('pointermove', onMove);
		handle.addEventListener('pointerup', onUp, { once: true });
	});
}

export function bindResizeHandle(
	handle: HTMLElement,
	table: HTMLElement,
	dataAttr: string,
	cssVar: string,
	minSize: number,
	onCommit: (size: number) => void,
	component: Component,
	onDrag?: () => void,
): void {
	// Shared hover+drag indicator line
	let rowLine: HTMLElement | null = null;
	let rowDragging = false;
	const hideRowLine = () => { rowLine?.remove(); rowLine = null; };
	component.register(hideRowLine);

	// Clicks on the seam must not bubble to the cell's click-to-edit handler
	handle.addEventListener('click', e => e.stopPropagation());

	// Cells that belong to exactly this one row (exclude rowspan cells whose height
	// spans multiple rows — using them would measure/set the whole merge, making the
	// indicator sit at the merge bottom and the drag magnitude mismatch the pointer).
	const rowCells = (): HTMLElement[] => {
		const all = Array.from(table.querySelectorAll<HTMLElement>(`[${dataAttr}]`));
		const single = all.filter(c => (c as HTMLTableCellElement).rowSpan <= 1);
		return single.length > 0 ? single : all;
	};

	// Appended as a sibling of `table` inside .bt-table-content-row (see
	// setupColResize's makeColLine for why this — DOM-nested in the table's
	// own coordinate space and clipping ancestor — replaced a viewport-rect,
	// wrapper/add-strip-aware version of this same line).
	const makeRowLine = (anchor: HTMLElement | undefined): HTMLElement => {
		const parent = table.parentElement!;
		const parentRect = parent.getBoundingClientRect();
		const tblRect = table.getBoundingClientRect();
		const line = parent.createDiv({ cls: 'bt-resize-indicator bt-resize-indicator-row' });
		const borderY = (anchor ? anchor.getBoundingClientRect().bottom : tblRect.bottom) - parentRect.top;
		line.setCssProps({
			'--ri-y':     `${borderY}px`,
			'--ri-left':  `${tblRect.left - parentRect.left}px`,
			'--ri-width': `${tblRect.width}px`,
		});
		return line;
	};

	handle.addEventListener('mouseenter', () => {
		if (rowLine || rowDragging) return;
		rowLine = makeRowLine(rowCells()[0]);
		rowLine.setCssProps({ '--bt-ri-opacity': '0.4' });
	});
	handle.addEventListener('mouseleave', () => {
		if (!rowDragging) hideRowLine();
	});

	handle.addEventListener('pointerdown', (e: PointerEvent) => {
		if (e.button !== 0) return;
		e.stopPropagation();
		e.preventDefault();
		handle.setPointerCapture(e.pointerId);
		rowDragging = true;

		const startCoord = e.clientY;
		// Only cells that belong to this row alone — anchor + height targets
		const targets   = rowCells();
		const anchor    = targets[0];

		// Read actual height at drag time — avoids the detached-div zero issue
		const actualStart = (anchor?.offsetHeight ?? 0) || minSize;
		let lastSize = actualStart;
		let hasMoved = false;

		// Upgrade hover line or create fresh one
		if (rowLine) rowLine.setCssProps({ '--bt-ri-opacity': '0.75' });
		else { rowLine = makeRowLine(anchor); rowLine.setCssProps({ '--bt-ri-opacity': '0.75' }); }

		const onMove = (ev: PointerEvent) => {
			// Capture scroll position before the height change so we can restore it
			// after scroll-anchoring fires — preventing the page from jumping up.
			const scrollEl = activeDocument.scrollingElement;
			const savedScrollTop = scrollEl?.scrollTop;

			const delta = ev.clientY - startCoord;
			lastSize = Math.max(minSize, Math.round(actualStart + delta));
			for (const cell of targets) cell.style.setProperty(cssVar, `${lastSize}px`);
			// Track actual cell bottom edge live — handles content min-height correctly
			if (rowLine && anchor) {
				const parentTop = table.parentElement!.getBoundingClientRect().top;
				rowLine.setCssProps({ '--ri-y': `${anchor.getBoundingClientRect().bottom - parentTop}px` });
			}
			onDrag?.();
			// Row height change shifts cell geometry → rebuild selector strips to follow
			table.dispatchEvent(new CustomEvent('bt-layout-changed'));
			hasMoved = true;

			// Restore scroll in the next animation frame (runs before paint, after
			// scroll-anchoring fires) to cancel any upward page compensation.
			if (scrollEl && savedScrollTop !== undefined) {
				window.requestAnimationFrame(() => { scrollEl.scrollTop = savedScrollTop; });
			}
		};

		const onUp = () => {
			handle.removeEventListener('pointermove', onMove);
			rowDragging = false;
			hideRowLine();
			if (!hasMoved) return;
			onCommit(lastSize);
			// (click on the handle is already blocked by the permanent stopPropagation above)
		};

		handle.addEventListener('pointermove', onMove);
		handle.addEventListener('pointerup', onUp, { once: true });
	});
}
