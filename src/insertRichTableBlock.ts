export interface EditorPosition {
	line: number;
	ch: number;
}

export interface InsertRichTableBlockPlan {
	text: string;
	cursorAfter: EditorPosition;
}

/**
 * Pure planning for "insert an empty rich-table block at the cursor" —
 * kept free of Obsidian's real Editor type so it's testable without the
 * runtime (same reasoning as cellNav.ts/renderFreezePlan.ts). main.ts applies
 * the result via editor.replaceRange/setCursor.
 *
 * A fenced code block's delimiters must each own their own line, so
 * inserting mid-line has to split whatever's there (before-cursor text stays
 * on its own line, after-cursor text starts a new one after the closing
 * fence) rather than sharing a line with either fence — a closing fence with
 * trailing content on the same line isn't recognized as a fence at all,
 * which would swallow the rest of the note into the code block.
 */
export function planRichTableBlockInsertion(cursor: EditorPosition, lineText: string): InsertRichTableBlockPlan {
	const onEmptyLineStart = cursor.ch === 0 && lineText.trim() === '';
	const prefix = onEmptyLineStart ? '' : '\n';
	const text = `${prefix}\`\`\`rich-table\n\n\`\`\`\n`;
	// The blank line between the two fences, where the template-picker
	// banner (an empty block renders one, see tableBlock.ts's isEmpty) ends
	// up, and the one sensible cursor spot in plain source mode.
	const blankLineOffset = onEmptyLineStart ? 1 : 2;
	return { text, cursorAfter: { line: cursor.line + blankLineOffset, ch: 0 } };
}
