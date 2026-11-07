/**
 * The status bar under a table, and the outer frame around it: the bar shows the table's size and the selection's
 * statistics, hosts the zoom control and the horizontal scrollbar, and is outside the zoomed subtree. The frame and
 * the bar share their geometry, so both are placed here, and the title is centred along with them.
 */
import type { TableModelV2 } from './model';
import type { TableEdits } from './tableEdits';
import type { LayoutSync } from './layoutSync';
import { viewSpan, setFrameBox } from './renderGeometry';
import { applyZoom, zoomFactor, renderZoomControl } from './renderZoom';
import { computeSelectionStats } from './renderStatusBar';
import { statusBarStatsLabel } from './i18n';

export interface StatusBarContext {
	model: TableModelV2;
	edits: TableEdits;
	forceStatusBarPinned: boolean | undefined;
	shell: HTMLElement;
	root: HTMLElement;
	wrapper: HTMLElement;
	table: HTMLTableElement;
	view: { zoom: number };
	hooks: { updateOuterFrame: () => void; updateStatusBarStats: () => void };
	sel: { start: { row: number; col: number } | null; end: { row: number; col: number } | null };
	layoutSync: LayoutSync;
	watchLayout: (el: HTMLElement) => void;
	ctrlColLeftGap: number;
}

export function renderStatusBar(ctx: StatusBarContext): void {
	const { model, edits, forceStatusBarPinned, shell, root, wrapper, table, view, hooks, sel, layoutSync, watchLayout } = ctx;
	const CTRL_COL_LEFT_GAP = ctx.ctrlColLeftGap;
	// ── Status bar ────────────────────────────────────────────────────────────
	// Shown unless the table opted out (the view-settings toggle), and always
	// for a 2+-sheet workbook, whose sheet tabs live in it. A sibling of `root`
	// under `shell`, not a child, so it stays out of the zoomed subtree (it
	// hosts the zoom control).
	const statusBar = (forceStatusBarPinned || model.statusBarMode !== 'hover')
		? shell.createDiv({ cls: 'bt-status-bar' })
		: null;
	const statusTabs = statusBar?.createDiv({ cls: 'bt-status-tabs' }) ?? null;
	let sliderDragging = false;
	if (statusBar) {
		const statusStats      = statusBar.createDiv({ cls: 'bt-status-stats' });
		// Static separator (no drag, unlike statusDivider below) — visually sets
		// the zoom widget apart from the row/col stats to its left, matching the
		// same vertical-line language statusDivider already uses one section over.
		statusBar.createDiv({ cls: 'bt-status-sep', attr: { 'aria-hidden': 'true' } });
		// Live-drag preview touches the real `zoom` CSS property on `root`
		// (applyZoom) AND the closure-local `zoom` NUMBER above, in the same tick —
		// every ResizeObserver-driven geometry pass in this file (rebuild()'s
		// auto-column-width pin, applyFreeze) can fire mid-drag, well before the
		// eventual commit's full re-render, and must divide by the CURRENT factor,
		// not the one this closure was built with. Leaving the number stale here
		// was the exact bug this comment used to describe as an accepted
		// tradeoff — confirmed via diagnostic logging to actually corrupt a pinned
		// column width (squeeze it into a visible, self-correcting wrap) rather
		// than just "lag a little", so it isn't a tradeoff worth keeping.
		// While the zoom slider is mid-drag, updateOuterFrame skips writing
		// statusBar's own real width — see that function's own comment for why
		// (writing a real layout property on the element the native <input
		// type=range> lives inside, every zoom-driven tick, corrupted the
		// slider's own drag math). sliderDragging is the flag it checks.
		renderZoomControl(statusBar, () => model.zoom ?? 100, edits, (percent) => { applyZoom(root, percent); view.zoom = zoomFactor(percent); }, (dragging) => {
			sliderDragging = dragging;
			// Writes skipped during the drag (see updateOuterFrame's own comment)
			// need one flush once it's safe again, or statusBar's own width stays
			// stale at whatever it was when the drag started.
			if (!dragging) hooks.updateOuterFrame();
		});
		const statusDivider    = statusBar.createDiv({ cls: 'bt-status-divider', attr: { 'aria-hidden': 'true' } });
		const statusScroll     = statusBar.createDiv({ cls: 'bt-status-scroll' });
		if (model.statusBarScrollWidth) statusScroll.setCssProps({ '--bt-status-scroll-w': `${model.statusBarScrollWidth}px` });
		const statusScrollTrack = statusScroll.createDiv({ cls: 'bt-status-scroll-track' });
		const statusScrollThumb = statusScrollTrack.createDiv({ cls: 'bt-status-scroll-thumb' });
		// statusTabs: renderTable() never populates this itself — a workbook's
		// sheet tabs are workbook-level chrome owned by tableBlock.ts, which mounts
		// renderSheetTabBar() into this exact element (found via querySelector,
		// see tableBlock.ts's own comment) once this render finishes, when there
		// are 2+ sheets and the active sheet is in table view (Task 9). A
		// single-sheet workbook, or a kanban/calendar active view, leaves it
		// permanently empty — .bt-status-stats' flex layout doesn't shift either
		// way since the div itself is always present.
		void statusTabs;

		hooks.updateStatusBarStats = () => {
			const selection = sel.start && sel.end
				? { r1: sel.start.row, r2: sel.end.row, c1: sel.start.col, c2: sel.end.col }
				: null;
			const stats = computeSelectionStats(model, selection);
			statusStats.setText(statusBarStatsLabel(stats));
			// Lets a user's own CSS snippet target/hide one state independently of
			// the other (e.g. "always hide the resting row/col count, keep the
			// selection sum") — both states used to share this one class with
			// nothing but text content to tell them apart, which CSS can't select
			// on at all (reported: github.com/SdKay/obsidian-rich-table/issues/7).
			statusStats.toggleClass('is-selection', stats.selectedRows !== undefined);
		};
		hooks.updateStatusBarStats();

		// Custom scrollbar synced to wrapper's real scrollLeft/scrollWidth/
		// clientWidth — the native track/thumb are hidden (see .bt-table-wrapper's
		// own ::-webkit-scrollbar:horizontal rule), but the underlying scroll
		// mechanism (wheel/trackpad/keyboard) is untouched; this is a pure
		// read-and-mirror layer on top of it, not a replacement for it.
		const syncScrollThumb = () => {
			const trackWidth = statusScrollTrack.clientWidth;
			const { scrollWidth, clientWidth, scrollLeft } = wrapper;
			// Nothing to scroll — a native scrollbar disappears entirely here, but
			// this control staying in flow while visually empty read as broken
			// ("看起来像什么都没有") rather than "intentionally nothing to do" — so
			// instead it fills the whole track, the same "100% visible, nothing more
			// to scroll" affordance a full progress bar gives.
			if (scrollWidth <= clientWidth + 1) {
				statusScroll.addClass('bt-status-scroll-empty');
				statusScrollThumb.setCssProps({ '--bt-status-thumb-w': `${trackWidth}px`, '--bt-status-thumb-l': '0px' });
				return;
			}
			statusScroll.removeClass('bt-status-scroll-empty');
			const thumbWidth = Math.max(16, trackWidth * clientWidth / scrollWidth);
			const maxThumbLeft = trackWidth - thumbWidth;
			const thumbLeft = maxThumbLeft * scrollLeft / (scrollWidth - clientWidth);
			statusScrollThumb.setCssProps({
				'--bt-status-thumb-w': `${thumbWidth}px`,
				'--bt-status-thumb-l': `${thumbLeft}px`,
			});
		};
		syncScrollThumb();

		let scrollThumbSyncScheduled = false;
		const scheduleSyncScrollThumb = () => {
			if (scrollThumbSyncScheduled) return;
			scrollThumbSyncScheduled = true;
			window.requestAnimationFrame(() => { scrollThumbSyncScheduled = false; syncScrollThumb(); });
		};
		// A press here is one deliberate step, so the thumb moves with it in the same frame; otherwise it would sit
		// for a frame where the table was, and a second press there would land on it. A scroll from the wheel or
		// the trackpad comes as many events a frame, and those are followed once a frame.
		wrapper.addEventListener('scroll', scheduleSyncScrollThumb);
		// Content width (columns resized/added) and track width (window/pane
		// resized, or the divider — Task 7 — moved) both invalidate the mapping.
		watchLayout(statusScrollTrack);
		layoutSync.register('place', syncScrollThumb);

		// Dragging the thumb sets wrapper.scrollLeft directly — this is pure local
		// UI state (like scroll position itself), never written back to the model.
		// A press on the empty track pages the view toward the pointer, like a native scrollbar.
		statusScrollTrack.addEventListener('pointerdown', (e: PointerEvent) => {
			if (e.target !== statusScrollTrack) return;
			const dir = e.clientX < statusScrollThumb.getBoundingClientRect().left ? -1 : 1;
			wrapper.scrollLeft += dir * wrapper.clientWidth * 0.9;
			syncScrollThumb();
		});
		statusScrollThumb.addEventListener('pointerdown', (e: PointerEvent) => {
			e.preventDefault();
			statusScrollThumb.setPointerCapture(e.pointerId);
			const trackRect = statusScrollTrack.getBoundingClientRect();
			const thumbWidth = statusScrollThumb.getBoundingClientRect().width;
			const startThumbLeft = statusScrollThumb.getBoundingClientRect().left - trackRect.left;
			const startX = e.clientX;
			const maxThumbLeft = trackRect.width - thumbWidth;
			const onMove = (ev: PointerEvent) => {
				const rawLeft = startThumbLeft + (ev.clientX - startX);
				const clampedLeft = Math.max(0, Math.min(maxThumbLeft, rawLeft));
				const scrollRange = wrapper.scrollWidth - wrapper.clientWidth;
				wrapper.scrollLeft = maxThumbLeft > 0 ? scrollRange * clampedLeft / maxThumbLeft : 0;
				syncScrollThumb();
			};
			const onUp = () => {
				statusScrollThumb.removeEventListener('pointermove', onMove);
				statusScrollThumb.removeEventListener('pointerup', onUp);
			};
			statusScrollThumb.addEventListener('pointermove', onMove);
			statusScrollThumb.addEventListener('pointerup', onUp);
		});

		// Dragging the divider reallocates space between .bt-status-tabs/-stats and
		// .bt-status-scroll, same "drag only touches CSS, release commits the op"
		// split as the view-resize handles above — statusBarScrollWidth persists to
		// the model, current drag position doesn't.
		if (edits.can('set-status-bar-scroll-width')) {
			const MIN_SCROLL_W = 60;
			statusDivider.addEventListener('pointerdown', (e: PointerEvent) => {
				e.preventDefault();
				statusDivider.setPointerCapture(e.pointerId);
				// barRect is visual (getBoundingClientRect); MIN_SCROLL_W/80 are logical
				// design constants and --bt-status-scroll-w is consumed as a logical
				// flex-basis width — divide the visual reads by zoom before mixing them
				// with those, same correction shape as scrollContentOffset's own
				// (NO_ZOOM's doc comment).
				const barRect = statusBar.getBoundingClientRect();
				const barRight = barRect.right / view.zoom;
				const maxScrollW = Math.max(MIN_SCROLL_W, barRect.width / view.zoom - 80);
				let newW = statusScroll.getBoundingClientRect().width / view.zoom;
				const onMove = (ev: PointerEvent) => {
					newW = Math.max(MIN_SCROLL_W, Math.min(maxScrollW, barRight - ev.clientX / view.zoom));
					statusScroll.setCssProps({ '--bt-status-scroll-w': `${Math.round(newW)}px` });
					scheduleSyncScrollThumb();
				};
				const onUp = () => {
					statusDivider.removeEventListener('pointermove', onMove);
					statusDivider.removeEventListener('pointerup', onUp);
					edits.run({ type: 'set-status-bar-scroll-width', width: Math.round(newW) });
				};
				statusDivider.addEventListener('pointermove', onMove);
				statusDivider.addEventListener('pointerup', onUp);
			});
		}

	}

	// Shift+wheel scrolls the view horizontally whether or not the bar (and its
	// scrollbar) is shown.
	wrapper.addEventListener('wheel', (e: WheelEvent) => {
		if (!e.shiftKey || e.deltaX !== 0) return;
		if (wrapper.scrollWidth <= wrapper.clientWidth) return;
		e.preventDefault();
		wrapper.scrollLeft += e.deltaY;
	}, { passive: false });

	// The outer frame element's real geometry — a `shell`-relative box
	// (--of-l/-t/-w/-h) that always covers `root`'s own box, extended down to
	// also cover a PINNED status bar's box (permanently in normal flow, so
	// shell's own bounding rect — read via getBoundingClientRect() —
	// already includes it: display:block stacks a later sibling below an
	// earlier one automatically). The bar is either present (in flow) or absent.
	//
	// Horizontally, the frame tracks the WRAPPER's own box, not root's, once a
	// manual viewWidth is actually narrower than what's available — replacing
	// the earlier corner-bracket markers (--vf-l/-t/-r/-b, .bt-view-corner),
	// which existed only because the frame itself didn't yet track the real
	// width; with the frame doing that natively, a second marker for the same
	// fact was redundant ("重复宣布同一件事，去掉角标，让外框直接体现实际宽度").
	// Same "only when actually narrower" condition those markers used (a
	// manual width could already be clamped back up to fill the same space by
	// max-width:100%, in which case there's no narrower box to show) — but,
	// unlike them, not gated on !model.locked: this is now the frame's own
	// permanent shape, not a dismissable editing cue, so it stays accurate
	// regardless of lock state.
	// Center the title's text over the part of <table> that is on screen: an editable table's
	// row also reserves addColBtn's width, so centering in root lands it off by half of that,
	// and a table wider than the view would carry the title out of sight. The shift stays
	// within root, so the title never makes the note scroll sideways. A transform does not
	// move layout, so the unshifted position is the measured one minus the shift applied.
	// Run with the frame, wherever the frame is placed: both follow every change of the layout.
	let titleShift = 0;
	const centreTitle = (rr: DOMRect, wr: DOMRect, tableRect: DOMRect) => {
		const titleText = root.querySelector<HTMLElement>(':scope > .bt-table-title > span');
		if (!titleText) return;
		const tr = titleText.getBoundingClientRect();
		const left = tr.left - titleShift;
		const right = tr.right - titleShift;
		const target = (Math.max(tableRect.left, wr.left) + Math.min(tableRect.right, wr.right)) / 2;
		const shift = Math.min(Math.max(target - (left + right) / 2, rr.left - left), rr.right - right);
		if (Math.abs(shift - titleShift) > 0.25) {
			titleShift = shift;
			titleText.setCssProps({ '--bt-title-center-adj': `${shift / view.zoom}px` });
		}
	};
	hooks.updateOuterFrame = () => {
		const rr = root.getBoundingClientRect();
		if (rr.width === 0) return;
		const shellRect = shell.getBoundingClientRect();
		const wr = wrapper.getBoundingClientRect();
		const tableRect = table.getBoundingClientRect();
		// The bar's natural (unsqueezed) width, measured with the bar and its tabs
		// both un-clipped; skipped while the zoom slider is mid-drag (writing the
		// bar's real width fights the native range input's drag math — the
		// slider's drag-end callback calls this once more to flush).
		let barNatural: number | null = null;
		if (statusBar && statusTabs && !sliderDragging && wr.width < rr.width - 0.5) {
			statusBar.addClass('bt-measure-natural');
			statusTabs.addClass('bt-measure-natural');
			barNatural = statusBar.scrollWidth;
			statusBar.removeClass('bt-measure-natural');
			statusTabs.removeClass('bt-measure-natural');
		}
		const { left, right } = viewSpan(rr, wr, CTRL_COL_LEFT_GAP, barNatural);
		if (statusBar && !sliderDragging) {
			statusBar.setCssProps({
				'--sb-pinned-l': `${left - shellRect.left}px`,
				'--sb-pinned-w': `${right - left}px`,
			});
		}
		const bottom = statusBar ? shellRect.bottom : rr.bottom;
		// outerFrame lives in `shell`, which — like the status bar itself — is
		// never zoomed (see `shell`'s own doc comment above), so these stay RAW
		// visual px with no `/ zoom` correction, same treatment as --sb-* just
		// above (that comment has the full reasoning for why dividing here
		// would double-correct an already-correctly-scaled distance).
		setFrameBox(shell, { l: left - shellRect.left, t: rr.top - shellRect.top, w: right - left, h: bottom - rr.top });
		centreTitle(rr, wr, tableRect);
	};
	window.requestAnimationFrame(hooks.updateOuterFrame);
}
