import { test, expect } from '../../common/test-base';
import { scrollableTable } from '../../common/fixtures';

// Reported as "the left border disappeared once column freeze was on": the
// table's own outer border lives on <table>, so it scrolls away as soon as the
// frozen columns stick, and the frozen block has to draw that edge itself. It
// used to draw a generic, theme-neutral divider — so a theme with a bold outer
// frame (grid: 2px --text-normal) had it silently swapped for a much fainter
// unrelated line. The frame line now reproduces the table's own real border.
//
// Rewritten to render the REAL source (renderFreeze.ts et al) instead of a
// hand-ported copy of the algorithm inside a fixture page. That hand-port had
// gone stale with nothing failing: it still asserted the seam behaviour the
// plugin deliberately stopped doing, and passed because it was testing its own
// copy of the old logic rather than the plugin.
test.describe('freeze-outer-border', () => {
	const frozen = (theme?: string) => scrollableTable({ freezeCols: 2, theme });

	test('the block\'s left frame reproduces the theme\'s own outer border', async ({ page, renderReal }) => {
		await renderReal(frozen('grid'));
		const info = await page.locator('#table th[data-col="0"]').evaluate(el => {
			const cs = getComputedStyle(el);
			return { boxShadow: cs.boxShadow, borderLeftColor: cs.borderLeftColor };
		});
		// grid's --bt-border-outer is 2px solid var(--text-normal) (#111).
		expect(info.boxShadow).toContain('rgb(17, 17, 17)');
		expect(info.boxShadow).toMatch(/\b2px\b/);
		// The real border on that edge is suppressed so the synthetic frame can't
		// double up with it while the table sits at rest.
		expect(info.borderLeftColor).toBe('rgba(0, 0, 0, 0)');
	});

	test('the frame line is drawn OUTSIDE the cell, where the real border was', async ({ page, renderReal }) => {
		await renderReal(frozen('grid'));
		// Outset, not inset: the table's real border sits in front of the first
		// cell, so an inset line lands one border-width inside the block and
		// leaves the strip the border vacated uncovered — measured as scrolling
		// content leaking through a band at the block's edge.
		const shadow = await page.locator('#table th[data-col="0"]').evaluate(el => getComputedStyle(el).boxShadow);
		const layers = shadow.split(/,(?![^(]*\))/);
		const frame = layers.find(l => l.includes('rgb(17, 17, 17)'));
		expect(frame, `no frame layer found in box-shadow: ${shadow}`).toBeDefined();
		expect(frame).not.toContain('inset');
	});

	test('a theme with no outer border falls back to the generic divider', async ({ page, renderReal }) => {
		await renderReal(frozen());
		// Without this fallback the block would have no edge at all against the
		// scrolling region. --background-modifier-border is #ccc in the shim.
		const shadow = await page.locator('#table th[data-col="0"]').evaluate(el => getComputedStyle(el).boxShadow);
		expect(shadow).toContain('rgb(204, 204, 204)');
		expect(shadow).toMatch(/\b1px\b/);
	});

	test('separators inside the block are the cells\' own real borders', async ({ page, renderReal }) => {
		await renderReal(frozen('grid'));
		// Only the block's outer edge is synthetic. Every separator INSIDE it is a
		// real border owned by the cell, which is what lets it travel with the cell
		// while scrolling — replacing these was the bug, not the fix.
		const info = await page.locator('#table th[data-col="0"]').evaluate(el => {
			const cs = getComputedStyle(el);
			return { rightColor: cs.borderRightColor, rightWidth: parseFloat(cs.borderRightWidth) };
		});
		expect(info.rightColor).toBe('rgb(17, 17, 17)');
		expect(info.rightWidth).toBeGreaterThan(0);
	});
});

// The frame line's colour is read off the table's OWN border, which freeze then
// overrides to transparent so the two don't double up. That makes the read
// order load-bearing: read the theme's value first, override second. Reported as
// "调整列宽行高过程中外边框不显示了" — during a resize the frame turned
// transparent, because a pass that reused cached per-cell values stopped
// resetting the table's inline override before reading it back, so it measured
// its own previous write and painted the frame in it.
test.describe('freeze-outer-border — frame colour survives repeated passes', () => {
	const SOURCE = scrollableTable({ freezeRows: 2, freezeCols: 2, theme: 'grid' });

	test('the frame keeps the theme\'s colour across a geometry change', async ({ page, renderReal }) => {
		await renderReal(SOURCE);
		const frameColour = () => page.locator('#table th[data-col="0"]').evaluate(el => getComputedStyle(el).boxShadow);
		expect(await frameColour()).toContain('rgb(17, 17, 17)');

		// A resize is exactly this: geometry changes, so applyFreeze re-runs and has
		// something new to write. Ten rounds, because the bug needed a pass that
		// both reuses cache AND writes.
		for (let i = 0; i < 10; i++) {
			await page.evaluate((n) => {
				const table = document.querySelector('.bt-table') as HTMLTableElement;
				const col = table.querySelector('col[data-col="1"]') as HTMLElement;
				col.style.width = `${44 + n}px`;
				window.RichTableReal.applyFreeze(
					table,
					table.querySelector('thead') as HTMLElement,
					table.querySelector('tbody') as HTMLElement,
					(window as unknown as { __btModel: never }).__btModel,
				);
			}, i);
			expect(await frameColour(), `frame lost the theme's colour on pass ${i + 1}`).toContain('rgb(17, 17, 17)');
			expect(await frameColour(), `frame went transparent on pass ${i + 1}`).not.toContain('rgba(0, 0, 0, 0)');
		}
	});

	test('switching theme re-measures the frame instead of keeping the old one', async ({ page, renderReal }) => {
		// A theme switch applies instantly to the DOM without a re-render, so the
		// same table element outlives the values measured under the previous theme.
		// The cache that makes repeat passes cheap therefore has to be invalidated
		// by it — otherwise the frozen region keeps painting the old theme's frame.
		await renderReal(SOURCE);
		const frameColour = () => page.locator('#table th[data-col="0"]').evaluate(el => getComputedStyle(el).boxShadow);
		expect(await frameColour()).toContain('rgb(17, 17, 17)'); // grid's --text-normal frame

		await page.evaluate(() => {
			const root = document.querySelector('.bt-render-root') as HTMLElement;
			root.classList.remove('bt-theme-grid');
			root.classList.add('bt-theme-academic'); // draws no outer border
			const table = document.querySelector('.bt-table') as HTMLTableElement;
			window.RichTableReal.applyFreeze(
				table,
				table.querySelector('thead') as HTMLElement,
				table.querySelector('tbody') as HTMLElement,
				(window as unknown as { __btModel: never }).__btModel,
			);
		});
		// academic has no outer border, so the frame falls back to the generic
		// divider (#ccc in the shim) — the point is that it is no longer grid's.
		expect(await frameColour()).not.toContain('rgb(17, 17, 17)');
	});
});
