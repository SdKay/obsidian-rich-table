/**
 * Whole-table visual zoom (model.ts's `TableModelV2.zoom`) — a real CSS
 * `zoom` property on `root` (renderer.ts's `.bt-render-root`), not
 * `transform: scale()`. The two look interchangeable at first glance, but
 * `zoom` has two properties `scale()` lacks that this feature specifically
 * needs: it reserves real, scaled LAYOUT space for the zoomed subtree (so
 * content below a zoomed-in table isn't overlapped/covered — confirmed
 * empirically: a `scale()`'d box's following siblings sit exactly where an
 * unscaled box's would, `zoom`'s don't), and every one of the countless
 * `getBoundingClientRect()`-based positioning computations already in this
 * codebase (drag-resize, frozen rows/cols, hover strips, the ctrl column)
 * keeps working with only a handful of centralized corrections — see
 * `renderGeometry.ts`'s `NO_ZOOM`/`scrollContentOffset`/`computeVisibleGeom`
 * for where those live and why exactly there.
 */
import { ZOOM_MIN, ZOOM_MAX, ZOOM_DEFAULT } from './operations';
import type { StructuralOpHandler } from './renderTypes';
import { t } from './i18n';

export { ZOOM_MIN, ZOOM_MAX, ZOOM_DEFAULT };

/** Percent → factor (100 → 1) — the form every geometry correction in
 *  renderGeometry.ts/renderFreeze.ts actually divides by. */
export function zoomFactor(percent: number | undefined): number {
	return (percent ?? ZOOM_DEFAULT) / 100;
}

/** Sets `root`'s real `zoom` CSS property from a percent value — the one
 *  place this codebase ever writes that property. A real (non-custom)
 *  property, so this goes through `style.setProperty` with a dynamic value
 *  (obsidianmd/no-static-styles-assignment allows that shape — only a
 *  literal-valued assignment is flagged), not `setCssProps` (custom
 *  properties only). */
export function applyZoom(root: HTMLElement, percent: number | undefined): void {
	root.style.setProperty('zoom', String(zoomFactor(percent)));
}

const STEP = 10;

/**
 * The status-bar zoom widget — a `-` button, a draggable range slider, a
 * `+` button, and a click-to-type percent label, in that order (matching the
 * user's own Excel-status-bar reference). Lives between `.bt-status-stats`
 * and `.bt-status-divider` (renderer.ts's own status-bar assembly), sharing
 * that bar's real estate rather than adding a second row.
 *
 * The slider drags LIVE (instant `applyZoom` on every input event, no
 * onStructuralOp — same "apply now, commit on release" split column/row
 * resize already use) and only dispatches `set-zoom` once, on release/blur —
 * committing on every intermediate drag tick would flood the write-back
 * queue with a value the user hasn't settled on yet.
 */
export function renderZoomControl(
	statusBar: HTMLElement,
	getPercent: () => number,
	onStructuralOp: StructuralOpHandler | undefined,
	applyLive: (percent: number) => void,
): HTMLElement {
	const zoomEl = statusBar.createDiv({ cls: 'bt-status-zoom' });
	if (!onStructuralOp) {
		// Read-only rendering (locked table / reading view without edit allowed) —
		// still show the current level as plain text, no interactive controls, same
		// "read-only but not hidden" treatment the stats section itself gets.
		zoomEl.createSpan({ cls: 'bt-status-zoom-value', text: `${getPercent()}%` });
		return zoomEl;
	}

	const clamp = (p: number) => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Math.round(p)));
	const commit = (p: number) => void onStructuralOp({ type: 'set-zoom', percent: clamp(p) === ZOOM_DEFAULT ? null : clamp(p) });

	const minusBtn = zoomEl.createDiv({ cls: 'bt-status-zoom-btn', attr: { 'aria-label': t('zoomOut') } });
	minusBtn.setText('−');
	const slider = zoomEl.createEl('input', {
		cls: 'bt-status-zoom-slider',
		attr: { type: 'range', min: String(ZOOM_MIN), max: String(ZOOM_MAX), step: '1' },
	});
	slider.value = String(getPercent());
	const plusBtn = zoomEl.createDiv({ cls: 'bt-status-zoom-btn', attr: { 'aria-label': t('zoomIn') } });
	plusBtn.setText('+');
	const valueEl = zoomEl.createSpan({ cls: 'bt-status-zoom-value', text: `${getPercent()}%` });

	const setLive = (p: number) => {
		const clamped = clamp(p);
		slider.value = String(clamped);
		valueEl.setText(`${clamped}%`);
		applyLive(clamped);
	};

	minusBtn.addEventListener('click', () => { const p = clamp(getPercent() - STEP); setLive(p); commit(p); });
	plusBtn.addEventListener('click',  () => { const p = clamp(getPercent() + STEP); setLive(p); commit(p); });

	// 'input' fires continuously while dragging (live preview, no write-back);
	// 'change' fires once on release/keyboard-commit (persists).
	slider.addEventListener('input', () => setLive(Number(slider.value)));
	slider.addEventListener('change', () => commit(Number(slider.value)));

	// Click-to-type — same enterLineEdit-adjacent affordance the title/footer
	// use elsewhere in this file, but simple enough (one numeric value, no
	// multi-line concern) that a plain inline <input type=number> is enough
	// rather than pulling in that shared editor.
	valueEl.addEventListener('click', () => {
		if (valueEl.hasClass('bt-editing')) return;
		valueEl.addClass('bt-editing');
		const current = Number(slider.value);
		valueEl.empty();
		const input = valueEl.createEl('input', {
			cls: 'bt-status-zoom-input',
			attr: { type: 'number', min: String(ZOOM_MIN), max: String(ZOOM_MAX) },
		});
		input.value = String(current);
		const finish = (apply: boolean) => {
			valueEl.removeClass('bt-editing');
			const parsed = Number(input.value);
			const next = apply && Number.isFinite(parsed) ? clamp(parsed) : current;
			valueEl.empty();
			valueEl.setText(`${next}%`);
			if (apply && next !== current) { setLive(next); commit(next); }
		};
		input.addEventListener('blur', () => finish(true));
		input.addEventListener('keydown', (evt: KeyboardEvent) => {
			if (evt.key === 'Enter') { evt.preventDefault(); input.blur(); }
			if (evt.key === 'Escape') { evt.preventDefault(); finish(false); }
		});
		input.focus();
		input.select();
	});

	return zoomEl;
}
