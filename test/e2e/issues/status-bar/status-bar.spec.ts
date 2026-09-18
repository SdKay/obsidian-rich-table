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

	test('thumb tracks wrapper.scrollLeft as the table scrolls', async ({ page, renderFull }) => {
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

	test('dragging the thumb sets wrapper.scrollLeft', async ({ page, renderFull }) => {
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

	test('the scrollbar fills the whole track when the table has nothing to scroll', async ({ page, renderFull }) => {
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

test.describe('status bar — pinned vs hover mode (Task 6)', () => {
	const PINNED = tableSource({ widths: [80, 80], rows: [{ 0: 'a1' }] });
	const HOVER = tableSource({ widths: [80, 80], rows: [{ 0: 'a1' }], statusBarMode: 'hover' });

	test('pinned (default) mode shows the bar with no hover needed', async ({ page, renderFull }) => {
		await renderFull(PINNED);
		await expect(page.locator('.bt-status-bar')).not.toHaveClass(/bt-status-mode-hover/);
		await expect(page.locator('.bt-status-bar')).toBeVisible();
	});

	test('hover mode hides the bar until the table is hovered, then hides again on leave', async ({ page, renderFull }) => {
		await renderFull(HOVER);
		const root = page.locator('.bt-render-root');
		const bar = page.locator('.bt-status-bar');
		await expect(bar).toHaveClass(/bt-status-mode-hover/);
		await expect(bar).not.toHaveClass(/bt-strip-visible/);

		const rootBox = (await root.boundingBox())!;
		await page.mouse.move(rootBox.x + rootBox.width / 2, rootBox.y + rootBox.height / 2);
		await expect(bar).toHaveClass(/bt-strip-visible/);

		await page.mouse.move(rootBox.x - 50, rootBox.y - 50);
		await expect(bar).not.toHaveClass(/bt-strip-visible/);
	});

	// The hover bar overlays root's own last row (see positionStatusBar's own
	// comment in renderer.ts for why: anything anchored past root's flow-box
	// gets clipped by Obsidian's real code-block container, which no earlier
	// version of this test could catch since the harness has no such
	// wrapper) — it must stay entirely within root's own box, above (never
	// overlapping) the add-row strip that lives further down inside the
	// scroll wrapper.
	test('the hovering bar overlays the table\'s own last row, never the add-row button below it', async ({ page, renderFull }) => {
		await renderFull(HOVER);
		const root = page.locator('.bt-render-root');
		const bar = page.locator('.bt-status-bar');
		const addRow = page.locator('.bt-edge-add-row');

		const rootBox = (await root.boundingBox())!;
		await page.mouse.move(rootBox.x + rootBox.width / 2, rootBox.y + rootBox.height / 2);
		await expect(bar).toHaveClass(/bt-strip-visible/);

		const barBox = (await bar.boundingBox())!;
		const addRowBox = (await addRow.boundingBox())!;
		expect(barBox.y).toBeGreaterThanOrEqual(rootBox.y - 1);
		expect(barBox.y + barBox.height).toBeLessThanOrEqual(rootBox.y + rootBox.height + 1);
		expect(barBox.y + barBox.height).toBeLessThanOrEqual(addRowBox.y + 1);
	});

	test('the settings menu toggles statusBarMode via the "Pin status bar" entry', async ({ page, renderFull }) => {
		await renderFull(PINNED);
		const root = page.locator('.bt-render-root');
		const rootBox = (await root.boundingBox())!;
		await page.mouse.move(rootBox.x + rootBox.width / 2, rootBox.y + rootBox.height / 2);

		await page.locator('.bt-ctrl-btn[aria-label="View settings"]').click();
		const clicked = await page.evaluate(() => {
			const menu = window.RichTableReal.ShimMenu.opened[0];
			return menu ? menu.clickItem('Pin status bar') : false;
		});
		expect(clicked, 'the menu should have a "Pin status bar" entry').toBe(true);

		expect(await page.evaluate(() => window.__btOps)).toEqual([
			{ type: 'set-status-bar-mode', mode: 'hover' },
		]);
	});
});

test.describe('status bar — divider drag + persistence (Task 7)', () => {
	const WIDE = tableSource({ widths: [150, 150, 150, 150, 150], rows: [{ 0: 'a1' }], viewWidth: 400 });
	const WITH_WIDTH = tableSource({
		widths: [150, 150, 150, 150, 150], rows: [{ 0: 'a1' }], viewWidth: 400, statusBarScrollWidth: 200,
	});

	test('dragging the divider left grows .bt-status-scroll and commits set-status-bar-scroll-width on release', async ({ page, renderFull }) => {
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

	test('a persisted statusBarScrollWidth is applied on render', async ({ page, renderFull }) => {
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

test.describe('status bar — height-resize handle relocation (Task 8)', () => {
	const EDITABLE = tableSource({ widths: [80, 80], rows: [{ 0: 'a1' }] });
	const LOCKED = tableSource({ widths: [80, 80], rows: [{ 0: 'a1' }], locked: true });

	test('the height handle is mounted inside the status bar, not root', async ({ page, renderFull }) => {
		await renderFull(EDITABLE);
		const handle = page.locator('.bt-status-bar .bt-view-resize-b');
		await expect(handle).toHaveCount(1);
		// Sanity check it isn't ALSO still a direct child of root from the old
		// mount point — there should be exactly one bt-view-resize-b in the DOM.
		await expect(page.locator('.bt-view-resize-b')).toHaveCount(1);
	});

	test('dragging it resizes the wrapper and commits set-view-height on release', async ({ page, renderFull }) => {
		await renderFull(EDITABLE);
		const wrapper = page.locator('.bt-table-wrapper');
		const handle = page.locator('.bt-status-bar .bt-view-resize-b');

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
	test('hovering anywhere over the table reveals the height-handle dash, not just the handle\'s own hotspot', async ({ page, renderFull }) => {
		await renderFull(EDITABLE);
		const root = page.locator('.bt-render-root');
		const handle = page.locator('.bt-status-bar .bt-view-resize-b');
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
	test('a 2+-sheet workbook forces the bar pinned even if the active sheet requests hover mode', async ({ page, renderBlock }) => {
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
		await expect(page.locator('.bt-status-bar')).not.toHaveClass(/bt-status-mode-hover/);
		await expect(page.locator('.bt-status-bar')).toBeVisible();
		await expect(page.locator('.bt-status-bar .bt-status-tabs .bt-sheet-tab')).toHaveCount(2);
	});

	// The "Pin status bar" toggle in the view-settings menu would have no
	// effect at all in this state (see forceStatusBarPinned's own doc comment,
	// renderer.ts) — hidden entirely rather than shown disabled, per the
	// user's own call: a disabled item nobody can act on isn't worth the
	// extra "why is this greyed out" UI.
	test('the view-settings menu omits "Pin status bar" entirely for a 2+-sheet workbook', async ({ page, renderBlock }) => {
		await renderBlock(WORKBOOK);
		const root = page.locator('.bt-render-root:not(#root)');
		const rootBox = (await root.boundingBox())!;
		await page.mouse.move(rootBox.x + rootBox.width / 2, rootBox.y + rootBox.height / 2);
		await page.locator('.bt-ctrl-btn[aria-label="View settings"]').click();
		const hasPinEntry = await page.evaluate(() => {
			const menu = window.RichTableReal.ShimMenu.opened[0];
			return menu ? menu.clickItem('Pin status bar') : null;
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
