import { getLanguage } from 'obsidian';

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
	hideRow:         'Hide row',
	hideColumn:      'Hide column',
	deleteRow:       'Delete row',
	deleteColumn:    'Delete column',
	alignLeft:       'Align left',
	alignCenter:     'Align center',
	alignRight:      'Align right',
	copyToExcel:     'Copy to Excel',
	copyToMarkdown:  'Copy as Markdown',
	copyFailed:      'Copy failed — clipboard access was denied',

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
	templatePreview: 'Template preview — click Insert to start editing',
	insertTemplate:  'Insert template',

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
} as const;

const ZH: { [K in keyof typeof EN]: string } = {
	unmergeCells:    '取消合并',
	insertRowAbove:  '在上方插入行',
	insertRowBelow:  '在下方插入行',
	insertColBefore: '在左侧插入列',
	insertColAfter:  '在右侧插入列',
	mergeCells:      '合并单元格',
	hideRow:         '隐藏行',
	hideColumn:      '隐藏列',
	deleteRow:       '删除行',
	deleteColumn:    '删除列',
	alignLeft:       '左对齐',
	alignCenter:     '居中',
	alignRight:      '右对齐',
	copyToExcel:     '复制到 Excel',
	copyToMarkdown:  '复制为 Markdown',
	copyFailed:      '复制失败——剪贴板访问被拒绝',

	background:  '背景色',
	textColor:   '字体颜色',
	fontSize:    '字体大小',
	bold:        '粗体',
	italic:      '斜体',
	clearFormat: '清除格式',
	apply:       '应用',

	noType:  '无类型',
	setType: '设置类型',

	templatePreview: '模板预览 — 点击"插入"开始编辑',
	insertTemplate:  '插入模板',

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

export function rowRangeLabel(r1: number, r2: number): string {
	if (isZh()) return r1 === r2 ? `第${r1 + 1}行` : `第${r1 + 1}–${r2 + 1}行`;
	return r1 === r2 ? 'row' : `rows ${r1 + 1}–${r2 + 1}`;
}

export function colRangeLabel(c1: number, c2: number, letter: (i: number) => string): string {
	if (isZh()) return c1 === c2 ? `${letter(c1)}列` : `${letter(c1)}–${letter(c2)}列`;
	return c1 === c2 ? 'column' : `cols ${letter(c1)}–${letter(c2)}`;
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
