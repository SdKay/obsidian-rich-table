import { getLanguage } from 'obsidian';
import type { CtrlColButtonId } from './model';

export function isZh(): boolean {
	return getLanguage().startsWith('zh');
}

const EN = {
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

	// Drag handles
	dragReorderCol: 'Drag to reorder column',
	dragReorderRow: 'Drag to reorder row',

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
	dragReorderAgg:  'Drag to reorder summary rows',

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
	pinStatusBar:  'Pin status bar',
	addTitle:      'Add title',
	addFooter:     'Add footer',
	titlePlaceholder:  'Title',
	footerPlaceholder: 'Footer',

	// Command palette / ribbon / editor context menu — inserting a brand-new
	// block (as opposed to editing an existing table, everything above)
	insertRichTableBlock: 'Insert rich-table block',
	convertToRichTable: 'Convert to rich-table',

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
} as const;

const ZH: { [K in keyof typeof EN]: string } = {
	unmergeCells:    '取消合并',
	insertRowAbove:  '在上方插入行',
	insertRowBelow:  '在下方插入行',
	insertColBefore: '在左侧插入列',
	insertColAfter:  '在右侧插入列',
	mergeCells:      '合并单元格',
	splitCellRow:    '拆分为两行',
	splitCellCol:    '拆分为两列',
	hideRow:         '隐藏行',
	hideColumn:      '隐藏列',
	deleteRow:       '删除行',
	deleteColumn:    '删除列',
	align:           '对齐',
	alignLeft:       '左对齐',
	alignCenter:     '居中',
	alignRight:      '右对齐',
	alignClear:      '取消对齐',
	copyToExcel:     '复制为Excel/rich-table',
	copyToMarkdown:  '复制为 Markdown',
	copyFailed:      '复制失败——剪贴板访问被拒绝',
	pasteFailed:     '粘贴失败——剪贴板访问被拒绝',

	background:  '背景色',
	textColor:   '字体颜色',
	fontSize:    '字体大小',
	bold:        '粗体',
	italic:      '斜体',
	clearFormat: '清除格式',
	apply:       '应用',

	noType:  '无类型',
	setType: '设置类型',

	templatePreview: '悬停按钮预览，点击插入',
	insertTemplate:  '插入模板',
	insertBlankTable: '插入空白表格',
	gridPickerRows:   '行数',
	gridPickerCols:   '列数',
	gridPickerInsert: '插入',
	importFromXlsx:      '从 .xlsx 导入',
	xlsxPickerPlaceholder: '选择一个 .xlsx 文件…',
	noXlsxFilesInVault:  '当前仓库中没有找到 .xlsx 文件',
	xlsxImportPreviewHint: '选择一个 .xlsx 文件——插入后将显示其自身内容',
	openInDefaultApp:    '用默认应用打开',
	openInDefaultAppUnsupported: '用默认应用打开仅支持桌面端',
	openInDefaultAppFailed: '无法打开该文件',
	detachFromXlsx:      '转为普通表格（不再引用该文件）',
	snapshotButton:      '生成快照',
	snapshotCopyPng:     '复制图片',
	snapshotSavePng:     '保存图片（PNG）到 vault',
	snapshotSaveSvg:     '保存矢量图（SVG）到 vault',
	snapshotCopied:      '已复制到剪贴板',
	snapshotSaved:       '已保存',
	snapshotFailed:      '生成快照失败',
	xlsxWriteFailed:     '无法保存到该 .xlsx 文件（可能正被其他程序占用）',
	exportToXlsx:        '导出为 .xlsx',
	exportXlsxModalTitle: '导出为 .xlsx',
	exportXlsxInVault:   'Vault 内',
	exportXlsxFolder:    '文件夹',
	exportXlsxFolderPlaceholder: 'vault 内文件夹（留空表示 vault 根目录）',
	exportXlsxFilename:  '文件名',
	exportXlsxSubmit:    '导出',
	exportXlsxCustomLocation: '自定义位置',
	exportXlsxCustomLocationDesc: '打开系统的保存对话框，在那里确认位置后立即导出。',
	exportXlsxBrowse:    '选择位置…',
	exportXlsxFilenameRequired: '请输入文件名',
	exportXlsxFailed:    '导出失败',
	exportXlsxSaved:     '已导出到',
	exportXlsxOverwriteTitle: '文件已存在',
	exportXlsxOverwriteBody: '已存在，是否覆盖？',
	exportXlsxOverwrite: '覆盖',
	exportXlsxCancel:    '取消',

	clickToEditTitle:  '点击编辑标题',
	clickToEditFooter: '点击编辑备注',

	dragReorderCol: '拖拽调整列顺序',
	dragReorderRow: '拖拽调整行顺序',

	changeValue: '切换值',

	rowAndColActions: '行列操作',

	filterColumn:    '筛选列',
	filterSelectAll: '全选',
	filterClear:     '清除筛选',
	filterActive:    '筛选中',

	sortAscending:        '升序排序',
	sortDescending:       '降序排序',
	keepSortedAscending:  '自动保持升序排序',
	keepSortedDescending: '自动保持降序排序',
	clearLiveSort:        '取消自动排序',

	lockTable:   '锁定表格（禁用图形化编辑）',
	unlockTable: '解锁表格（启用图形化编辑）',

	autoFitAll: '自动调整所有列宽和行高',

	zoomOut: '缩小',
	zoomIn:  '放大',

	transposeTable: '行列转置',

	selectAllOpenMenu: '全选并弹出菜单',

	changeTheme:      '切换表格主题',
	themeDefault:     '默认',

	collapseTable: '收起表格',
	expandTable:   '展开表格',

	aggSum:   '求和',
	aggAvg:   '平均',
	aggMin:   '最小值',
	aggMax:   '最大值',
	aggCount: '计数',
	aggMore:  '更多统计',
	clearAggregate:  '删除这一行统计',
	dragReorderAgg:  '拖拽调整统计行顺序',

	views:            '视图',
	defaultTableView: '表格',
	newKanbanView:    '新建看板视图：按此列分组',
	newCalendarView:  '新建日历视图：按此列的日期',
	deleteView:       '删除此视图',
	kanbanNoGroupCol: '这个视图的分组列已经不存在了，请在视图菜单里重新选择。',
	kanbanNoValue:    '未分组',
	calendarNoDateCol: '这个视图的日期列已经不存在了，请在视图菜单里重新选择。',
	untitledView:     '未命名视图',
	untitledEvent:    '未命名',

	calendarPrevMonth:  '上个月',
	calendarNextMonth:  '下个月',
	calendarToday:      '回到今天',
	calendarUnscheduled: '未排期',

	newSheet:      '新建 sheet',
	renameSheet:   '重命名 sheet',
	deleteSheet:   '删除 sheet',
	sheetTabStyle: '设置标签样式',

	freezeHeaderOnly: '冻结表头',
	freezeUpToRow:    '冻结到此行',
	unfreezeRows:     '取消行冻结',
	freezeUpToCol:    '冻结到此列',
	unfreezeCols:     '取消列冻结',
	freezeBlockedByMerge: '无法冻结——有合并单元格跨越了这条边界',
	viewSettings:  '视图设置',
	autoWidth:     '自动宽度',
	autoHeight:    '自动高度',
	pinStatusBar:  '常驻状态栏',
	addTitle:      '添加标题',
	addFooter:     '添加页脚',
	titlePlaceholder:  '标题',
	footerPlaceholder: '页脚',

	insertRichTableBlock: '插入 Rich Table',
	convertToRichTable: '转为 Rich Table',

	settingAllowReadingViewEditName: '允许在阅读模式下编辑',
	settingAllowReadingViewEditDesc:
		'关闭时（默认），所有交互行为——悬停选择条、点击编辑、双击面板、下拉选择——在阅读模式下都会被禁用。实时预览/源码模式始终可交互。',
	settingSingleClickEditName: '单击即可编辑',
	settingSingleClickEditDesc:
		'开启后，单击单元格会立即进入编辑(无需区分双击，响应更快)，样式面板通过 Ctrl/Cmd+点击 打开。关闭时（默认），单击进入编辑（稍有迟缓），双击打开样式面板。',
	settingCtrlColHeading: '左侧工具栏按钮',
	settingCtrlColDesc:
		'分别为锁定表格、未锁定表格、引用外部 .xlsx 的表格选择要显示哪些左侧工具栏按钮——每种场景只会列出该场景下实际可用的按钮。',
	ctrlColScenarioLocked:   '锁定表格',
	ctrlColScenarioUnlocked: '未锁定表格',
	ctrlColScenarioXlsxRef:  '外部 .xlsx 表格',
	ctrlColBtnOpenExternal: '用默认应用打开',
	ctrlColBtnDetachXlsx:   '转为普通表格',
	ctrlColBtnLock:         '锁定/解锁',
	ctrlColBtnAutoFit:      '自动调整全部',
	ctrlColBtnTranspose:    '行列转置',
	ctrlColBtnSelectAll:    '全选',
	ctrlColBtnTheme:        '切换主题',
	ctrlColBtnAggregate:    '统计行',
	ctrlColBtnCollapse:     '收起/展开',
	ctrlColBtnViewSettings: '视图设置',
	ctrlColBtnViews:        '视图',
	ctrlColBtnNewSheet:     '新建 sheet',
	ctrlColBtnSnapshot:     '生成快照',
	ctrlColBtnExportXlsx:   '导出为 .xlsx',

	settingBuiltinTypes:     '内置类型',
	settingDatePickerDesc:   '日期选择器（YYYY-MM-DD）',
	settingCustomTypes:      '自定义类型',
	settingAddType:          '添加类型',
	settingTypeId:           '类型 ID',
	settingTypeIdPlaceholder: '我的类型',
	settingDeleteType:       '删除类型',
	settingOptionsHeader:    '选项（值 · 显示标签 · 颜色）',
	settingAddOption:        '添加选项',
	settingOptionValuePlaceholder: '值',
	settingOptionLabelPlaceholder: '标签',
	settingDeleteOption:     '删除选项',
	settingDefaultOptionLabel: '选项 1（点击编辑）',

	// Changelog
	showChangelogCommand: '查看更新日志',
	changelogTitle:       'Rich Table 更新日志',
	settingChangelogName: '更新日志',
	settingChangelogDesc: '查看最近版本的更新内容。',
	settingChangelogButton: '查看更新日志',
};

export function t(key: keyof typeof EN): string {
	return (isZh() ? ZH : EN)[key];
}

// ── Dynamic label helpers ─────────────────────────────────────────────────────

export function tableVersionTooHighMsg(tableV: number, curV: number): string {
	return isZh()
		? `该表格由更高版本的 Rich Table（格式 v${tableV}）保存，当前插件最高支持 v${curV}，请升级插件后查看。`
		: `This table was saved with Rich Table format v${tableV}, but the installed plugin only supports up to v${curV}. Please upgrade the plugin.`;
}

export function gridSizeCaption(rows: number, cols: number): string {
	return isZh() ? `${rows} × ${cols} 表格` : `${rows} × ${cols} table`;
}

export function rowRangeLabel(r1: number, r2: number): string {
	if (isZh()) return r1 === r2 ? `第${r1 + 1}行` : `第${r1 + 1}–${r2 + 1}行`;
	return r1 === r2 ? 'row' : `rows ${r1 + 1}–${r2 + 1}`;
}

export function colRangeLabel(c1: number, c2: number, letter: (i: number) => string): string {
	if (isZh()) return c1 === c2 ? `${letter(c1)}列` : `${letter(c1)}–${letter(c2)}列`;
	return c1 === c2 ? 'column' : `cols ${letter(c1)}–${letter(c2)}`;
}

/** Status bar (FR-017) text — either the table's own totals, or (once
 *  `selectedRows`/`selectedCols` are present, i.e. a genuine multi-cell
 *  selection) the selected count plus sum/avg if the selection has any
 *  numeric cells. Kept as one function, not a handful of `t()` keys, since
 *  the exact composition (which parts appear, in what order) differs enough
 *  between languages that word-by-word substitution would read awkwardly. */
export function statusBarStatsLabel(stats: {
	totalRows: number; totalCols: number;
	selectedRows?: number; selectedCols?: number;
	sum?: string; avg?: string;
}): string {
	const zh = isZh();
	const base = stats.selectedRows !== undefined
		? (zh ? `已选 ${stats.selectedRows} 行 × ${stats.selectedCols} 列` : `Selected ${stats.selectedRows} × ${stats.selectedCols}`)
		: (zh ? `${stats.totalRows} 行 × ${stats.totalCols} 列` : `${stats.totalRows} rows × ${stats.totalCols} cols`);
	if (stats.sum === undefined) return base;
	return zh ? `${base} · 求和: ${stats.sum} · 平均: ${stats.avg}` : `${base} · Sum: ${stats.sum} · Avg: ${stats.avg}`;
}

export function hideRowsLabel(r1: number, r2: number): string {
	return isZh()
		? `隐藏${rowRangeLabel(r1, r2)}`
		: `Hide ${rowRangeLabel(r1, r2)}`;
}

export function hideColsLabel(c1: number, c2: number, letter: (i: number) => string): string {
	return isZh()
		? `隐藏${colRangeLabel(c1, c2, letter)}`
		: `Hide ${colRangeLabel(c1, c2, letter)}`;
}

export function deleteRowsLabel(r1: number, r2: number): string {
	return isZh()
		? `删除${rowRangeLabel(r1, r2)}`
		: `Delete ${rowRangeLabel(r1, r2)}`;
}

export function deleteColsLabel(c1: number, c2: number, letter: (i: number) => string): string {
	return isZh()
		? `删除${colRangeLabel(c1, c2, letter)}`
		: `Delete ${colRangeLabel(c1, c2, letter)}`;
}

export function styleEntireRowsLabel(r1: number, r2: number): string {
	return isZh()
		? `设置${rowRangeLabel(r1, r2)}整行样式`
		: `Style entire ${rowRangeLabel(r1, r2)}`;
}

export function styleEntireColsLabel(c1: number, c2: number, letter: (i: number) => string): string {
	return isZh()
		? `设置${colRangeLabel(c1, c2, letter)}整列样式`
		: `Style entire ${colRangeLabel(c1, c2, letter)}`;
}

export function typeLabel(currentType?: string): string {
	if (!currentType) return t('setType');
	return isZh() ? `类型：${currentType}` : `Type: ${currentType}`;
}

export function filterStatusLabel(shown: number, total: number): string {
	return isZh()
		? `已筛选：显示 ${shown} / ${total} 行`
		: `Filtered: showing ${shown} of ${total} rows`;
}

export function collapsedRowsLabel(): string {
	return isZh()
		? `表格已折叠 · 点击展开`
		: `Table collapsed · click to expand`;
}

export function aggLabel(agg: 'sum' | 'avg' | 'min' | 'max' | 'count'): string {
	switch (agg) {
		case 'sum':   return t('aggSum');
		case 'avg':   return t('aggAvg');
		case 'min':   return t('aggMin');
		case 'max':   return t('aggMax');
		case 'count': return t('aggCount');
	}
}

export function sortActiveLabel(colName: string, dir: 'asc' | 'desc'): string {
	return isZh()
		? `按"${colName}"排序（${dir === 'asc' ? '升序' : '降序'}）· 点击取消`
		: `Sorted by "${colName}" (${dir === 'asc' ? 'ascending' : 'descending'}) · click to clear`;
}

export function calendarMoreEventsLabel(n: number): string {
	return isZh() ? `还有 ${n} 条` : `+${n} more`;
}

/** A sheet with no explicit `name` is labeled by its 1-based position — same
 *  "absent = derive from position, only frozen once explicitly renamed" idea
 *  as ViewDefV2's own name field, model.ts. */
export function sheetFallbackName(oneBasedIndex: number): string {
	return isZh() ? `表 ${oneBasedIndex}` : `Sheet ${oneBasedIndex}`;
}

/** Settings tab label for one ctrlCol button checkbox — CtrlColButtonId → EN/ZH text. */
export function ctrlColButtonLabel(id: CtrlColButtonId): string {
	const KEYS: { [K in CtrlColButtonId]: keyof typeof EN } = {
		openExternal: 'ctrlColBtnOpenExternal',
		detachXlsx:   'ctrlColBtnDetachXlsx',
		lock:         'ctrlColBtnLock',
		autoFit:      'ctrlColBtnAutoFit',
		transpose:    'ctrlColBtnTranspose',
		selectAll:    'ctrlColBtnSelectAll',
		theme:        'ctrlColBtnTheme',
		aggregate:    'ctrlColBtnAggregate',
		collapse:     'ctrlColBtnCollapse',
		viewSettings: 'ctrlColBtnViewSettings',
		views:        'ctrlColBtnViews',
		newSheet:     'ctrlColBtnNewSheet',
		snapshot:     'ctrlColBtnSnapshot',
		exportXlsx:   'ctrlColBtnExportXlsx',
	};
	return t(KEYS[id]);
}

/** Settings tab heading label for one of the three ctrlCol scenarios. */
export function ctrlColScenarioLabel(scenario: 'locked' | 'unlocked' | 'xlsxRef'): string {
	return t(scenario === 'locked' ? 'ctrlColScenarioLocked' : scenario === 'unlocked' ? 'ctrlColScenarioUnlocked' : 'ctrlColScenarioXlsxRef');
}
