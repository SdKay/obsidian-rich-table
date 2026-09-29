import { test, expect } from '../../common/test-base';
import { tableSource } from '../../common/fixtures';

test.describe('toolbar position on hover', () => {
	const CASES = {
		'no title': tableSource({ widths: [100, 100], rows: [{ 0: 'x', 1: 'y' }] }),
		'with title': tableSource({ widths: [100, 100], rows: [{ 0: 'x', 1: 'y' }], title: 'T' } as never),
	};
	for (const [name, src] of Object.entries(CASES)) {
		test(`stays aligned to the body top on every frame while fading in (${name})`, async ({ page, renderFull }) => {
			await renderFull(src);
			await page.evaluate(() => {
				const w = window as unknown as { __tops: number[] };
				w.__tops = [];
				const tick = () => {
					const c = document.querySelector('.bt-ctrl-col')!;
					const b = document.querySelector('.bt-table-wrapper')!.getBoundingClientRect();
					if (parseFloat(getComputedStyle(c).opacity) > 0) w.__tops.push(Math.round(c.getBoundingClientRect().top - b.top));
					requestAnimationFrame(tick);
				};
				tick();
			});
			const r = (await page.locator('.bt-render-root').boundingBox())!;
			await page.mouse.move(r.x + r.width / 2, r.y + r.height / 2, { steps: 3 });
			await page.waitForTimeout(300);
			const tops = await page.evaluate(() => (window as unknown as { __tops: number[] }).__tops);
			expect(tops.length).toBeGreaterThan(2);
			expect(new Set(tops).size).toBe(1);
		});
	}
});
