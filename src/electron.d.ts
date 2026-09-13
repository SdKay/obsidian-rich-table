/**
 * Minimal ambient declaration for the handful of Electron APIs this plugin
 * actually calls — `electron` itself is already `external` in
 * esbuild.config.mjs, same treatment as `obsidian` — it's provided by
 * Obsidian's own desktop runtime, never bundled. Declaring just these
 * surfaces avoids adding the real `electron` package (and its full type
 * surface) as a devDependency for a handful of method calls.
 */
declare module 'electron' {
	export const shell: {
		openPath(path: string): Promise<string>;
	};
	/**
	 * `remote` is Electron's pre-v14 renderer→main bridge, removed as a
	 * default-on feature everywhere except Obsidian's own desktop app, which
	 * still enables it for its main window (confirmed working precedent: the
	 * community "Webpage HTML Export" plugin ships `require('electron').remote.dialog`
	 * for its own save/folder pickers). Unsupported/undocumented by Obsidian —
	 * see tableBlock.ts's `exportToXlsx` for why every call site through this
	 * must have a working fallback rather than assuming it never throws.
	 */
	export const remote: {
		dialog: {
			showSaveDialog(options: {
				defaultPath?: string;
				filters?: { name: string; extensions: string[] }[];
			}): Promise<{ canceled: boolean; filePath?: string }>;
		};
	};
}
