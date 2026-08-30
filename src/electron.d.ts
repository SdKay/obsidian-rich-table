/**
 * Minimal ambient declaration for the one Electron API this plugin actually
 * calls (tableBlock.ts's openXlsxFileExternally — desktop-only "open in
 * default app" for an xlsx-backed table). `electron` itself is already
 * `external` in esbuild.config.mjs, same treatment as `obsidian` — it's
 * provided by Obsidian's own desktop runtime, never bundled. Declaring just
 * this one surface avoids adding the real `electron` package (and its full
 * type surface) as a devDependency for a single method call.
 */
declare module 'electron' {
	export const shell: {
		openPath(path: string): Promise<string>;
	};
}
