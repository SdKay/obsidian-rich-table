/**
 * A block whose rows are the tasks a query finds in the vault. The block keeps the query, the columns and the look;
 * the rows are built on every draw and never written. See blockSource.ts.
 */
import type { PaneType } from 'obsidian';
import { fmt, t } from '../i18n';
import type { ColumnDefV2, TableModelV2 } from '../model';
import type { BlockSource, EntryHost, Loaded, Parsed, SourceHost, SourceKind } from '../blockSource';
import type { EmptyEntry } from '../emptyEntries';
import { serializeTable } from '../serializer';
import { NATIVE } from '../blockSource';
import type { TableAction } from '../renderTypes';
import type { ColumnKinds } from '../columnKind';
import { TASK_FIELDS, fieldById } from './taskFields';
import type { TableOp, TableOpType } from '../tableEdits';
import { buildTasksBlock, hasQuery } from './taskBlock';
import { tasksAccepts, sortedQuery, withSort } from './taskOps';
import { TaskQueryModal } from './taskQueryModal';
import { toIso } from './taskRun';
import type { TaskSource } from './taskSource';
import { jumpTo } from './taskJump';
import { buildTasksTable, type RowSource } from './taskTable';

export class TasksBlockSource implements BlockSource {
	readonly exportable = true;
	/** The block as saved, as of the last load: what sorting and the query dialog read. */
	private shell: TableModelV2 | null = null;
	private stopWatch: (() => void) | null = null;

	constructor(private readonly host: SourceHost, private readonly vaultTasks: TaskSource) {}

	async load(parsed: Parsed): Promise<Loaded> {
		const shell = parsed.model;
		this.shell = shell;
		if (!shell?.tasks || !hasQuery(shell.tasks.query)) {
			// Nothing is drawn from the vault yet, so nothing to be told about.
			this.dispose();
			return { kind: 'message', parsed, render: (el, can) => this.renderMissingQuery(el, can('set-tasks-query')) };
		}
		await this.vaultTasks.whenReady();
		// Kept across draws: a change that arrives while one is drawing still draws again.
		this.stopWatch ??= this.vaultTasks.onChange(() => { void this.host.rerender(); });
		const built = buildTasksTable(shell, this.vaultTasks.tasks(), toIso(new Date()));
		this.places = built.sources;
		return { kind: 'table', parsed, drawn: built.model };
	}

	/** Where each drawn row's task is, from the last draw. */
	private places = new Map<string, RowSource>();

	jumpColumn(col: ColumnDefV2): boolean {
		return col.field === 'file' || col.field === 'path';
	}

	rowNote(rowId: string): string | null {
		return this.places.get(rowId)?.path ?? null;
	}

	openRow(rowId: string, where: string | boolean): boolean {
		const place = this.places.get(rowId);
		if (!place) return false;
		const target = jumpTo(place, this.host.sourcePath, where);
		void this.host.app.workspace.openLinkText(target.linktext, target.sourcePath, target.where as PaneType | boolean, target.state);
		return true;
	}

	locked = NATIVE.locked;
	scenario = NATIVE.scenario;

	/** No stored rows: what names a row or a cell has nothing to act on. Sorting is kept in the query (see route). */
	accepts(type: TableOpType): boolean {
		return tasksAccepts(type) || type === 'set-sort';
	}

	route(op: TableOp): true | TableOp {
		const shell = this.shell;
		if (op.type !== 'set-sort' || !shell?.tasks) return op;
		const sort = op.sort;
		// Clearing needs no column: it takes every sort line out.
		const next = sort === null
			? withSort(shell.tasks.query, null, null)
			: sortedQuery(shell.tasks.query, shell.columns.find(c => c.id === sort.colId)?.field, sort.dir);
		// A column Tasks has no sort for is left as it is.
		return next === null ? true : { type: 'set-tasks-query', query: next };
	}

	actions(can: (type: TableOpType) => boolean): TableAction[] {
		if (!can('set-tasks-query')) return [];
		return [{ id: 'editTasksQuery', label: t('tasksQueryEdit'), place: 'first', run: () => this.editQuery() }];
	}

	/** What a column shows of each task, and the other properties it can show instead. */
	columnKinds(col: ColumnDefV2): ColumnKinds {
		const choice = (field: string | null, label: string) => ({
			label, current: (col.field ?? null) === field, op: { type: 'set-col-field' as const, colId: col.id, field },
		});
		const current = col.field ? fieldById(col.field)?.label ?? col.field : null;
		return {
			label: current ? fmt('tasksFieldWithName', { field: current }) : t('tasksFieldChoose'),
			emits: 'set-col-field',
			groups: [
				[choice(null, t('tasksFieldNone'))],
				TASK_FIELDS.map(f => choice(f.id, `${f.label} (${f.id})`)),
			],
		};
	}

	dispose(): void {
		this.stopWatch?.();
		this.stopWatch = null;
	}

	/** Asks for the query, starting from the one the block has. */
	private editQuery(): void {
		const query = this.shell?.tasks?.query ?? '';
		new TaskQueryModal(this.host.app, query, next => {
			if (next !== query) void this.host.queueCell({ type: 'set-tasks-query', query: next });
		}).open();
	}

	/** Shown in place of the table while it has no query: what is missing, and the button that asks for it. */
	private renderMissingQuery(el: HTMLElement, canEdit: boolean): void {
		const box = el.createDiv({ cls: 'bt-template-banner bt-tasks-query-missing' });
		box.createSpan({ cls: 'bt-template-banner-label', text: t('tasksQueryMissing') });
		if (!canEdit) return;
		const btn = box.createEl('button', { cls: 'bt-template-btn', text: t('tasksQueryWrite') });
		btn.addEventListener('click', () => this.editQuery());
	}
}

/** Tables of the tasks a query finds, over the vault's tasks. */
export function tasksSourceKind(vaultTasks: TaskSource): SourceKind {
	return {
		matches: (model) => !!model.tasks,
		create: (host) => new TasksBlockSource(host, vaultTasks),
		entry: (host) => tasksEntry(host),
	};
}

/** The empty-block button for a tasks table. Whole blocks only. */
function tasksEntry(host: SourceHost & EntryHost): EmptyEntry {
	return {
		key: 'tasks',
		label: t('insertTasksTable'),
		// The tasks are in the vault, not in this block, so there is no table to show before it is inserted.
		preview: { hint: t('tasksPreviewHint') },
		bind: (ctx) => { ctx.button.addEventListener('click', () => ctx.insert(() => insertTasksTable(host))); },
	};
}

/**
 * Inserts a tasks table (the default columns, no rows: they are found on draw), then asks for its query. Saving
 * writes the block again with the query in it: the block may not have been read back yet, so there is no table to
 * send an op to, and the text just written is the block. Closing the dialog without one leaves it asking for it.
 */
async function insertTasksTable(host: SourceHost & EntryHost): Promise<void> {
	const block = buildTasksBlock(host.defaultTheme());
	await host.writeBlock(serializeTable(block));
	new TaskQueryModal(host.app, '', query => {
		if (query !== '') void host.writeBlock(serializeTable({ ...block, tasks: { query } }));
	}).open();
}
