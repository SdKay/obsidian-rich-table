import { test, expect } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

declare global {
	interface Window {
		applyFreezeBoth: (freezeRows: number, freezeCols: number) => void;
	}
}

// Regression tests for freezing MORE THAN ONE row and/or column together
// (a single frozen row/column has no "interior" boundary, so it never
// exercised this): applyFreeze() used to unconditionally hide top/bottom
// on every row-frozen cell and left/right on every col-frozen cell,
// regardless of whether that cell sat at the frozen band's TRUE outer edge
// or strictly inside it — reported as "看着太丑了" (looks broken), and as a
// mismatched-width overhang at the two corners where a frame line (using
// the theme's real border width) met a seam line (still hardcoded at 1px).
// Fix (src/renderFreeze.ts): only hide the ONE side actually being replaced
// by a synthetic line — the frozen band's first/last row or column — and
// give the seam lines the same width as the frame lines instead of a
// separate fixed 1px.

const FIXTURE = path.resolve(__dirname, 'fixtures/freeze-multi-band.html');

test('interior cells of a multi-row/multi-column frozen block keep every real border', async ({ page }) => {
	await page.goto(`file://${FIXTURE}`);
	await page.evaluate(() => window.applyFreezeBoth(3, 3));

	// row=2 (strictly between the frozen band's first row 0 and last row 3),
	// col=1 (strictly between the frozen band's first col 0 and last col 2).
	const interior = page.locator('td[data-col="1"][data-row="2"]');
	const sides = await interior.evaluate(el => {
		const cs = getComputedStyle(el);
		return { top: cs.borderTopColor, bottom: cs.borderBottomColor, left: cs.borderLeftColor, right: cs.borderRightColor };
	});
	for (const color of Object.values(sides)) {
		expect(color).not.toBe('rgba(0, 0, 0, 0)');
	}
});

test('the frozen block\'s true corner cell only suppresses its two outer-frame sides', async ({ page }) => {
	await page.goto(`file://${FIXTURE}`);
	await page.evaluate(() => window.applyFreezeBoth(3, 3));

	const corner = page.locator('th[data-col="0"]'); // row 0, col 0 — the block's top-left cell
	const sides = await corner.evaluate(el => {
		const cs = getComputedStyle(el);
		return { top: cs.borderTopColor, bottom: cs.borderBottomColor, left: cs.borderLeftColor, right: cs.borderRightColor };
	});
	// Top/left are replaced by the synthetic outer-frame line.
	expect(sides.top).toBe('rgba(0, 0, 0, 0)');
	expect(sides.left).toBe('rgba(0, 0, 0, 0)');
	// Bottom/right are interior to the frozen block (not its true far edge
	// here, since freezeRows/freezeCols are both 3) — must stay real.
	expect(sides.bottom).not.toBe('rgba(0, 0, 0, 0)');
	expect(sides.right).not.toBe('rgba(0, 0, 0, 0)');
});

test('outer-frame and seam lines share the same width at both mixed corners (no overhang)', async ({ page }) => {
	await page.goto(`file://${FIXTURE}`);
	// freezeRows=1, freezeCols=1: the single frozen row/column is simultaneously
	// the "first" (outer frame) and "last" (seam) on both axes, so its own
	// corner cell carries all four synthetic lines at once — exactly where a
	// frame/seam width mismatch would show as one line overhanging the other.
	await page.evaluate(() => window.applyFreezeBoth(1, 1));

	const parseWidths = (boxShadow: string) => {
		// Each layer: "<color> <offsetX> <offsetY> <blur> <spread> inset" — only
		// the sharp frame/seam lines (blur 0) are under test here; the
		// elevation shadows (real blur, e.g. "-6px 0px 6px -6px") are a
		// different, unrelated layer and must be excluded or they'd be
		// mistaken for a mismatched line width.
		return boxShadow.split(/,(?![^(]*\))/).map(layer => {
			const m = layer.match(/(-?[\d.]+)px (-?[\d.]+)px (-?[\d.]+)px/);
			if (!m || parseFloat(m[3]) !== 0) return null;
			return { x: Math.abs(parseFloat(m[1])), y: Math.abs(parseFloat(m[2])) };
		}).filter((v): v is { x: number; y: number } => v !== null);
	};

	// Top-right mix: top frame (LINE_TOP) + right seam, both on the header cell.
	const headerShadow = await page.locator('th[data-col="0"]').evaluate(el => getComputedStyle(el).boxShadow);
	const headerWidths = parseWidths(headerShadow);
	const topWidth = headerWidths.find(w => w.y > 0 && w.x === 0)?.y;
	const rightSeamWidth = headerWidths.find(w => w.x > 0 && w.y === 0 && w !== headerWidths[0])?.x;
	// Every non-zero offset among the header cell's layers must agree — frame
	// and seam use the same theme-detected width (2, from the fixture's grid
	// theme --bt-border-outer), not a mismatched fixed 1px for the seam.
	for (const w of headerWidths) {
		expect(w.x || w.y).toBe(2);
	}
	expect(topWidth).toBe(2);
	expect(rightSeamWidth).toBe(2);

	// Bottom-left mix: left frame + bottom seam, both on the row-1/col-0 cell.
	const cellShadow = await page.locator('td[data-col="0"][data-row="1"]').evaluate(el => getComputedStyle(el).boxShadow);
	const cellWidths = parseWidths(cellShadow);
	for (const w of cellWidths) {
		expect(w.x || w.y).toBe(2);
	}
});
