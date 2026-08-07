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
export interface RenderFullOpts {
	sheetId?: string;
	scrollLeft?: number;
	scrollTop?: number;
	/** Collected structural ops instead of writing back — inspect via window.__btOps. */
	captureOps?: boolean;
}

export interface RenderBlockResult {
	/** The note's current text — assert write-back against this. */
	noteText: () => Promise<string>;
	/** Re-runs the code-block processor the way Obsidian does after a write:
	 *  a brand-new instance, a fresh blank container, the updated source. */
	reprocess: () => Promise<void>;
}

export const test = base.extend<{
	renderReal: (source: string, opts?: { sheetId?: string; scrollLeft?: number; scrollTop?: number }) => Promise<RenderRealResult>;
	renderFull: (source: string, opts?: RenderFullOpts) => Promise<RenderRealResult>;
	renderBlock: (blockSource: string) => Promise<RenderBlockResult>;
}>({
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

	/**
	 * Renders through the REAL `renderTable` — the whole interactive surface:
	 * hover strips, resize handles, floating panels, cell editors. Possible only
	 * because obsidian-shim.ts supplies a runtime for the types-only `obsidian`
	 * package; before that, every one of those had zero coverage, and a hang in
	 * the strips' hover path could only be chased by guessing and asking the user.
	 *
	 * Structural ops are captured into `window.__btOps` rather than written back,
	 * so a test can assert what an interaction WOULD persist without needing a
	 * vault.
	 */
	renderFull: async ({ page }, use) => {
		await page.addInitScript({ path: POLYFILL });

		const helper = async (source: string, opts?: RenderFullOpts): Promise<RenderRealResult> => {
			await page.goto(`file://${SHELL}`);
			await page.addScriptTag({ path: BUNDLE });

			const model = await page.evaluate(async ({ source, sheetId, scrollLeft, scrollTop }) => {
				const R = window.RichTableReal;
				const parsed = R.parseSource(source);
				const active = 'sheets' in parsed
					? parsed.sheets.find(s => s.id === (sheetId ?? parsed.activeSheetId)) ?? parsed.sheets[0]
					: parsed;
				const root = document.getElementById('root');
				// renderTable builds the whole root itself, so hand it an empty
				// container rather than the pre-built wrapper the other fixture uses.
				root.replaceChildren();
				root.className = '';
				window.__btOps = [];
				window.__btModel = active;
				const registry = new R.ChoiceRegistry([]);
				// Published so a test can tear the table down the way Obsidian does
				// (unloading the component), which is what runs every cleanup
				// registration — several hover/edit fixes live in those.
				const component = new R.ShimComponent();
				component.load();
				window.__btComponent = component;
				await R.renderTable(
					active,
					() => registry,
					root,
					{},                       // app — only ever passed through
					'test.md',
					component,
					(op) => { window.__btOps.push(op); },
				);
				const wrapper = document.querySelector('.bt-table-wrapper');
				if (scrollLeft !== undefined) wrapper.scrollLeft = scrollLeft;
				if (scrollTop !== undefined) wrapper.scrollTop = scrollTop;
				return active;
			}, { source, sheetId: opts?.sheetId, scrollLeft: opts?.scrollLeft, scrollTop: opts?.scrollTop });

			return { model };
		};

		await use(helper);
	},

	/**
	 * Renders through the REAL write-back layer (tableBlock.ts) against an
	 * in-memory note, so an interaction actually rewrites the note text and the
	 * rebuild Obsidian performs afterwards can be reproduced faithfully.
	 *
	 * That rebuild is where a long tail of problems lived — the table flickering,
	 * the page scrolling away from it, an in-progress edit being lost — and none of
	 * it was reachable by a test before: it needs the code-block processor to run
	 * twice over the same table, which is what `reprocess` does.
	 */
	renderBlock: async ({ page }, use) => {
		await page.addInitScript({ path: POLYFILL });

		const helper = async (blockSource: string): Promise<RenderBlockResult> => {
			await page.goto(`file://${SHELL}`);
			await page.addScriptTag({ path: BUNDLE });

			await page.evaluate((src) => {
				const R = window.RichTableReal;
				const NOTE = 'note.md';
				const vault = new R.FakeVault();
				// A note with the block preceded by a line of prose, so lineStart is
				// non-zero and an off-by-one in the line splice can't pass unnoticed.
				const header = '# note\n\n';
				vault.files.set(NOTE, `${header}\`\`\`rich-table\n${src}\`\`\`\n`);
				const w = window as unknown as Record<string, unknown>;
				w.__btVault = vault;
				w.__btNote = NOTE;
				w.__btSource = src;
				w.__btPlugin = {
					app: { vault },
					choiceRegistry: new R.ChoiceRegistry([]),
					settings: { allowReadingViewEdit: true, singleClickEdit: false },
				};
				w.__btMount = () => {
					const host = document.getElementById('root');
					// Obsidian hands each re-run a brand-new, EMPTY container.
					const container = host.createDiv();
					const lines = (vault.files.get(NOTE) ?? '').split('\n');
					const lineStart = lines.findIndex(l => l.startsWith('```rich-table'));
					const lineEnd = lines.findIndex((l, i) => i > lineStart && l.startsWith('```'));
					const inner = lines.slice(lineStart + 1, lineEnd).join('\n') + '\n';
					const ctx = { getSectionInfo: () => ({ lineStart, lineEnd, text: vault.files.get(NOTE) ?? '' }) };
					const block = new R.TableBlock(container, inner, w.__btPlugin, NOTE, ctx, `${NOTE}:${lineStart}`);
					w.__btBlock = block;
					block.load();
					return container;
				};
				w.__btMount();
			}, blockSource);

			// The first paint is async (a cell at a time), so wait for the table.
			await page.locator('.bt-table').first().waitFor();

			return {
				noteText: () => page.evaluate(() => {
					const w = window as unknown as { __btVault: { files: Map<string, string> }; __btNote: string };
					return w.__btVault.files.get(w.__btNote) ?? '';
				}),
				reprocess: async () => {
					await page.evaluate(() => {
						const w = window as unknown as { __btBlock: { unload(): void }; __btMount: () => void };
						w.__btBlock.unload();
						// Obsidian DISCARDS the old element; unload alone only runs the
						// instance's cleanups. Leaving it attached made assertions match
						// the stale DOM instead of what the rebuild produced, so a test
						// could pass with the mechanism it was checking removed entirely.
						(document.getElementById('root') as HTMLElement).replaceChildren();
						w.__btMount();
					});
				},
			};
		};

		await use(helper);
	},
});

export { expect } from '@playwright/test';
