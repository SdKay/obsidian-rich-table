// Entry point for the browser bundle used by e2e fixtures — re-exports the
// REAL, unmodified source functions under test (not hand-ported copies).
// Bundled by build-bundle.mjs into real-bundle.generated.js (gitignored,
// rebuilt fresh before every e2e run — see playwright.config.ts's
// globalSetup) and exposed on window as `RichTableReal`.
export { parseTable, parseWorkbook, parseSource } from '../../../src/parser';
export { applyFreeze } from '../../../src/renderFreeze';
export { buildOccupied, getMergeOrigin } from '../../../src/renderGridHelpers';
export { canFreezeRows, canFreezeCols } from '../../../src/operations';
export { cellEffectiveStyle, applyColStyle, applyStyleRulesV2, applyResolvedStyle } from '../../../src/renderCellStyle';
