import { test, expect } from '../../common/test-base';
import { tableSource } from '../../common/fixtures';

// Reported ("自动宽度且未lock时，未hover时，view左边完全贴合左边表格边界，但是
// 右边预留了列增加按钮的padding，视觉上没有贴合table右边界...左边也预留hover时
// 的行选择器/工具栏等，目的就是保证hover前后view矩形框保持宽度和位置不变。另外
// 右边再加一些留白吧，把手已经叠到列增加按钮里了"):
//
// 1. An auto-width, unlocked table's left edge sat flush with the table at
//    rest but shifted right on hover, because reserveLeftPad (renderer.ts)
//    used to MEASURE how much natural centering slack the table already had
//    and only reserved the shortfall — a measurement that never converges
//    under root's own margin-inline:auto centering (reserving padding-left
//    only moves wrapper's actual edge by HALF of what's reserved, so a
//    second call measures a different deficit than the first). Fixed by
//    reserving a flat, unconditional CTRL_COL_LEFT_GAP from the very first
//    paint, exactly like the top strip padding already does — trading
//    "flush when there happens to be slack" for "identical rect before and
//    after hover, unconditionally".
// 2. The width-resize handle sat directly on top of addColBtn's own
//    clickable box, since both derive from the exact same wrapper-relative
//    "right edge" value. Fixed with a permanent RIGHT_STRIP_GAP reservation
//    on the wrapper's own padding-right (a scroll-container padding grows
//    scrollWidth and clientWidth together, so it adds no dead scroll space
//    past the last column) — addColBtn's sticky right:0 now resolves a few
//    px inside that padding edge, clearing the handle's own hit-area.
test.describe('view rect stays identical across hover, and the resize handle clears addColBtn', () => {
	const WIDE = tableSource({ widths: [200, 200, 200], rows: [{ 0: 'x', 1: 'y', 2: 'z' }] });

	test("an auto-width table's outer rect (root's own box) does not move or resize on hover", async ({ page, renderBlock }) => {
		await page.setViewportSize({ width: 900, height: 400 });
		const SOURCE = `---
version: 2
columns:
  - { id: c_0, name: A, width: 200 }
  - { id: c_1, name: B, width: 200 }
  - { id: c_2, name: C, width: 200 }
rows:
  - { id: r_0, cells: { c_0: "x", c_1: "y", c_2: "z" } }
---
`;
		await renderBlock(SOURCE);
		const root = page.locator('.bt-render-root:not(#root)');
		const wrapper = page.locator('.bt-table-wrapper:not(#wrapper)');
		const rootBefore = (await root.boundingBox())!;
		const wrapperBefore = (await wrapper.boundingBox())!;

		await page.mouse.move(rootBefore.x + 10, rootBefore.y + rootBefore.height / 2);
		await page.waitForTimeout(80);

		const rootAfter = (await root.boundingBox())!;
		const wrapperAfter = (await wrapper.boundingBox())!;
		expect(rootAfter.x, "root's left edge must not shift on hover").toBeCloseTo(rootBefore.x, 0);
		expect(rootAfter.width, "root's width must not change on hover").toBeCloseTo(rootBefore.width, 0);
		expect(wrapperAfter.x, "wrapper's left edge must not shift on hover").toBeCloseTo(wrapperBefore.x, 0);
		expect(wrapperAfter.width, "wrapper's width must not change on hover").toBeCloseTo(wrapperBefore.width, 0);
	});

	test('a narrow, flush-left table also keeps an identical rect across hover (squeeze regime)', async ({ page, renderBlock }) => {
		await page.setViewportSize({ width: 220, height: 400 });
		const SOURCE = `---
version: 2
columns:
  - { id: c_0, name: A, width: 80 }
  - { id: c_1, name: B, width: 80 }
rows:
  - { id: r_0, cells: { c_0: "x", c_1: "y" } }
---
`;
		await renderBlock(SOURCE);
		const root = page.locator('.bt-render-root:not(#root)');
		const wrapper = page.locator('.bt-table-wrapper:not(#wrapper)');
		const rootBefore = (await root.boundingBox())!;
		const wrapperBefore = (await wrapper.boundingBox())!;

		await page.mouse.move(rootBefore.x + rootBefore.width / 2, rootBefore.y + rootBefore.height / 2);
		await page.waitForTimeout(80);

		const rootAfter = (await root.boundingBox())!;
		const wrapperAfter = (await wrapper.boundingBox())!;
		expect(rootAfter.x).toBeCloseTo(rootBefore.x, 0);
		expect(rootAfter.width).toBeCloseTo(rootBefore.width, 0);
		expect(wrapperAfter.x).toBeCloseTo(wrapperBefore.x, 0);
		expect(wrapperAfter.width).toBeCloseTo(wrapperBefore.width, 0);
	});

	test('the width-resize handle never overlaps addColBtn, flush-left/squeeze regime', async ({ page, renderBlock }) => {
		await page.setViewportSize({ width: 220, height: 400 });
		const SOURCE = `---
version: 2
columns:
  - { id: c_0, name: A, width: 80 }
  - { id: c_1, name: B, width: 80 }
rows:
  - { id: r_0, cells: { c_0: "x", c_1: "y" } }
---
`;
		await renderBlock(SOURCE);
		const root = page.locator('.bt-render-root:not(#root)');
		const rootBox = (await root.boundingBox())!;
		await page.mouse.move(rootBox.x + rootBox.width / 2, rootBox.y + rootBox.height / 2);
		await page.waitForTimeout(80);

		const addColBox = (await page.locator('.bt-edge-add-col').boundingBox())!;
		const handleBox = (await page.locator('.bt-view-resize-r').boundingBox())!;
		const overlap = handleBox.x < addColBox.x + addColBox.width && handleBox.x + handleBox.width > addColBox.x;
		expect(overlap, 'the width-resize handle must not sit on top of addColBtn').toBe(false);
	});

	test('the width-resize handle never overlaps addColBtn when the table itself fills the pane (wide regime)', async ({ page, renderBlock }) => {
		await page.setViewportSize({ width: 900, height: 400 });
		const SOURCE = `---
version: 2
columns:
  - { id: c_0, name: A, width: 200 }
  - { id: c_1, name: B, width: 200 }
  - { id: c_2, name: C, width: 200 }
rows:
  - { id: r_0, cells: { c_0: "x", c_1: "y", c_2: "z" } }
---
`;
		await renderBlock(SOURCE);
		const root = page.locator('.bt-render-root:not(#root)');
		const rootBox = (await root.boundingBox())!;
		await page.mouse.move(rootBox.x + 10, rootBox.y + rootBox.height / 2);
		await page.waitForTimeout(80);

		const addColBox = (await page.locator('.bt-edge-add-col').boundingBox())!;
		const handleBox = (await page.locator('.bt-view-resize-r').boundingBox())!;
		const overlap = handleBox.x < addColBox.x + addColBox.width && handleBox.x + handleBox.width > addColBox.x;
		expect(overlap, 'the width-resize handle must not sit on top of addColBtn').toBe(false);
	});

	test('the reserved right-side breathing room does not add dead scrollable space past the last column', async ({ page, renderBlock }) => {
		await page.setViewportSize({ width: 300, height: 400 });
		const SOURCE = `---
version: 2
columns:
  - { id: c_0, name: A, width: 200 }
  - { id: c_1, name: B, width: 200 }
rows:
  - { id: r_0, cells: { c_0: "x", c_1: "y" } }
---
`;
		await renderBlock(SOURCE);
		const wrapper = page.locator('.bt-table-wrapper:not(#wrapper)');
		const maxScroll = await wrapper.evaluate((el: HTMLElement) => el.scrollWidth - el.clientWidth);
		await wrapper.evaluate((el: HTMLElement) => { el.scrollLeft = el.scrollWidth; });
		const scrollLeftAfterMax = await wrapper.evaluate((el: HTMLElement) => el.scrollLeft);
		expect(scrollLeftAfterMax, 'scrolling to scrollWidth must clamp to the real max, not overshoot into padding').toBe(maxScroll);
	});
});
