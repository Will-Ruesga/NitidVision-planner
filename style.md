# Nitid Planner style

One design language for the planner, built from two references:

- **Nitid Vision website**: type (Archivo, Martian Mono), neutral "alloy" greys,
  blue action colour, near-square corners, blocks separated by 4px *cuts* that
  show the canvas instead of hairline borders, see-through near-black tags, and
  quick, smooth motion.
- **Little Planet palette**: six flat brand colours used as solid blocks, each
  with an ink that reads on it.

Tokens live in `nitid_planner/static/css/base.css`, shared widgets in
`components.css`, page layout in `planner.css`. No hex values outside `base.css`.

## Type

Archivo (Google Fonts, `wdth 62..125`, `wght 100..900`), fallback
`"Helvetica Neue", Arial`. Martian Mono (`wght 400..600`) for machine-like text.

| Tier      | Class / where   | Setting                                          | Used for                                |
| --------- | --------------- | ------------------------------------------------ | --------------------------------------- |
| Display   | `.t-display`    | width 125% (Expanded), 650, -0.005em             | column names, editor title, month names |
| Wordmark  | `.brand__name`  | Expanded, uppercase, 0.06em; "Nitid" 800, rest 300 | top bar, like the Nitid logo          |
| Body      | (default)       | 14px / 20px, 400; task titles 500; buttons 600   | everything else                         |
| Figure    | `.t-figure`     | width 75% (Condensed), 700, tabular numbers      | counts                                  |
| Label     | `.t-label`      | Martian Mono 11px, 500, uppercase, 0.04em, muted | field names, filter groups, headers     |
| Data      | task dates, day numbers | Martian Mono 11px, 500 (dates uppercase) | dates on tasks, timeline days           |

## Colour

### Neutrals (theme-scoped)

| Token             | Light     | Dark      | Role                                          |
| ----------------- | --------- | --------- | --------------------------------------------- |
| `--canvas`        | `#dfe2e6` | `#0f1216` | page background, cuts, input wells            |
| `--surface`       | `#ffffff` | `#1c2024` | cells, dialog                                 |
| `--surface-muted` | `#eff1f4` | `#2c3136` | quiet buttons, chips, weekend shading         |
| `--raised`        | surface   | surface-muted | tasks and the composer; inside a column it is the column tint |
| `--line`          | `#bec3c8` | `#41474d` | input hover, timeline week lines              |
| `--ink`           | `#1c2024` | `#eff1f4` | text                                          |
| `--ink-muted`     | `#5a6066` | `#9a9fa5` | secondary text                                |
| `--action`        | `#215ee5` | `#538bfd` | primary button, focus, pressed toggles        |
| `--action-soft` / `--action-text` | `#e0ebff` / `#194ab6` | `#0b1d46` / `#a1c1ff` | current tab, pressed chips |
| `--danger`        | `#bc100c` | `#f64b3c` | delete, overdue dates                         |
| `--today`         | `#c21320` | `#f64b3c` | timeline today line and day number            |
| `--channel-r/g/b` | site RGB  | lighter RGB | channel bar over the wordmark               |
| `--done` / `--on-done` | `#007752` / white | `#00bb82` / `#0f1216` | a ticked task's tick         |

### Tints and translucency

- Tasks: `color-mix(--c-bg var(--tint), var(--tint-base))`, a light tint of their
  column's colour (set as `--raised` on `.column`). Light: 14% over `--surface`.
  Dark: 24% over `--surface`, because the Little Planet colours need a bigger share
  to show on the dark surface. Timeline group rows use the same tint along their track.
- Count badges: the column ink at 16% over the column colour.
- `.column-adder`: the surface at 50% until hovered or in use.
- Dialog: `--scrim` (`#0a0c0fa6`) with a 3px blur behind it.
- Tags over content: `--tag` (`#0f1216e6`) with `--on-tag` text, like the site's
  labels over camera images (the timeline's "Today").

### Palette keys (theme-independent)

Stages, projects and avatars name a key in their data file (`"color": "maroon"`).
The keys are `COLORS` in `nitid_planner/board.py` (the API refuses others);
CSS maps `[data-color]` to `--c-bg` and `--c-ink`. Every pair is at least 4.5:1.

| Key      | Background | Ink       | Source        | Default use              |
| -------- | ---------- | --------- | ------------- | ------------------------ |
| `cream`  | `#fcf1d5`  | navy      | Little Planet | stage Idees              |
| `maroon` | `#780001`  | cream     | Little Planet | stage Per fer            |
| `forest` | `#053b2d`  | cream     | Little Planet | stage Aquesta setmana    |
| `navy`   | `#02304a`  | steel     | Little Planet | stage En curs, project   |
| `steel`  | `#659bbd`  | navy      | Little Planet | stage En revisio         |
| `red`    | `#c21320`  | cream     | Little Planet | avatar                   |
| `amber`  | `#faa617`  | `#1c2024` | Nitid site    | project                  |
| `green`  | `#007752`  | white     | Nitid site    | project                  |
| `coral`  | `#f64b3c`  | `#1c2024` | Nitid site    | project                  |
| `blue`   | `#215ee5`  | white     | Nitid site    | project                  |

The logo's own pairs (steel on maroon, red on steel, steel on cream, navy on red)
are 2.0–3.9:1, so they are not used for text. A new key needs a pair of 4.5:1 or
more, a `[data-color]` rule and an entry in `COLORS`.

## Shape and space

- Radius: `--radius-1` 2px (tasks, chips, buttons, inputs, tags), `--radius-2` 4px
  (dialog). Big blocks (cells, columns) are square.
- Separation: `--cut` (4px) gaps between blocks show the canvas. No borders
  between blocks; inputs are canvas-coloured wells with an action edge on focus.
- Spacing: `--space-1..6` = 4, 8, 12, 16, 24, 32.
- Controls: `--control-sm` 28px, `--control-md` 36px.
- Shadows: `--shadow-panel` at rest, `--shadow-float` on hover and the dialog.

## Motion

- Hovers and state changes: `--motion-fast` (120ms) `ease-out` on colour, background,
  border and shadow. Tasks and timeline bars also lift 1px; buttons press down 1px;
  swatches grow on hover with `--ease-pop`.
- Things that appear pop in: `pop-in` (fade + rise + 96% → 100% scale) over
  `--motion-pop` (280ms) with `--ease-pop`, a slight overshoot. Used by the editor
  and by tasks and projects the last fetch added (never on the first load,
  and a re-render does not replay it).
- Views and the dialog backdrop fade in (`fade-in`, 200ms).
- `prefers-reduced-motion: reduce` turns all of it off.

## Components (`components.css`)

- `.btn` quiet fill · `--primary` action fill · `--ghost` transparent, takes the
  colour of its context · `--danger` · `--sm` · `--icon`.
- `.input` text, select, date and textarea; `.field` stacks a `.t-label` over a control.
- `.label` small caps tag in its palette colour, on tasks: the project on the Time
  Board, the stage on the Project Board.
- `.avatar` member initials in a circle; `.avatars` overlaps them.
- `.chip` small button led by a `.chip__swatch` or `.avatar`. With `aria-pressed`
  it is a toggle (pressed = `--action-soft` fill, action text and ring). `.chip--add`
  is the quiet "+" at the end of a row. `.chips` wraps a row.
- `.swatch` one palette colour as a radio button (checked = ink ring); `.swatches` a row of them.
- `.creator` name + swatches + Add / Cancel, for a new project.
- `.composer` new task typed in place, raised like a task, with a select for the
  stage or project the column doesn't give.
- `.task` raised block: top row (`.task__tick` then the tag), title, meta (dates,
  description mark, avatars). Overdue dates turn `--danger`. A ticked task
  (`.is-done`) has a filled `--done` tick and a struck-through, muted title.
- `.editor` dialog: `.editor__band` is a solid block in the task's stage colour,
  then the title and fields.
- `.channelbar` the R / G / B stripes of the Nitid logo.

## Layout (`planner.css`)

- `.app` stacks the top bar, filter bar and views with cuts between them.
- `.topbar`: three cells (brand | view tabs | actions). The brand is the channel bar
  over the wordmark; the current tab has an `--action-soft` fill.
- `.filterbar`: search, project chips + "+" (status chips, without "+", on the Project
  Board), people chips (with names), Clear.
- Boards: full-height `.column` blocks in their palette colour, 288px wide, scrolling
  horizontally. Tasks stack with 8px gaps; a `.task-slot` marks the drop spot.
  Time Board: one column per stage, Fet last and without a composer. Project Board:
  one column per project, a folded `.done-list` ("Fet", count) of its done tasks,
  and `.column-adder` as the last tile.
- Timeline: task names in a sticky left column (`--tl-label-w`), one day = `--day-w`
  (32px, kept in sync with `DAY_W` in `app.js`). Mondays get a week line, weekends
  are shaded, group rows (one per stage) use the stage colour with its tint along the
  track, and bars use the stage colour with a soft ink ring so light and dark bars
  both read on either theme. Undated tasks sit in the "Not scheduled" tray.
- Under 720px: tabs drop to their own row; columns and the adder are 85vw with scroll snap.

## Rules

1. Hex values only in `base.css`. New colours enter as tokens or palette keys.
2. A new shared widget goes in this file first, then in `components.css`.
3. `planner.css` positions things; it never re-styles a component.
4. Bold is structural (names, headings). Body actions stay at 400–600.
5. Motion uses the tokens above, and anything that animates on render must not replay on re-render.
