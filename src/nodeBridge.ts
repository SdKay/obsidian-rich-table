import { Platform } from 'obsidian';

/**
 * Typed access to the few desktop-only Node/Electron modules the plugin uses.
 * Obsidian's loader only resolves them through a plain synchronous require()
 * (a dynamic import() does not work), and the shapes are declared here rather
 * than taken from `typeof import(...)`, which falls back to `any` wherever the
 * real type packages are not installed.
 */

export interface ElectronShell {
	openPath(path: string): Promise<string>;
}

export interface ElectronRemote {
	dialog: {
		showSaveDialog(options: {
			defaultPath?: string;
			filters?: { name: string; extensions: string[] }[];
		}): Promise<{ canceled: boolean; filePath?: string }>;
	};
}

export interface FsPromises {
	writeFile(path: string, data: Uint8Array): Promise<void>;
}

/** Only call from desktop code paths that are already guarded by `Platform.isDesktop`. */
export function electronShell(): ElectronShell {
	// eslint-disable-next-line @typescript-eslint/no-require-imports -- a dynamic import() does not resolve in Obsidian's desktop runtime
	const mod = require('electron') as unknown as { shell: ElectronShell };
	return mod.shell;
}

export function electronRemote(): ElectronRemote {
	// eslint-disable-next-line @typescript-eslint/no-require-imports -- see electronShell
	const mod = require('electron') as unknown as { remote: ElectronRemote };
	return mod.remote;
}

export function fsPromises(): FsPromises {
	if (!Platform.isDesktop) throw new Error('fs is only available on desktop');
	// eslint-disable-next-line @typescript-eslint/no-require-imports -- see electronShell; the unprefixed 'fs/promises' is the form esbuild.config.mjs lists as external
	const mod: unknown = require('fs/promises');
	return mod as FsPromises;
}
