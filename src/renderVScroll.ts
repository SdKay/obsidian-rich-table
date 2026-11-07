/**
 * The vertical scrollbar on the right of a table, the mirror of the toolbar on the left. It is a flex sibling of the
 * table and is drawn whether or not the table is locked: a locked table still scrolls.
 */
import type { TableModelV2 } from './model';
import type { LayoutSync } from './layoutSync';
import type { VisibleGeom } from './renderGeometry';

export interface RenderVScrollContext {
	model: TableModelV2;
	wrapper: HTMLElement;
	contentRow: HTMLElement;
	computeVisibleGeom: () => VisibleGeom;
	layoutSync: LayoutSync;
	watchLayout: (el: HTMLElement) => void;
}

export function renderVScroll(ctx: RenderVScrollContext): void {
	const { model, wrapper, contentRow, computeVisibleGeom, layoutSync, watchLayout } = ctx;
	// ── Vertical scrollbar — right-side mirror of the toolbar (.bt-ctrl-col) ──
	// Created unconditionally like ctrlCol itself: a locked table still needs
	// a scrollbar if its content overflows, it just never gets the edge-add
	// strips (onStructuralOp-only) — appending it here, AFTER the edge-strip
	// block above, guarantees it lands after addColBtn in contentRow's DOM
	// order when addColBtn exists (unlocked), so the flex row places it to
	// addColBtn's right; on a locked table it's simply contentRow's only
	// added sibling of <table>. A flex sibling, not a JS-toggled overlay —
	// see .bt-view-scroll's own CSS comment for why that's load-bearing here
	// (the exact "toggling a size on hover shifts the table sideways" bug
	// class .bt-edge-add-col's own comment already documents).
	{
		const viewScroll = contentRow.createDiv({ cls: 'bt-view-scroll' + (model.locked ? ' is-locked' : '') });
		const viewScrollTrack = viewScroll.createDiv({ cls: 'bt-view-scroll-track' });
		const viewScrollThumb = viewScrollTrack.createDiv({ cls: 'bt-view-scroll-thumb' });

		// Mirrors positionEdgeStrips' own --strip-height (addColBtn's height) —
		// both need the exact same clamped-to-visible table height, since they
		// sit side by side in the same flex row. Kept as its own small
		// function (rather than folding into positionEdgeStrips, which only
		// exists inside the onStructuralOp-gated edge-strip block) so a LOCKED
		// table — which never creates addColBtn at all — still gets this
		// sized correctly.
		const positionViewScroll = (geom: VisibleGeom = computeVisibleGeom()) => {
			if (geom.tr.width === 0) return;
			viewScroll.setCssProps({ '--strip-height': `${geom.vh}px` });
		};
		window.requestAnimationFrame(() => positionViewScroll());
		layoutSync.register('place', () => positionViewScroll());
		wrapper.addEventListener('scroll', () => positionViewScroll());

		// Custom scrollbar synced to wrapper's real scrollTop/scrollHeight/
		// clientHeight — vertical mirror of the status bar's own
		// syncScrollThumb. The native track/thumb are hidden (.bt-table-
		// wrapper's own ::-webkit-scrollbar rule); actual wheel/trackpad/
		// keyboard scrolling is untouched.
		const syncVScrollThumb = () => {
			const trackHeight = viewScrollTrack.clientHeight;
			const { scrollHeight, clientHeight, scrollTop } = wrapper;
			if (scrollHeight <= clientHeight + 1) {
				viewScroll.addClass('bt-view-scroll-empty');
				viewScrollThumb.setCssProps({ '--bt-view-thumb-h': `${trackHeight}px`, '--bt-view-thumb-t': '0px' });
				return;
			}
			viewScroll.removeClass('bt-view-scroll-empty');
			const thumbHeight = Math.max(16, trackHeight * clientHeight / scrollHeight);
			const maxThumbTop = trackHeight - thumbHeight;
			const thumbTop = maxThumbTop * scrollTop / (scrollHeight - clientHeight);
			viewScrollThumb.setCssProps({
				'--bt-view-thumb-h': `${thumbHeight}px`,
				'--bt-view-thumb-t': `${thumbTop}px`,
			});
		};
		syncVScrollThumb();

		let vScrollThumbSyncScheduled = false;
		const scheduleSyncVScrollThumb = () => {
			if (vScrollThumbSyncScheduled) return;
			vScrollThumbSyncScheduled = true;
			window.requestAnimationFrame(() => { vScrollThumbSyncScheduled = false; syncVScrollThumb(); });
		};
		wrapper.addEventListener('scroll', scheduleSyncVScrollThumb);
		watchLayout(viewScrollTrack);
		layoutSync.register('place', syncVScrollThumb);

		// Dragging the thumb sets wrapper.scrollTop directly — pure local UI
		// state, never written back to the model, mirroring the horizontal
		// thumb's own drag handler.
		viewScrollThumb.addEventListener('pointerdown', (e: PointerEvent) => {
			e.preventDefault();
			viewScrollThumb.setPointerCapture(e.pointerId);
			const trackRect = viewScrollTrack.getBoundingClientRect();
			const thumbHeight = viewScrollThumb.getBoundingClientRect().height;
			const startThumbTop = viewScrollThumb.getBoundingClientRect().top - trackRect.top;
			const startY = e.clientY;
			const maxThumbTop = trackRect.height - thumbHeight;
			const onMove = (ev: PointerEvent) => {
				const rawTop = startThumbTop + (ev.clientY - startY);
				const clampedTop = Math.max(0, Math.min(maxThumbTop, rawTop));
				const scrollRange = wrapper.scrollHeight - wrapper.clientHeight;
				wrapper.scrollTop = maxThumbTop > 0 ? scrollRange * clampedTop / maxThumbTop : 0;
			};
			const onUp = () => {
				viewScrollThumb.removeEventListener('pointermove', onMove);
				viewScrollThumb.removeEventListener('pointerup', onUp);
			};
			viewScrollThumb.addEventListener('pointermove', onMove);
			viewScrollThumb.addEventListener('pointerup', onUp);
		});
	}
}
