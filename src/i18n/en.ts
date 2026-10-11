/** English: the source of truth. Every other language must define exactly these keys. */
export const en = {
	// Cell operations
	unmergeCells:    'Unmerge cells',
	insertRowAbove:  'Insert row above',
	insertRowBelow:  'Insert row below',
	insertColBefore: 'Insert column before',
	insertColAfter:  'Insert column after',
	mergeCells:      'Merge cells',
	splitCellRow:    'Split into 2 rows',
	splitCellCol:    'Split into 2 columns',
	hideRow:         'Hide row',
	hideColumn:      'Hide column',
	deleteRow:       'Delete row',
	deleteColumn:    'Delete column',
	align:           'Align',
	alignLeft:       'Align left',
	alignCenter:     'Align center',
	alignRight:      'Align right',
	alignClear:      'Clear alignment',
	copyToExcel:     'Copy as Excel/rich-table',
	copyToMarkdown:  'Copy as Markdown',
	copyFailed:      'Copy failed — clipboard access was denied',
	pasteFailed:     'Paste failed — clipboard access was denied',

	// Style panel
	background:  'Background',
	textColor:   'Text color',
	fontSize:    'Font size',
	bold:        'Bold',
	italic:      'Italic',
	clearFormat: 'Clear format',
	apply:       'Apply',

	// Type section
	noType:  'No type',
	setType: 'Set type',

	// Template banner
	templatePreview: 'Hover a button to preview, click to insert',
	insertTemplate:  'Insert template',
	insertBlankTable: 'Insert blank table',
	gridPickerRows:   'Rows',
	gridPickerCols:   'Columns',
	gridPickerInsert: 'Insert',
	importFromXlsx:      'Import from .xlsx',
	xlsxPickerPlaceholder: 'Choose a .xlsx file…',
	noXlsxFilesInVault:  'No .xlsx files found in this vault',
	xlsxImportPreviewHint: 'Pick a .xlsx file — its own content will show once inserted',
	openInDefaultApp:    'Open in default app',
	openInDefaultAppUnsupported: 'Opening in the default app is only supported on desktop',
	openInDefaultAppFailed: 'Could not open the file',
	detachFromXlsx:      'Convert to plain table (stop referencing the file)',
	snapshotButton:      'Snapshot',
	snapshotCopyPng:     'Copy image',
	snapshotSavePng:     'Save image (PNG) to vault',
	snapshotSaveSvg:     'Save vector (SVG) to vault',
	snapshotCopied:      'Copied to clipboard',
	snapshotSaved:       'Saved',
	snapshotFailed:      'Snapshot failed',
	xlsxWriteFailed:     'Could not save to the .xlsx file (it may be open in another program)',
	exportToXlsx:        'Export as .xlsx',
	exportXlsxModalTitle: 'Export as .xlsx',
	exportXlsxInVault:   'In this vault',
	exportXlsxFolder:    'Folder',
	exportXlsxFolderPlaceholder: 'Vault folder (leave empty for vault root)',
	exportXlsxFilename:  'File name',
	exportXlsxSubmit:    'Export',
	exportXlsxCustomLocation: 'Custom location',
	exportXlsxCustomLocationDesc: 'Opens your system\'s save dialog and exports as soon as you confirm a location there.',
	exportXlsxBrowse:    'Choose location…',
	exportXlsxFilenameRequired: 'Enter a file name',
	exportXlsxFailed:    'Export failed',
	exportXlsxSaved:     'Exported to',
	exportXlsxOverwriteTitle: 'File already exists',
	exportXlsxOverwriteBody: 'already exists. Overwrite it?',
	exportXlsxOverwrite: 'Overwrite',
	exportXlsxCancel:    'Cancel',

	// Editable title / footer
	clickToEditTitle:  'Click to edit title',
	clickToEditFooter: 'Click to edit footer',

	// Reorder gesture hints
	dragReorderCol: 'Long-press the selected columns and drag to reorder, or Ctrl/Cmd+drag, or Alt+Shift+Left/Right',
	dragReorderRow: 'Long-press the selected rows and drag to reorder, or Ctrl/Cmd+drag, or Alt+Shift+Up/Down',

	// Choice pill
	changeValue: 'Change value',

	// Row/col actions menu
	rowAndColActions: 'Row and column actions',

	// Row filtering
	filterColumn:   'Filter column',
	filterSelectAll: 'Select all',
	filterClear:    'Clear filter',
	filterActive:   'filter active',

	// Row sorting (menu items in the column-selector popup)
	sortAscending:        'Sort ascending',
	sortDescending:       'Sort descending',
	keepSortedAscending:  'Keep sorted ascending',
	keepSortedDescending: 'Keep sorted descending',
	clearLiveSort:        'Clear live sort',

	// Table lock
	lockTable:   'Lock table (disable graphical editing)',
	unlockTable: 'Unlock table (enable graphical editing)',

	// Auto-fit all
	autoFitAll: 'Auto-fit all column widths and row heights',

	// Zoom (status bar widget)
	zoomOut: 'Zoom out',
	zoomIn:  'Zoom in',

	// Transpose
	transposeTable: 'Transpose rows and columns',

	// Select-all (ctrlCol button — selects every cell and opens the range menu)
	selectAllOpenMenu: 'Select all and open menu',

	// Theme picker (individual theme names live in @theme-label-en/zh CSS comments)
	changeTheme:      'Change table theme',
	themeDefault:     'Default',

	// Collapse/expand
	collapseTable: 'Collapse table',
	expandTable:   'Expand table',

	// Summary/aggregate row (menu items in the column-selector popup, and the
	// row-label cell of the rendered summary row)
	aggSum:   'Sum',
	aggAvg:   'Average',
	aggMin:   'Min',
	aggMax:   'Max',
	aggCount: 'Count',
	aggMore:  'More statistics',
	clearAggregate:  'Remove this summary row',
	dragReorderAgg:  'Ctrl/Cmd+drag to reorder summary rows',
	reorderBlocked_sort: 'Can\'t drag-reorder rows while a live sort is on',
	reorderBlocked_freeze: 'Frozen rows/columns can\'t be dragged — unfreeze them first',
	reorderBlocked_hidden: 'Can\'t drag-reorder while rows/columns are hidden',
	reorderBlocked_merge: 'Select the whole merged cell to drag it',

	// Views (table / kanban / calendar switcher)
	views:            'Views',
	defaultTableView: 'Table',
	newKanbanView:    'New kanban view: group by',
	newCalendarView:  'New calendar view: dates from',
	deleteView:       'Delete this view',
	kanbanNoGroupCol: 'This view\'s group-by column no longer exists. Switch it from the views menu.',
	kanbanNoValue:    'No value',
	calendarNoDateCol: 'This view\'s date column no longer exists. Switch it from the views menu.',
	untitledView:     'Untitled view',
	untitledEvent:    'Untitled',

	// Calendar view
	calendarPrevMonth:  'Previous month',
	calendarNextMonth:  'Next month',
	calendarToday:      'Jump to today',
	calendarUnscheduled: 'Unscheduled',

	// Sheet tabs (multi-sheet workbooks)
	newSheet:      'New sheet',
	renameSheet:   'Rename sheet',
	deleteSheet:   'Delete sheet',
	sheetTabStyle: 'Set tab style',

	// Freeze rows/columns
	freezeHeaderOnly: 'Freeze header row',
	freezeUpToRow:    'Freeze up to this row',
	unfreezeRows:     'Unfreeze rows',
	freezeUpToCol:    'Freeze up to this column',
	unfreezeCols:     'Unfreeze columns',
	freezeBlockedByMerge: "Can't freeze here — a merged cell crosses this boundary",
	// View settings
	viewSettings:  'View settings',
	autoWidth:     'Auto width',
	autoHeight:    'Auto height',
	showStatusBar: 'Show status bar',
	addTitle:      'Add title',
	addFooter:     'Add footer',
	titlePlaceholder:  'Title',
	footerPlaceholder: 'Footer',

	// Command palette / ribbon / editor context menu — inserting a brand-new
	// block (as opposed to editing an existing table, everything above)
	insertRichTableBlock: 'Insert rich-table block',
	convertToRichTable: 'Convert to rich-table',

	// Cell editor context menu
	menuCut: 'Cut',
	menuCopy: 'Copy',
	menuPaste: 'Paste',
	menuSelectAll: 'Select all',
	menuHighlight: 'Highlight',
	highlightRed: 'Red',
	highlightOrange: 'Orange',
	highlightYellow: 'Yellow',
	highlightGreen: 'Green',
	highlightBlue: 'Blue',
	highlightPurple: 'Purple',

	// Settings tab
	settingAllowReadingViewEditName: 'Allow editing in reading view',
	settingAllowReadingViewEditDesc:
		'When off (default), all interactive behaviour — hover selector strips, ' +
		'click-to-edit, double-click panels, choice dropdowns — is disabled in ' +
		"Obsidian's reading view. Live preview / source mode is always interactive.",
	settingSingleClickEditName: 'Single-click to edit',
	settingSingleClickEditDesc:
		'When on, a single click on a cell enters edit mode immediately (no ~200ms delay), ' +
		'and the style panel opens with Ctrl/Cmd+click instead of double-click. Speeds up ' +
		'rapid consecutive editing. When off (default), single click enters edit after a short ' +
		'delay and double click opens the style panel.',
	settingDefaultThemeName: 'Default theme for new tables',
	settingDefaultThemeDesc:
		'Theme given to a blank table you insert and to a Markdown table you convert. Built-in templates keep their own look, and you can still change any table\'s theme from its left toolbar.',
	settingCtrlColHeading: 'Left-toolbar buttons',
	settingCtrlColDesc:
		'Choose which left-toolbar buttons show, separately for a locked table, an unlocked ' +
		'table, and a table backed by an external .xlsx file — each scenario only ever offers ' +
		'the buttons that actually apply to it.',
	ctrlColScenarioLocked:   'Locked table',
	ctrlColScenarioUnlocked: 'Unlocked table',
	ctrlColScenarioXlsxRef:  'External .xlsx table',
	ctrlColBtnOpenExternal: 'Open in default app',
	ctrlColBtnDetachXlsx:   'Convert to plain table',
	ctrlColBtnLock:         'Lock / unlock',
	ctrlColBtnAutoFit:      'Auto-fit all',
	ctrlColBtnTranspose:    'Transpose',
	ctrlColBtnSelectAll:    'Select all',
	ctrlColBtnTheme:        'Change theme',
	ctrlColBtnAggregate:    'Summary row',
	ctrlColBtnCollapse:     'Collapse / expand',
	ctrlColBtnViewSettings: 'View settings',
	ctrlColBtnViews:        'Views',
	ctrlColBtnNewSheet:     'New sheet',
	ctrlColBtnSnapshot:     'Snapshot',
	ctrlColBtnExportXlsx:   'Export as .xlsx',

	settingBuiltinTypes:     'Built-in types',
	settingDatePickerDesc:   'Date picker (YYYY-MM-DD)',
	settingCustomTypes:      'Custom types',
	settingAddType:          'Add type',
	settingTypeId:           'Type ID',
	settingTypeIdPlaceholder: 'My-type',
	settingDeleteType:       'Delete type',
	settingOptionsHeader:    'Options (value · display label · color)',
	settingAddOption:        'Add option',
	settingOptionValuePlaceholder: 'Value',
	settingOptionLabelPlaceholder: 'Label',
	settingDeleteOption:     'Delete option',
	settingDefaultOptionLabel: 'Option 1 (edit me)',

	// Changelog
	showChangelogCommand: 'Show changelog',
	changelogTitle:       "What's new in Rich Table",
	settingChangelogName: 'Changelog',
	settingChangelogDesc: 'See what changed in recent releases.',
	settingChangelogButton: 'View changelog',

	// Templates with {placeholders}, filled by fmt()
	tableVersionTooHigh: 'This table was saved with Rich Table format v{tableV}, but the installed plugin only supports up to v{curV}. Please upgrade the plugin.',
	gridSize:            '{rows} × {cols} table',
	rowOne:              'row',
	rowRange:            'rows {from}–{to}',
	colOne:              'column',
	colRange:            'cols {from}–{to}',
	hideRows:            'Hide {range}',
	hideCols:            'Hide {range}',
	deleteRows:          'Delete {range}',
	deleteCols:          'Delete {range}',
	typeWithName:        'Type: {type}',
	collapsedHint:       'Table collapsed · click to expand',
	statsTotal:          '{rows} rows × {cols} cols',
	statsSelected:       'Selected {rows} × {cols}',
	statsSum:            'Sum: {sum}',
	statsAvg:            'Avg: {avg}',
	sortedAsc:           'Sorted by "{name}" (ascending) · click to clear',
	sortedDesc:          'Sorted by "{name}" (descending) · click to clear',
	calendarMore:        '+{n} more',
	sheetFallback:       'Sheet {n}',
	xlsxNotFound:        'xlsx file not found: {path}',
	upgradeBannerText:   'This table uses an older format. The new format supports more features. Converting will update the code block — you can undo with Ctrl+Z.',
	upgradeBannerConvert: 'Convert to new format',
	upgradeBannerKeep:   'Keep old format',
	openCommunityStore:  'Open in Community Store',
} as const;

export type Dict = { [K in keyof typeof en]: string };
