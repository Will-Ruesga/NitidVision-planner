# Nitid Planner

Nitid Vision's planning board: every task has a stage and a project, and shows on two boards, plus a timeline (Gantt) view.

## Features

- **Time Board:** six fixed stages: Idees, Per fer, Aquesta setmana, En curs, En revisio and Fet. Each task shows its project.
- **Project Board:** one column per project. Each task shows its stage. Done tasks fold into a "Fet" list at the bottom of their project. **+ Add project**, after the last column, or **+** after the project filters, adds a project with a name and a colour.
- **New tasks:** **+ Add a task** in a column. The column sets the stage (Time Board) or the project (Project Board), and the form asks for the other one.
- **Done:** the tick at the top left of a task marks it done and moves it to Fet. Unticking it returns it to the stage it was at. On the Time Board, dragging into or out of Fet does the same.
- **Drag and drop:** within or between columns on either board.
- **Task editor:** click a task to set its stage, project, start and due dates, people and description, or to delete it. Every change saves immediately.
- **Filters:** by project (by status on the Project Board, whose columns are already projects), by person and by text search. Several projects or statuses show tasks in any of them; that, person and search together narrow the results. Each board keeps its own selection.
- **Timeline:** dated tasks as bars, grouped by stage, with a line for today. Undated tasks are listed under "Not scheduled".
- **Themes:** light and dark. The design system is described in [style.md](style.md).

## Run

Requires [uv](https://docs.astral.sh/uv/).

```sh
uv sync              # creates .venv (prompt: nitidvision-planner)
uv run planner
```

Then open http://127.0.0.1:5001.

## Layout

```
data/
├── status.json          the fixed stages (Time Board columns)
├── projects.json        the projects (Project Board columns)
├── members.json         the people
└── tasks.json           every task
nitid_planner/
├── __init__.py          create_app(), the page route, main()
├── api.py               JSON API
├── board.py             storage of the data files + validation
├── templates/index.html
└── static/              css/ and js/
```

## Editing stages, projects and people

Projects are added in the app. Everything else is edited by hand in the files in `data/` while the app is stopped. Each file is a list of:

- `status.json` (stages): `{id, name, color}`. The set is fixed. The last one, `fet`, holds done tasks and must keep that id.
- `projects.json`: `{id, name, color}`. Rename, recolour, reorder or delete them here.
- `members.json` (people): `{id, name, initials, color}`.

`color` is a palette key from `COLORS` in `nitid_planner/board.py`. Tasks refer to stages, projects and people by `id`, so rename freely but don't change an `id` that tasks still use.

## Not in git

`.gitignore` keeps out the virtual environment (`.venv`), build output (`dist/`), Python caches, tests and Claude files (`.claude/`, `CLAUDE.md`).
