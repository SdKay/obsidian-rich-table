import { test, expect } from '../../common/test-base';
import type { Page } from '@playwright/test';

// Leaving a cell commits the edit, and the table is rebuilt from the saved note a moment later. Until
// then the screen must stay as it was: the cell gives up its own padding to the editor while it is
// edited, and must not take it back, on top of the editor's, in the time before the editor goes.
const SOURCE = `---
version: 2
columns:
  - { id: c_a, name: GSPI 信号aaasdfasdfasdf }
  - { id: c_b, name: GSPI }
  - { id: c_c, name: 应连接的 Pi 针脚 }
rows:
  - id: r_1
    cells:
      c_a: SPI_CLK
      c_b: 23（GPIO11）
      c_c: PB19
  - id: r_2
    cells:
      c_a: 1. a
      c_b: x
      c_c: |-
        - a
          - b
merges:
  - anchor: header.c_a
    end: header.c_b
---
`;
const CELL = 'td[data-row="2"][data-col="1"]';

const cols = (page: Page) => page.evaluate(() => [
	...[0, 1, 2].map(i => Math.round((document.querySelector(`col[data-col="${i}"]`) as HTMLElement).getBoundingClientRect().width * 10) / 10),
	Math.round((document.querySelector('td[data-row="2"][data-col="1"]') as HTMLElement).getBoundingClientRect().height * 10) / 10,
]);

test('leaving a cell changes no column width and no row height before the table is rebuilt', { tag: '@geometry' }, async ({ page, renderBlock }) => {
	await page.setViewportSize({ width: 1100, height: 600 });
	await renderBlock(SOURCE);
	await page.locator(CELL).click();
	await page.locator(`${CELL} .bt-cell-editor`).waitFor();
	await page.keyboard.press('Control+a');
	await page.keyboard.type('2. b', { delay: 0 });
	await page.keyboard.press('Shift+Enter');
	await page.keyboard.type('   - c', { delay: 0 });
	await page.keyboard.press('Shift+Enter');
	await page.keyboard.type(`   - ef asdfasdfasdfasfd${' '.repeat(25)}fdfdf    fdff fsff    dsf   af`, { delay: 0 });

	const editing = await cols(page);
	// Watch every frame from the click until the editor is gone.
	await page.evaluate(() => {
		const w = window as unknown as { __seen: number[][] };
		w.__seen = [];
		const loop = () => {
			const cell = document.querySelector('td[data-row="2"][data-col="1"]') as HTMLElement | null;
			if (cell?.querySelector('.bt-cell-editor')) {
				w.__seen.push([
					...[0, 1, 2].map(i => Math.round((document.querySelector(`col[data-col="${i}"]`) as HTMLElement).getBoundingClientRect().width * 10) / 10),
					Math.round(cell.getBoundingClientRect().height * 10) / 10,
				]);
				requestAnimationFrame(loop);
			}
		};
		requestAnimationFrame(loop);
	});
	await page.mouse.click(5, 300);
	await page.waitForTimeout(600);
	const seen = await page.evaluate(() => (window as unknown as { __seen: number[][] }).__seen);
	expect(seen.length, 'the editor was never seen after the click').toBeGreaterThan(0);
	for (const widths of seen) expect(widths, 'the table moved while the editor was still there').toEqual(editing);
});
