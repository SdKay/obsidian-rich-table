// Entry point for the browser bundle used by e2e fixtures — re-exports the
// REAL, unmodified source functions under test (not hand-ported copies).
// Bundled by build-bundle.mjs into real-bundle.generated.js (gitignored,
// rebuilt fresh before every e2e run — see playwright.config.ts's
// globalSetup) and exposed on window as `RichTableReal`.
export { parseTable, parseWorkbook, parseSource } from '../../../src/parser';
export { applyFreeze } from '../../../src/renderFreeze';
export { scrollContentOffset } from '../../../src/renderGeometry';
// The whole interactive renderer — hover strips, floating panels, cell editing —
// reachable now that obsidian-shim.ts provides a runtime for the `obsidian`
// module. Previously untestable in any form.
export { renderTable } from '../../../src/renderer';
export { ChoiceRegistry } from '../../../src/choiceRegistry';
// The shim's Component, so a test can hand renderTable a real lifecycle owner.
export { Component as ShimComponent } from './obsidian-shim';
// The hover-pin counter, so a test can assert the pin was released rather than
// inferring it from the strips (which would confuse "released" with "the pointer
// happens to be away").
export { isHoverPinned, getActiveCellMenu } from '../../../src/renderHoverPin';
// The shim's Menu, so a test can see which value-picker menu is open and drive
// its entries. Note the shim renders no menu chrome and attaches no keyboard
// handling of its own — enough to assert this plugin's tracking and close-on-Tab
// wiring, but it cannot tell you whether the REAL Obsidian Menu consumes a
// keystroke before it reaches a document-level listener. That question is settled
// by hand in the app.
export { Menu as ShimMenu } from './obsidian-shim';
export { buildOccupied, getMergeOrigin } from '../../../src/renderGridHelpers';
export { canFreezeRows, canFreezeCols } from '../../../src/operations';
export { cellEffectiveStyle, applyColStyle, applyStyleRulesV2, applyResolvedStyle } from '../../../src/renderCellStyle';

// The write-back layer. Its Obsidian surface is small — a vault that can read and
// rewrite a file, and the line range of the code block within it — so an in-memory
// stand-in is enough to exercise the parts that historically caused trouble:
// rewriting the note, and staying visually continuous across the rebuild Obsidian
// performs afterwards.
export { TableBlock } from '../../../src/tableBlock';
export { FakeVault } from './obsidian-shim';
