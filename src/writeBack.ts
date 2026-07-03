import type { MarkdownPostProcessorContext, MarkdownSectionInformation, TFile, Vault } from 'obsidian';
import type { TableModel } from './model';
import { serializeTable } from './serializer';

/**
 * Serializes the model and replaces the rich-table code block content in the
 * source file via vault.process() (atomic write).
 *
 * `preInfo` should be captured synchronously before any await so the element
 * is still attached.  Inside vault.process, the line numbers are used as a
 * HINT: if the file shifted (due to a prior write), we search the surrounding
 * ±40 lines for the actual fence to avoid corrupting unrelated blocks.
 */
export async function writeBackModel(
	model: TableModel,
	containerEl: HTMLElement,
	ctx: MarkdownPostProcessorContext,
	vault: Vault,
	file: TFile,
	preInfo?: MarkdownSectionInformation | null,
): Promise<void> {
	const info = preInfo ?? ctx.getSectionInfo(containerEl);
	if (!info) return;

	const serialized = serializeTable(model);

	await vault.process(file, content => {
		const lines = content.split('\n');

		// Use info.lineStart as a hint; search nearby if the file shifted.
		let lineStart = info.lineStart;
		if (!isRichTableFence(lines[lineStart])) {
			const low  = Math.max(0, lineStart - 40);
			const high = Math.min(lines.length - 1, lineStart + 40);
			let nearest = -1, nearestDist = Infinity;
			for (let i = low; i <= high; i++) {
				if (isRichTableFence(lines[i])) {
					const d = Math.abs(i - lineStart);
					if (d < nearestDist) { nearestDist = d; nearest = i; }
				}
			}
			if (nearest < 0) return content; // block not found — abort to avoid corruption
			lineStart = nearest;
		}

		// Find the matching closing fence starting from lineStart+1.
		let lineEnd = -1;
		for (let i = lineStart + 1; i < lines.length; i++) {
			if (isClosingFence(lines[i])) { lineEnd = i; break; }
		}
		if (lineEnd < 0) return content; // malformed block — abort

		return [
			...lines.slice(0, lineStart + 1),   // keep opening ```rich-table line
			...serialized.split('\n'),            // new content
			...lines.slice(lineEnd),              // keep closing ``` line and beyond
		].join('\n');
	});
}

function isRichTableFence(line: string | undefined): boolean {
	return /^```rich-table\s*$/.test(line ?? '');
}

function isClosingFence(line: string | undefined): boolean {
	return /^```\s*$/.test(line ?? '');
}
