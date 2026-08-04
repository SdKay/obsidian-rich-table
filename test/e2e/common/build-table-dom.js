// Builds the <table> DOM for a parsed TableModelV2, using the REAL
// buildOccupied/getMergeOrigin/applyColStyle/applyStyleRulesV2 from the
// bundled source (window.RichTableReal) for every piece of logic that's
// actually tricky to get right (merge skip/rowspan/colspan, style
// resolution) — only the DOM skeleton itself and cell text content are
// hand-built here, deliberately simplified relative to the real
// renderCell.ts (renderHeaderCell/renderDataCell need Obsidian's App/
// MarkdownRenderer machinery, which this harness doesn't pull in — cell
// content is plain text in a <p>, matching MarkdownRenderer's real output
// shape closely enough for structural/layout tests without needing actual
// markdown rendering).
//
// window.buildTableDom(model) returns { table, thead, tbody } — the table
// is NOT yet attached to any parent.
window.buildTableDom = function (model) {
	const { buildOccupied, getMergeOrigin, applyColStyle, applyStyleRulesV2 } = window.RichTableReal;
	const occupied = buildOccupied(model);

	const table = document.createElement('table');
	table.className = 'bt-table';

	const colgroup = document.createElement('colgroup');
	for (let ci = 0; ci < model.columns.length; ci++) {
		const col = model.columns[ci];
		const c = document.createElement('col');
		c.dataset.col = String(ci);
		if (col && (col.width ?? 0) > 0) c.style.width = `${col.width}px`;
		colgroup.appendChild(c);
	}
	table.appendChild(colgroup);
	const totalWidth = model.columns.reduce((sum, c) => sum + (c?.width ?? 0), 0);
	if (totalWidth > 0) {
		table.style.tableLayout = 'fixed';
		table.style.width = `${totalWidth}px`;
	}

	const thead = document.createElement('thead');
	const tbody = document.createElement('tbody');
	table.appendChild(thead);
	table.appendChild(tbody);

	const buildRow = (rowIdx, isHeader) => {
		const tr = document.createElement('tr');
		const currentRow = rowIdx > 0 ? (model.rows[rowIdx - 1] ?? null) : null;
		const currentRowId = isHeader ? 'header' : (currentRow ? currentRow.id : '');
		let c = 0;
		while (c < model.columns.length) {
			const col = model.columns[c];
			if (!col) { c++; continue; }
			const currentColId = col.id;
			if (occupied.has(`${currentRowId}.${currentColId}`)) { c++; continue; }

			const colIdx = c;
			const merge = getMergeOrigin(rowIdx, colIdx, model);
			const tag = isHeader ? 'th' : 'td';
			const el = document.createElement(tag);
			el.className = isHeader ? 'bt-th' : 'bt-td';
			el.dataset.row = String(rowIdx);
			el.dataset.col = String(colIdx);

			if (merge) {
				let rowSpan = 0;
				for (let ri = merge.startRow; ri <= merge.endRow; ri++) {
					const hidden = ri > 0 ? (model.rows[ri - 1]?.hidden ?? false) : false;
					if (!hidden) rowSpan++;
				}
				let colSpan = 0;
				for (let ci = merge.startCol; ci <= merge.endCol; ci++) {
					if (!model.columns[ci]?.hidden) colSpan++;
				}
				if (rowSpan > 1) el.rowSpan = rowSpan;
				if (colSpan > 1) el.colSpan = colSpan;
			}

			applyColStyle(el, col);
			applyStyleRulesV2(el, rowIdx, colIdx, model);

			const value = isHeader
				? (col.name ?? '')
				: merge
					? (model.rows.find(r => r.id === merge.anchorRowId)?.cells[merge.anchorColId] ?? '')
					: (currentRow ? (currentRow.cells[col.id] ?? '') : '');
			const p = document.createElement('p');
			p.textContent = value === '' ? ' ' : value;
			el.appendChild(p);

			tr.appendChild(el);
			c++;
		}
		return tr;
	};

	thead.appendChild(buildRow(0, true));
	for (let ri = 1; ri <= model.rows.length; ri++) {
		tbody.appendChild(buildRow(ri, false));
	}

	return { table, thead, tbody };
};
