import type { MarkdownPostProcessorContext, TFile, Vault } from 'obsidian';
import type { TableModel } from './model';
import { serializeTable } from './serializer';

/**
 * Serializes the model and replaces the rich-table code block content in the source file.
 * Uses vault.process() for atomic, race-free writes.
 */
export async function writeBackModel(
	model: TableModel,
	containerEl: HTMLElement,
	ctx: MarkdownPostProcessorContext,
	vault: Vault,
	file: TFile,
): Promise<void> {
	const info = ctx.getSectionInfo(containerEl);
	if (!info) return;

	const serialized = serializeTable(model);

	await vault.process(file, content => {
		const lines = content.split('\n');
		return [
			...lines.slice(0, info.lineStart + 1),   // keep opening ```rich-table line
			...serialized.split('\n'),                // new content
			...lines.slice(info.lineEnd),             // keep closing ``` line and beyond
		].join('\n');
	});
}
