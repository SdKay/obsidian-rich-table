import { test, expect } from '../../common/test-base';
import type { Page } from '@playwright/test';

// Moving the selection with the keyboard costs the same on a table with merges as on one without. Each move
// re-marks every cell, and the selection (grown to cover the merges it touches) used to be worked out again for
// every cell, walking every row for every merge each time: a few hundred rows with a few dozen merges made each
// arrow key take about half a second.
const ROWS = 300, COLS = 10;

function source(merges: boolean): string {
	const L = ['---', 'version: 2', 'columns:'];
	for (let c = 0; c < COLS; c++) L.push(`  - { id: c_${c}, name: C${c}, width: 80 }`);
	L.push('rows:');
	for (let r = 0; r < ROWS; r++) L.push(`  - { id: r_${r}, cells: { ${Array.from({ length: COLS }, (_, c) => `c_${c}: r${r}c${c}`).join(', ')} } }`);
	if (merges) {
		L.push('merges:');
		for (let i = 0; i < 50; i++) L.push(`  - { anchor: r_${4 + i * 5}.c_${(i * 3) % 7}, end: r_${5 + i * 5}.c_${(i * 3) % 7 + 1} }`);
	}
	L.push('---', '| A |', '| --- |', '');
	return L.join('\n');
}

/** Median time the page spends running script for one arrow key, in ms. */
async function perKey(page: Page): Promise<number> {
	await page.locator('td[data-row="8"][data-col="5"]').click();
	await page.locator('.bt-editing').first().waitFor();
	await page.keyboard.press('Escape');
	await page.locator('td.bt-selected').first().waitFor();
	const cdp = await page.context().newCDPSession(page);
	await cdp.send('Performance.enable');
	const script = async () => (await cdp.send('Performance.getMetrics')).metrics.find(m => m.name === 'ScriptDuration')!.value * 1000;
	const samples: number[] = [];
	for (const k of ['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp', 'ArrowRight', 'ArrowDown']) {
		const before = await script();
		await page.keyboard.press(k);
		await page.waitForTimeout(60);
		samples.push((await script()) - before);
	}
	return samples.sort((a, b) => a - b)[Math.floor(samples.length / 2)]!;
}

test('an arrow key costs about the same on a table with merges as on one without', async ({ page, renderFull }) => {
	await page.setViewportSize({ width: 1200, height: 800 });
	await renderFull(source(false));
	const plain = await perKey(page);
	await renderFull(source(true));
	const merged = await perKey(page);
	// Both are a few milliseconds when healthy; the old behaviour was about a hundred times apart.
	expect(merged, `plain ${plain.toFixed(1)}ms, merged ${merged.toFixed(1)}ms`).toBeLessThan(Math.max(plain * 8, 25));
});
