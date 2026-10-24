import { test as base } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const SHELL = path.join(__dirname, 'shell.html');
const POLYFILL = path.join(__dirname, 'obsidian-dom-polyfill.js');
const FAKE_SEARCH_HOST = path.join(__dirname, 'fake-search-host.js');
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
	/**
	 * The plugin's "edit on single click" setting. Off (the default) is classic
	 * mode: a click waits out the double-click delay before opening the editor,
	 * and a double-click opens the style panel. On, a click opens the editor
	 * immediately and Ctrl/Cmd+click takes over as the panel gesture — a
	 * materially different path through bindCellActivation, so anything asserting
	 * on click-to-edit behaviour should cover both.
	 */
	singleClickEdit?: boolean;
	/** Overrides the fixed 'test-cache-key' default — for a test that needs
	 *  renderTable() to treat this render as a NESTED table (a cacheKey
	 *  containing blockCacheKey.ts's nested marker). Only ONE thing in
	 *  renderer.ts still branches on this (TOP_STRIP_PAD skipping the extra
	 *  clearance for Obsidian's block-hover toolbar, which structurally can't
	 *  float over a nested block) — everything else renders identically
	 *  regardless of cacheKey, by design. */
	cacheKey?: string;
}

export interface RenderBlockResult {
	/** Types a query into the fake search panel (null = closed or empty) and notifies the followers. */
	setQuery: (query: { query: string; caseSensitive?: boolean; wholeWord?: boolean } | null) => Promise<void>;
	/** Text of every highlighted fragment on the page, in document order. */
	hits: () => Promise<string[]>;
	/** How many listeners the fake panel has. */
	panelListeners: () => Promise<number>;
	/** Opens a match in the fake panel (null = none) and notifies the followers, as a click on a result does. */
	openHit: (hit: unknown) => Promise<void>;
	/** Text of every mark drawn at full strength, in document order. */
	brightMarks: () => Promise<string[]>;
	/** Listeners on the opened-match hook. */
	hitListeners: () => Promise<number>;
	/** What Rich Search's revealBlock does once it has found the block: show a hit and say whether there was one. */
	revealHit: (anchor: unknown, query: { query: string; caseSensitive?: boolean; wholeWord?: boolean }) => Promise<boolean>;
	/** The live block that opens on this fence line of the note, as the lookup behind revealBlock finds it. */
	blockAtLine: (line: number, path?: string) => Promise<boolean>;
	/** The note's current text — assert write-back against this. */
	noteText: () => Promise<string>;
	/** Re-runs the code-block processor the way Obsidian does after a write:
	 *  a brand-new instance, a fresh blank container, the updated source. */
	reprocess: () => Promise<void>;
	/** Simulate an external tool overwriting an already-seeded binary file's
	 *  bytes and firing the 'modify' event Obsidian's own file-watcher would
	 *  — for exercising tableBlock.ts's xlsx auto-refresh. `bytes` is a plain
	 *  byte array (not ArrayBuffer/Uint8Array — those aren't reliably
	 *  structured-cloneable across Playwright's page.evaluate boundary). */
	writeBinaryAndNotify: (path: string, bytes: number[]) => Promise<void>;
	/** Simulate the vault renaming the file on disk (fires 'rename'). */
	renameBinaryAndNotify: (oldPath: string, newPath: string) => Promise<void>;
	/** Simulate the vault deleting the file (fires 'delete'). */
	deleteBinaryAndNotify: (path: string) => Promise<void>;
	/** Reads a binary file's CURRENT bytes out of the fake vault — for
	 *  asserting phase 1 of xlsx WRITE support (tableBlock.ts's
	 *  handleXlsxWrite) actually rewrote the referenced .xlsx file. Plain byte
	 *  array, same not-structured-cloneable reasoning as writeBinaryAndNotify. */
	readBinaryFile: (path: string) => Promise<number[]>;
	/** Makes the NEXT modifyBinary write to this path fail, simulating the real
	 *  file being locked open in another program (e.g. Excel) — for asserting
	 *  handleXlsxWrite's failure path (Notice + corrective re-render) actually
	 *  runs instead of silently vanishing. */
	lockBinaryFile: (path: string) => Promise<void>;
	/** Every `new Notice(...)` message shown so far, in order — obsidian-shim.ts's
	 *  `Notice.shown` static array, read fresh (not snapshotted at mount time). */
	getNotices: () => Promise<string[]>;
	/** Mutates `__btPlugin.settings` in place with `patch`, then calls the real
	 *  `refreshAllTableBlocks()` — the exact sequence main.ts's `saveSettings()`
	 *  runs after a settings-tab change, for asserting an already-mounted table
	 *  (no `reprocess()`, no new instance) picks up the new setting live. */
	changeSettingsAndRefresh: (patch: Record<string, unknown>) => Promise<void>;
}

export interface LinkOpening {
	kind: 'internal' | 'external';
	href: string;
	sourcePath?: string;
	where?: string | boolean;
}

/** panel: a full Rich Search; noHit: one with the search but not the opened match; hitThrows: currentHit fails; legacy: one that predates currentQuery; throws: matchLine fails; future: an apiVersion this plugin does not know; none: not installed. */
export type FakeSearchHost = 'none' | 'panel' | 'noHit' | 'legacy' | 'throws' | 'hitThrows' | 'future';

export interface RenderXlsxFileResult {
	/** Hands the viewer a search hit, the way setEphemeralState does. */
	reveal: (request: unknown) => Promise<void>;
	/** Types a query into the fake search panel (null = panel closed or query empty) and notifies the view. */
	setQuery: (query: { query: string; caseSensitive?: boolean; wholeWord?: boolean } | null) => Promise<void>;
	/** How many listeners the fake panel currently has. */
	panelListeners: () => Promise<number>;
	/** Opens a match in the fake panel (null = none) and notifies the followers, as a click on a result does. */
	openHit: (hit: unknown) => Promise<void>;
	/** Text of every mark drawn at full strength, in document order. */
	brightMarks: () => Promise<string[]>;
	/** Listeners on the opened-match hook. */
	hitListeners: () => Promise<number>;
	/** Which of its cell's marks is bright (0 = the first), or -1 when none is. */
	brightIndex: () => Promise<number>;
	/** Text of the cell that holds the bright mark. */
	brightCellText: () => Promise<string | null>;
	/** Inserts a link into the first cell the way MarkdownRenderer would, and returns its selector. */
	addLink: (kind: 'internal' | 'external', href: string | null, text?: string) => Promise<string>;
	/** Every link opened so far through workspace.openLinkText or window.open, in order. */
	linkOpenings: () => Promise<LinkOpening[]>;
	/** Text of every currently highlighted fragment, in document order. */
	hits: () => Promise<string[]>;
	/** Simulate an external tool overwriting the open file and firing 'modify'. */
	modify: (bytes: number[]) => Promise<void>;
	rename: (newPath: string) => Promise<void>;
	remove: () => Promise<void>;
	/** Show a different file in the same view, the way a tab navigates. */
	openOther: (path: string) => Promise<void>;
	/** Closes the view the way Obsidian does when its tab goes away. */
	closeView: () => Promise<void>;
	/** Installs Rich Search after the view is already open, as when the user enables the plugin meanwhile. */
	enableSearchHost: (name: FakeSearchHost) => Promise<void>;
	/** Closes the shown file but keeps the view, as Obsidian does just before it shows another file in the same tab. */
	closeFile: () => Promise<void>;
	/** Unloads the view component without closing the file first. */
	unloadView: () => Promise<void>;
	/** Number of vault listeners still registered (for leak checks). */
	listenerCount: () => Promise<number>;
}

export const test = base.extend<{
	renderReal: (source: string, opts?: { sheetId?: string; scrollLeft?: number; scrollTop?: number }) => Promise<RenderRealResult>;
	renderFull: (source: string, opts?: RenderFullOpts) => Promise<RenderRealResult>;
	/** `binaryFiles` seeds the fake vault's binary files (vault-relative path
	 *  → plain byte array) BEFORE the block's first render, for a block whose
	 *  YAML references an `xlsxSource` — see writeBinaryAndNotify above for
	 *  why a byte array, not ArrayBuffer/Uint8Array. */
	/** Mounts the real XlsxFileViewer on an in-memory vault holding `files` (path → bytes) and opens `open`. */
	renderXlsxFile: (files: Record<string, number[]>, open: string, opts?: { searchHost?: FakeSearchHost; pendingReveal?: unknown; initialQuery?: { query: string; caseSensitive?: boolean; wholeWord?: boolean } }) => Promise<RenderXlsxFileResult>;
	renderBlock: (blockSource: string, opts?: { binaryFiles?: Record<string, number[]>; sourcePath?: string; settings?: Record<string, unknown>; searchHost?: FakeSearchHost; initialQuery?: { query: string; caseSensitive?: boolean; wholeWord?: boolean } }) => Promise<RenderBlockResult>;
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

			const model = await page.evaluate(async ({ source, sheetId, scrollLeft, scrollTop, singleClickEdit, cacheKey }) => {
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
					// A locked table has no onStructuralOp in the real app (tableBlock.ts's
					// render() ternary) — matching that here matters for anything asserting
					// on locked-table behaviour, not just for realism in general.
					active.locked ? undefined : (op) => { window.__btOps.push(op); },
					// onToggleLock, unlike onOp, stays available while locked — you need a
					// way to unlock a locked table. Pushes the same {type:'toggle-lock'}
					// shape onOp would have dispatched, so a test can assert on __btOps
					// either way.
					() => { window.__btOps.push({ type: 'toggle-lock' }); return Promise.resolve(); },
					undefined,                // onRootReady
					undefined,                // isSwapping
					cacheKey ?? 'test-cache-key', // cacheKey — needed by the cross-rebuild handoffs
					() => !!singleClickEdit,
				);
				// Mirrors tableBlock.ts's own post-swap step: renderTable() leaves any
				// column with no width of its own (alongside a sibling that has one)
				// unmeasured — root is already live here (unlike tableBlock.ts's
				// detached tmp tree), so this can run immediately.
				document.querySelectorAll('table.bt-table').forEach(window.RichTableReal.applyAutoColWidths);
				// Same mirroring, for the inline-code line-height fix (renderAutofit.ts).
				document.querySelectorAll('table.bt-table').forEach(window.RichTableReal.applyCodeLineHeightFix);
				const wrapper = document.querySelector('.bt-table-wrapper');
				if (scrollLeft !== undefined) wrapper.scrollLeft = scrollLeft;
				if (scrollTop !== undefined) wrapper.scrollTop = scrollTop;
				return active;
			}, {
				source, sheetId: opts?.sheetId, scrollLeft: opts?.scrollLeft,
				scrollTop: opts?.scrollTop, singleClickEdit: opts?.singleClickEdit,
				cacheKey: opts?.cacheKey,
			});

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
	renderXlsxFile: async ({ page }, use) => {
		await page.addInitScript({ path: POLYFILL });
		await page.addInitScript({ path: FAKE_SEARCH_HOST });

		const helper = async (files: Record<string, number[]>, open: string, opts?: { searchHost?: FakeSearchHost; pendingReveal?: unknown; initialQuery?: { query: string; caseSensitive?: boolean; wholeWord?: boolean } }): Promise<RenderXlsxFileResult> => {
			await page.goto(`file://${SHELL}`);
			await page.addScriptTag({ path: BUNDLE });
			await page.evaluate(async ({ files, open, searchHost, pendingReveal, initialQuery }) => {
				const R = window.RichTableReal;
				const vault = new R.FakeVault();
				for (const [path, bytes] of Object.entries(files)) vault.binaryFiles.set(path, new Uint8Array(bytes).buffer);
				const w = window as unknown as Record<string, unknown>;
				w.__btVault = vault;
				const getHost = (window as any).__btMakeSearchHost(searchHost, initialQuery);
				const opened: unknown[] = [];
				w.__btOpened = opened;
				window.open = ((href: string) => { opened.push({ kind: 'external', href }); return null; }) as typeof window.open;
				const workspace = { openLinkText: (href: string, sourcePath: string, where: unknown) => { opened.push({ kind: 'internal', href, sourcePath, where }); return Promise.resolve(); } };
				const host = { app: { vault, workspace }, choiceRegistry: new R.ChoiceRegistry([]), searchPanel: new R.SearchPanelFollower(getHost) };
				const container = document.getElementById('root').createDiv();
				const viewer = new R.XlsxFileViewer(host, container);
				viewer.load();
				w.__btViewer = viewer;
				if (pendingReveal) viewer.reveal(pendingReveal);
				await viewer.open(vault.getAbstractFileByPath(open));
			}, { files, open, searchHost: opts?.searchHost, pendingReveal: opts?.pendingReveal, initialQuery: opts?.initialQuery });
			await Promise.race([
				page.locator('.bt-table').first().waitFor(),
				page.locator('.bt-error').first().waitFor(),
				page.locator('.bt-empty-workbook').first().waitFor(),
			]);

			type W = { __btVault: any; __btViewer: any; __btOpenPath: string };
			return {
				reveal: (request) => page.evaluate(async (request) => {
					const w = window as unknown as W;
					w.__btViewer.reveal(request);
					await new Promise(r => setTimeout(r, 0));
				}, request),
				addLink: (kind, href, text) => page.evaluate(({ kind, href, text }) => {
					const cell = document.querySelector('.bt-td') as HTMLElement;
					const a = document.createElement('a');
					a.className = kind === 'internal' ? 'internal-link' : 'external-link';
					if (href !== null) a.setAttribute('data-href', href);
					a.textContent = text ?? 'a link';
					a.id = 'probe-link';
					cell.appendChild(a);
					return '#probe-link';
				}, { kind, href, text }),
				linkOpenings: () => page.evaluate(() => (window as unknown as { __btOpened: LinkOpening[] }).__btOpened),
				setQuery: (query) => page.evaluate((query) => {
					const w = window as unknown as { __btPanel: { query: unknown; listeners: Set<(q: unknown) => void> } };
					w.__btPanel.query = query;
					for (const fn of [...w.__btPanel.listeners]) fn(query);
				}, query),
				panelListeners: () => page.evaluate(() => (window as unknown as { __btPanel: { listeners: Set<unknown> } }).__btPanel.listeners.size),
				openHit: (hit) => page.evaluate((hit) => {
					const w = window as unknown as { __btPanel: { hit: unknown; hitListeners: Set<(h: unknown) => void> } };
					w.__btPanel.hit = hit;
					for (const fn of [...w.__btPanel.hitListeners]) fn(hit);
				}, hit),
				brightMarks: () => page.evaluate(() => Array.from(document.querySelectorAll('mark.bt-search-hit-active')).map(m => m.textContent ?? '')),
				hitListeners: () => page.evaluate(() => (window as unknown as { __btPanel: { hitListeners: Set<unknown> } }).__btPanel.hitListeners.size),
				brightIndex: () => page.evaluate(() => {
					const bright = document.querySelector('mark.bt-search-hit-active');
					return bright ? Array.from(bright.closest('td, th')!.querySelectorAll('mark.bt-search-hit')).indexOf(bright) : -1;
				}),
				brightCellText: () => page.evaluate(() => document.querySelector('mark.bt-search-hit-active')?.closest('td, th')?.textContent ?? null),
				hits: () => page.evaluate(() => Array.from(document.querySelectorAll('mark.bt-search-hit')).map(m => m.textContent ?? '')),
				modify: (bytes) => page.evaluate(({ bytes }) => {
					const w = window as unknown as W;
					const path = w.__btViewer.file.path;
					w.__btVault.writeBinaryAndNotify(path, new Uint8Array(bytes).buffer);
				}, { bytes }),
				rename: (newPath) => page.evaluate(({ newPath }) => {
					const w = window as unknown as W;
					w.__btVault.renameBinaryAndNotify(w.__btViewer.file.path, newPath);
				}, { newPath }),
				remove: () => page.evaluate(() => {
					const w = window as unknown as W;
					w.__btVault.deleteBinaryAndNotify(w.__btViewer.file.path);
				}),
				openOther: (path) => page.evaluate(async ({ path }) => {
					const w = window as unknown as W;
					await w.__btViewer.open(w.__btVault.getAbstractFileByPath(path));
				}, { path }),
				closeView: () => page.evaluate(() => {
					const w = window as unknown as W;
					w.__btViewer.close();
					w.__btViewer.unload();
				}),
				enableSearchHost: (name) => page.evaluate((name) => { (window as unknown as { __btHostState: { name: string } }).__btHostState.name = name; }, name),
				closeFile: () => page.evaluate(() => { (window as unknown as W).__btViewer.close(); }),
				unloadView: () => page.evaluate(() => {
					const w = window as unknown as W;
					w.__btViewer.unload();
				}),
				listenerCount: () => page.evaluate(() => {
					const w = window as unknown as W;
					let n = 0;
					for (const set of w.__btVault.listeners.values()) n += set.size;
					return n;
				}),
			};
		};

		await use(helper);
	},

	renderBlock: async ({ page }, use) => {
		await page.addInitScript({ path: POLYFILL });
		await page.addInitScript({ path: FAKE_SEARCH_HOST });

		const helper = async (blockSource: string, opts?: { binaryFiles?: Record<string, number[]>; sourcePath?: string; settings?: Record<string, unknown>; searchHost?: FakeSearchHost; initialQuery?: { query: string; caseSensitive?: boolean; wholeWord?: boolean } }): Promise<RenderBlockResult> => {
			await page.goto(`file://${SHELL}`);
			await page.addScriptTag({ path: BUNDLE });

			await page.evaluate(({ src, binaryFiles, sourcePath, settings, searchHost, initialQuery }) => {
				const R = window.RichTableReal;
				const NOTE = sourcePath ?? 'note.md';
				const vault = new R.FakeVault();
				// A note with the block preceded by a line of prose, so lineStart is
				// non-zero and an off-by-one in the line splice can't pass unnoticed.
				const header = '# note\n\n';
				vault.files.set(NOTE, `${header}\`\`\`rich-table\n${src}\`\`\`\n`);
				// Seeded BEFORE the first mount below — an xlsx-backed block's very
				// first render() already needs vault.readBinary to resolve.
				for (const [path, bytes] of Object.entries(binaryFiles ?? {})) {
					vault.binaryFiles.set(path, new Uint8Array(bytes).buffer);
				}
				const w = window as unknown as Record<string, unknown>;
				w.__btVault = vault;
				w.__btNote = NOTE;
				w.__btSource = src;
				w.__btPlugin = {
					app: { vault, metadataCache: new R.FakeMetadataCache(vault), fileManager: new R.FakeFileManager() },
					choiceRegistry: new R.ChoiceRegistry([]),
					searchPanel: new R.SearchPanelFollower((window as any).__btMakeSearchHost(searchHost, initialQuery)),
					settings: {
						allowReadingViewEdit: true,
						singleClickEdit: false,
						ctrlColHiddenButtons: { locked: [], unlocked: [], xlsxRef: [] },
						...(settings ?? {}),
					},
				};
				// Recomputes the fence's line range from whatever the note CURRENTLY
				// holds, rather than freezing lineStart/lineEnd at mount time —
				// real Obsidian's ctx.getSectionInfo reads the live editor state,
				// which vault.process keeps in sync with every write, so calling it
				// again immediately after a write reflects that write's own line-
				// count change. A frozen pair would still be right for exactly one
				// write per mount, but production code can fire two structural ops
				// back to back in the same tick (e.g. a "both" resize sets width AND
				// height, each its own insertBlock/vault.process call) — the second
				// call's stale lineEnd would then bound the splice against the
				// PRE-first-write layout, corrupting whichever write applies second.
				const findBlockRange = (text: string) => {
					const lines = text.split('\n');
					const lineStart = lines.findIndex(l => l.startsWith('```rich-table'));
					const lineEnd = lines.findIndex((l, i) => i > lineStart && l.startsWith('```'));
					return { lineStart, lineEnd };
				};
				w.__btMount = (into?: HTMLElement, fenceLineOverride?: number) => {
					const host = into ?? document.getElementById('root');
					// Obsidian hands each re-run a brand-new, EMPTY container.
					const container = host.createDiv();
					const { lineStart, lineEnd } = findBlockRange(vault.files.get(NOTE) ?? '');
					const lines = (vault.files.get(NOTE) ?? '').split('\n');
					const inner = lines.slice(lineStart + 1, lineEnd).join('\n') + '\n';
					// Reading view answers null until a section is attached to the page; a test can switch that on.
					const ctx = { getSectionInfo: () => (w.__btSectionNull ? null : { ...findBlockRange(vault.files.get(NOTE) ?? ''), ...(fenceLineOverride === undefined ? {} : { lineStart: fenceLineOverride }), text: vault.files.get(NOTE) ?? '' }) };
					const block = new R.TableBlock(container, inner, w.__btPlugin, NOTE, ctx, `${NOTE}:${lineStart}`);
					w.__btBlock = block;
					block.load();
					return container;
				};
				w.__btMount();
			}, { src: blockSource, binaryFiles: opts?.binaryFiles, sourcePath: opts?.sourcePath, settings: opts?.settings, searchHost: opts?.searchHost, initialQuery: opts?.initialQuery });

			// The first paint is async (a cell at a time), so wait for either
			// outcome — a rendered table, or (an xlsx-backed block whose file
			// can't be resolved/read) the error banner render() falls back to.
			await Promise.race([
				page.locator('.bt-table').first().waitFor(),
				page.locator('.bt-error').first().waitFor(),
			]);

			return {
				setQuery: (query) => page.evaluate((query) => {
					const w = window as unknown as { __btPanel: { query: unknown; listeners: Set<(q: unknown) => void> } };
					w.__btPanel.query = query;
					for (const fn of [...w.__btPanel.listeners]) fn(query);
				}, query),
				hits: () => page.evaluate(() => Array.from(document.querySelectorAll('mark.bt-search-hit')).map(m => m.textContent ?? '')),
				panelListeners: () => page.evaluate(() => (window as unknown as { __btPanel: { listeners: Set<unknown> } }).__btPanel.listeners.size),
				openHit: (hit) => page.evaluate((hit) => {
					const w = window as unknown as { __btPanel: { hit: unknown; hitListeners: Set<(h: unknown) => void> } };
					w.__btPanel.hit = hit;
					for (const fn of [...w.__btPanel.hitListeners]) fn(hit);
				}, hit),
				brightMarks: () => page.evaluate(() => Array.from(document.querySelectorAll('mark.bt-search-hit-active')).map(m => m.textContent ?? '')),
				hitListeners: () => page.evaluate(() => (window as unknown as { __btPanel: { hitListeners: Set<unknown> } }).__btPanel.hitListeners.size),
				revealHit: (anchor, query) => page.evaluate(({ anchor, query }) => {
					const w = window as unknown as { __btBlock: { revealSearchHit(a: unknown, q: unknown): Promise<boolean> } };
					return w.__btBlock.revealSearchHit(anchor, query);
				}, { anchor, query }),
				blockAtLine: (line, path) => page.evaluate(({ line, path }) => {
					const R = (window as any).RichTableReal;
					const w = window as unknown as { __btNote: string };
					return R.findBlockAt(path ?? w.__btNote, line, document.body) !== null;
				}, { line, path }),
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
				writeBinaryAndNotify: (path, bytes) => page.evaluate(({ path, bytes }) => {
					const w = window as unknown as { __btVault: { writeBinaryAndNotify(path: string, buf: ArrayBuffer): void } };
					w.__btVault.writeBinaryAndNotify(path, new Uint8Array(bytes).buffer);
				}, { path, bytes }),
				renameBinaryAndNotify: (oldPath, newPath) => page.evaluate(({ oldPath, newPath }) => {
					const w = window as unknown as { __btVault: { renameBinaryAndNotify(oldPath: string, newPath: string): void } };
					w.__btVault.renameBinaryAndNotify(oldPath, newPath);
				}, { oldPath, newPath }),
				deleteBinaryAndNotify: (path) => page.evaluate((path) => {
					const w = window as unknown as { __btVault: { deleteBinaryAndNotify(path: string): void } };
					w.__btVault.deleteBinaryAndNotify(path);
				}, path),
				readBinaryFile: (path) => page.evaluate((path) => {
					const w = window as unknown as { __btVault: { binaryFiles: Map<string, ArrayBuffer> } };
					const buf = w.__btVault.binaryFiles.get(path);
					return buf ? Array.from(new Uint8Array(buf)) : [];
				}, path),
				lockBinaryFile: (path) => page.evaluate((path) => {
					const w = window as unknown as { __btVault: { lockedBinaryPaths: Set<string> } };
					w.__btVault.lockedBinaryPaths.add(path);
				}, path),
				getNotices: () => page.evaluate(() => {
					const w = window as unknown as { RichTableReal: { Notice: { shown: string[] } } };
					return w.RichTableReal.Notice.shown;
				}),
				changeSettingsAndRefresh: (patch) => page.evaluate((patch) => {
					const w = window as unknown as {
						__btPlugin: { settings: Record<string, unknown> };
						RichTableReal: { refreshAllTableBlocks(): void };
					};
					Object.assign(w.__btPlugin.settings, patch);
					w.RichTableReal.refreshAllTableBlocks();
				}, patch),
			};
		};

		await use(helper);
	},
});

export { expect } from '@playwright/test';
