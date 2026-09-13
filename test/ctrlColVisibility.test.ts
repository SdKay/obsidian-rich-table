/**
 * Settings-driven visibility for the left-toolbar (`.bt-ctrl-col`) buttons —
 * see model.ts's CtrlColButtonId/CTRL_COL_BUTTONS_BY_SCENARIO and
 * settings.ts's "Left-toolbar buttons" section. Pure data/label-completeness
 * checks; the actual hide-on-click behaviour is covered end-to-end in
 * test/e2e/issues/ctrl-col-visibility/.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import { CTRL_COL_BUTTONS_BY_SCENARIO, ctrlColButtonIcon, type CtrlColButtonId } from '../src/model';
import { DEFAULT_SETTINGS } from '../src/settings';
import { ctrlColButtonLabel, ctrlColScenarioLabel } from '../src/i18n';

describe('CTRL_COL_BUTTONS_BY_SCENARIO', () => {
	it("xlsxRef's own buttons (openExternal/detachXlsx) never appear in the other two scenarios — those callbacks only ever exist for an xlsx-backed table", () => {
		expect(CTRL_COL_BUTTONS_BY_SCENARIO.locked).not.toContain('openExternal');
		expect(CTRL_COL_BUTTONS_BY_SCENARIO.locked).not.toContain('detachXlsx');
		expect(CTRL_COL_BUTTONS_BY_SCENARIO.unlocked).not.toContain('openExternal');
		expect(CTRL_COL_BUTTONS_BY_SCENARIO.unlocked).not.toContain('detachXlsx');
	});

	it('snapshot is the one button available in every scenario, matching onSnapshot\'s own no-gate treatment in renderer.ts', () => {
		expect(CTRL_COL_BUTTONS_BY_SCENARIO.locked).toContain('snapshot');
		expect(CTRL_COL_BUTTONS_BY_SCENARIO.unlocked).toContain('snapshot');
		expect(CTRL_COL_BUTTONS_BY_SCENARIO.xlsxRef).toContain('snapshot');
	});

	it("locked is a subset of unlocked (every button available while locked is also available unlocked)", () => {
		for (const id of CTRL_COL_BUTTONS_BY_SCENARIO.locked) {
			expect(CTRL_COL_BUTTONS_BY_SCENARIO.unlocked).toContain(id);
		}
	});

	it('has a display label for every listed button id, in both languages', () => {
		const allIds = new Set<CtrlColButtonId>([
			...CTRL_COL_BUTTONS_BY_SCENARIO.locked,
			...CTRL_COL_BUTTONS_BY_SCENARIO.unlocked,
			...CTRL_COL_BUTTONS_BY_SCENARIO.xlsxRef,
		]);
		for (const id of allIds) {
			expect(ctrlColButtonLabel(id).length).toBeGreaterThan(0);
		}
	});

	it('has a scenario heading label for all three scenarios', () => {
		for (const scenario of ['locked', 'unlocked', 'xlsxRef'] as const) {
			expect(ctrlColScenarioLabel(scenario).length).toBeGreaterThan(0);
		}
	});
});

describe('DEFAULT_SETTINGS.ctrlColHiddenButtons', () => {
	it('defaults to nothing hidden in any scenario — pre-existing behaviour is unchanged until a user opts in', () => {
		expect(DEFAULT_SETTINGS.ctrlColHiddenButtons).toEqual({ locked: [], unlocked: [], xlsxRef: [] });
	});
});

describe('ctrlColButtonIcon', () => {
	// Cross-checks against renderer.ts's own `setIcon(xBtn, '<icon>')` calls
	// (source text, not a runtime import — renderer.ts's ctrlCol block is deep
	// inside one large function, not worth extracting just for this) so the
	// settings tab's icon can never silently drift from the real button's icon.
	const rendererSrc = readFileSync(join(__dirname, '../src/renderer.ts'), 'utf8');

	function realIconFor(id: CtrlColButtonId, scenario: 'locked' | 'unlocked' | 'xlsxRef'): string {
		const setIconCall: Record<CtrlColButtonId, RegExp> = {
			openExternal: /setIcon\(openBtn, '([\w-]+)'\)/,
			detachXlsx:   /setIcon\(detachBtn, '([\w-]+)'\)/,
			lock:         scenario === 'locked' ? /setIcon\(lockBtn, model\.locked \? '([\w-]+)'/ : /setIcon\(lockBtn, model\.locked \? '[\w-]+' : '([\w-]+)'/,
			autoFit:      /setIcon\(autoFitBtn, '([\w-]+)'\)/,
			transpose:    /setIcon\(transposeBtn, '([\w-]+)'\)/,
			selectAll:    /setIcon\(selectAllBtn, '([\w-]+)'\)/,
			theme:        /setIcon\(themeBtn, '([\w-]+)'\)/,
			aggregate:    /setIcon\(aggBtn, '([\w-]+)'\)/,
			collapse:     /setIcon\(collapseBtn, model\.collapsed \? '[\w-]+' : '([\w-]+)'\)/,
			viewSettings: /setIcon\(settingsBtn, '([\w-]+)'\)/,
			views:        /setIcon\(viewsBtn, '([\w-]+)'\)/,
			newSheet:     /setIcon\(addSheetBtn, '([\w-]+)'\)/,
			snapshot:     /setIcon\(snapshotBtn, '([\w-]+)'\)/,
			exportXlsx:   /setIcon\(exportBtn, '([\w-]+)'\)/,
		};
		const match = setIconCall[id].exec(rendererSrc);
		if (!match?.[1]) throw new Error(`could not find a real setIcon call for "${id}" in renderer.ts`);
		return match[1];
	}

	it('matches the real ctrlCol button\'s own icon, for every button in every scenario it appears in', () => {
		for (const scenario of ['locked', 'unlocked', 'xlsxRef'] as const) {
			for (const id of CTRL_COL_BUTTONS_BY_SCENARIO[scenario]) {
				expect(ctrlColButtonIcon(id, scenario)).toBe(realIconFor(id, scenario));
			}
		}
	});
});
