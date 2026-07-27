import type { ChoiceRegistry } from './choiceRegistry';

/**
 * Renders a field's value into `container` — plain text for an untyped
 * column, or the same colored choice-pill markup renderCell.ts's data-cell
 * renderer uses when `colType` is a registered choice type (task-status,
 * priority, custom types, …). Shared by Kanban's card fields and Calendar's
 * event fields so a typed value (e.g. "high" priority) keeps its usual
 * colored pill wherever it's shown, instead of reading as plain text next to
 * its own colored dot everywhere else in the table.
 *
 * Deliberately read-only: no click-to-change dropdown, no per-cell style/
 * markdown — those stay the existing v1 simplification for card/event
 * fields (see the "plain text" comment on Kanban's cardFieldCols). This only
 * upgrades the VISUAL of an already-resolved value, not its interactivity.
 */
export function renderTypedFieldValue(
	container: HTMLElement, colType: string | undefined, value: string, registry: ChoiceRegistry,
): void {
	const choiceType = colType ? registry.get(colType) : undefined;
	if (!choiceType) {
		container.createSpan({ text: value });
		return;
	}
	const option = registry.getOption(colType!, value);
	const pill = container.createSpan({ cls: 'bt-choice' });
	if (option) {
		if (option.color) pill.setCssProps({ '--bt-choice-bg': option.color });
		pill.setText(option.label ?? option.value);
	} else {
		pill.addClass('bt-choice-unknown');
		pill.createSpan({ cls: 'bt-choice-warn-icon', text: '⚠' });
		pill.createSpan({ text: value });
	}
}
