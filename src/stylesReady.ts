/**
 * Obsidian reads a plugin's styles.css only after the plugin's onload, so a note that is already open
 * gets its tables drawn before the stylesheet is there. Anything measured then (an auto column's width,
 * the space the strips need) comes out wrong, and anything with a transition fades from the values it
 * had without the stylesheet. This waits for the stylesheet.
 */
export interface StylesReadyOptions {
	/** True once the stylesheet styles the element in question. */
	isReady: () => boolean;
	nextFrame: (fn: () => void) => void;
	/** Frames to wait before giving up; the table stays hidden without the stylesheet anyway. */
	maxFrames?: number;
}

/** Runs `fn` now if the stylesheet is there, otherwise in the first frame it is, or never. */
export function whenStylesReady(fn: () => void, { isReady, nextFrame, maxFrames = 120 }: StylesReadyOptions): void {
	if (isReady()) { fn(); return; }
	let left = maxFrames;
	const check = (): void => {
		if (isReady()) { fn(); return; }
		if (--left > 0) nextFrame(check);
	};
	nextFrame(check);
}

/** Whether the plugin's stylesheet is styling `shell`: it is what makes a shell visible (styles.css). */
export const shellStyled = (shell: HTMLElement): boolean =>
	shell.isConnected && getComputedStyle(shell).visibility === 'visible';
