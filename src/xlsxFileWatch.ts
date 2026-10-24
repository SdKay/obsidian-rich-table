import type { EventRef, TAbstractFile, Vault } from 'obsidian';

export const XLSX_REFRESH_DELAY_MS = 400;

export interface XlsxFileWatch {
	stop(): void;
}

export interface XlsxFileWatchHandlers {
	/** The file changed or was deleted. Calls inside one delay window collapse into one. */
	onRefresh(): void;
	/** The file itself was renamed. Immediate, not debounced. */
	onRenamed?(file: TAbstractFile): void;
}

type WatchedVault = Pick<Vault, 'on' | 'offref'>;

/**
 * Watches one vault file. An external editor can save several times for one edit, so
 * modify and delete are debounced; a rename is a single deliberate action and is not.
 */
export function watchXlsxFile(vault: WatchedVault, path: string, handlers: XlsxFileWatchHandlers): XlsxFileWatch {
	let timer: number | null = null;
	const scheduleRefresh = (): void => {
		if (timer !== null) window.clearTimeout(timer);
		timer = window.setTimeout(() => {
			timer = null;
			handlers.onRefresh();
		}, XLSX_REFRESH_DELAY_MS);
	};
	const refs: EventRef[] = [
		vault.on('modify', (file: TAbstractFile) => { if (file.path === path) scheduleRefresh(); }),
		vault.on('delete', (file: TAbstractFile) => { if (file.path === path) scheduleRefresh(); }),
		vault.on('rename', (file: TAbstractFile, oldPath: string) => { if (oldPath === path) handlers.onRenamed?.(file); }),
	];
	return {
		stop() {
			for (const ref of refs) vault.offref(ref);
			if (timer !== null) window.clearTimeout(timer);
			timer = null;
		},
	};
}
