import { test, expect } from '../../common/test-base';
import { tableSource } from '../../common/fixtures';

// Reported ("未lock时，未hover的时候view左边界完全贴合table左边界，没有padding。
// lock时view右边界完全贴合table右边界，也没有padding；以上两个情况要加一个
// padding，不然太丑了"): two rest-state cases had nothing widening the outer
// frame past the table's own real edge at all —
//   1. an unlocked, unhovered table: nothing widens the LEFT edge until the
//      first hover reveals the ctrl column/row selector strip.
//   2. a LOCKED table: it has no addColBtn at all (locked tables have no
//      onStructuralOp), so it never gets the --bt-wrapper-pad-right
//      reservation an editable table's RIGHT edge gets.
// Fixed with FRAME_MIN_GAP (selectorLayout.ts) — a small unconditional floor
// under BOTH edges, applied in addition to (never replacing) every other
// widening reason (hover-only strips, RIGHT_STRIP_GAP, a wider status bar).
test.describe('outer frame keeps a minimum cosmetic gap from the table on both sides, in every state', () => {
	const buildSource = (locked: boolean) => `---
version: 2
columns:
  - { id: c_0, name: A, width: 80 }
  - { id: c_1, name: B, width: 80 }
rows:
  - { id: r_0, cells: { c_0: "x", c_1: "y" } }
${locked ? 'locked: true\n' : ''}---
`;

	test('unlocked, at rest (no hover) — left edge no longer flush against the table', async ({ page, renderBlock }) => {
		await renderBlock(buildSource(false));
		const frame = page.locator('.bt-outer-frame');
		const table = page.locator('.bt-table:not(#table)');
		const frameBox = (await frame.boundingBox())!;
		const tableBox = (await table.boundingBox())!;
		const leftGap = tableBox.x - frameBox.x;
		expect(leftGap, 'the frame must not be flush against the table on the left at rest').toBeGreaterThanOrEqual(6);
	});

	// Tight viewport so root's own width lands right at the table's — the
	// default (much wider) Playwright viewport leaves so much slack that
	// rr.right already exceeds the table regardless of the fix, hiding the
	// exact bug being tested (same "table fills its container" reproduction
	// this codebase's other narrow-viewport tests already use).
	test('locked, at rest, flush viewport — right edge no longer flush against the table', async ({ page, renderBlock }) => {
		await page.setViewportSize({ width: 220, height: 400 });
		await renderBlock(buildSource(true));
		const frame = page.locator('.bt-outer-frame');
		const table = page.locator('.bt-table:not(#table)');
		const frameBox = (await frame.boundingBox())!;
		const tableBox = (await table.boundingBox())!;
		const rightGap = (frameBox.x + frameBox.width) - (tableBox.x + tableBox.width);
		expect(rightGap, 'the frame must not be flush against the table on the right for a locked table').toBeGreaterThanOrEqual(6);
	});

	test('locked, at rest, flush viewport — left edge also keeps the minimum gap', async ({ page, renderBlock }) => {
		await page.setViewportSize({ width: 220, height: 400 });
		await renderBlock(buildSource(true));
		const frame = page.locator('.bt-outer-frame');
		const table = page.locator('.bt-table:not(#table)');
		const frameBox = (await frame.boundingBox())!;
		const tableBox = (await table.boundingBox())!;
		const leftGap = tableBox.x - frameBox.x;
		expect(leftGap).toBeGreaterThanOrEqual(6);
	});

	// The floor must not widen the frame past a MANUALLY narrower viewWidth
	// that already sits inside a wider wrapper — that case already has its
	// own natural gap (the centering slack between the table and the wider
	// manual width), and the floor is measured off the TABLE's own edge, not
	// off wrapper's, specifically so it never adds an extra unwanted gap on
	// top of an already-sufficient one.
	test('a manually-narrower viewWidth still narrows the frame to exactly that width, unaffected by the floor', async ({ page, renderFull }) => {
		await renderFull(tableSource({ widths: [100, 100], rows: [{ 0: 'x', 1: 'y' }], viewWidth: 400 }));
		const wrapper = page.locator('.bt-table-wrapper');
		const frame = page.locator('.bt-outer-frame');
		const wrapperBox = (await wrapper.boundingBox())!;
		const frameBox = (await frame.boundingBox())!;
		expect(frameBox.width).toBeCloseTo(wrapperBox.width, 0);
		expect(frameBox.x).toBeCloseTo(wrapperBox.x, 0);
	});

	test('hovering an unlocked table still widens the frame further, past the floor', async ({ page, renderBlock }) => {
		await renderBlock(buildSource(false));
		const root = page.locator('.bt-render-root:not(#root)');
		const frame = page.locator('.bt-outer-frame');
		const table = page.locator('.bt-table:not(#table)');
		const restLeftGap = (await table.boundingBox())!.x - (await frame.boundingBox())!.x;

		const rootBox = (await root.boundingBox())!;
		await page.mouse.move(rootBox.x + rootBox.width / 2, rootBox.y + rootBox.height / 2);
		await page.waitForTimeout(80);
		const hoverLeftGap = (await table.boundingBox())!.x - (await frame.boundingBox())!.x;
		expect(hoverLeftGap, 'hover must still widen the frame further than the resting floor').toBeGreaterThan(restLeftGap);
	});
});
