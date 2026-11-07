import { test, expect } from '../../common/test-base';

// Selecting a column or a row redraws the strips, which need each row's place. Looking the rows up one at a time by
// searching the table for each made a redraw cost the square of the table's size: a few hundred rows took a tenth of
// a second per click. The number of searches over the table must not follow the number of rows.
function source(rows: number): string {
	const L = ['---', 'version: 2', 'columns:'];
	for (let c = 0; c < 6; c++) L.push(`  - { id: c_${c}, name: C${c}, width: 80 }`);
	L.push('rows:');
	for (let r = 0; r < rows; r++) L.push(`  - { id: r_${r}, cells: { ${Array.from({ length: 6 }, (_, c) => `c_${c}: r${r}c${c}`).join(', ')} } }`);
	L.push('---', '| A |', '| --- |', '');
	return L.join('\n');
}

/** Searches of the whole table by a `[data-row=…]` selector made while one column is selected from its strip. */
async function rowSearches(page: import('@playwright/test').Page): Promise<{ searches: number; selected: number }> {
	return page.evaluate(async () => {
		const table = document.querySelector('table.bt-table') as HTMLElement;
		const shell = document.querySelector('.bt-render-root-shell') as HTMLElement;
		shell.dispatchEvent(new MouseEvent('mouseenter'));
		const frame = () => new Promise<void>(r => requestAnimationFrame(() => r()));
		await frame(); await frame();
		let searches = 0;
		const original = Element.prototype.querySelector;
		Element.prototype.querySelector = function (this: Element, sel: string) {
			if (this === table && /\[data-row=/.test(sel)) searches++;
			return original.call(this, sel);
		};
		const cell = document.querySelector('.bt-col-selector [data-idx="2"]') as HTMLElement;
		const ev = (type: string) => new PointerEvent(type, { button: 0, pointerId: 1, bubbles: true, cancelable: true });
		cell.dispatchEvent(ev('pointerdown'));
		await frame();
		cell.dispatchEvent(ev('pointerup'));
		await frame(); await frame();
		Element.prototype.querySelector = original;
		return { searches, selected: document.querySelectorAll('[data-sel-stripe]').length };
	});
}

test('selecting a column does not search the table once per row', async ({ page, renderFull }) => {
	await page.setViewportSize({ width: 1200, height: 800 });
	await renderFull(source(30));
	const small = await rowSearches(page);
	await renderFull(source(300));
	const large = await rowSearches(page);
	// The selection really happened (proof the path ran), and ten times the rows did not mean ten times the searches.
	expect(small.selected).toBeGreaterThan(0);
	expect(large.selected).toBeGreaterThan(small.selected);
	expect(large.searches, `${small.searches} searches for 30 rows, ${large.searches} for 300`).toBeLessThanOrEqual(small.searches + 2);
});
