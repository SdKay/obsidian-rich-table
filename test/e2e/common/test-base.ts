import { test as base } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const SHELL = path.join(__dirname, 'shell.html');
const POLYFILL = path.join(__dirname, 'obsidian-dom-polyfill.js');
const BUNDLE = path.join(__dirname, 'real-bundle.generated.js');
const BUILD_TABLE_DOM = path.join(__dirname, 'build-table-dom.js');

export interface RenderRealResult {
	/** The parsed model actually rendered (the active sheet, if the source was a workbook). */
	model: unknown;
}

/**
 * Custom test fixture adding `renderReal(source, opts?)` — navigates to the
 * shared shell page, injects the REAL bundled source (parser.ts,
 * renderFreeze.ts, renderGridHelpers.ts, renderCellStyle.ts — see
 * real-bundle-entry.ts), parses `source` with the REAL parseSource (so a
 * workbook's `sheets[]`/`active_sheet` are handled exactly like production,
 * not hand-simulated), builds the table DOM via build-table-dom.js (which
 * itself calls the real buildOccupied/getMergeOrigin/applyColStyle/
 * applyStyleRulesV2 for merge and style resolution — only the DOM skeleton
 * and cell text content are hand-built, see that file's own header comment
 * for why), and calls the REAL applyFreeze if the model has freezeRows/
 * freezeCols set.
 *
 * After `renderReal` resolves, use the normal `page` fixture to assert
 * against `#table`/`#root` etc. in the shell page — this fixture only
 * handles getting a genuine, source-accurate table into the DOM.
 */
export const test = base.extend<{ renderReal: (source: string, opts?: { sheetId?: string; scrollLeft?: number; scrollTop?: number }) => Promise<RenderRealResult> }>({
	renderReal: async ({ page }, use) => {
		await page.addInitScript({ path: POLYFILL });

		const helper = async (source: string, opts?: { sheetId?: string; scrollLeft?: number; scrollTop?: number }): Promise<RenderRealResult> => {
			await page.goto(`file://${SHELL}`);
			await page.addScriptTag({ path: BUNDLE });
			await page.addScriptTag({ path: BUILD_TABLE_DOM });

			const model = await page.evaluate(({ source, sheetId, scrollLeft, scrollTop }) => {
				const parsed = window.RichTableReal.parseSource(source);
				const active = 'sheets' in parsed
					? parsed.sheets.find(s => s.id === (sheetId ?? parsed.activeSheetId)) ?? parsed.sheets[0]
					: parsed;
				const { table, thead, tbody } = window.buildTableDom(active);
				if (active.theme) document.getElementById('root').classList.add(`bt-theme-${active.theme}`);
				const wrapper = document.getElementById('wrapper');
				// A bounded, ACTUALLY-scrollable wrapper is what makes frozen
				// rows/cols' position:sticky do anything at all — a wrapper
				// that just grows to fit its content (no explicit view size)
				// never scrolls, so sticky cells never engage real compositing,
				// which is where some of these bugs only show up (see this
				// issue's own notes on the static-vs-scrolled render gap).
				if (typeof active.viewWidth === 'number') {
					wrapper.classList.add('bt-view-fixed-w');
					wrapper.style.setProperty('--bt-view-width', `${active.viewWidth}px`);
				}
				if (typeof active.viewHeight === 'number') {
					wrapper.classList.add('bt-view-fixed-h');
					wrapper.style.setProperty('--bt-view-height', `${active.viewHeight}px`);
				}
				document.getElementById('contentRow').appendChild(table);
				if (active.freezeRows !== undefined || active.freezeCols !== undefined) {
					window.RichTableReal.applyFreeze(table, thead, tbody, active);
				}
				table.id = 'table';
				thead.id = 'thead';
				tbody.id = 'tbody';
				// Published for assertions that need to know which rows/columns are
				// frozen without re-parsing the source (pixel-invariance.ts).
				window.__btModel = active;
				if (scrollLeft !== undefined) wrapper.scrollLeft = scrollLeft;
				if (scrollTop !== undefined) wrapper.scrollTop = scrollTop;
				return active;
			}, { source, sheetId: opts?.sheetId, scrollLeft: opts?.scrollLeft, scrollTop: opts?.scrollTop });

			return { model };
		};

		await use(helper);
	},
});

export { expect } from '@playwright/test';
