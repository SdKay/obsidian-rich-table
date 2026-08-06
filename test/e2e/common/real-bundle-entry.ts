// Entry point for the browser bundle used by e2e fixtures — re-exports the
// REAL, unmodified source functions under test (not hand-ported copies).
// Bundled by build-bundle.mjs into real-bundle.generated.js (gitignored,
// rebuilt fresh before every e2e run — see playwright.config.ts's
// globalSetup) and exposed on window as `RichTableReal`.
export { parseTable, parseWorkbook, parseSource } from '../../../src/parser';
export { applyFreeze } from '../../../src/renderFreeze';
// The whole interactive renderer — hover strips, floating panels, cell editing —
// reachable now that obsidian-shim.ts provides a runtime for the `obsidian`
// module. Previously untestable in any form.
export { renderTable } from '../../../src/renderer';
export { ChoiceRegistry } from '../../../src/choiceRegistry';
// The shim's Component, so a test can hand renderTable a real lifecycle owner.
export { Component as ShimComponent } from './obsidian-shim';
export { buildOccupied, getMergeOrigin } from '../../../src/renderGridHelpers';
export { canFreezeRows, canFreezeCols } from '../../../src/operations';
export { cellEffectiveStyle, applyColStyle, applyStyleRulesV2, applyResolvedStyle } from '../../../src/renderCellStyle';
