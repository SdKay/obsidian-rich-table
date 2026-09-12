import { test, expect } from '../../common/test-base';

// Reported: with a nested rich-table rendered inside a cell, the OUTER
// table's column-selector strip showed duplicate letters (A B C D C D for a
// 4-column table). Root cause: the strip was built from
// `table.querySelectorAll('col')`, which also matches a nested table's own
// <col> elements — still DOM descendants of the outer <table>, just through
// an intermediate <td>. Simulates the nested render (this harness's
// MarkdownRenderer stub can't produce a real one) by injecting the same
// <colgroup><col data-col> shape a real nested table would have.
function rows(n: number) {
	return Array.from({ length: n }, (_, i) => `  - { id: r_${i}, cells: { c_0: "row${i}" } }`).join('\n');
}

const SOURCE = `---
version: 2
columns:
  - { id: c_0, name: A, width: 40 }
  - { id: c_1, name: B, width: 40 }
  - { id: c_2, name: C, width: 40 }
  - { id: c_3, name: D, width: 40 }
rows:
${rows(3)}
---
`;

test('the column-selector strip shows exactly one letter per outer column, even with a nested table in a cell', async ({ page, renderFull }) => {
	await renderFull(SOURCE);

	await page.evaluate(() => {
		const cell = document.querySelector('[data-row="1"][data-col="2"]')!;
		cell.innerHTML = '';
		const root = document.createElement('div');
		root.className = 'bt-render-root';
		const wrapper = document.createElement('div');
		wrapper.className = 'bt-table-wrapper';
		const nestedTable = document.createElement('table');
		const colgroup = document.createElement('colgroup');
		for (let i = 0; i < 4; i++) {
			const col = document.createElement('col');
			col.dataset.col = String(i);
			colgroup.appendChild(col);
		}
		nestedTable.appendChild(colgroup);
		wrapper.appendChild(nestedTable);
		root.appendChild(wrapper);
		cell.appendChild(root);
	});

	await page.locator('table.bt-table').first().hover();
	await page.waitForTimeout(200);

	const labels = await page.evaluate(() =>
		Array.from(document.querySelectorAll('.bt-col-selector .bt-sel-cell')).map(el => el.textContent?.trim()));
	expect(labels).toEqual(['A', 'B', 'C', 'D']);
});

test('the row-selector strip shows exactly one number per outer row, even with a nested table\'s own <tr>s in a cell', async ({ page, renderFull }) => {
	await renderFull(SOURCE);

	await page.evaluate(() => {
		const cell = document.querySelector('[data-row="1"][data-col="2"]')!;
		cell.innerHTML = '';
		const root = document.createElement('div');
		root.className = 'bt-render-root';
		const wrapper = document.createElement('div');
		wrapper.className = 'bt-table-wrapper';
		const nestedTable = document.createElement('table');
		const tbody = document.createElement('tbody');
		for (let i = 0; i < 3; i++) {
			const tr = document.createElement('tr');
			const td = document.createElement('td');
			td.dataset.row = String(i + 1);
			td.dataset.col = '0';
			tr.appendChild(td);
			tbody.appendChild(tr);
		}
		nestedTable.appendChild(tbody);
		wrapper.appendChild(nestedTable);
		root.appendChild(wrapper);
		cell.appendChild(root);
	});

	await page.locator('table.bt-table').first().hover();
	await page.waitForTimeout(200);

	// The header row gets a selector cell of its own (label "1"), so 3 data
	// rows show as "2", "3", "4" — confirmed against an un-nested baseline of
	// the same SOURCE, which shows this identical set with no nesting involved.
	const labels = await page.evaluate(() =>
		Array.from(document.querySelectorAll('.bt-row-selector .bt-sel-cell')).map(el => el.textContent?.trim()));
	expect(labels).toEqual(['1', '2', '3', '4']);
});
