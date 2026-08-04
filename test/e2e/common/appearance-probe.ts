import { expect, type Page } from '@playwright/test';
import { frozenBlockGeometry } from './pixel-invariance';

/**
 * APPEARANCE PROBE — asserts the table actually LOOKS right, by sampling the
 * rendered pixels where each line is supposed to be.
 *
 * Why this exists alongside pixel-invariance.ts: that helper asserts the frozen
 * block renders IDENTICALLY at every scroll offset, which is a strong check but
 * has one blind spot — a line that's missing at EVERY offset satisfies it
 * perfectly. That blind spot shipped a real bug (the table's left outer border
 * gone even at rest). The two are complementary: invariance catches "changes
 * when it shouldn't", this catches "isn't there at all".
 *
 * The expected line positions are derived from the DOM's own geometry (each
 * cell's rect), not hardcoded — so the probe keeps working as column widths,
 * fonts, zoom or themes change, and it fails only when a line that the layout
 * says should be visible isn't painted.
 */

const PROBE = `
// A screenshot is in DEVICE pixels while every rect we derive expectations from
// is in CSS pixels, so every coordinate has to be scaled by devicePixelRatio
// before indexing the image — and the neighbour offsets used to find a line
// have to be scaled too, or at dpr 2 "1px away" lands mid-line and the probe
// compares a line against itself. Getting this wrong doesn't just add noise: it
// reported every single line as missing at dpr 1.25/1.5/2, uniformly at all
// scroll offsets, which reads exactly like a catastrophic rendering bug.
window.__btProbe = async (b64, clipX, clipY, segments, darkness) => {
	const dpr = window.devicePixelRatio || 1;
	const img = await createImageBitmap(await (await fetch('data:image/png;base64,' + b64)).blob());
	const c = new OffscreenCanvas(img.width, img.height);
	const cx = c.getContext('2d');
	cx.drawImage(img, 0, 0);
	const data = cx.getImageData(0, 0, img.width, img.height).data;
	const lum = (cssX, cssY) => {
		const x = Math.round(cssX * dpr), y = Math.round(cssY * dpr);
		if (x < 0 || y < 0 || x >= img.width || y >= img.height) return null;
		const i = (y * img.width + x) * 4;
		return 0.299 * data[i] + 0.587 * data[i+1] + 0.114 * data[i+2];
	};
	// A cell's own background, sampled a few px inside it — comparing against
	// this instead of an absolute threshold is what makes the probe work on any
	// theme (dark lines on light cells, light lines on dark cells, coloured
	// backgrounds from a user's per-cell style).
	const isLine = (x, y, horizontal) => {
		// Half-device-pixel steps, so a hairline that rounds onto one device pixel
		// is still sampled at dpr 1.25/1.5 where a whole CSS pixel would skip it.
		const step = 1 / dpr;
		const on = [];
		for (const d of [-step, 0, step]) on.push(horizontal ? lum(x, y + d) : lum(x + d, y));
		const near = [];
		for (const d of [-4, 4]) near.push(horizontal ? lum(x, y + d) : lum(x + d, y));
		const bg = near.filter(v => v !== null);
		const fg = on.filter(v => v !== null);
		if (!bg.length || !fg.length) return false;
		const bgAvg = bg.reduce((a, b) => a + b, 0) / bg.length;
		return fg.some(v => Math.abs(v - bgAvg) >= darkness);
	};
	return segments.map(s => {
		const horizontal = s.orientation === 'h';
		const from = Math.ceil(horizontal ? s.from : s.from);
		const to = Math.floor(horizontal ? s.to : s.to);
		let hit = 0, total = 0;
		for (let p = from; p <= to; p++) {
			total++;
			const x = horizontal ? p - clipX : s.at - clipX;
			const y = horizontal ? s.at - clipY : p - clipY;
			if (isLine(x, y, horizontal)) hit++;
		}
		return { label: s.label, coverage: total ? hit / total : 0 };
	});
};
`;

export interface LineSegment {
	label: string;
	orientation: 'h' | 'v';
	/** Screen coordinate of the line itself (y for 'h', x for 'v'). */
	at: number;
	/** Screen coordinate range the line should span (x for 'h', y for 'v'). */
	from: number;
	to: number;
}

/**
 * Every gridline the current layout says should be visible, in screen
 * coordinates, clipped to the part of the scroll viewport that's actually on
 * screen. Derived from live cell rects, so merges (which have no line through
 * them) are naturally excluded — a merged cell is one rect, so only its own
 * outer edges are probed.
 */
export async function expectedLines(page: Page): Promise<LineSegment[]> {
	return await page.evaluate(() => {
		const wrapper = document.querySelector('.bt-table-wrapper') as HTMLElement;
		const table = document.querySelector('.bt-table') as HTMLElement;
		const view = wrapper.getBoundingClientRect();
		const segs: LineSegment[] = [];

		// The frozen block covers part of the viewport, so a scrolling cell that
		// has slid underneath it is legitimately not visible and must not be
		// probed. Frozen COLUMNS occupy [view.left, blockRight] at every y;
		// frozen ROWS occupy [view.top, blockBottom] at every x. So for any cell,
		// the region where its own pixels can actually be seen starts after
		// whichever of those it isn't part of.
		let blockRight = view.left, blockBottom = view.top;
		for (const c of Array.from(table.querySelectorAll<HTMLElement>('.bt-frozen-col'))) {
			blockRight = Math.max(blockRight, c.getBoundingClientRect().right);
		}
		for (const c of Array.from(table.querySelectorAll<HTMLElement>('.bt-frozen-row'))) {
			blockBottom = Math.max(blockBottom, c.getBoundingClientRect().bottom);
		}

		// A line is only EXPECTED where the cell itself declares a real, visible
		// border. Deriving the expectation from the cell's own computed style is
		// what makes this "declared intent vs actual pixels" rather than "assume
		// every edge has a line" — most themes here draw no cell borders at all
		// (the base default is --bt-cell-border: none, academic draws no verticals),
		// so assuming otherwise would fail them for rendering exactly as designed.
		// The alpha check matters: renderFreeze hides a border by setting its
		// COLOR to transparent, keeping style/width intact (deliberately, to avoid
		// a layout change), so style+width alone would still claim a line there.
		const declaresBorder = (cell: HTMLElement, side: 'right' | 'bottom'): boolean => {
			const cs = getComputedStyle(cell);
			const style = side === 'right' ? cs.borderRightStyle : cs.borderBottomStyle;
			const width = parseFloat(side === 'right' ? cs.borderRightWidth : cs.borderBottomWidth) || 0;
			const color = side === 'right' ? cs.borderRightColor : cs.borderBottomColor;
			const alpha = /rgba?\([^)]*?,\s*([\d.]+)\s*\)/.exec(color);
			return style !== 'none' && style !== 'hidden' && width > 0 && (alpha ? parseFloat(alpha[1]!) > 0.05 : true);
		};

		for (const cell of Array.from(table.querySelectorAll<HTMLElement>('.bt-th, .bt-td'))) {
			const r = cell.getBoundingClientRect();
			if (r.width < 6 || r.height < 6) continue;
			const id = `r${cell.dataset.row}c${cell.dataset.col}`;
			// Where this particular cell's pixels are unoccluded.
			const minX = cell.classList.contains('bt-frozen-col') ? view.left + 1 : Math.max(view.left + 1, blockRight);
			const minY = cell.classList.contains('bt-frozen-row') ? view.top + 1 : Math.max(view.top + 1, blockBottom);
			const clampX = (v: number) => Math.min(Math.max(v, minX), view.right - 1);
			const clampY = (v: number) => Math.min(Math.max(v, minY), view.bottom - 1);
			if (r.right <= minX || r.left >= view.right - 2 || r.bottom <= minY || r.top >= view.bottom - 2) continue;
			// A cell owns its right and bottom edge (see styles.css's
			// one-border-per-edge rule), so those are the internal gridlines.
			// Probe the middle 60% of each edge: the ends meet other lines and a
			// corner's own antialiasing shouldn't count for or against it.
			const insetY = r.height * 0.2, insetX = r.width * 0.2;
			if (r.right < view.right - 2 && r.right > minX + 1 && declaresBorder(cell, 'right')) {
				const from = clampY(r.top + insetY), to = clampY(r.bottom - insetY);
				if (to - from >= 4) segs.push({ label: `${id} right edge`, orientation: 'v', at: r.right - 0.5, from, to });
			}
			if (r.bottom < view.bottom - 2 && r.bottom > minY + 1 && declaresBorder(cell, 'bottom')) {
				const from = clampX(r.left + insetX), to = clampX(r.right - insetX);
				if (to - from >= 4) segs.push({ label: `${id} bottom edge`, orientation: 'h', at: r.bottom - 0.5, from, to });
			}
		}
		const clampX = (v: number) => Math.min(Math.max(v, view.left + 1), view.right - 1);
		const clampY = (v: number) => Math.min(Math.max(v, view.top + 1), view.bottom - 1);
		// The table's own outer frame, on the two edges a frozen block replaces
		// with a synthetic line (the other two never move). Same rule as cells:
		// only expected where the theme actually declares an outer border — and
		// while freeze is active the real one is deliberately transparent, so this
		// contributes nothing then. That case is covered by frameProfile()
		// comparing freeze-on against freeze-off instead.
		const t = table.getBoundingClientRect();
		const ts = getComputedStyle(table);
		const frameVisible = (side: 'Left' | 'Top'): boolean => {
			const style = side === 'Left' ? ts.borderLeftStyle : ts.borderTopStyle;
			const width = parseFloat(side === 'Left' ? ts.borderLeftWidth : ts.borderTopWidth) || 0;
			const color = side === 'Left' ? ts.borderLeftColor : ts.borderTopColor;
			const alpha = /rgba?\([^)]*?,\s*([\d.]+)\s*\)/.exec(color);
			return style !== 'none' && width > 0 && (alpha ? parseFloat(alpha[1]!) > 0.05 : true);
		};
		// Strictly inside the scrollport: once the table has scrolled even 1px, its
		// own left border is clipped out of view and probing where it "should" be
		// samples the wrong pixel — which read as the frame being missing at
		// scrollLeft=1 on a table with no freeze at all.
		if (frameVisible('Left') && t.left >= view.left && t.left < view.right - 2) {
			segs.push({ label: 'table outer LEFT border', orientation: 'v', at: clampX(t.left + 1), from: clampY(t.top + 6), to: clampY(Math.min(t.bottom, view.bottom) - 6) });
		}
		if (frameVisible('Top') && t.top >= view.top && t.top < view.bottom - 2) {
			segs.push({ label: 'table outer TOP border', orientation: 'h', at: clampY(t.top + 1), from: clampX(t.left + 6), to: clampX(Math.min(t.right, view.right) - 6) });
		}
		return segs;
	});
}

/**
 * Dark-pixel count inside each text-bearing FROZEN cell — a proxy for "its
 * content is fully visible", so a cell whose glyphs get covered is caught.
 *
 * Frozen cells only, deliberately: a scrolling cell's ink is *supposed* to change
 * as it slides under the frozen block, so including them would report expected
 * behaviour as a defect. A frozen cell's content, by contrast, must never change
 * — which is exactly the invariant a sticky <tr> broke by letting a later row
 * paint over the row above's rowSpan merge.
 */
export interface CellInk {
	ink: number;
	/** Pinned vertically — its ink is invariant under vertical scroll. */
	frozenRow: boolean;
	/** Pinned horizontally — its ink is invariant under horizontal scroll. */
	frozenCol: boolean;
}

export async function cellInkCounts(page: Page): Promise<Record<string, CellInk>> {
	await page.addScriptTag({ content: PROBE });
	const cells = await page.evaluate(() => {
		const wrapper = document.querySelector('.bt-table-wrapper') as HTMLElement;
		const view = wrapper.getBoundingClientRect();
		const out: { id: string; x: number; y: number; w: number; h: number; frozenRow: boolean; frozenCol: boolean }[] = [];
		for (const cell of Array.from(document.querySelectorAll<HTMLElement>('.bt-table .bt-frozen-row, .bt-table .bt-frozen-col'))) {
			if (!(cell.textContent ?? '').trim()) continue;
			const r = cell.getBoundingClientRect();
			if (r.left < view.left || r.right > view.right || r.top < view.top || r.bottom > view.bottom) continue;
			out.push({
				id: `r${cell.dataset.row}c${cell.dataset.col}`,
				x: r.left + 2, y: r.top + 2, w: r.width - 4, h: r.height - 4,
				frozenRow: cell.classList.contains('bt-frozen-row'),
				frozenCol: cell.classList.contains('bt-frozen-col'),
			});
		}
		return out;
	});
	const shot = (await page.screenshot()).toString('base64');
	return await page.evaluate(([b64, list]) => {
		return (async () => {
			const img = await createImageBitmap(await (await fetch('data:image/png;base64,' + b64)).blob());
			const c = new OffscreenCanvas(img.width, img.height);
			const cx = c.getContext('2d')!;
			cx.drawImage(img, 0, 0);
			const out: Record<string, { ink: number; frozenRow: boolean; frozenCol: boolean }> = {};
			const dpr = window.devicePixelRatio || 1;
			for (const cell of list as { id: string; x: number; y: number; w: number; h: number; frozenRow: boolean; frozenCol: boolean }[]) {
				// Device pixels — the rects came from getBoundingClientRect (CSS px).
				const d = cx.getImageData(Math.round(cell.x * dpr), Math.round(cell.y * dpr), Math.max(1, Math.round(cell.w * dpr)), Math.max(1, Math.round(cell.h * dpr))).data;
				let ink = 0;
				for (let i = 0; i < d.length; i += 4) {
					if (0.299 * d[i]! + 0.587 * d[i+1]! + 0.114 * d[i+2]! < 140) ink++;
				}
				out[cell.id] = { ink, frozenRow: cell.frozenRow, frozenCol: cell.frozenCol };
			}
			return out;
		})();
	}, [shot, cells] as const);
}

/**
 * Luminance across the table's outer top and left frame (a few px either side of
 * each edge). Turning freeze on suppresses the table's real border on those two
 * edges and redraws them synthetically, so comparing this profile with freeze on
 * vs off is what proves the substitution is faithful — an assertion nothing else
 * here makes, since a frame that's uniformly missing looks perfectly consistent
 * to the scroll-invariance check.
 */
export async function frameProfile(page: Page): Promise<{ left: number[]; top: number[] }> {
	await page.addScriptTag({ content: PROBE });
	const geo = await page.evaluate(() => {
		const wrapper = document.querySelector('.bt-table-wrapper') as HTMLElement;
		const table = document.querySelector('.bt-table') as HTMLElement;
		const w = wrapper.getBoundingClientRect(), t = table.getBoundingClientRect();
		// Sample well inside the table on the other axis, away from corners.
		return {
			clip: { x: Math.floor(w.x) - 4, y: Math.floor(w.y) - 4, width: Math.ceil(w.width) + 8, height: Math.ceil(w.height) + 8 },
			left: t.left, top: t.top,
			midY: Math.min(t.top + t.height / 2, w.bottom - 10),
			midX: Math.min(t.left + 40, w.right - 10),
		};
	});
	const shot = (await page.screenshot({ clip: geo.clip })).toString('base64');
	const probes = [
		{ label: 'left', pts: [-2, -1, 0, 1, 2, 3].map(d => [geo.left + d + 0.5, geo.midY]) },
		{ label: 'top', pts: [-2, -1, 0, 1, 2, 3].map(d => [geo.midX, geo.top + d + 0.5]) },
	];
	const res = await page.evaluate(([b64, cx, cy, p]) => {
		return (async () => {
			const img = await createImageBitmap(await (await fetch('data:image/png;base64,' + (b64 as string))).blob());
			const c = new OffscreenCanvas(img.width, img.height);
			const x = c.getContext('2d')!;
			x.drawImage(img, 0, 0);
			const d = x.getImageData(0, 0, img.width, img.height).data;
			// Device pixels, same as __btProbe — see its note.
			const dpr = window.devicePixelRatio || 1;
			const L = (px: number, py: number) => {
				const i = (Math.round(py * dpr) * img.width + Math.round(px * dpr)) * 4;
				return Math.round(0.299 * d[i]! + 0.587 * d[i + 1]! + 0.114 * d[i + 2]!);
			};
			return (p as { label: string; pts: number[][] }[]).map(q => ({ label: q.label, lums: q.pts.map(([a, b]) => L(a! - (cx as number), b! - (cy as number))) }));
		})();
	}, [shot, geo.clip.x, geo.clip.y, probes] as const);
	const byLabel = (l: string) => res.find(r => r.label === l)?.lums ?? [];
	return { left: byLabel('left'), top: byLabel('top') };
}

/** Probes every expected line at the current scroll position. */
export async function probeLines(page: Page, darkness = 24): Promise<{ label: string; coverage: number }[]> {
	await page.addScriptTag({ content: PROBE });
	const clip = await page.evaluate(() => {
		const r = (document.querySelector('.bt-table-wrapper') as HTMLElement).getBoundingClientRect();
		return { x: Math.floor(r.x), y: Math.floor(r.y), width: Math.ceil(r.width), height: Math.ceil(r.height) };
	});
	const segments = await expectedLines(page);
	const shot = (await page.screenshot({ clip })).toString('base64');
	return await page.evaluate(([b64, x, y, segs, darkness]) =>
		window.__btProbe(b64 as string, x as number, y as number, segs as LineSegment[], darkness as number),
	[shot, clip.x, clip.y, segments, darkness] as const);
}

/**
 * Asserts nothing from the scrolling region shows through the frozen block.
 *
 * Every non-frozen cell is painted a colour that appears nowhere else, then the
 * frozen block is screenshotted: a single pixel of it inside the block is a
 * leak. This catches what probeLines structurally cannot — a line probe only
 * asks "is there a line at this x", so a frozen cell that lost its own border
 * still passes whenever a line leaking through from underneath happens to land
 * at the same position. The user's report was precisely that: the frozen
 * column's separator was missing, and at certain scroll offsets a line from the
 * table underneath aligned with the gap and filled it in.
 */
export async function expectNoLeakThroughFrozenBlock(page: Page, offsets: [number, number][]): Promise<void> {
	// Pure green, and matched with tight bounds. Magenta was tried first and
	// false-positived on plain's own violet outline once blended with the page
	// background — the marker colour has to be one no theme can approach, not
	// merely one no theme uses exactly.
	const MARK = `.bt-table .bt-td:not(.bt-frozen-row):not(.bt-frozen-col),
		.bt-table .bt-th:not(.bt-frozen-row):not(.bt-frozen-col) {
			background: #00ff00 !important; border-color: #00ff00 !important; color: #00ff00 !important;
		}`;
	await page.addStyleTag({ content: MARK });
	const { clip } = await frozenBlockGeometry(page);
	for (const [left, top] of offsets) {
		await page.evaluate(([l, t]) => {
			const w = document.querySelector('.bt-table-wrapper') as HTMLElement;
			w.scrollLeft = l < 0 ? w.scrollWidth - w.clientWidth : l;
			w.scrollTop = t < 0 ? w.scrollHeight - w.clientHeight : t;
		}, [left, top]);
		await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
		const b64 = (await page.screenshot({ clip })).toString('base64');
		const leak = await page.evaluate(async (b: string) => {
			const img = await createImageBitmap(await (await fetch('data:image/png;base64,' + b)).blob());
			const c = new OffscreenCanvas(img.width, img.height);
			const x = c.getContext('2d')!;
			x.drawImage(img, 0, 0);
			const d = x.getImageData(0, 0, img.width, img.height).data;
			let count = 0;
			let first = '';
			for (let i = 0; i < d.length; i += 4) {
				// Tight bounds: unmistakably the marker, not a theme colour that
				// merely leans green once alpha-blended.
				if (d[i]! < 110 && d[i + 1]! > 190 && d[i + 2]! < 110) {
					count++;
					if (!first) {
						const p = i / 4;
						first = `${p % img.width},${Math.floor(p / img.width)}`;
					}
				}
			}
			return { count, first };
		}, b64);
		expect(leak.count, `scrolling content leaks through the frozen block at scrollLeft=${left}, scrollTop=${top}` +
			(leak.first ? ` (first leaked pixel at ${leak.first} within the block)` : ''))
			.toBe(0);
	}
}

/**
 * Scrolls to `[scrollLeft, scrollTop]` (negative = that axis's maximum) and
 * asserts every line the layout expects is actually painted there.
 */
export async function expectLinesPainted(page: Page, offsets: [number, number][], minCoverage = 0.7): Promise<void> {
	for (const [left, top] of offsets) {
		await page.evaluate(([l, t]) => {
			const w = document.querySelector('.bt-table-wrapper') as HTMLElement;
			w.scrollLeft = l < 0 ? w.scrollWidth - w.clientWidth : l;
			w.scrollTop = t < 0 ? w.scrollHeight - w.clientHeight : t;
		}, [left, top]);
		await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
		const results = await probeLines(page);
		const missing = results.filter(r => r.coverage < minCoverage);
		expect(missing.map(m => `${m.label} (${Math.round(m.coverage * 100)}% painted)`),
			`at scrollLeft=${left}, scrollTop=${top}: ${missing.length} of ${results.length} expected lines are missing or broken`)
			.toEqual([]);
	}
}

declare global {
	interface Window {
		__btProbe: (b64: string, clipX: number, clipY: number, segments: LineSegment[], darkness: number) => Promise<{ label: string; coverage: number }[]>;
	}
}
