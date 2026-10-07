import { test, expect } from '../../common/test-base';

// A cell whose style is bold must also bold the links inside it. Obsidian (and
// themes) give links a font-weight of their own, so inheriting from the cell is
// not enough; the harness's renderer doesn't produce links, so one is added to
// the rendered cell together with a host rule that sets the link weight.
const SRC = ['---', 'version: 2', 'columns:', '  - { id: c_0, name: A, width: 200 }', 'rows:',
	'  - { id: r_0, cells: { c_0: "text" } }',
	'  - { id: r_1, cells: { c_0: "text" } }',
	'styles:', '  - { target: "r_0.c_0", bold: true }', '---', ''].join('\n');

const linkWeights = (page: import('@playwright/test').Page) => page.evaluate(() => {
	document.querySelectorAll('tbody td').forEach(td => {
		const a = document.createElement('a');
		a.className = 'external-link';
		a.textContent = 'aaa';
		td.querySelector('p')?.appendChild(a);
	});
	return [...document.querySelectorAll('tbody td')].map(td => getComputedStyle(td.querySelector('a')!).fontWeight);
});

test('a link inside a bold cell is bold even when a host rule sets the link weight', async ({ page, renderFull }) => {
	await renderFull(SRC);
	await page.evaluate(() => document.getElementById('root')?.classList.add('markdown-rendered'));
	await page.addStyleTag({ content: '.markdown-rendered a.external-link { font-weight: 400; }' });
	const [bold, plain] = await linkWeights(page);
	expect(bold).toBe('700');
	expect(plain, 'a link in a non-bold cell keeps the host weight').toBe('400');
});
