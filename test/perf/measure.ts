/**
 * What a scenario runs inside the page, and how its cost is read.
 *
 * Two things would make a number say something other than what the plugin costs, and both are avoided here:
 *  - Playwright's input. Its mouse and keyboard calls cost tens to hundreds of milliseconds of their own (an injected
 *    script walks the DOM before every action). Events are dispatched from the page instead.
 *  - Waiting. A time taken from an event to the next frame is a multiple of the frame (16.7 ms) and mostly the
 *    browser's schedule, so a cheap operation and a dear one both read "two frames". The cost is read from the
 *    browser's own count of main-thread work (`TaskDuration`) across the repetitions, which has no waiting in it.
 *
 * A function sent to the page is self-contained: it uses nothing from this file but what it is given.
 */
import type { Page, CDPSession } from '@playwright/test';
import { FLIPS } from './ops';
import { countLayouts, type TraceEvent } from './layoutTrace';

export interface Cost {
	/** Main-thread time per repetition, in milliseconds, by what it was spent on. */
	task: number;
	script: number;
	style: number;
	layout: number;
	/** Layouts the browser did per repetition. */
	layouts: number;
}

/** A scenario that did not do what it says. Nothing is reported for it, since the number would be of something else. */
export class ScenarioBroken extends Error {}

export async function counters(page: Page): Promise<{ read: () => Promise<Record<string, number>> }> {
	const cdp: CDPSession = await page.context().newCDPSession(page);
	await cdp.send('Performance.enable');
	return { read: async () => Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map(m => [m.name, m.value])) };
}

const ms = (a: Record<string, number>, b: Record<string, number>, k: string) => ((b[k] ?? 0) - (a[k] ?? 0)) * 1000;

/** Runs `body` once in the page (it does `reps` repetitions itself) and returns the main-thread cost of each. */
export async function costOf<A>(page: Page, reps: number, body: (arg: A & { reps: number }) => Promise<void>, arg: A): Promise<Cost> {
	const c = await counters(page);
	// The page is quiet before the first reading: whatever the last step queued has run.
	await page.evaluate(() => new Promise<void>(r => requestAnimationFrame(() => requestAnimationFrame(() => r()))));
	const a = await c.read();
	try {
		await page.evaluate(body as never, { ...arg, reps } as never);
	} catch (e) {
		throw new ScenarioBroken((e as Error).message.split('\n')[0]);
	}
	await page.evaluate(() => new Promise<void>(r => requestAnimationFrame(() => requestAnimationFrame(() => r()))));
	const b = await c.read();
	return {
		task: ms(a, b, 'TaskDuration') / reps, script: ms(a, b, 'ScriptDuration') / reps,
		style: ms(a, b, 'RecalcStyleDuration') / reps, layout: ms(a, b, 'LayoutDuration') / reps,
		layouts: ((b.LayoutCount ?? 0) - (a.LayoutCount ?? 0)) / reps,
	};
}

/**
 * Layouts a gesture makes per repetition, and how many of them its script forced. The browser lays out once per frame
 * when something is dirty; every layout beyond that is the script reading a measurement after writing a style. Taken
 * from a trace of one run of the body, apart from the timed runs, since tracing slows the page.
 */
export async function layoutsOf<A>(page: Page, reps: number, body: (arg: A & { reps: number }) => Promise<void>, arg: A): Promise<{ layouts: number; forced: number }> {
	const browser = page.context().browser();
	if (!browser) throw new ScenarioBroken('no browser to trace');
	await page.evaluate(() => new Promise<void>(r => requestAnimationFrame(() => requestAnimationFrame(() => r()))));
	await browser.startTracing(page, { categories: ['devtools.timeline'] });
	let failure: Error | undefined;
	try {
		await page.evaluate(body as never, { ...arg, reps } as never);
		await page.evaluate(() => new Promise<void>(r => requestAnimationFrame(() => requestAnimationFrame(() => r()))));
	} catch (e) {
		failure = e as Error;
	}
	const buffer = await browser.stopTracing();
	if (failure) throw new ScenarioBroken(failure.message.split('\n')[0]);
	const parsed = JSON.parse(buffer.toString()) as { traceEvents: TraceEvent[] } | TraceEvent[];
	const c = countLayouts(Array.isArray(parsed) ? parsed : parsed.traceEvents);
	return { layouts: c.layouts / reps, forced: c.forced / reps };
}

/** Hovering onto the table and off it again: the strips come up and go. */
export const hoverBody = async ({ cell, reps }: { cell: string; reps: number }): Promise<void> => {
	const frame = () => new Promise<void>(r => requestAnimationFrame(() => r()));
	const el = document.querySelector(cell) as HTMLElement | null;
	const shell = document.querySelector('.bt-render-root-shell') as HTMLElement | null;
	if (!el || !shell) throw new Error('the hover target is missing');
	for (let i = 0; i < reps; i++) {
		el.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
		shell.dispatchEvent(new MouseEvent('mouseenter'));
		await frame(); await frame();
		if (!document.querySelector('.bt-col-selector.bt-strip-visible, .bt-edge-add-row.bt-strip-visible, .bt-ctrl-col')) throw new Error('the strips did not come up on hover');
		shell.dispatchEvent(new MouseEvent('mouseleave'));
		await frame(); await frame();
	}
};

/** Moving the selection with the arrow keys; the selection must really move each time. */
export const keyBody = async ({ reps }: { reps: number }): Promise<void> => {
	const frame = () => new Promise<void>(r => requestAnimationFrame(() => r()));
	const at = () => { const e = document.querySelector('td.bt-selected'); return e ? `${e.getAttribute('data-row')},${e.getAttribute('data-col')}` : 'none'; };
	const keys = ['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp'];
	for (let i = 0; i < reps; i++) {
		const key = keys[i % 4]!;
		const from = at();
		if (from === 'none') throw new Error('no cell is selected, so the keys go nowhere');
		// On an element, as a real key press is (it goes to the focused one, the body when nothing is): the handler asks
		// the target for its closest editor, which the document itself cannot answer, and it throws.
		document.body.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
		await frame();
		if (at() === from) throw new Error(`${key} did not move the selection from ${from}`);
	}
};

/**
 * A handle dragged `steps` times; each step is a repetition. The drag is left held and released afterwards by
 * `releaseDrag`, so the write-back that ends it is not counted in the moves.
 */
export const dragBody = async ({ selector, index, axis, steps, step, reps, watch }: { selector: string; index: number; axis: 'x' | 'y' | 'xy'; steps: number; step: number; reps: number; watch: string }): Promise<void> => {
	const frame = () => new Promise<void>(r => requestAnimationFrame(() => r()));
	// A handle with no size belongs to a hidden row or column; the first drawn one from the index on is used.
	const handle = Array.from(document.querySelectorAll<HTMLElement>(selector)).slice(index).find(h => h.getBoundingClientRect().height > 0 || h.getBoundingClientRect().width > 0);
	if (!handle) throw new Error(`the drag handle is missing: ${selector}[${index}]`);
	const rect = handle.getBoundingClientRect();
	const x = rect.left + rect.width / 2, y = rect.top + rect.height / 2;
	// pointerId 1 is the mouse. A made-up id makes setPointerCapture throw in the handle's own pointerdown handler,
	// which ends it before the drag is wired, and nothing moves.
	const ev = (type: string, d: number) => new PointerEvent(type, { button: 0, pointerId: 1, clientX: x + (axis !== 'y' ? d : 0), clientY: y + (axis !== 'x' ? d : 0), bubbles: true, cancelable: true });
	// What the drag must change, read from the thing it resizes: the handle itself may stay where it is until the drop.
	const target = document.querySelector(watch) as HTMLElement | null;
	if (!target) throw new Error(`the element the drag resizes is missing: ${watch}`);
	const size = () => { const b = target.getBoundingClientRect(); return b.width + b.height; };
	const before = size();
	handle.dispatchEvent(ev('pointerdown', 0));
	await frame();
	const n = Math.min(steps, reps);
	for (let i = 1; i <= n; i++) {
		handle.dispatchEvent(ev('pointermove', i * step));
		await frame();
	}
	await frame();
	if (Math.abs(size() - before) < 1) throw new Error('the drag did not resize what it drags');
	(window as unknown as { __release: () => void }).__release = () => handle.dispatchEvent(ev('pointerup', n * step));
};

export const releaseDrag = (page: Page) => page.evaluate(() => (window as unknown as { __release: () => void }).__release());

/**
 * The delay after an edit, as one number: the operation goes to the block, the note is written, and the table is
 * drawn again from it as Obsidian does. This is a wait the user sits through, so it is read as elapsed time, from
 * handing over the operation to the first frame of the rebuilt table, and not as main-thread work.
 */
export async function rebuildDelay(page: Page, ops: unknown[]): Promise<number[]> {
	// Each repetition must change the note, or nothing is written and nothing is rebuilt. Two in a row that are alike
	// change it only for a toggle, which flips what it finds; any other setting would be set to what it already is.
	for (let i = 1; i < ops.length; i++) {
		const same = JSON.stringify(ops[i]) === JSON.stringify(ops[i - 1]);
		if (same && !FLIPS.has((ops[i] as { type: string }).type)) throw new ScenarioBroken(`${(ops[i] as { type: string }).type} repeated with the same values writes nothing the second time`);
	}
	try {
		return await page.evaluate(async ({ ops }) => {
			type W = { __btBlock: { handleStructuralOp(op: unknown): Promise<void>; handleWorkbookOp(op: unknown): Promise<void>; unload(): void }; __btVault: { files: Map<string, string> }; __btNote: string; __btMount: () => void };
			const w = window as unknown as W;
			const frame = () => new Promise<void>(r => requestAnimationFrame(() => r()));
			const sleep0 = () => new Promise<void>(r => setTimeout(r, 0));
			const out: number[] = [];
			for (let i = 0; i < ops.length; i++) {
				const op = ops[i];
				const type = (op as { type: string }).type;
				const workbook = ['create-sheet', 'delete-sheet', 'rename-sheet', 'reorder-sheets', 'set-active-sheet', 'set-sheet-tab-style', 'set-sheet-content'].includes(type);
				const before = w.__btVault.files.get(w.__btNote);
				const t0 = performance.now();
				void (workbook ? w.__btBlock.handleWorkbookOp(op) : w.__btBlock.handleStructuralOp(op));
				const deadline = performance.now() + 6_000;
				while (w.__btVault.files.get(w.__btNote) === before) {
					if (performance.now() > deadline) throw new Error(`the note was never written for ${type}`);
					await sleep0();
				}
				w.__btBlock.unload();
				(document.getElementById('root') as HTMLElement).replaceChildren();
				w.__btMount();
				while (!document.querySelector('.bt-table td.bt-td, .bt-kanban-board, .bt-cal-nav')) {
					if (performance.now() > deadline) throw new Error('the table was never drawn again');
					await sleep0();
				}
				await frame();
				// The first is the warm-up: the first rebuild of a page pays for things the later ones do not.
				if (i > 0) out.push(performance.now() - t0);
			}
			return out;
		}, { ops });
	} catch (e) {
		throw new ScenarioBroken((e as Error).message.split('\n')[0]);
	}
}

export const median = (a: number[]): number => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)]!;


/**
 * Clicks a cell the way a mouse does and leaves it selected (the editor it opens is closed with Escape), so the keys
 * have a selection to move. The table is rendered with single-click editing, which opens the editor at once.
 */
export const selectCellBody = async ({ cell }: { cell: string }): Promise<void> => {
	const frame = () => new Promise<void>(r => requestAnimationFrame(() => r()));
	const el = document.querySelector(cell) as HTMLElement | null;
	if (!el) throw new Error(`the cell to select is missing: ${cell}`);
	for (const type of ['mousedown', 'mouseup', 'click']) el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, button: 0 }));
	for (let i = 0; i < 10 && !document.querySelector('.bt-editing'); i++) await frame();
	if (!document.querySelector('.bt-editing')) throw new Error('the editor did not open on click');
	(document.activeElement ?? document.body).dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
	await frame(); await frame();
	if (!document.querySelector('td.bt-selected')) throw new Error('no cell is selected after the editor closed');
};

/** Hovering the table so its strips are built and shown, and leaving it there. */
export const hoverOnBody = async ({ cell }: { cell: string }): Promise<void> => {
	const frame = () => new Promise<void>(r => requestAnimationFrame(() => r()));
	const el = document.querySelector(cell) as HTMLElement | null;
	const shell = document.querySelector('.bt-render-root-shell') as HTMLElement | null;
	if (!el || !shell) throw new Error('the hover target is missing');
	el.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
	shell.dispatchEvent(new MouseEvent('mouseenter'));
	await frame(); await frame();
	if (!document.querySelector('.bt-col-selector.bt-strip-visible, .bt-row-selector.bt-strip-visible')) throw new Error('the strips did not come up on hover');
};

/**
 * Selecting a whole column or row from its strip: press, release (which opens the panel), close the panel. That the
 * press selects is proved by `selectionMarks`, once, outside the timed run: a query over a large table costs as much
 * as the gesture and would be counted as the plugin's.
 */
export const selectStripBody = async ({ axis, reps }: { axis: 'col' | 'row'; reps: number }): Promise<void> => {
	const frame = () => new Promise<void>(r => requestAnimationFrame(() => r()));
	const strip = document.querySelector(axis === 'col' ? '.bt-col-selector' : '.bt-row-selector') as HTMLElement | null;
	if (!strip) throw new Error('the strip is missing');
	const ev = (type: string) => new PointerEvent(type, { button: 0, pointerId: 1, bubbles: true, cancelable: true });
	for (let i = 0; i < reps; i++) {
		// Any cell of the strip but the first: a filter or hidden rows leave gaps in the numbering.
		const cells = Array.from(strip.querySelectorAll<HTMLElement>('[data-idx]')).filter(e => Number(e.dataset.idx) >= 1);
		const cell = cells[(2 + i) % Math.max(1, Math.min(cells.length, 6))];
		if (!cell) throw new Error('the strip has no cell to press');
		cell.dispatchEvent(ev('pointerdown'));
		await frame();
		cell.dispatchEvent(ev('pointerup'));
		await frame(); await frame();
		document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
		await frame();
	}
};

/** A drag across cells with the button held: each repetition reaches one cell further. */
export const dragSelectBody = async ({ reps }: { reps: number }): Promise<void> => {
	const frame = () => new Promise<void>(r => requestAnimationFrame(() => r()));
	const cellAt = (col: number, n: number) => document.querySelectorAll(`td.bt-td[data-col="${col}"]`)[n] as HTMLElement | undefined;
	const start = cellAt(1, 3);
	if (!start) throw new Error('the cell to start from is missing');
	start.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0 }));
	let was = document.querySelectorAll('td.bt-selected').length;
	for (let i = 0; i < reps; i++) {
		const over = cellAt(1 + ((i + 1) % 4), 4 + i);
		if (!over) throw new Error('the cell to drag onto is missing');
		over.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
		await frame();
		const now = document.querySelectorAll('td.bt-selected').length;
		if (now === was) throw new Error('the selection did not grow with the drag');
		was = now;
	}
	document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, button: 0 }));
	await frame(); await frame();
	document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
	await frame();
};

/** Scrolling the view (or the page, when the table is not in a fixed-height view) a step at a time. */
export const scrollBody = async ({ reps }: { reps: number }): Promise<void> => {
	const frame = () => new Promise<void>(r => requestAnimationFrame(() => r()));
	const wrapper = document.querySelector('.bt-table-wrapper') as HTMLElement | null;
	const target = (wrapper && wrapper.scrollHeight > wrapper.clientHeight + 50 ? wrapper : document.scrollingElement) as HTMLElement | null;
	if (!target) throw new Error('nothing to scroll');
	for (let i = 0; i < reps; i++) {
		const before = target.scrollTop;
		target.scrollTop = before + 150;
		await frame();
		if (target.scrollTop === before) throw new Error('the scroll did not move');
	}
	target.scrollTop = 0;
};

/** Opening the editor on a cell with a click and closing it with Escape. */
export const editorBody = async ({ reps }: { reps: number }): Promise<void> => {
	const frame = () => new Promise<void>(r => requestAnimationFrame(() => r()));
	for (let i = 0; i < reps; i++) {
		const el = document.querySelectorAll('td.bt-td[data-col="4"]')[6 + i] as HTMLElement | undefined;
		if (!el) throw new Error('the cell to edit is missing');
		for (const type of ['mousedown', 'mouseup', 'click']) el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, button: 0 }));
		for (let k = 0; k < 10 && !document.querySelector('.bt-editing'); k++) await frame();
		if (!document.querySelector('.bt-editing')) throw new Error('the editor did not open on click');
		(document.activeElement ?? document.body).dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
		await frame();
		if (document.querySelector('.bt-editing')) throw new Error('the editor did not close on Escape');
	}
};

/** Opening a column's filter panel from its header button and closing it with Escape. */
export const filterPanelBody = async ({ reps }: { reps: number }): Promise<void> => {
	const frame = () => new Promise<void>(r => requestAnimationFrame(() => r()));
	const buttons = document.querySelectorAll('.bt-filter-btn');
	if (buttons.length === 0) throw new Error('no header has a filter button');
	for (let i = 0; i < reps; i++) {
		(buttons[i % buttons.length] as HTMLElement).dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
		await frame(); await frame();
		if (!document.querySelector('.bt-filter-panel')) throw new Error('the filter panel did not open');
		document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
		await frame();
		if (document.querySelector('.bt-filter-panel')) throw new Error('the filter panel did not close on Escape');
	}
};

/** The zoom slider moved a step at a time; the table follows it live. */
export const zoomBody = async ({ reps }: { reps: number }): Promise<void> => {
	const frame = () => new Promise<void>(r => requestAnimationFrame(() => r()));
	const slider = document.querySelector('.bt-status-zoom-slider') as HTMLInputElement | null;
	if (!slider) throw new Error('the zoom slider is missing');
	for (let i = 0; i < reps; i++) {
		const to = 80 + (i % 2) * 40 + i;
		slider.value = String(to);
		slider.dispatchEvent(new Event('input', { bubbles: true }));
		await frame();
		const shown = document.querySelector('.bt-status-zoom-value')?.textContent;
		if (shown !== `${to}%`) throw new Error(`the zoom did not follow the slider (${shown} for ${to})`);
	}
};

/** The cells marked as selected by a strip press, left in place: press one cell of the strip and report the count. */
export const selectionMarks = async ({ axis }: { axis: 'col' | 'row' }): Promise<number> => {
	const frame = () => new Promise<void>(r => requestAnimationFrame(() => r()));
	const strip = document.querySelector(axis === 'col' ? '.bt-col-selector' : '.bt-row-selector') as HTMLElement | null;
	const cell = strip?.querySelector('[data-idx="3"]') as HTMLElement | null;
	if (!cell) throw new Error('the strip has no cell to press');
	const ev = (type: string) => new PointerEvent(type, { button: 0, pointerId: 1, bubbles: true, cancelable: true });
	cell.dispatchEvent(ev('pointerdown'));
	await frame();
	const marked = document.querySelectorAll('[data-sel-stripe]').length;
	cell.dispatchEvent(ev('pointerup'));
	await frame(); await frame();
	document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
	await frame();
	return marked;
};
