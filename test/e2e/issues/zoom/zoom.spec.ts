import { test, expect } from '../../common/test-base';
import { tableSource, scrollableTable } from '../../common/fixtures';

/**
 * Whole-table zoom (model.ts's TableModelV2.zoom) — a real CSS `zoom`
 * property on `.bt-render-root`, chosen over `transform: scale()` because it
 * reserves real, scaled layout space for the zoomed subtree (confirmed via a
 * direct probe: a `scale()`d box's following siblings sit exactly where an
 * unscaled box's would; a `zoom`'d box's don't) — see renderZoom.ts's own
 * doc comment for the full reasoning. These tests cover the two halves of
 * the feature: (1) the CSS actually applies and doesn't clip/overlap
 * anything, and (2) every geometry computation renderer.ts/renderResize.ts/
 * renderFreeze.ts/renderAutofit.ts corrected for zoom (renderGeometry.ts's
 * `NO_ZOOM`) still lands pixel-correct once a real zoom is in effect — the
 * whole reason those corrections exist.
 */
test.describe('zoom', () => {
	test('applies the model\'s zoom percent as a real CSS zoom factor on the render root', async ({ page, renderFull }) => {
		await renderFull(tableSource({ widths: [100, 100], rows: [{ 0: 'x', 1: 'y' }], zoom: 150 }));
		const zoomStyle = await page.locator('.bt-render-root').evaluate(el => getComputedStyle(el).zoom);
		expect(zoomStyle).toBe('1.5');
	});

	test('a table with no zoom field renders at exactly 100% — old tables are unaffected', async ({ page, renderFull }) => {
		await renderFull(tableSource({ widths: [100], rows: [{ 0: 'x' }] }));
		const zoomStyle = await page.locator('.bt-render-root').evaluate(el => getComputedStyle(el).zoom);
		expect(zoomStyle).toBe('1');
	});

	test('the status bar shows the current zoom percent and a functional -/+/slider control', async ({ page, renderFull }) => {
		await renderFull(tableSource({ widths: [100], rows: [{ 0: 'x' }], zoom: 120 }));
		await expect(page.locator('.bt-status-zoom-value')).toHaveText('120%');
		await expect(page.locator('.bt-status-zoom-slider')).toHaveValue('120');
	});

	// Reported ("缩放按钮+和后面的百分比按钮中间有挺大一块空白，不够紧凑"): the
	// right-aligned percent label's min-width (3.5em) was sized for a value
	// wider than any real zoom percent ever produces (ZOOM_MAX is 400%,
	// ZOOM_MIN 25%) — the unused width showed as blank space to the LEFT of
	// the text, between it and the "+" button, for every narrower value.
	// Fixed by shrinking min-width to fit "400%" (the widest possible value)
	// with no leftover slack.
	test('the gap between "+" and the percent label stays tight at every zoom value, including the widest', async ({ page, renderFull }) => {
		await renderFull(tableSource({ widths: [100], rows: [{ 0: 'x' }], zoom: 120 }));
		const plusBtn = page.locator('.bt-status-zoom-btn').nth(1);
		const valueEl = page.locator('.bt-status-zoom-value');

		// text-align:right keeps the ELEMENT's own box left edge fixed even as
		// min-width slack grows — the actual visible gap is between the button
		// and the glyphs themselves, so measure the text's own rect, not the box.
		const visualGapAt = async () => {
			const plusBox = (await plusBtn.boundingBox())!;
			const textX = await valueEl.evaluate(el => {
				const range = document.createRange();
				range.selectNodeContents(el);
				return range.getBoundingClientRect().x;
			});
			return textX - (plusBox.x + plusBox.width);
		};
		const gap120 = await visualGapAt();

		await page.locator('.bt-status-zoom-slider').evaluate((el: HTMLInputElement) => {
			el.value = '400';
			el.dispatchEvent(new Event('input', { bubbles: true }));
		});
		await expect(valueEl).toHaveText('400%');
		const gap400 = await visualGapAt();

		// "400%" is the widest value ZOOM_MAX ever produces, so it should need
		// (almost) no min-width slack beyond its own text — the gap at the
		// narrower "120%" must not be noticeably larger than at "400%".
		expect(gap120 - gap400).toBeLessThan(3);
		expect(gap120).toBeLessThan(10);
	});

	test('clicking "+" dispatches set-zoom stepped by 10, and updates the CSS zoom live', async ({ page, renderFull }) => {
		await renderFull(tableSource({ widths: [100], rows: [{ 0: 'x' }], zoom: 120 }));
		await page.locator('.bt-status-zoom-btn').nth(1).click(); // + is the second button
		const ops = await page.evaluate(() => window.__btOps);
		expect(ops).toEqual([{ type: 'set-zoom', percent: 130 }]);
		const zoomStyle = await page.locator('.bt-render-root').evaluate(el => getComputedStyle(el).zoom);
		expect(zoomStyle).toBe('1.3');
	});

	test('clicking "-" dispatches set-zoom stepped down by 10', async ({ page, renderFull }) => {
		await renderFull(tableSource({ widths: [100], rows: [{ 0: 'x' }], zoom: 120 }));
		await page.locator('.bt-status-zoom-btn').nth(0).click();
		const ops = await page.evaluate(() => window.__btOps);
		expect(ops).toEqual([{ type: 'set-zoom', percent: 110 }]);
	});

	test('typing a value into the percent label commits it on Enter', async ({ page, renderFull }) => {
		await renderFull(tableSource({ widths: [100], rows: [{ 0: 'x' }], zoom: 120 }));
		await page.locator('.bt-status-zoom-value').click();
		const input = page.locator('.bt-status-zoom-input');
		await input.fill('75');
		await input.press('Enter');
		const ops = await page.evaluate(() => window.__btOps);
		expect(ops).toEqual([{ type: 'set-zoom', percent: 75 }]);
	});

	test('dragging the slider only updates the CSS live and does not dispatch until release', async ({ page, renderFull }) => {
		await renderFull(tableSource({ widths: [100], rows: [{ 0: 'x' }], zoom: 100 }));
		const slider = page.locator('.bt-status-zoom-slider');
		await slider.evaluate((el: HTMLInputElement) => {
			el.value = '200';
			el.dispatchEvent(new Event('input', { bubbles: true }));
		});
		let ops = await page.evaluate(() => window.__btOps);
		expect(ops).toEqual([]); // no commit yet — only 'input' fired
		const zoomStyle = await page.locator('.bt-render-root').evaluate(el => getComputedStyle(el).zoom);
		expect(zoomStyle).toBe('2'); // live preview did apply though
		await slider.evaluate(el => el.dispatchEvent(new Event('change', { bubbles: true })));
		ops = await page.evaluate(() => window.__btOps);
		expect(ops).toEqual([{ type: 'set-zoom', percent: 200 }]);
	});

	test('on a locked table, the zoom widget shows the value read-only with no interactive controls', async ({ page, renderFull }) => {
		await renderFull(tableSource({ widths: [100], rows: [{ 0: 'x' }], zoom: 130, locked: true }));
		await expect(page.locator('.bt-status-zoom-value')).toHaveText('130%');
		await expect(page.locator('.bt-status-zoom-btn')).toHaveCount(0);
		await expect(page.locator('.bt-status-zoom-slider')).toHaveCount(0);
	});

	// ── Geometry correctness under zoom — the actual point of every /zoom
	// correction added to renderGeometry.ts/renderResize.ts/renderFreeze.ts/
	// renderAutofit.ts. Each test picks a KNOWN zoom factor and asserts a
	// real, on-screen pixel relationship that would only hold if the
	// correction is right — not just "no crash". ──

	test('zoomed content does not overlap whatever comes after the table (the reason zoom was chosen over transform:scale)', async ({ page, renderFull }) => {
		await renderFull(tableSource({ widths: [100, 100], rows: [{ 0: 'x', 1: 'y' }], zoom: 250 }));
		// A real DOM marker appended right after the table's own root — if the
		// zoomed root's reserved layout space were wrong (e.g. using
		// transform:scale, which reserves none), this marker would sit
		// overlapped underneath the visually-2.5x table instead of below it.
		await page.evaluate(() => {
			const root = document.querySelector('.bt-render-root')!;
			const marker = document.createElement('div');
			marker.id = 'after-marker';
			marker.style.height = '10px';
			root.after(marker);
		});
		const rootRect = await page.locator('.bt-render-root').evaluate(el => el.getBoundingClientRect());
		const markerRect = await page.locator('#after-marker').evaluate(el => el.getBoundingClientRect());
		expect(markerRect.top).toBeGreaterThanOrEqual(rootRect.bottom - 0.5);
	});

	test('a column resize-drag under zoom moves the column by the exact number of real (visual) pixels dragged', async ({ page, renderFull }) => {
		await renderFull(tableSource({ widths: [100, 100], rows: [{ 0: 'x', 1: 'y' }], zoom: 200 }));
		await page.locator('table.bt-table').hover();
		const handle = page.locator('.bt-sel-resize-col').first();
		const box = (await handle.boundingBox())!;
		await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
		await page.mouse.down();
		// Drag by 60 REAL/visual px — at zoom=200%, this must widen the LOGICAL
		// column width by 30px (60 / 2), not 60 (which is what the pre-fix
		// naive delta math would have produced — see renderResize.ts's own
		// correction comment).
		await page.mouse.move(box.x + box.width / 2 + 60, box.y + box.height / 2);
		await page.mouse.up();
		const ops = await page.evaluate(() => window.__btOps);
		const widthOp = ops.find((o: { type: string }) => o.type === 'set-col-width');
		expect(widthOp).toBeTruthy();
		expect(widthOp.width).toBe(130); // 100 (initial) + 30 (logical delta)
	});

	test('a row resize-drag under zoom moves the row by the exact number of logical pixels', async ({ page, renderFull }) => {
		// 3 rows, not 1 — .bt-row-selector clips its own children to --rs-height
		// (overflow: hidden), and a single-row table's only resize handle sits
		// tight against that clip boundary, right where elementFromPoint can miss
		// it entirely. Using row 0's handle (well clear of the strip's edge with
		// 3 rows present) keeps this test about the drag MATH, not the strip's
		// own clipping geometry.
		await renderFull(tableSource({
			widths: [100],
			rows: [{ 0: 'x' }, { 0: 'y' }, { 0: 'z' }],
			zoom: 150,
		}));
		await page.locator('table.bt-table').hover();
		const startHeight = await page.locator('td[data-row="1"]').evaluate(el => (el as HTMLElement).offsetHeight);
		const handle = page.locator('.bt-sel-resize-row').first();
		const box = (await handle.boundingBox())!;
		await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
		await page.mouse.down();
		// 45 real px at zoom=150% => 30 logical px.
		await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2 + 45);
		await page.mouse.up();
		const ops = await page.evaluate(() => window.__btOps);
		const heightOp = ops.find((o: { type: string }) => o.type === 'set-row-height');
		expect(heightOp).toBeTruthy();
		expect(heightOp.height).toBe(startHeight + 30);
	});

	test('a frozen column\'s real left edge lines up exactly with its non-frozen neighbor at rest, under zoom', async ({ page, renderFull }) => {
		// renderFull, not renderReal — renderReal builds its table DOM through a
		// hand-ported fixture (build-table-dom.js) that predates this feature and
		// never applies `zoom` at all, which would make this test vacuous (freeze
		// alignment checked at zoom=1 regardless of what the source says).
		// renderFull runs the REAL renderTable(), which does apply it.
		//
		// Checked at scroll=0 specifically, where scrollContentOffset's own
		// `scroller.scrollLeft` term is exactly 0 — this isolates the ONE term
		// that actually needs the `/ zoom` correction (the visual
		// getBoundingClientRect() difference) from the scroll term, which is
		// already logical and needs no correction. A scroll-invariance check
		// (comparing the frozen cell's position before/after scrolling) was
		// tried first and rejected: position:sticky keeps ANY assigned `left`
		// value visually fixed across scroll regardless of whether that value
		// is itself correct, so a wrong-but-constant value would pass such a
		// check — confirmed by deliberately reintroducing the bug (dropping the
		// `/ zoom` on scrollContentOffset's x-axis) and observing the
		// scroll-invariance version keep passing anyway.
		await renderFull(scrollableTable({ freezeCols: 2, zoom: 175 }));
		const gap = await page.evaluate(() => {
			const frozenCell = document.querySelector('td[data-row="1"][data-col="1"]') as HTMLElement;
			const neighborCell = document.querySelector('td[data-row="1"][data-col="2"]') as HTMLElement;
			return neighborCell.getBoundingClientRect().left - frozenCell.getBoundingClientRect().right;
		});
		expect(Math.abs(gap)).toBeLessThan(1);
	});

	test('the view-resize handle under zoom grows the view by the exact number of logical pixels dragged', async ({ page, renderFull }) => {
		await renderFull(tableSource({ widths: [100], rows: [{ 0: 'x' }], zoom: 200, viewWidth: 150 }));
		await page.locator('table.bt-table').hover();
		const handle = page.locator('.bt-view-resize-r');
		const box = (await handle.boundingBox())!;
		await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
		await page.mouse.down();
		// 80 real px at zoom=200% => 40 logical px.
		await page.mouse.move(box.x + box.width / 2 + 80, box.y + box.height / 2);
		await page.mouse.up();
		const ops = await page.evaluate(() => window.__btOps);
		const widthOp = ops.find((o: { type: string }) => o.type === 'set-view-width');
		expect(widthOp).toBeTruthy();
		expect(widthOp.width).toBe(190); // 150 (initial) + 40 (logical delta)
	});

	// Reported ("autofit-all 的表格每次调整之后...瞬间出现换行...随后又变回不换行"):
	// on an all-auto table (no column has any explicit width — exactly what
	// the ⊞ auto-fit-all button produces), dragging the zoom control squeezed
	// a column, forcing a visible wrap that then self-corrected. Root cause:
	// the zoom control's live-drag preview (renderZoomControl's applyLive)
	// changes root's real CSS `zoom` immediately, without waiting for the
	// eventual commit's full re-render — but renderer.ts's `rebuild()` (which
	// re-measures and pins EVERY column's width in the !hasExplicitWidths
	// branch, run on hover and by a ResizeObserver a live zoom change itself
	// can trigger) used to divide by a `zoom` NUMBER captured once at render
	// time and never updated for the live-preview change. A `rebuild()` that
	// runs mid-drag therefore divided a now-different visual measurement by a
	// stale factor, pinning columns to a corrupted width until the real
	// commit's fresh render fixed it. re-hovering the table is used here
	// instead of waiting on the ResizeObserver directly, since showSelectors()
	// calls rebuild() unconditionally on the very next frame — deterministic,
	// unlike the observer's own timing.
	test('a live zoom drag does not corrupt an all-auto table\'s pinned column widths', async ({ page, renderFull }) => {
		await renderFull(tableSource({ widths: [undefined, undefined], rows: [
			{ 0: 'x', 1: 'a fairly long line of content that this auto column should track without ever squeezing narrower than its own content needs' },
		] }));
		await page.waitForTimeout(100);
		await page.locator('table.bt-table').hover();
		await page.waitForTimeout(100);

		const col = page.locator('col[data-col="1"]');
		const widthBefore = await col.evaluate(el => parseFloat((el as HTMLElement).style.width));
		expect(widthBefore).toBeGreaterThan(0);

		// Live-drag zoom to 150% via 'input' only (no commit) — the exact
		// interaction that exposed the bug.
		const slider = page.locator('.bt-status-zoom-slider');
		await slider.evaluate((el) => {
			(el as HTMLInputElement).value = '150';
			el.dispatchEvent(new Event('input', { bubbles: true }));
		});
		await page.waitForTimeout(50);

		// Force rebuild() to run again, deterministically, while zoom is still
		// only live-previewed (no commit): leave and re-enter the table.
		await page.mouse.move(0, 0);
		await page.waitForTimeout(20);
		await page.locator('table.bt-table').hover();
		await page.waitForTimeout(100);

		// The auto column's pinned LOGICAL width must stay the same regardless
		// of live zoom (rebuild() always divides its visual measurement back
		// down to logical px) — it must never have been squeezed/inflated by a
		// stale zoom factor mid-drag.
		const widthAfter = await col.evaluate(el => parseFloat((el as HTMLElement).style.width));
		expect(Math.abs(widthAfter - widthBefore)).toBeLessThan(1);

		// And the content must never have been forced to wrap.
		const cell = page.locator('td[data-row="1"][data-col="1"]');
		const lines = await cell.evaluate(el => {
			const p = el.querySelector('p') ?? el;
			const range = document.createRange();
			range.selectNodeContents(p);
			return range.getClientRects().length;
		});
		expect(lines).toBe(1);
	});

	// Reported ("标题也跟着一起缩放呗"): the title used to be a sibling of
	// .bt-render-root, deliberately excluded from zoom (the original design
	// intentionally kept it fixed-size, per the user's own earlier choice) —
	// this reverses that: the title is now INSIDE root, so it scales with
	// everything else.
	test('the table title scales together with the table under zoom', async ({ page, renderFull }) => {
		await renderFull(tableSource({ widths: [100], rows: [{ 0: 'x' }], zoom: 200, title: 'My Title' }));
		const insideRoot = await page.evaluate(() => {
			const title = document.querySelector('.bt-table-title') as HTMLElement | null;
			const root = title?.closest('.bt-render-root');
			return !!title && !!root && title.parentElement === root;
		});
		expect(insideRoot).toBe(true);
	});

	// Reported ("滑动调整缩放比例体验很差，稍微一拖表格缩放导致滑块和鼠标位置脱离，
	// 然后表格会迅速所发到一个极大或极小的比例"): the zoom slider is a native
	// <input type=range>. When it lived INSIDE the zoomed .bt-render-root, its
	// own on-screen track geometry changed the instant its own 'input' handler
	// changed root's zoom — so the browser's next mouse-to-value mapping used a
	// rescaled track under an unmoved cursor, producing a huge value jump from
	// a tiny real mouse movement, compounding every frame into a runaway. Fixed
	// by moving the status bar (and its zoom control) OUTSIDE the zoomed
	// subtree entirely (renderer.ts's `shell`) — confirmed via a direct probe
	// that a slider inside a self-changing zoomed ancestor runs away (a 20px
	// mouse move produced a 100%→212% jump) while one outside it doesn't.
	test('the zoom slider does not live inside the zoomed subtree (no drag runaway)', async ({ page, renderFull }) => {
		await renderFull(tableSource({ widths: [100], rows: [{ 0: 'x' }] }));
		const sliderInsideRoot = await page.evaluate(() => {
			const slider = document.querySelector('.bt-status-zoom-slider');
			const root = document.querySelector('.bt-render-root');
			return !!slider && !!root && root.contains(slider);
		});
		expect(sliderInsideRoot).toBe(false);

		// A real drag, starting from the pixel that actually corresponds to the
		// slider's CURRENT value (100, min=25/max=400) rather than the track's
		// visual midpoint — mousedown away from the thumb's own position jumps
		// the value on its own (confirmed via direct probe: box-center alone,
		// with no drag at all, jumped value 100 -> 213), which would swamp the
		// runaway this test is actually checking for.
		const slider = page.locator('.bt-status-zoom-slider');
		const box = (await slider.boundingBox())!;
		const [min, max, value0] = await slider.evaluate((el: HTMLInputElement) => [Number(el.min), Number(el.max), Number(el.value)]);
		const startFrac = (value0 - min) / (max - min);
		const startX = box.x + box.width * startFrac;
		const startY = box.y + box.height / 2;
		await page.mouse.move(startX, startY);
		await page.mouse.down();
		await page.waitForTimeout(20);
		expect(Number(await slider.inputValue())).toBe(value0); // mousedown alone must not have jumped it

		// Now a SMALL real mouse move. If the slider were still inside the
		// zoomed subtree, this exact drag would compound into a value far past
		// what a 12px move should ever produce (confirmed via direct probe: a
		// 20px move produced a 100%→212% jump under that bug).
		await page.mouse.move(startX + 12, startY, { steps: 5 });
		await page.waitForTimeout(30);
		const value = Number(await slider.inputValue());
		await page.mouse.up();
		expect(value - value0).toBeLessThan(50);
	});

	// Reported ("hover之后title被列选择器遮挡了"): moving the title INSIDE root
	// (the fix above) carried an unnoticed side effect. The column-selector
	// strip's reserved 32px gap used to land as root's own padding-top — safe
	// back when the title was root's SIBLING, since root's only content was
	// the table, so that padding sat directly above it, right where the
	// strip anchors. With the title now root's first child, that same
	// padding pushed the TITLE down instead of opening a gap between title
	// and table, so the strip (which always anchors just above the table,
	// regardless of what's above THAT) rendered directly on top of the
	// title. Fixed by moving the reservation onto the title's own
	// margin-bottom (--bt-title-sel-pad) instead of root's padding-top
	// whenever a title exists — confirmed via direct measurement: the strip
	// now sits exactly between title and table, at every scroll offset.
	test('a title never gets covered by the column-selector strip on hover', async ({ page, renderFull }) => {
		await renderFull(tableSource({ widths: [100, 100], rows: [{ 0: 'x', 1: 'y' }], title: 'My Title' }));
		await page.locator('table.bt-table').hover();
		await page.waitForTimeout(50);
		const state = await page.evaluate(() => {
			const title = document.querySelector('.bt-table-title') as HTMLElement;
			const colSel = document.querySelector('.bt-col-selector') as HTMLElement;
			return { titleBottom: title.getBoundingClientRect().bottom, colSelTop: colSel.getBoundingClientRect().top };
		});
		expect(state.colSelTop).toBeGreaterThanOrEqual(state.titleBottom - 0.5);
	});
});
