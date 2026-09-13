/**
 * Stands in for the `obsidian` module when bundling the real source for e2e
 * tests (esbuild aliases the bare import to this file — see build-bundle.mjs).
 *
 * Why this has to exist: the `obsidian` npm package is types-only, with no
 * runtime at all. So anything importing it couldn't be exercised in a plain
 * browser, which for a long time meant the harness could only run the pieces
 * that don't — the parser, the freeze pass, style resolution. `renderTable`
 * itself was out of reach, so every interactive surface (hover strips, floating
 * panels, cell editing) had zero coverage, and a real hang in the selector
 * strips' hover path could only be diagnosed by guessing and asking the user to
 * try again.
 *
 * The goal is NOT to reimplement Obsidian. It's to be faithful in exactly the
 * respects the plugin's layout and event behaviour depend on:
 *   - the DOM shape produced (a rendered cell must get the same box as in
 *     Obsidian, so MarkdownRenderer.render emits a <p> like the real one)
 *   - synchronous-vs-async timing of anything the plugin awaits
 *   - Component's registration lifecycle, since several hover/freeze fixes are
 *     implemented as cleanup registrations and would silently not run
 * Everything beyond that (menu chrome, notices, icon glyphs) is a stub on
 * purpose — a test depending on it would be testing this file.
 *
 * Kept separate from test/__mocks__/obsidian.ts (vitest's alias), which only
 * needs YAML: that one runs in Node against pure logic, this one runs in a
 * browser against the renderer.
 */
import * as yaml from 'js-yaml';

export function parseYaml(src: string): unknown {
	return yaml.load(src);
}

export function stringifyYaml(obj: unknown): string {
	return yaml.dump(obj, { lineWidth: -1, quotingType: '"', forceQuotes: false });
}

export function getLanguage(): string {
	return 'en';
}

/** Faithful re-implementation of the real utility's own documented behaviour
 *  (collapse "\" to "/", drop a trailing slash, collapse repeated slashes) —
 *  xlsxSaveModal.ts calls the real one to sanitise a user-typed folder path. */
export function normalizePath(path: string): string {
	return path.replace(/\\/g, '/').replace(/\/+/g, '/').replace(/\/$/, '').replace(/^\.\//, '');
}

/**
 * Faithful in the one respect the plugin relies on: registered callbacks run
 * exactly once on unload, and children unload with their parent. Hover-pin
 * release and resize-indicator cleanup are both cleanup registrations, so
 * getting this wrong would disable them quietly rather than fail loudly.
 */
export class Component {
	_loaded = false;
	_children: Component[] = [];
	_cleanups: (() => void)[] = [];

	load(): void {
		if (this._loaded) return;
		this._loaded = true;
		this.onload();
		for (const c of this._children) c.load();
	}
	onload(): void { /* subclasses override */ }
	unload(): void {
		if (!this._loaded) return;
		this._loaded = false;
		for (const c of this._children.splice(0)) c.unload();
		for (const fn of this._cleanups.splice(0)) fn();
		this.onunload();
	}
	onunload(): void { /* subclasses override */ }
	addChild<T extends Component>(child: T): T {
		this._children.push(child);
		if (this._loaded) child.load();
		return child;
	}
	removeChild<T extends Component>(child: T): T {
		const i = this._children.indexOf(child);
		if (i >= 0) this._children.splice(i, 1);
		child.unload();
		return child;
	}
	register(cb: () => void): void {
		this._cleanups.push(cb);
	}
	registerEvent(_ref: unknown): void { /* no event bus here */ }
	registerDomEvent(el: EventTarget, type: string, cb: EventListenerOrEventListenerObject): void {
		el.addEventListener(type, cb);
		this.register(() => el.removeEventListener(type, cb));
	}
	registerInterval(id: number): number {
		this.register(() => window.clearInterval(id));
		return id;
	}
}

export class MarkdownRenderChild extends Component {
	containerEl: HTMLElement;
	constructor(containerEl: HTMLElement) {
		super();
		this.containerEl = containerEl;
	}
}

/**
 * The real one parses markdown into block elements. Cell layout depends on the
 * <p> it produces (styles.css sets `p { margin: 0 }` inside cells, and the
 * empty-cell height fix relies on a paragraph existing), so that shape is
 * reproduced; inline markdown is not parsed, since no layout question turns on
 * whether `**a**` came out bold.
 *
 * Async like the real one — renderTable awaits it per cell, and collapsing that
 * to synchronous would hide any ordering bug that depends on the await.
 */
export const MarkdownRenderer = {
	render(_app: unknown, markdown: string, el: HTMLElement, _sourcePath: string, _component: unknown): Promise<void> {
		if (markdown !== '') el.createEl('p', { text: markdown });
		return Promise.resolve();
	},
};

export class MenuItem {
	title = '';
	icon = '';
	checked = false;
	disabled = false;
	callback: ((evt: MouseEvent) => unknown) | null = null;
	setTitle(title: string | DocumentFragment): this { this.title = String(title instanceof DocumentFragment ? title.textContent : title); return this; }
	setIcon(icon: string | null): this { this.icon = icon ?? ''; return this; }
	setChecked(checked: boolean): this { this.checked = checked; return this; }
	setDisabled(disabled: boolean): this { this.disabled = disabled; return this; }
	setSection(): this { return this; }
	setIsLabel(): this { return this; }
	onClick(cb: (evt: MouseEvent) => unknown): this { this.callback = cb; return this; }
	setSubmenu(): Menu { return new Menu(); }
}

/**
 * Not rendered, but menus ARE tracked: the hover-pin mechanism
 * (renderHoverPin.ts) hangs on `onHide`, and a menu that never reported hiding
 * would leak the pin count and pin the strips open forever. Tests drive entries
 * through `Menu.opened` / `clickItem`.
 */
export class Menu {
	static opened: Menu[] = [];
	items: MenuItem[] = [];
	private hideCbs: (() => void)[] = [];
	addItem(cb: (item: MenuItem) => void): this {
		const item = new MenuItem();
		cb(item);
		this.items.push(item);
		return this;
	}
	addSeparator(): this { return this; }
	setNoIcon(): this { return this; }
	onHide(cb: () => void): this { this.hideCbs.push(cb); return this; }
	showAtMouseEvent(): this { Menu.opened.push(this); return this; }
	showAtPosition(): this { Menu.opened.push(this); return this; }
	hide(): this {
		const i = Menu.opened.indexOf(this);
		if (i >= 0) Menu.opened.splice(i, 1);
		for (const cb of this.hideCbs.splice(0)) cb();
		return this;
	}
	/** Test helper: invoke the entry with this exact title. */
	clickItem(title: string): boolean {
		const item = this.items.find(i => i.title === title);
		if (!item?.callback) return false;
		item.callback(new MouseEvent('click'));
		return true;
	}
}

/**
 * Obsidian injects a real <svg> (a Lucide icon, ~16px square by default) — this
 * used to be just a `data-icon` attribute, on the reasoning that it "keeps
 * every measured box independent of an icon glyph this harness doesn't have."
 * That reasoning broke autoFitColWidth's own measurement code, which queries
 * for `svg, canvas` to detect a rendered diagram/embed in a DATA cell, but
 * matched a HEADER cell's filter-button icon instead (real Obsidian) while
 * matching nothing at all here (the old attribute-only stub) — same "unfaithful
 * shim" pattern already noted elsewhere in this file, just a new instance of
 * it. A real, appropriately-sized (but glyph-less) <svg> keeps that class of
 * measurement code exercised here the same way it runs in production.
 */
export function setIcon(el: HTMLElement, icon: string): void {
	el.dataset.icon = icon;
	const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
	svg.setAttribute('viewBox', '0 0 24 24');
	svg.setAttribute('width', '16');
	svg.setAttribute('height', '16');
	svg.dataset.icon = icon;
	el.appendChild(svg);
}

export class Notice {
	static shown: string[] = [];
	constructor(message: string | DocumentFragment) {
		Notice.shown.push(String(message instanceof DocumentFragment ? message.textContent : message));
	}
	setMessage(): this { return this; }
	hide(): void { /* nothing to hide */ }
}

export class App { }

/** Stub, same treatment as Menu/Notice/setIcon above — no e2e test drives its
 *  real fuzzy-search/open UI, it only needs to exist so xlsxFilePicker.ts's
 *  import resolves when TableBlock gets bundled here. */
export class FuzzySuggestModal<T> {
	constructor(_app: App) { /* stub */ }
	setPlaceholder(_text: string): void { /* stub */ }
	open(): void { /* stub */ }
	close(): void { /* stub */ }
}

/** Stub — same treatment as FuzzySuggestModal above, no e2e test drives the
 *  real desktop-vs-mobile branch tableBlock.ts's openXlsxFileExternally
 *  takes, it only needs to exist so the import resolves. */
export const Platform = { isDesktopApp: true, isMobile: false };

/** Stub — no e2e test opens a real OS file, this only needs to exist (as an
 *  `instanceof`-able class) so tableBlock.ts's import resolves. */
export class FileSystemAdapter {
	getFullPath(normalizedPath: string): string { return normalizedPath; }
}
export class TFile {
	path = '';
	basename = '';
	extension = 'md';
	constructor(path = '') {
		this.path = path;
		this.basename = path.replace(/\.[^.]*$/, '').replace(/^.*\//, '');
		this.extension = /\.([^./]+)$/.exec(path)?.[1] ?? 'md';
	}
}
export class MarkdownView { }
export class Plugin extends Component { }
export class PluginSettingTab { }

/**
 * Faithful enough for xlsxSaveModal.ts's own usage (name/addText/addButton) —
 * real DOM elements, real click/input wiring, unlike the earlier no-op stub
 * this replaced (which only needed to exist for settings.ts's import to
 * resolve; nothing tested a settings-tab row through it). `ButtonComponent`'s
 * setCta/setClass are real class-toggles too, so a test CAN assert on them if
 * it ever needs to, though none currently does.
 */
export class TextComponent {
	inputEl = document.createElement('input');
	private onChangeCb: ((value: string) => void) | null = null;
	constructor() {
		this.inputEl.type = 'text';
		this.inputEl.addEventListener('input', () => this.onChangeCb?.(this.inputEl.value));
	}
	setPlaceholder(text: string): this { this.inputEl.placeholder = text; return this; }
	setValue(value: string): this { this.inputEl.value = value; return this; }
	getValue(): string { return this.inputEl.value; }
	onChange(cb: (value: string) => void): this { this.onChangeCb = cb; return this; }
}

export class ButtonComponent {
	buttonEl = document.createElement('button');
	setButtonText(text: string): this { this.buttonEl.textContent = text; return this; }
	setCta(): this { this.buttonEl.classList.add('mod-cta'); return this; }
	setWarning(): this { this.buttonEl.classList.add('mod-warning'); return this; }
	setClass(cls: string): this { this.buttonEl.classList.add(cls); return this; }
	onClick(cb: (evt: MouseEvent) => unknown): this { this.buttonEl.addEventListener('click', (evt) => void cb(evt)); return this; }
}

/** Real checkbox input, not a stub — settings.ts's ctrlCol visibility toggles
 *  (and any future addToggle usage) need a genuine checked/change round trip
 *  for an e2e test to drive them the way a user's click would. */
export class ToggleComponent {
	toggleEl = document.createElement('input');
	private onChangeCb: ((value: boolean) => void) | null = null;
	constructor() {
		this.toggleEl.type = 'checkbox';
		this.toggleEl.addEventListener('change', () => this.onChangeCb?.(this.toggleEl.checked));
	}
	setValue(value: boolean): this { this.toggleEl.checked = value; return this; }
	getValue(): boolean { return this.toggleEl.checked; }
	onChange(cb: (value: boolean) => void): this { this.onChangeCb = cb; return this; }
}

export class Setting {
	settingEl = document.createElement('div');
	nameEl = document.createElement('div');
	controlEl = document.createElement('div');
	constructor(containerEl?: HTMLElement) {
		this.settingEl.className = 'setting-item';
		this.settingEl.append(this.nameEl, this.controlEl);
		containerEl?.appendChild(this.settingEl);
	}
	setName(name: string): this { this.nameEl.textContent = name; return this; }
	setDesc(desc: string): this {
		const el = document.createElement('div');
		el.textContent = desc;
		this.settingEl.appendChild(el);
		return this;
	}
	setHeading(): this { this.settingEl.classList.add('setting-item-heading'); return this; }
	addText(cb: (c: TextComponent) => void): this {
		const c = new TextComponent();
		cb(c);
		this.controlEl.appendChild(c.inputEl);
		return this;
	}
	addButton(cb: (c: ButtonComponent) => void): this {
		const c = new ButtonComponent();
		cb(c);
		this.controlEl.appendChild(c.buttonEl);
		return this;
	}
	addToggle(cb: (c: ToggleComponent) => void): this {
		const c = new ToggleComponent();
		cb(c);
		this.controlEl.appendChild(c.toggleEl);
		return this;
	}
}

/**
 * Real DOM attach/detach, matching the one respect every caller in this
 * codebase relies on: `open()` makes `contentEl` (and anything a test
 * queries through it) actually present in the document, `close()` removes
 * it — same as the real Modal's overlay lifecycle, just with no backdrop/
 * animation chrome, which no test here needs.
 */
export class Modal {
	app: App;
	contentEl = document.createElement('div');
	titleEl = document.createElement('div');
	modalEl = document.createElement('div');
	constructor(app: App) {
		this.app = app;
		this.modalEl.className = 'modal';
		this.modalEl.append(this.titleEl, this.contentEl);
	}
	setTitle(title: string): this { this.titleEl.textContent = title; return this; }
	open(): void {
		document.body.appendChild(this.modalEl);
		void this.onOpen();
	}
	close(): void {
		this.modalEl.remove();
		this.onClose();
	}
	onOpen(): void | Promise<void> { /* subclasses override */ }
	onClose(): void { /* subclasses override */ }
}

/** Faithful, not a stub: folderInputSuggest.ts's real getSuggestions() reads
 *  `app.vault.getAllFolders`, so a test can drive the actual production
 *  suggest logic end to end. */
export class TFolder {
	children: unknown[] = [];
	constructor(public path: string) { }
	isRoot(): boolean { return this.path === '' || this.path === '/'; }
}

/** The plugin subclasses this for wikilink autocomplete; nothing needs to popup. */
export class AbstractInputSuggest<T> {
	app: unknown;
	textInputEl: HTMLElement;
	constructor(app: unknown, textInputEl: HTMLElement) {
		this.app = app;
		this.textInputEl = textInputEl;
	}
	/**
	 * The real API's selection hook. Present because its ABSENCE broke edit mode
	 * outright rather than merely degrading suggestions: WikilinkInputSuggest calls
	 * onSelect from its constructor, so a missing method threw there, which aborted
	 * the rest of enterEditMode — including the editor's focus() call. The editor
	 * appeared, took no keystrokes, and nothing looked wrong. A shim missing a
	 * method fails in whatever came after it, not where it's missing.
	 */
	onSelect(cb: (value: T, evt: MouseEvent | KeyboardEvent) => void): void {
		this.selectCb = cb;
	}
	protected selectCb: ((value: T, evt: MouseEvent | KeyboardEvent) => void) | null = null;
	/** Test hook: pick a suggestion as the user would. */
	chooseSuggestion(value: T): void {
		this.selectCb?.(value, new MouseEvent('click'));
	}
	setLimit(_n: number): void { /* no popup to limit */ }
	getSuggestions(_query: string): T[] | Promise<T[]> { return []; }
	renderSuggestion(_value: T, _el: HTMLElement): void { /* not rendered */ }
	selectSuggestion(_value: T): void { /* not selectable */ }
	getValue(): string { return ''; }
	setValue(_v: string): void { /* no-op */ }
	close(): void { /* nothing open */ }
}

/** Faithful (not a stub): tableBlock.ts's xlsx-watch feature (refreshXlsxWatch)
 *  registers real 'modify'/'rename'/'delete' listeners and expects them to
 *  actually fire — a no-op stub here would make that whole feature
 *  untestable. Mirrors real Obsidian's `Events` base class (`Vault extends
 *  Events`): `on`/`off`/`offref`/`trigger`, with `trigger` public so a test
 *  can simulate an external file change exactly the way `renderReal`/
 *  `renderFull` already call other real production functions directly. */
class FakeEvents {
	private listeners = new Map<string, Set<(...args: unknown[]) => unknown>>();
	on(name: string, cb: (...args: unknown[]) => unknown): { name: string; cb: (...args: unknown[]) => unknown } {
		let set = this.listeners.get(name);
		if (!set) { set = new Set(); this.listeners.set(name, set); }
		set.add(cb);
		return { name, cb };
	}
	off(name: string, cb: (...args: unknown[]) => unknown): void {
		this.listeners.get(name)?.delete(cb);
	}
	offref(ref: { name: string; cb: (...args: unknown[]) => unknown }): void {
		this.listeners.get(ref.name)?.delete(ref.cb);
	}
	trigger(name: string, ...args: unknown[]): void {
		for (const cb of this.listeners.get(name) ?? []) cb(...args);
	}
}

/**
 * In-memory stand-in for the slice of the vault the write-back path uses: read a
 * file's text, and rewrite it inside a callback (Obsidian's `process` is an atomic
 * read-modify-write, and the plugin depends on that sequencing). Also backs the
 * xlsx-source feature: binary files (readBinary) and the modify/rename/delete
 * events tableBlock.ts's xlsx-watch feature depends on.
 */
export class FakeVault extends FakeEvents {
	files = new Map<string, string>();
	/** Binary (.xlsx) files, seeded directly by a test — see readBinary. */
	binaryFiles = new Map<string, ArrayBuffer>();
	/** Test-only knob for simulating a file locked by another program (e.g. the
	 *  real .xlsx open in Excel) — see modifyBinary. A path in this set makes
	 *  the NEXT modifyBinary call for it throw instead of succeeding, matching
	 *  the real Vault.modifyBinary rejecting on an OS-level file lock. */
	lockedBinaryPaths = new Set<string>();
	/** Folders created via createFolder OR implied by an existing file's own
	 *  path (a real vault always has every ancestor folder of a file that
	 *  exists in it) — backs getAllFolders/getAbstractFileByPath's folder
	 *  branch. Seeded with '' (the root) since every vault has one. */
	private folders = new Set<string>(['']);
	/** Backs the desktop-only native-save-dialog path in xlsxSaveModal.ts —
	 *  a plain object (not a real FileSystemAdapter instance) is enough since
	 *  every call site only ever reads .getBasePath(), never `instanceof`s it. */
	adapter = { getBasePath: () => '/fake/vault' };

	private ensureFolder(path: string): void {
		let p = path;
		while (p && !this.folders.has(p)) {
			this.folders.add(p);
			p = p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '';
		}
	}

	/**
	 * Returns a real TFile (or TFolder), not a look-alike: the write-back path
	 * guards with `instanceof TFile` and simply returns when it fails, so a
	 * plain object with the right shape makes every write silently do nothing
	 * — no error, no clue.
	 */
	getAbstractFileByPath(path: string): TFile | TFolder | null {
		if (this.files.has(path) || this.binaryFiles.has(path)) return new TFile(path);
		if (this.folders.has(path)) return new TFolder(path);
		return null;
	}
	async read(file: TFile): Promise<string> {
		return this.files.get(file.path) ?? '';
	}
	async readBinary(file: TFile): Promise<ArrayBuffer> {
		const buf = this.binaryFiles.get(file.path);
		if (!buf) throw new Error(`FakeVault.readBinary: no binary file at ${file.path}`);
		return buf;
	}
	/** Matches the real signature: the callback receives current content and returns the new content. */
	async process(file: TFile, fn: (data: string) => string): Promise<string> {
		const next = fn(this.files.get(file.path) ?? '');
		this.files.set(file.path, next);
		return next;
	}
	/** Backs tableBlock.ts's captureSnapshot save-png path AND the xlsx-export
	 *  feature's vault-relative write path. Throws on an existing path — same
	 *  as the real Vault.createBinary — so exportToXlsx's own overwrite-
	 *  confirmation flow (checked via getAbstractFileByPath BEFORE this is
	 *  ever called) has something real to be protecting against. */
	async createBinary(path: string, data: ArrayBuffer): Promise<TFile> {
		if (this.binaryFiles.has(path) || this.files.has(path)) throw new Error(`FakeVault.createBinary: ${path} already exists`);
		this.ensureFolder(path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '');
		this.binaryFiles.set(path, data);
		return new TFile(path);
	}
	/** Backs tableBlock.ts's captureSnapshot save-svg path. */
	async create(path: string, data: string): Promise<TFile> {
		this.ensureFolder(path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '');
		this.files.set(path, data);
		return new TFile(path);
	}
	/** Backs the xlsx-export feature's own explicit folder creation (its own
	 *  getAbstractFileByPath check already avoids calling this redundantly). */
	async createFolder(path: string): Promise<TFolder> {
		this.ensureFolder(path);
		return new TFolder(path);
	}
	/** Backs folderInputSuggest.ts's real getSuggestions() — driven end to end
	 *  by an e2e test typing into the export modal's folder field. */
	getAllFolders(includeRoot = false): TFolder[] {
		return [...this.folders].filter(p => includeRoot || p !== '').map(p => new TFolder(p));
	}
	/** Test helper: simulate an external tool overwriting a binary file's bytes,
	 *  then firing the same 'modify' event Obsidian's own file-watcher would. */
	writeBinaryAndNotify(path: string, buf: ArrayBuffer): void {
		this.binaryFiles.set(path, buf);
		this.trigger('modify', new TFile(path));
	}
	/** Real vault.modifyBinary equivalent — an in-place content write to an
	 *  EXISTING file (unlike createBinary, which is for a brand-new one).
	 *  Fires 'modify' the same way Obsidian's own vault mutation does, since
	 *  tableBlock.ts's xlsx WRITE path (phase 1 of xlsx write support) relies
	 *  on exactly that event to trigger the existing refreshXlsxWatch/
	 *  scheduleXlsxRefresh cycle — its OWN write looks indistinguishable from
	 *  an external tool's, by design (see handleXlsxWrite's own doc comment). */
	async modifyBinary(file: TFile, data: ArrayBuffer): Promise<void> {
		if (this.lockedBinaryPaths.has(file.path)) {
			throw new Error(`EBUSY: resource busy or locked, open '${file.path}'`);
		}
		this.binaryFiles.set(file.path, data);
		this.trigger('modify', file);
	}
	/** Test helper: simulate a rename in the file system (move the binary
	 *  content under a new path, then fire 'rename' the way Obsidian would). */
	renameBinaryAndNotify(oldPath: string, newPath: string): void {
		const buf = this.binaryFiles.get(oldPath);
		if (buf) { this.binaryFiles.delete(oldPath); this.binaryFiles.set(newPath, buf); }
		this.trigger('rename', new TFile(newPath), oldPath);
	}
	/** Test helper: simulate deleting the file, then fire 'delete'. */
	deleteBinaryAndNotify(path: string): void {
		this.binaryFiles.delete(path);
		this.trigger('delete', new TFile(path));
	}
}

/** Faithful stand-in for `metadataCache.getFirstLinkpathDest` — resolves a
 *  vault-relative path exactly (both xlsxSource.path and getFullPath's
 *  `file.path` in this codebase are always full vault-relative paths, never
 *  wikilink shorthand needing the real fuzzy/shortest-path resolution). */
export class FakeMetadataCache {
	constructor(private readonly vault: FakeVault) { /* stub */ }
	getFirstLinkpathDest(linkpath: string, _sourcePath: string): TFile | null {
		return this.vault.getAbstractFileByPath(linkpath);
	}
}

/** Backs tableBlock.ts's captureSnapshot save actions — no real attachment-
 *  folder-setting resolution (that's Obsidian's own config, not this
 *  plugin's concern), just returns the requested filename unchanged since
 *  the fake vault has no naming collisions to dedupe in these tests. */
export class FakeFileManager {
	getAvailablePathForAttachment(filename: string, _sourcePath?: string): Promise<string> {
		return Promise.resolve(filename);
	}
}
