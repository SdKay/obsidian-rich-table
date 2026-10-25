import { test, expect } from '../../common/test-base';
import { tableSource } from '../../common/fixtures';

// FR-017 — see solutions/status-bar.md. Tests added incrementally as each
// implementation task lands; this file covers the pieces that genuinely need
// a real browser (DOM structure, native-scrollbar hiding, live drag/scroll
// sync) — the pure-logic pieces (computeSelectionStats, the two structural
// ops) are unit-tested in test/statusBar.test.ts instead.
test.describe('status bar — DOM skeleton (Task 4)', () => {
	const SOURCE = tableSource({
		widths: [80, 80],
		rows: [{ 0: 'a1' }, { 0: 'a2' }],
	});

	test('renders the skeleton with the table\'s totals, no selection yet', async ({ page, renderFull }) => {
		await renderFull(SOURCE);
		const bar = page.locator('.bt-status-bar');
		await expect(bar).toBeVisible();
		await expect(bar.locator('.bt-status-tabs')).toHaveCount(1);
		await expect(bar.locator('.bt-status-divider')).toHaveCount(1);
		await expect(bar.locator('.bt-status-scroll-track')).toHaveCount(1);
		await expect(bar.locator('.bt-status-scroll-thumb')).toHaveCount(1);
		await expect(bar.locator('.bt-status-stats')).toHaveText('2 rows × 2 cols');
	});

	test('.bt-status-stats carries an is-selection class only while a multi-cell selection is active (issue #7)', { tag: '@geometry' }, async ({ page, renderFull }) => {
		await renderFull(SOURCE);
		const stats = page.locator('.bt-status-stats');
		await expect(stats).not.toHaveClass(/is-selection/);

		const a1 = (await page.locator('[data-row="1"][data-col="0"]').boundingBox())!;
		const a2 = (await page.locator('[data-row="2"][data-col="0"]').boundingBox())!;
		await page.mouse.move(a1.x + a1.width / 2, a1.y + a1.height / 2);
		await page.mouse.down();
		await page.mouse.move(a2.x + a2.width / 2, a2.y + a2.height / 2, { steps: 5 });
		await page.mouse.up();

		await expect(stats).toHaveClass(/is-selection/);
		await expect(stats).toHaveText(/^Selected/);
	});

	test('native horizontal scrolling still works once its own scrollbar is visually hidden', async ({ page, renderFull }) => {
		// Whether the ::-webkit-scrollbar:horizontal rule actually suppresses
		// the painted track/thumb isn't reliably checkable here: Chromium's
		// getComputedStyle only resolves a SIMPLE pseudo-element name for its
		// second argument (confirmed: `::-webkit-scrollbar` alone returns a
		// real value, `::-webkit-scrollbar:horizontal` always comes back empty
		// regardless of whether a matching rule exists), and this harness's
		// file:// stylesheets throw on `cssRules` access (cross-origin
		// restriction), so `document.styleSheets` can't be walked either. What
		// IS reliably checkable, and is the part that would actually break if
		// this rule broke real scrolling: native scroll keeps working.
		const WIDE = tableSource({ widths: [150, 150, 150, 150, 150], rows: [{ 0: 'a1' }], viewWidth: 200 });
		await renderFull(WIDE);
		const wrapper = page.locator('.bt-table-wrapper');
		await expect(wrapper).toHaveCSS('overflow-x', 'auto');
		await wrapper.evaluate((el: HTMLElement) => { el.scrollLeft = 20; });
		expect(await wrapper.evaluate((el: HTMLElement) => el.scrollLeft)).toBe(20);
	});
});

test.describe('status bar — custom scrollbar sync (Task 5)', () => {
	const WIDE = tableSource({ widths: [150, 150, 150, 150, 150], rows: [{ 0: 'a1' }], viewWidth: 200 });
	const NARROW = tableSource({ widths: [80, 80], rows: [{ 0: 'a1' }] });

	test('thumb tracks wrapper.scrollLeft as the table scrolls', { tag: '@geometry' }, async ({ page, renderFull }) => {
		await renderFull(WIDE);
		const wrapper = page.locator('.bt-table-wrapper');
		const thumb = page.locator('.bt-status-scroll-thumb');
		const track = page.locator('.bt-status-scroll-track');

		const trackRect = (await track.boundingBox())!;
		const thumbBefore = (await thumb.boundingBox())!;
		expect(thumbBefore.x, 'thumb should start flush with the track\'s left edge').toBeCloseTo(trackRect.x, 0);

		await wrapper.evaluate((el: HTMLElement) => { el.scrollLeft = el.scrollWidth; });
		await expect.poll(async () => {
			const t = (await thumb.boundingBox())!;
			return Math.round(t.x + t.width);
		}).toBe(Math.round(trackRect.x + trackRect.width));
	});

	test('the scrollbar track fills about half of the status bar height, so it is easy to grab', { tag: '@geometry' }, async ({ page, renderFull }) => {
		await renderFull(WIDE);
		const track = (await page.locator('.bt-status-scroll-track').boundingBox())!;
		const thumb = (await page.locator('.bt-status-scroll-thumb').boundingBox())!;
		const bar = (await page.locator('.bt-status-bar').boundingBox())!;
		expect(track.height).toBeGreaterThanOrEqual(10);
		expect(track.height).toBeLessThan(bar.height);
		expect(thumb.height).toBeCloseTo(track.height, 0);
	});

	test('no resize handle overlaps the scrollbar track, so dragging the thumb never grabs the view edge', { tag: '@geometry' }, async ({ page, renderFull }) => {
		await renderFull(WIDE);
		const overlap = await page.evaluate(() => {
			const t = document.querySelector('.bt-status-scroll-track')!.getBoundingClientRect();
			return ['.bt-view-resize-r', '.bt-view-resize-b', '.bt-view-resize-br'].map(sel => {
				const h = document.querySelector(sel)!.getBoundingClientRect();
				return Math.min(t.right, h.right) - Math.max(t.left, h.left) > 0.5 && Math.min(t.bottom, h.bottom) - Math.max(t.top, h.top) > 0.5;
			});
		});
		expect(overlap).toEqual([false, false, false]);
	});

	test('the scrollbar track is vertically centered with the other status bar content', { tag: '@geometry' }, async ({ page, renderFull }) => {
		await renderFull(WIDE);
		const mid = async (sel: string) => { const b = (await page.locator(sel).boundingBox())!; return b.y + b.height / 2; };
		expect(Math.abs((await mid('.bt-status-scroll-track')) - (await mid('.bt-status-stats')))).toBeLessThanOrEqual(1);
		expect(Math.abs((await mid('.bt-status-scroll-track')) - (await mid('.bt-status-zoom')))).toBeLessThanOrEqual(1);
	});

	test('pressing the empty track pages the table toward the pointer', { tag: '@geometry' }, async ({ page, renderFull }) => {
		await renderFull(WIDE);
		const wrapper = page.locator('.bt-table-wrapper');
		const track = (await page.locator('.bt-status-scroll-track').boundingBox())!;
		await page.mouse.click(track.x + track.width - 3, track.y + track.height / 2);
		await expect.poll(() => wrapper.evaluate((el: HTMLElement) => el.scrollLeft)).toBeGreaterThan(0);
		await page.mouse.click(track.x + 2, track.y + track.height / 2);
		await expect.poll(() => wrapper.evaluate((el: HTMLElement) => el.scrollLeft)).toBe(0);
	});

	test('dragging the thumb sets wrapper.scrollLeft', { tag: '@geometry' }, async ({ page, renderFull }) => {
		await renderFull(WIDE);
		const wrapper = page.locator('.bt-table-wrapper');
		const thumb = page.locator('.bt-status-scroll-thumb');
		const track = page.locator('.bt-status-scroll-track');

		const thumbBox = (await thumb.boundingBox())!;
		const trackBox = (await track.boundingBox())!;
		await page.mouse.move(thumbBox.x + thumbBox.width / 2, thumbBox.y + thumbBox.height / 2);
		await page.mouse.down();
		await page.mouse.move(trackBox.x + trackBox.width, thumbBox.y + thumbBox.height / 2);
		await page.mouse.up();

		const scrollLeft = await wrapper.evaluate((el: HTMLElement) => el.scrollLeft);
		const maxScroll = await wrapper.evaluate((el: HTMLElement) => el.scrollWidth - el.clientWidth);
		expect(scrollLeft, 'dragging the thumb all the way right should scroll to the end').toBe(maxScroll);
	});

	test('the scrollbar fills the whole track when the table has nothing to scroll', { tag: '@geometry' }, async ({ page, renderFull }) => {
		await renderFull(NARROW);
		const scroll = page.locator('.bt-status-scroll');
		const track = page.locator('.bt-status-scroll-track');
		const thumb = page.locator('.bt-status-scroll-thumb');
		await expect(scroll).toHaveClass(/bt-status-scroll-empty/);
		await expect(scroll).toBeVisible();
		const trackWidth = (await track.boundingBox())!.width;
		const thumbWidth = (await thumb.boundingBox())!.width;
		expect(thumbWidth).toBeGreaterThanOrEqual(trackWidth - 1);
	});

	test('the scrollbar is visible (not empty) for a table with real overflow', async ({ page, renderFull }) => {
		await renderFull(WIDE);
		await expect(page.locator('.bt-status-scroll')).not.toHaveClass(/bt-status-scroll-empty/);
	});
});

test.describe('status bar — divider drag + persistence (Task 7)', () => {
	const WIDE = tableSource({ widths: [150, 150, 150, 150, 150], rows: [{ 0: 'a1' }], viewWidth: 400 });
	const WITH_WIDTH = tableSource({
		widths: [150, 150, 150, 150, 150], rows: [{ 0: 'a1' }], viewWidth: 400, statusBarScrollWidth: 200,
	});

	test('dragging the divider left grows .bt-status-scroll and commits set-status-bar-scroll-width on release', { tag: '@geometry' }, async ({ page, renderFull }) => {
		await renderFull(WIDE);
		const divider = page.locator('.bt-status-divider');
		const scroll = page.locator('.bt-status-scroll');

		const before = (await scroll.boundingBox())!;
		const dividerBox = (await divider.boundingBox())!;
		await page.mouse.move(dividerBox.x + dividerBox.width / 2, dividerBox.y + dividerBox.height / 2);
		await page.mouse.down();
		await page.mouse.move(dividerBox.x - 40, dividerBox.y + dividerBox.height / 2);
		await page.mouse.up();

		const after = (await scroll.boundingBox())!;
		expect(after.width, 'dragging left should widen the scroll section').toBeGreaterThan(before.width + 20);

		const ops = await page.evaluate(() => window.__btOps) as { type: string; width?: number }[];
		expect(ops.length).toBe(1);
		expect(ops[0]!.type).toBe('set-status-bar-scroll-width');
		expect(ops[0]!.width).toBeGreaterThan(before.width + 20);
	});

	test('a persisted statusBarScrollWidth is applied on render', { tag: '@geometry' }, async ({ page, renderFull }) => {
		await renderFull(WITH_WIDTH);
		const scroll = page.locator('.bt-status-scroll');
		// flex-basis (the persisted width) is a content-box size; the element's
		// own horizontal padding (--size-4-1 each side) adds on top of it in the
		// rendered bounding box, so this checks a range rather than an exact px.
		const box = (await scroll.boundingBox())!;
		expect(box.width).toBeGreaterThanOrEqual(200);
		expect(box.width).toBeLessThan(220);
	});
});

test.describe('status bar — height-resize handle', () => {
	const EDITABLE = tableSource({ widths: [80, 80], rows: [{ 0: 'a1' }] });
	const LOCKED = tableSource({ widths: [80, 80], rows: [{ 0: 'a1' }], locked: true });

	test('the height handle is a direct child of root, with or without the status bar', async ({ page, renderFull }) => {
		await renderFull(EDITABLE);
		await expect(page.locator('.bt-render-root-shell > .bt-view-resize-b')).toHaveCount(1);
		await expect(page.locator('.bt-view-resize-b')).toHaveCount(1);
		await expect(page.locator('.bt-status-bar')).toHaveCount(1);
	});

	test('the height handle sits on the view bottom edge (the bar\'s bottom) and is centered on the view', { tag: '@geometry' }, async ({ page, renderFull }) => {
		await renderFull(EDITABLE);
		const frame = (await page.locator('.bt-outer-frame').boundingBox())!;
		const bar = (await page.locator('.bt-status-bar').boundingBox())!;
		const handle = (await page.locator('.bt-view-resize-b').boundingBox())!;
		expect(handle.y + handle.height).toBeCloseTo(frame.y + frame.height, 0);
		expect(frame.y + frame.height).toBeCloseTo(bar.y + bar.height, 0);
		expect(handle.x + handle.width / 2).toBeCloseTo(frame.x + frame.width / 2, 0);
	});

	test('dragging it resizes the wrapper and commits set-view-height on release', { tag: '@geometry' }, async ({ page, renderFull }) => {
		await renderFull(EDITABLE);
		const wrapper = page.locator('.bt-table-wrapper');
		const handle = page.locator('.bt-render-root-shell > .bt-view-resize-b');

		const before = (await wrapper.boundingBox())!;
		const handleBox = (await handle.boundingBox())!;
		await page.mouse.move(handleBox.x + handleBox.width / 2, handleBox.y + handleBox.height / 2);
		await page.mouse.down();
		await page.mouse.move(handleBox.x + handleBox.width / 2, handleBox.y + 60);
		await page.mouse.up();

		const after = (await wrapper.boundingBox())!;
		expect(after.height, 'dragging down should grow the wrapper').toBeGreaterThan(before.height + 30);

		const ops = await page.evaluate(() => window.__btOps) as { type: string; height?: number }[];
		expect(ops.length).toBe(1);
		expect(ops[0]!.type).toBe('set-view-height');
	});

	// Reported ("一般人都不知道高度能调"): showing the dash only once the
	// cursor is already precisely over the 6px-tall handle hotspot gave no
	// hint the affordance existed at all. Fixed to reveal on hovering the
	// whole table (matches every other discoverability hint in this file —
	// ctrl column, row/col selectors — which shows on entering the outer
	// frame, not on landing on one exact pixel-precise strip within it).
	test('hovering anywhere over the table reveals the height-handle dash, not just the handle\'s own hotspot', { tag: '@geometry' }, async ({ page, renderFull }) => {
		await renderFull(EDITABLE);
		const root = page.locator('.bt-render-root');
		const handle = page.locator('.bt-render-root-shell > .bt-view-resize-b');
		const opacityBefore = await handle.evaluate(el => getComputedStyle(el, '::after').opacity);
		expect(opacityBefore).toBe('0');

		const rootBox = (await root.boundingBox())!;
		await page.mouse.move(rootBox.x + rootBox.width / 2, rootBox.y + rootBox.height / 2);
		await expect.poll(() => handle.evaluate(el => getComputedStyle(el, '::after').opacity)).toBe('1');

		await page.mouse.move(rootBox.x - 100, rootBox.y - 100);
		await expect.poll(() => handle.evaluate(el => getComputedStyle(el, '::after').opacity)).toBe('0');
	});

	test('a locked table hides the handle but keeps the stats visible', async ({ page, renderFull }) => {
		await renderFull(LOCKED);
		await expect(page.locator('.bt-view-resize-b')).toHaveCount(0);
		await expect(page.locator('.bt-status-stats')).toBeVisible();
		await expect(page.locator('.bt-status-stats')).not.toBeEmpty();
	});
});

test.describe('status bar — show/hide toggle', () => {
	const SRC = tableSource({ widths: [80, 80], rows: [{ 0: 'a1' }] });
	const HIDDEN = tableSource({ widths: [80, 80], rows: [{ 0: 'a1' }], statusBarMode: 'hover' });
	const WIDE = tableSource({ widths: [200, 200, 200], rows: [{ 0: 'a1' }], viewWidth: 250 });

	test('a table with the bar turned off renders none of it, but keeps the height handle on the view', async ({ page, renderFull }) => {
		await renderFull(HIDDEN);
		await expect(page.locator('.bt-status-bar')).toHaveCount(0);
		await expect(page.locator('.bt-render-root-shell > .bt-view-resize-b')).toHaveCount(1);
	});

	test('the view-settings "Show status bar" entry is checked when shown and toggles via set-status-bar-mode', async ({ page, renderFull }) => {
		await renderFull(SRC);
		await page.locator('.bt-ctrl-btn[aria-label="View settings"]').click();
		const checked = await page.evaluate(() => window.RichTableReal.ShimMenu.opened.at(-1)!.items.find(i => i.title === 'Show status bar')?.checked);
		expect(checked).toBe(true);
		await page.evaluate(() => window.RichTableReal.ShimMenu.opened.at(-1)!.clickItem('Show status bar'));
		const ops = await page.evaluate(() => window.__btOps);
		expect(ops).toContainEqual({ type: 'set-status-bar-mode', mode: 'hover' });
	});

	test('when the bar is off, the entry is unchecked and turns it back on', async ({ page, renderFull }) => {
		await renderFull(HIDDEN);
		await page.locator('.bt-ctrl-btn[aria-label="View settings"]').click();
		const checked = await page.evaluate(() => window.RichTableReal.ShimMenu.opened.at(-1)!.items.find(i => i.title === 'Show status bar')?.checked);
		expect(checked).toBe(false);
		await page.evaluate(() => window.RichTableReal.ShimMenu.opened.at(-1)!.clickItem('Show status bar'));
		const ops = await page.evaluate(() => window.__btOps);
		expect(ops).toContainEqual({ type: 'set-status-bar-mode', mode: null });
	});

	for (const [label, src] of [['shown', SRC], ['hidden', HIDDEN]] as const) {
		test(`Shift+wheel scrolls horizontally with the bar ${label}`, { tag: '@geometry' }, async ({ page, renderFull }) => {
			await renderFull(label === 'shown'
				? tableSource({ widths: [200, 200, 200], rows: [{ 0: 'a1' }], viewWidth: 250 })
				: tableSource({ widths: [200, 200, 200], rows: [{ 0: 'a1' }], viewWidth: 250, statusBarMode: 'hover' }));
			void src; void WIDE;
			const wrapper = page.locator('.bt-table-wrapper');
			const box = (await wrapper.boundingBox())!;
			await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
			await page.keyboard.down('Shift');
			await page.mouse.wheel(0, 120);
			await page.keyboard.up('Shift');
			await expect.poll(() => wrapper.evaluate(el => el.scrollLeft)).toBeGreaterThan(0);
		});
	}
});

test.describe('status bar — multi-sheet tab integration (Task 9)', () => {
	// A minimal v3 workbook (see workbookFormat.test.ts for the format) — two
	// sheets, both in the default table view, so renderTable() builds a real
	// .bt-status-bar for tableBlock.ts to mount tabs into.
	const WORKBOOK = [
		'---',
		'version: 3',
		'active_sheet: s_1',
		'sheets:',
		'  - id: s_1',
		'    columns:',
		'      - { id: c_0, name: A, width: 80 }',
		'    rows:',
		'      - { id: r_0, cells: { c_0: x } }',
		'  - id: s_2',
		'    columns:',
		'      - { id: c_0, name: A, width: 80 }',
		'    rows:',
		'      - { id: r_0, cells: { c_0: y } }',
		'---',
		'',
	].join('\n');

	test('sheet tabs mount inside .bt-status-tabs instead of a separate bottom bar', async ({ page, renderBlock }) => {
		await renderBlock(WORKBOOK);
		await expect(page.locator('.bt-status-bar .bt-status-tabs .bt-sheet-tab')).toHaveCount(2);
		// Exactly one tab bar in the whole DOM — not a second, standalone one.
		await expect(page.locator('.bt-sheet-tabbar')).toHaveCount(1);
	});

	test('a single-sheet workbook mounts nothing into .bt-status-tabs', async ({ page, renderBlock }) => {
		const ONE_SHEET = [
			'---', 'version: 3', 'active_sheet: s_1', 'sheets:',
			'  - id: s_1', '    columns:', '      - { id: c_0, name: A, width: 80 }',
			'    rows:', '      - { id: r_0, cells: { c_0: x } }',
			'---', '',
		].join('\n');
		await renderBlock(ONE_SHEET);
		await expect(page.locator('.bt-sheet-tabbar')).toHaveCount(0);
		await expect(page.locator('.bt-status-bar')).toBeVisible();
	});

	// Reported concern: the sheet tabs are the only way to switch sheets at
	// all (mounted inside .bt-status-bar) — if a sheet's own statusBarMode
	// were honored verbatim on a 2+-sheet workbook, setting it to 'hover'
	// would hide the workbook's own navigation, not just its stats.
	test('a 2+-sheet workbook always shows the bar even if the active sheet turned it off', async ({ page, renderBlock }) => {
		const HOVER_WORKBOOK = [
			'---', 'version: 3', 'active_sheet: s_1', 'sheets:',
			'  - id: s_1', '    statusBarMode: hover',
			'    columns:', '      - { id: c_0, name: A, width: 80 }',
			'    rows:', '      - { id: r_0, cells: { c_0: x } }',
			'  - id: s_2', '    columns:', '      - { id: c_0, name: A, width: 80 }',
			'    rows:', '      - { id: r_0, cells: { c_0: y } }',
			'---', '',
		].join('\n');
		await renderBlock(HOVER_WORKBOOK);
				await expect(page.locator('.bt-status-bar')).toBeVisible();
		await expect(page.locator('.bt-status-bar .bt-status-tabs .bt-sheet-tab')).toHaveCount(2);
	});

	// The "Pin status bar" toggle in the view-settings menu would have no
	// effect at all in this state (see forceStatusBarPinned's own doc comment,
	// renderer.ts) — hidden entirely rather than shown disabled, per the
	// user's own call: a disabled item nobody can act on isn't worth the
	// extra "why is this greyed out" UI.
	test('the view-settings menu omits "Show status bar" entirely for a 2+-sheet workbook', { tag: '@geometry' }, async ({ page, renderBlock }) => {
		await renderBlock(WORKBOOK);
		const root = page.locator('.bt-render-root:not(#root)');
		const rootBox = (await root.boundingBox())!;
		await page.mouse.move(rootBox.x + rootBox.width / 2, rootBox.y + rootBox.height / 2);
		await page.locator('.bt-ctrl-btn[aria-label="View settings"]').click();
		const hasPinEntry = await page.evaluate(() => {
			const menu = window.RichTableReal.ShimMenu.opened[0];
			return menu ? menu.clickItem('Show status bar') : null;
		});
		expect(hasPinEntry).toBe(false);
	});

	test('clicking a status-bar tab switches the active sheet', async ({ page, renderBlock }) => {
		const result = await renderBlock(WORKBOOK);
		const tabs = page.locator('.bt-status-bar .bt-status-tabs .bt-sheet-tab');
		await tabs.nth(1).click();
		await expect.poll(async () => (await result.noteText()).includes('active_sheet: s_2')).toBe(true);
	});
});
