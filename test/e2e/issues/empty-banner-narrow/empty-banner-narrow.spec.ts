import { test, expect } from '../../common/test-base';
import type { Page } from '@playwright/test';

// The empty-block guide stays inside its container at any width: its buttons wrap
// onto further lines instead of running past the right edge.
const bounds = (page: Page) => page.evaluate(() => {
	const banner = document.querySelector('.bt-template-banner') as HTMLElement;
	const frame = banner.parentElement as HTMLElement;
	const fr = frame.getBoundingClientRect();
	const btns = [...banner.querySelectorAll<HTMLElement>('.bt-template-btn')].map(b => b.getBoundingClientRect());
	return {
		bannerRight: banner.getBoundingClientRect().right - fr.left,
		frameW: fr.width,
		btnRight: Math.max(...btns.map(r => r.right)) - fr.left,
		scroll: banner.scrollWidth - banner.clientWidth,
		count: btns.length,
	};
});

for (const width of [280, 360, 480, 600, 690, 700, 720]) {
	test(`the guide fits a ${width}px wide container`, { tag: '@geometry' }, async ({ page, renderBlock }) => {
		await renderBlock('');
		await page.evaluate(w => {
			const banner = document.querySelector('.bt-template-banner') as HTMLElement;
			(banner.parentElement as HTMLElement).style.cssText = `width:${w}px; overflow:hidden;`;
		}, width);
		const b = await bounds(page);
		expect(b.count, 'the guide lists its buttons').toBeGreaterThan(0);
		expect(b.bannerRight, 'the guide ran past its container').toBeLessThanOrEqual(b.frameW + 1);
		expect(b.btnRight, 'a button ran past the guide').toBeLessThanOrEqual(b.frameW + 1);
		expect(b.scroll, 'the guide scrolls sideways').toBeLessThanOrEqual(1);
	});
}

test('the template buttons offer no Cornell notes', async ({ page, renderBlock }) => {
	await renderBlock('');
	const labels = await page.locator('.bt-template-btn').allTextContents();
	expect(labels.join('|')).not.toMatch(/Cornell|康奈尔/);
});
