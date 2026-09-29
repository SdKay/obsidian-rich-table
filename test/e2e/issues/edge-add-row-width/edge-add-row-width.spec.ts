import { test, expect } from '../../common/test-base';
import { tableSource } from '../../common/fixtures';

test.describe('row adder width', () => {
	const SOURCES = {
		auto: tableSource({ widths: [100, 100], rows: [{ 0: 'x', 1: 'y' }] }),
		'view wider than table': tableSource({ widths: [100, 100], rows: [{ 0: 'x', 1: 'y' }], viewWidth: 500 }),
		'scrolling wide table': tableSource({ widths: [200, 200, 200], rows: [{ 0: 'a1' }], viewWidth: 250 }),
	};
	for (const [name, src] of Object.entries(SOURCES)) {
		test(`stays within the body's left/right edges (${name})`, async ({ page, renderFull }) => {
			await renderFull(src);
			const root = (await page.locator('.bt-render-root').boundingBox())!;
			await page.mouse.move(root.x + root.width / 2, root.y + 30);
			await expect(page.locator('.bt-edge-add-row.bt-strip-visible')).toHaveCount(1);
			const row = (await page.locator('.bt-edge-add-row').boundingBox())!;
			const wrapper = (await page.locator('.bt-table-wrapper').boundingBox())!;
			const body = (await page.locator('.bt-table').boundingBox())!;
			expect(row.x).toBeGreaterThanOrEqual(body.x - 0.5);
			const bodyRight = Math.min(body.x + body.width, wrapper.x + wrapper.width);
			expect(row.x + row.width).toBeLessThanOrEqual(bodyRight + 0.5);
		});
	}
});
