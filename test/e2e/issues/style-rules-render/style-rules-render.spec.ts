import { test, expect } from '../../common/test-base';

// The style rules are worked out once for the whole table when it is drawn and each cell looks its style up. Every
// cell must end up with the style the rules give it by the one-cell-at-a-time resolution, the earlier way of drawing
// it, for every kind of target and priority.
const ROWS = 12;
function source(): string {
	const L = ['---', 'version: 2', 'columns:'];
	for (let c = 0; c < 5; c++) L.push(`  - { id: c_${c}, name: C${c}, width: 90${c === 3 ? ', align: right' : ''} }`);
	L.push('rows:');
	for (let r = 0; r < ROWS; r++) L.push(`  - { id: r_${r}, cells: { ${[0, 1, 2, 3, 4].map(c => `c_${c}: r${r}c${c}`).join(', ')} } }`);
	L.push('styles:',
		'  - { target: header, bg: "#e8f0fe", bold: true }',
		'  - { target: header.c_2, bg: "#ffe0e0" }',
		'  - { target: c_1, bg: "#eeeeee", italic: true }',
		'  - { target: r_3, bg: "#dddddd" }',
		'  - { target: "c_2:c_3", color: "#0000aa" }',
		'  - { target: "r_4:r_6", size: 18 }',
		'  - { target: "r_5.c_1:r_7.c_3", bg: "#cfe8cf", bold: true }',
		'  - { target: r_6.c_2, bg: "#ffee00", align: center }',
		'  - { target: "r_9:r_missing", bg: "#abcdef" }',
		'  - { target: "r_1.c_4", color: "#aa0000" }');
	L.push('---', '| A |', '| --- |', '');
	return L.join('\n');
}

test('every cell has the style the one-at-a-time resolution gives it @geometry', { tag: '@geometry' }, async ({ page, renderFull }) => {
	await renderFull(source());
	const result = await page.evaluate(() => {
		const R = (window as unknown as { RichTableReal: Record<string, any> }).RichTableReal;
		const model = (window as unknown as { __btModel: any }).__btModel;
		const compare: string[] = [];
		let styled = 0;
		for (const el of Array.from(document.querySelectorAll<HTMLElement>('table.bt-table th.bt-th, table.bt-table td.bt-td'))) {
			if (el.closest('table') !== document.querySelector('table.bt-table')) continue;
			const row = Number(el.dataset.row), col = Number(el.dataset.col);
			if (Number.isNaN(row) || Number.isNaN(col)) continue;
			const want = R.cellEffectiveStyle(model, row, col);
			const got = {
				bg: el.style.backgroundColor, color: el.style.color, size: el.style.fontSize,
				bold: el.classList.contains('bt-bold'), italic: el.classList.contains('bt-italic'), align: el.style.textAlign,
			};
			const toRgb = (hex?: string) => { if (!hex) return ''; const n = parseInt(hex.slice(1), 16); return `rgb(${n >> 16}, ${(n >> 8) & 255}, ${n & 255})`; };
			const expect_ = {
				bg: toRgb(want.bg), color: toRgb(want.color), size: want.size ? `${want.size}px` : '',
				bold: !!want.bold, italic: !!want.italic, align: want.align ?? '',
			};
			if (JSON.stringify(got) !== JSON.stringify(expect_)) compare.push(`${row},${col}: got ${JSON.stringify(got)} want ${JSON.stringify(expect_)}`);
			if (want.bg || want.color || want.size || want.bold || want.italic) styled++;
		}
		return { compare, styled };
	});
	expect(result.styled, 'the table has styled cells to compare').toBeGreaterThan(20);
	expect(result.compare).toEqual([]);
});
