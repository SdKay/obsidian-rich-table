import { test, expect } from '../../common/test-base';

// Reported: on a tall table (vertical scrollbar), dragging the scrollbar
// made the left toolbar column's icons visibly shift/lose buttons near the
// ends of the scroll range. Root cause: --cc-maxh (styles.css's .bt-ctrl-col
// max-height) was derived from computeVisibleGeom()'s vh — the live
// intersection of the table's and wrapper's rects — which dips below the
// wrapper's own stable height in a narrow band right at the very top/bottom
// of the scroll range, where the table's own edge is entering the wrapper's
// visible band. The wrapper's own height never actually changes there.
function rows(n: number) {
	return Array.from({ length: n }, (_, i) => `  - { id: r_${i}, cells: { c_0: "row${i}" } }`).join('\n');
}

const TALL_SOURCE = `---
version: 2
columns:
  - { id: c_0, name: A, width: 200 }
rows:
${rows(60)}
viewHeight: 130
---
`;

test('the ctrl column icon count/height stays stable across the full scroll range', async ({ page, renderBlock }) => {
	await renderBlock(TALL_SOURCE);
	await page.locator('table.bt-table').hover();
	await page.waitForTimeout(150);

	const samples = await page.evaluate(async () => {
		const wrapper = document.querySelector('.bt-table-wrapper.bt-view-fixed-h') as HTMLElement;
		const maxScroll = wrapper.scrollHeight - wrapper.clientHeight;
		const out: { maxH: string; visibleBtns: number }[] = [];
		const frames = 30;
		for (let i = 0; i <= frames; i++) {
			wrapper.scrollTop = Math.round((maxScroll * i) / frames);
			await new Promise(r => requestAnimationFrame(r));
			const col = document.querySelector('.bt-ctrl-col') as HTMLElement;
			const colRect = col.getBoundingClientRect();
			const btns = Array.from(col.querySelectorAll('.bt-ctrl-btn')) as HTMLElement[];
			const visible = btns.filter(b => {
				const r = b.getBoundingClientRect();
				return r.height > 0 && r.bottom <= colRect.bottom + 0.5;
			});
			out.push({ maxH: getComputedStyle(col).maxHeight, visibleBtns: visible.length });
		}
		return out;
	});

	const baseline = samples[0]!;
	for (const s of samples) {
		expect(s.maxH).toBe(baseline.maxH);
		expect(s.visibleBtns).toBe(baseline.visibleBtns);
	}
});
