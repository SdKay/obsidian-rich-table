/**
 * Settings-driven visibility for the left-toolbar (`.bt-ctrl-col`) buttons —
 * see model.ts's CtrlColButtonId/CTRL_COL_BUTTONS_BY_SCENARIO and
 * settings.ts's "Left-toolbar buttons" section. Pure data/label-completeness
 * checks; the actual hide-on-click behaviour is covered end-to-end in
 * test/e2e/issues/ctrl-col-visibility/.
 */
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

	it('snapshot is the one button available in every scenario, matching onSnapshot\'s own no-gate treatment in renderCtrlCol.ts', () => {
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
	it('gives every button in every scenario it appears in an icon, from the one map the toolbar and the settings share', () => {
		for (const scenario of ['locked', 'unlocked', 'xlsxRef'] as const) {
			for (const id of CTRL_COL_BUTTONS_BY_SCENARIO[scenario]) expect(ctrlColButtonIcon(id, scenario).length, `${scenario}/${id}`).toBeGreaterThan(0);
		}
	});

	it('lock and collapse change with the state of the table', () => {
		expect(ctrlColButtonIcon('lock', 'locked')).toBe('lock');
		expect(ctrlColButtonIcon('lock', 'unlocked')).toBe('lock-open');
		expect(ctrlColButtonIcon('collapse', 'unlocked', false)).toBe('fold-vertical');
		expect(ctrlColButtonIcon('collapse', 'unlocked', true)).toBe('unfold-vertical');
	});
});
