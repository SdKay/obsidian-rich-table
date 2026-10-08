# Formulas

Per-row formula cells in a rich-table block. Read this when the user wants computed cells.

### `formulas` (per-row object, optional)
A formula cell's row has a `formulas: { <colId>: "<formula>" }` entry alongside
its `cells`. `cells[colId]` must still hold that same cell's **last computed
value** as a plain string — the plugin overwrites it on every load/edit, but
write a correct one when authoring so the value is right even before the
plugin's own render pass runs.

Grammar (leading `=` required): `=expr`, where `expr` supports `+ - * /` with
standard precedence and parentheses, numeric literals, cell references
(`r_xxx.c_yyy`), and one function call over a range
(`FUNC(r_aaa.c_bbb:r_ccc.c_ddd)`).

| Function | Behavior over the range |
| -------- | ------------------------ |
| `SUM`    | Sum of numeric cells |
| `AVG`    | Average of numeric cells |
| `MIN`    | Minimum of numeric cells |
| `MAX`    | Maximum of numeric cells |
| `COUNT`  | Count of non-empty cells (numeric or not) |

Blank/non-numeric cells are skipped by every function above; a bare arithmetic
reference (e.g. `=r_000000.c_000001+1`) instead treats a blank referenced cell
as `0` and a non-numeric one as an error.

References are by **ID**, not position — they keep working after rows/columns
are inserted or reordered. A reference to a row/column ID that no longer
exists, or a formula that (directly or indirectly) references its own cell,
evaluates to an error string instead of throwing:

| Result | Meaning |
| ------ | ------- |
| `#REF!` | Referenced row or column ID doesn't exist |
| `#CIRCULAR!` | Formula references its own cell, directly or through a chain |
| `#DIV/0!` | Division by zero |
| `#VALUE!` | Non-numeric operand where arithmetic expected a number, or a syntax error |

```yaml
rows:
  - id: r_000000
    cells:
      c_000000: "5"
  - id: r_000001
    cells:
      c_000000: "12"
      c_000001: "17"
    formulas:
      c_000001: "=SUM(r_000000.c_000000:r_000001.c_000000)"
```
