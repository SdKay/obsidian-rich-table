# Tasks tables

A table whose rows are the tasks a [Tasks](https://publish.obsidian.md/tasks/) plugin style query finds in the vault. Use it when the user wants a live list of tasks (open items, due this week, one per row) rather than data typed into cells.

### `tasks` (object, optional)

| Field   | Type | Description |
| ------- | ---- | ----------- |
| `query` | string | The query, one condition per line, in the Tasks plugin's language. An empty query (or one of only `#` comment lines) shows no rows: the table asks the user to write one. To list every task, write a condition every task meets, such as `not done` plus `done` in two tables, or `path includes /`. |

The rows are **read from the vault on every render and never written to the note**. Do not write `rows:` for a tasks table: it is discarded on read, and the plugin's own writes never include it. Only `tasks.query` and `columns` are saved.

Each task is one row. A task keeps its row across refreshes, so styles and selections that name a row keep naming the same task.

```yaml
---
version: 2
tasks:
  query: |
    not done
    due before next week
    sort by due
columns:
  - id: c_status
    name: Status
    width: 36
    field: status
  - id: c_body
    name: Task
    field: body
  - id: c_due
    name: Due
    field: due
---
```

### `columns[].field`

Which property of each task the column shows. A column without `field` is empty in a tasks table.

| `field` | Shows |
| ------- | ----- |
| `status` | The checkbox |
| `body` | The task text, without its dates, priority and tags |
| `due`, `scheduled`, `start`, `created`, `done` | That date |
| `priority` | Priority |
| `tags` | The task's tags |
| `recurrence` | The repeat rule |
| `file`, `path` | The note's name, or its full path |
| `heading` | The heading the task sits under |
| `description` | The task text as written, dates and tags included |

A new tasks table shows `status`, `body`, `due`, `priority`, `tags`, `file`. The user can add, reorder, resize and re-point columns like in any table.

### Query language

Supported: `done` / `not done`, status type and name, date conditions (`due before …`, `due today`, `has due date`, `no scheduled date`, `due this week`, …), `priority is|above|below|not …`, `has tags` / `no tags`, `tags include|do not include …`, `path|filename|folder|heading|description includes|does not include …` (also `regex matches`), `is recurring`, `exclude sub-items`, `sort by …` (with `reverse`), `group by …`, `limit N`.

Not supported: `filter by function`, boolean groups (`AND`, `OR`, `NOT` with parentheses) and presets. A line the plugin does not understand is not applied, so the table shows the tasks the other lines allow. Write only lines the language has, and do not invent one.

### Editing

- Sorting a column writes a `sort by` line into the query; it is not stored on the rows. `sort:` in the block only mirrors it for the header.
- Anything that names a row or a cell (editing a cell, inserting or deleting a row, a cell style) is refused: there are no stored rows to change.
- A block is one kind of table. `tasks` goes at the top level of a `version: 2` block, never inside a `sheets` entry (it has no effect there) and never together with `xlsxSource`.
