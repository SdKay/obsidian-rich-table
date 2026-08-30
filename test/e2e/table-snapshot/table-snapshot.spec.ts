import { test, expect } from '../common/test-base';
import { tableSource } from '../common/fixtures';

/**
 * tableSnapshot.ts + tableBlock.ts's captureSnapshot — the left-toolbar
 * "Snapshot" button. Runs through the real write-back layer (renderBlock)
 * so the save actions exercise the real fileManager/vault calls, not a
 * hand-simulated shortcut.
 *
 * Pixel content itself isn't asserted (that's what a human comparing the
 * exported image against the table is for) — these check the things that
 * are actually load-bearing: hover-only chrome is excluded, the FULL table
 * is captured regardless of scroll/viewHeight bounds, and each of the three
 * menu actions reaches its real destination (vault file or clipboard).
 */

function clickMenuItem(page: import('@playwright/test').Page, title: string): Promise<boolean> {
	return page.evaluate((title) => {
		const menu = window.RichTableReal.ShimMenu.opened[0];
		return menu ? menu.clickItem(title) : false;
	}, title);
}

/** The exported SVG's declared `height="…"` attribute — NOT a substring
 *  check on row text, which would pass even with clipping: HTML overflow
 *  clips how content PAINTS, not whether it's present in the markup, so
 *  every row's text is in the serialized DOM regardless of whether the
 *  declared canvas is tall enough to show it. The declared height is the
 *  one number that actually reflects what a rasterized PNG would crop to. */
function svgHeight(svg: string): number {
	const m = /\sheight="(\d+(?:\.\d+)?)"/.exec(svg);
	if (!m) throw new Error('no height attribute found in exported SVG');
	return Number(m[1]);
}

/** The `.bt-render-root` element's own computed top padding, as baked into
 *  the exported markup — html-to-image inlines each element's real computed
 *  style during its own internal clone (separate from
 *  prepareSnapshotClone's own clone-and-strip pass), so this reflects
 *  whatever --bt-sel-pad actually resolved to for the export, not just
 *  whatever inline value happened to exist on the live table.
 *
 *  A getComputedStyle dump reports the SHORTHAND `padding: T R B [L];`, not a
 *  separate `padding-top:` — confirmed directly (logged the exported style
 *  string) after a first version of this helper looked for the longhand and
 *  silently always returned 0, passing regardless of whether the real bug
 *  was fixed or not. */
function rootPaddingTop(svg: string): number {
	const styleMatch = /class="bt-render-root[^"]*"\s+style="([^"]*)"/.exec(svg);
	if (!styleMatch) throw new Error('no .bt-render-root element found in exported SVG');
	const paddingMatch = /(?:^|;)\s*padding:\s*([\d.]+)px/.exec(styleMatch[1]!);
	if (!paddingMatch) throw new Error('no padding shorthand found on the exported .bt-render-root');
	return Number(paddingMatch[1]);
}

test.describe('table snapshot', () => {
	test('the button offers exactly the three documented actions', async ({ page, renderBlock }) => {
		await renderBlock(tableSource({ widths: [80, 80], rows: [{ 0: 'a', 1: 'b' }] }));
		await page.locator('.bt-ctrl-btn[aria-label="Snapshot"]').click();
		const titles = await page.evaluate(() => window.RichTableReal.ShimMenu.opened[0]?.items.map(i => i.title));
		expect(titles).toEqual(['Copy image', 'Save image (PNG) to vault', 'Save vector (SVG) to vault']);
	});

	test('"Save vector (SVG) to vault" writes real cell content with no hover-only chrome', async ({ page, renderBlock }) => {
		await renderBlock(tableSource({ widths: [80, 80], rows: [{ 0: 'hello', 1: 'world' }] }));
		await page.locator('.bt-ctrl-btn[aria-label="Snapshot"]').click();
		expect(await clickMenuItem(page, 'Save vector (SVG) to vault')).toBe(true);

		await expect.poll(() => page.evaluate(() => window.__btVault.files.has('note table.svg'))).toBe(true);
		const svg = await page.evaluate(() => window.__btVault.files.get('note table.svg'));
		expect(svg).toContain('hello');
		expect(svg).toContain('world');
		// Hover-only chrome AND the status bar (tableSnapshot.ts's
		// STRIP_SELECTORS) must not survive into the capture — chrome has no
		// meaning in a static image, and the status bar is chrome ABOUT the
		// table (totals, scrollbar) rather than the table's own content.
		for (const cls of ['bt-ctrl-col', 'bt-row-selector', 'bt-col-selector', 'bt-edge-add-row', 'bt-edge-add-col', 'bt-status-bar']) {
			expect(svg, `${cls} leaked into the snapshot`).not.toContain(cls);
		}
	});

	test('an untitled table has no leftover top-clearance padding in its snapshot', async ({ page, renderBlock }) => {
		// --bt-sel-pad (TOP_STRIP_PAD in renderer.ts) reserves EXTRA top padding
		// on an untitled table specifically, so the hover strip clears
		// Obsidian's own floating block toolbar (see the no-title-top-clearance
		// spec) — but it's only set once the table is actually hovered
		// (renderer.ts's prepareLayout, run by the hover-proximity handler),
		// and then never collapses back to 0. Reproduce that real sequence —
		// hover, THEN snapshot — rather than just checking a never-hovered
		// table, which would pass without exercising the bug at all.
		await renderBlock(tableSource({ widths: [80, 80], rows: [{ 0: 'a', 1: 'b' }] }));
		// :not(#wrapper) — shell.html's OWN static markup (used by the
		// unrelated renderReal fixture) has its own `<div class="bt-table-
		// wrapper" id="wrapper">` nested inside the SAME #root renderBlock
		// mounts TableBlock's real output into, so any selector that only
		// scopes by ancestor still matches both; excluding that one static id
		// leaves just TableBlock's real, freshly-built wrapper.
		const wrapperBox = (await page.locator('.bt-table-wrapper:not(#wrapper)').boundingBox())!;
		await page.mouse.move(wrapperBox.x + wrapperBox.width / 2, wrapperBox.y + wrapperBox.height / 2);
		await expect.poll(() => page.locator('.bt-col-selector').evaluate((el: HTMLElement) => el.classList.contains('bt-strip-visible')))
			.toBe(true);

		await page.locator('.bt-ctrl-btn[aria-label="Snapshot"]').click();
		expect(await clickMenuItem(page, 'Save vector (SVG) to vault')).toBe(true);
		await expect.poll(() => page.evaluate(() => window.__btVault.files.has('note table.svg'))).toBe(true);
		const svg = await page.evaluate(() => window.__btVault.files.get('note table.svg'));

		expect(rootPaddingTop(svg), 'the hover-strip top-clearance reservation has no purpose once the strips are stripped from the snapshot')
			.toBe(0);
	});

	test('excludes the sheet tab bar from a multi-sheet workbook\'s snapshot', async ({ page, renderBlock }) => {
		const WORKBOOK = [
			'---', 'version: 3', 'active_sheet: s_1', 'sheets:',
			'  - id: s_1', '    columns:', '      - { id: c_0, name: A, width: 80 }',
			'    rows:', '      - { id: r_0, cells: { c_0: active-sheet-cell } }',
			'  - id: s_2', '    columns:', '      - { id: c_0, name: A, width: 80 }',
			'    rows:', '      - { id: r_0, cells: { c_0: other-sheet-cell } }',
			'---', '',
		].join('\n');
		await renderBlock(WORKBOOK);
		// Sanity check the fixture itself before asserting on the snapshot.
		await expect(page.locator('.bt-sheet-tabbar, .bt-status-tabs .bt-sheet-tab').first()).toBeVisible();

		await page.locator('.bt-ctrl-btn[aria-label="Snapshot"]').click();
		expect(await clickMenuItem(page, 'Save vector (SVG) to vault')).toBe(true);
		await expect.poll(() => page.evaluate(() => window.__btVault.files.has('note table.svg'))).toBe(true);
		const svg = await page.evaluate(() => window.__btVault.files.get('note table.svg'));

		expect(svg).toContain('active-sheet-cell');
		for (const cls of ['bt-status-bar', 'bt-sheet-tabbar', 'bt-sheet-tab']) {
			expect(svg, `${cls} leaked into the multi-sheet snapshot`).not.toContain(cls);
		}
	});

	test('captures the full table even with an explicit viewHeight bounding it', async ({ page, renderBlock }) => {
		const rows = Array.from({ length: 25 }, (_, i) => ({ 0: `row-${i}` }));
		await renderBlock(tableSource({ widths: [100], rows, viewHeight: 80 }));
		await page.locator('.bt-ctrl-btn[aria-label="Snapshot"]').click();
		expect(await clickMenuItem(page, 'Save vector (SVG) to vault')).toBe(true);

		await expect.poll(() => page.evaluate(() => window.__btVault.files.has('note table.svg'))).toBe(true);
		const svg = await page.evaluate(() => window.__btVault.files.get('note table.svg'));
		expect(svg).toContain('row-0');
		expect(svg).toContain('row-24');
		// The declared canvas height, not just text presence (see svgHeight's
		// own comment) — 25 rows at even a generous 40px each is 1000px, far
		// past the 80px viewHeight bound the live table actually scrolls within.
		expect(svgHeight(svg)).toBeGreaterThan(400);
	});

	// A SEPARATE case from the one above: removing bt-view-fixed-h (which the
	// explicit-viewHeight case above exercises) is not by itself enough —
	// .bt-table-wrapper's DEFAULT (no explicit viewHeight at all) cap is
	// `max-height: 70vh`, which the 1280×720 default test viewport still
	// clips well before 60 short rows. Only bt-snapshot-expanded's
	// `max-height: none !important` removes THIS bound; confirmed by
	// temporarily deleting that class application and watching this fail
	// while the explicit-viewHeight case above kept passing.
	test('captures the full table even against the DEFAULT unbounded-height cap (no explicit viewHeight)', async ({ page, renderBlock }) => {
		const rows = Array.from({ length: 60 }, (_, i) => ({ 0: `row-${i}` }));
		await renderBlock(tableSource({ widths: [100], rows }));
		await page.locator('.bt-ctrl-btn[aria-label="Snapshot"]').click();
		expect(await clickMenuItem(page, 'Save vector (SVG) to vault')).toBe(true);

		await expect.poll(() => page.evaluate(() => window.__btVault.files.has('note table.svg'))).toBe(true);
		const svg = await page.evaluate(() => window.__btVault.files.get('note table.svg'));
		expect(svg).toContain('row-0');
		expect(svg).toContain('row-59');
		// 60 rows comfortably exceed 70% of the 720px default test viewport
		// (504px) — the declared height must reflect all of them, not just
		// whatever fit within that default cap.
		expect(svgHeight(svg)).toBeGreaterThan(600);
	});

	test('"Save image (PNG) to vault" writes a non-empty PNG', async ({ page, renderBlock }) => {
		await renderBlock(tableSource({ widths: [80, 80], rows: [{ 0: 'a', 1: 'b' }] }));
		await page.locator('.bt-ctrl-btn[aria-label="Snapshot"]').click();
		expect(await clickMenuItem(page, 'Save image (PNG) to vault')).toBe(true);

		await expect.poll(() => page.evaluate(() => window.__btVault.binaryFiles.get('note table.png')?.byteLength ?? 0),
			{ timeout: 5000 }).toBeGreaterThan(0);
	});

	test('"Copy image" writes a PNG onto the system clipboard', async ({ page, context, renderBlock }) => {
		await context.grantPermissions(['clipboard-read', 'clipboard-write']);
		await renderBlock(tableSource({ widths: [80, 80], rows: [{ 0: 'a', 1: 'b' }] }));
		await page.locator('.bt-ctrl-btn[aria-label="Snapshot"]').click();
		expect(await clickMenuItem(page, 'Copy image')).toBe(true);

		await expect.poll(async () => page.evaluate(async () => {
			const items = await navigator.clipboard.read();
			return items.some(item => item.types.includes('image/png'));
		}), { timeout: 5000 }).toBe(true);
	});
});
