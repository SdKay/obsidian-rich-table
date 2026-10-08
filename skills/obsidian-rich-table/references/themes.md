# Themes

The built-in visual themes selected with the `theme` field.

## Themes

Set the `theme` field in the YAML front-matter to apply a built-in visual theme.

### Available themes

**`academic`** — LaTeX booktabs style
- Only three horizontal rules: thick line above header, medium line below header, thick line after last row
- No vertical lines, no cell backgrounds, minimal distraction

```yaml
theme: academic
```

**`plain`** — Colorful and animated
- Rainbow gradient header that slowly cycles hue, rounded corners with an animated
  outline border and comet-flash effect
- Row hover highlight with a cursor-following glow
- Table centered in the reading pane

```yaml
theme: plain
```

### Applying a theme

Add `theme:` to the YAML front-matter alongside other fields:

````markdown
```rich-table
---
version: 2
theme: academic
columns:
  - id: c_000000
    name: Method
    width: 160
  - id: c_000001
    name: Result
    width: 120
rows:
  - id: r_000000
    cells:
      c_000000: Control
      c_000001: 0.42 ± 0.03
  - id: r_000001
    cells:
      c_000000: Treatment A
      c_000001: 0.67 ± 0.04
---
```
````

### Switching themes

Change the `theme:` value (or remove it). The visual appearance updates immediately when the plugin re-renders the block.
