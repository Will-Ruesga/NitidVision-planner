"""Board storage. One JSON file per section of the board, in the data folder.

The rest of the app only talks to this module, so swapping to SQLite later
means rewriting this file and nothing else. Routes/UI never touch the files
or the schema directly.

A task sits on two boards at once: the Time Board groups tasks by stage, the
Project Board by project. Stages are fixed; projects are added in the UI.

Files (data/), each a JSON list; the board key each one loads into is in FILES:
    status.json:    stages    list[{id, name, color}]            fixed; the last one is DONE_STAGE
    projects.json:  projects  list[{id, name, color}]            added in the UI, renamed by hand
    members.json:   members   list[{id, name, initials, color}]  people, edited by hand
    tasks.json:     tasks     list[task]                         list order = order in a column

Schema (one task):
    id:           str (uuid4 hex)
    title:        str
    description:  str
    stage:        str               (a stage id, never DONE_STAGE: kept while done, for unticking)
    project:      str               (a project id)
    members:      list[str]         (member ids)
    start_date:   str|None          (ISO yyyy-mm-dd)
    due_date:     str|None          (ISO yyyy-mm-dd, not before start_date)
    done:         bool              (shown in the DONE_STAGE column and in its project's done list)

Project ids are ASCII slugs of their names ("Màrqueting" -> "marqueting").
`color` values are palette keys from COLORS.
"""
from __future__ import annotations

import json
import os
import re
import tempfile
import threading
import unicodedata
import uuid
from datetime import date
from pathlib import Path
from typing import Any

# Palette keys. Each one needs a [data-color] rule in nitid_planner/static/css/base.css.
COLORS = ("cream", "maroon", "forest", "navy", "steel", "red", "amber", "green", "coral", "blue")

# Board key -> its file in the data folder.
FILES = {"stages": "status.json", "projects": "projects.json", "members": "members.json", "tasks": "tasks.json"}

# The Time Board column of done tasks. Moving a task here ticks it; moving it out unticks it.
DONE_STAGE = "fet"

# Routes build a repository per request, so the lock must be per process,
# not per instance, to serialize concurrent read-modify-write cycles.
_LOCK = threading.Lock()


class InvalidInput(ValueError):
    """Raised when a task or project payload fails validation. The message is user-facing."""


class BoardRepository:
    """Thread-safe JSON-backed board store.

    Args:
        data_dir: absolute path to the data folder. Every file in FILES must
                  exist there, since they also hold the fixed stages and the
                  hand-edited members.
    """

    def __init__(self, data_dir: Path):
        self._dir = Path(data_dir)

    # ---------- public API ----------

    def board(self) -> dict[str, Any]:
        """Return the whole board: stages, projects, members and tasks."""
        with _LOCK:
            return self._read()

    def create_task(self, payload: dict[str, Any]) -> dict[str, Any]:
        """Add an open task at the bottom of its columns.

        Args:
            payload: task fields; `title`, `stage` and `project` are required.
        Returns:
            The stored task.
        Raises:
            InvalidInput: if the payload does not validate.
        """
        with _LOCK:
            data = self._read()
            task = _normalize_task({**payload, "done": False}, data, task_id=uuid.uuid4().hex)
            data["tasks"].append(task)
            self._write(data, "tasks")
        return task

    def update_task(self, task_id: str, payload: dict[str, Any]) -> dict[str, Any] | None:
        """Patch a task with the given fields.

        Returns:
            The updated task, or None if no task has `task_id`.
        Raises:
            InvalidInput: if the merged task does not validate.
        """
        with _LOCK:
            data = self._read()
            for i, task in enumerate(data["tasks"]):
                if task["id"] == task_id:
                    data["tasks"][i] = _normalize_task({**task, **payload}, data, task_id=task_id)
                    self._write(data, "tasks")
                    return data["tasks"][i]
        return None

    def move_task(self, task_id: str, target: dict[str, Any], before_id: str | None) -> dict[str, Any] | None:
        """Move a task into a column, just above task `before_id`, or last when None.

        Args:
            target: {"stage": id} for a Time Board column (DONE_STAGE ticks the
                    task, any other stage unticks it), or {"project": id} for a
                    Project Board column (the task keeps its stage and done flag).
        Returns:
            The moved task, or None if no task has `task_id`.
        Raises:
            InvalidInput: unknown stage or project, or `before_id` is not another task in that column.
        """
        with _LOCK:
            data = self._read()
            tasks = data["tasks"]
            task = _find(tasks, task_id)
            if task is None:
                return None
            if "stage" in target:
                stage = target["stage"]
                patch = {"done": True} if stage == DONE_STAGE else {"stage": stage, "done": False}
            else:
                patch = {"project": target.get("project")}
            moved = _normalize_task({**task, **patch}, data, task_id=task_id)
            before = _find(tasks, before_id) if before_id else None
            if before_id and (before is None or before is task or _column(before, target) != _column(moved, target)):
                raise InvalidInput("before must be another task in the target column")

            tasks.remove(task)
            if before is None:
                tasks.append(moved)
            else:
                tasks.insert(tasks.index(before), moved)
            self._write(data, "tasks")
        return moved

    def delete_task(self, task_id: str) -> bool:
        """Hard-delete a task. Returns True if removed."""
        with _LOCK:
            data = self._read()
            before = len(data["tasks"])
            data["tasks"] = [t for t in data["tasks"] if t["id"] != task_id]
            if len(data["tasks"]) == before:
                return False
            self._write(data, "tasks")
            return True

    def create_project(self, payload: dict[str, Any]) -> dict[str, Any]:
        """Add a project at the right end of the Project Board.

        Args:
            payload: `name` and `color` (a key of COLORS).
        Returns:
            The stored project.
        Raises:
            InvalidInput: empty or taken name, or unknown color.
        """
        with _LOCK:
            data = self._read()
            project = _new_project(payload, data["projects"])
            data["projects"].append(project)
            self._write(data, "projects")
        return project

    # ---------- internals ----------

    def _read(self) -> dict[str, Any]:
        """Load every file into one board dict, keyed as in FILES."""
        board = {}
        for key, name in FILES.items():
            with (self._dir / name).open("r", encoding="utf-8") as f:
                board[key] = json.load(f)
        return board

    def _write(self, data: dict[str, Any], key: str) -> None:
        """Save the `key` section of `data` to its file; the other files are untouched."""
        path = self._dir / FILES[key]
        # Atomic write: write to temp file in same dir, then rename.
        fd, tmp = tempfile.mkstemp(prefix=f".{path.stem}-", suffix=".json", dir=self._dir)
        try:
            with os.fdopen(fd, "w", encoding="utf-8") as f:
                json.dump(data[key], f, ensure_ascii=False, indent=2)
            os.replace(tmp, path)
        except Exception:
            if os.path.exists(tmp):
                os.remove(tmp)
            raise


def _find(tasks: list[dict[str, Any]], task_id: str) -> dict[str, Any] | None:
    """Return the task with `task_id` from `tasks`, or None."""
    return next((t for t in tasks if t["id"] == task_id), None)


def _column(task: dict[str, Any], target: dict[str, Any]) -> tuple[str, bool]:
    """The column `task` shows in on the board `target` belongs to.

    Time Board: its stage, or DONE_STAGE when done. Project Board: its project,
    split into the open list and the done list.
    """
    if "stage" in target:
        return (DONE_STAGE if task["done"] else task["stage"], False)
    return (task["project"], task["done"])


def _normalize_task(payload: dict[str, Any], data: dict[str, Any], *, task_id: str) -> dict[str, Any]:
    """Validate a raw payload and coerce it into a complete task dict.

    Args:
        payload: raw input (optional fields may be missing).
        data: the current board, used to check the stage and project ids.
        task_id: id stored on the task.
    Returns:
        Full task dict with every schema key set.
    Raises:
        InvalidInput: empty title, unknown stage or project, or bad / inverted dates.
    """
    title = str(payload.get("title", "")).strip()
    if not title:
        raise InvalidInput("title is required")

    stage = payload.get("stage")
    if stage == DONE_STAGE or stage not in {s["id"] for s in data["stages"]}:
        raise InvalidInput(f"unknown stage: {stage!r}")
    project = payload.get("project")
    if project not in {p["id"] for p in data["projects"]}:
        raise InvalidInput("choose a project" if not project else f"unknown project: {project!r}")

    start = _iso_date(payload.get("start_date"))
    due = _iso_date(payload.get("due_date"))
    if start and due and start > due:
        raise InvalidInput("start date must be on or before the due date")

    return {
        "id": task_id,
        "title": title,
        "description": str(payload.get("description") or ""),
        "stage": stage,
        "project": project,
        "members": [str(x) for x in (payload.get("members") or [])],
        "start_date": start,
        "due_date": due,
        "done": bool(payload.get("done", False)),
    }


def _new_project(payload: dict[str, Any], projects: list[dict[str, Any]]) -> dict[str, Any]:
    """Validate a new project and give it an id.

    Args:
        payload: raw input with `name` and `color`.
        projects: the existing projects, so names and ids stay unique.
    Returns:
        {id, name, color}, the id being a slug of the name.
    Raises:
        InvalidInput: empty name, a name already taken (ignoring case), or a color not in COLORS.
    """
    name = str(payload.get("name", "")).strip()
    if not name:
        raise InvalidInput("name is required")
    if name.casefold() in {p["name"].casefold() for p in projects}:
        raise InvalidInput(f"{name!r} already exists")
    color = payload.get("color")
    if color not in COLORS:
        raise InvalidInput(f"unknown color: {color!r}")
    return {"id": _slug(name, {p["id"] for p in projects}), "name": name, "color": color}


def _slug(name: str, taken: set[str]) -> str:
    """Return an ASCII slug of `name` that is not in `taken`.

    Accents are dropped and anything else becomes "-" ("Per fer!" -> "per-fer").
    A name with no letters or digits becomes "item"; clashes get "-2", "-3", ...
    """
    ascii_name = unicodedata.normalize("NFKD", name).encode("ascii", "ignore").decode()
    base = re.sub(r"[^a-z0-9]+", "-", ascii_name.lower()).strip("-") or "item"
    slug, n = base, 2
    while slug in taken:
        slug, n = f"{base}-{n}", n + 1
    return slug


def _iso_date(value: Any) -> str | None:
    """Return `value` as an ISO date string, or None when empty.

    Raises:
        InvalidInput: if `value` is not a yyyy-mm-dd date.
    """
    if not value:
        return None
    try:
        return date.fromisoformat(str(value)).isoformat()
    except ValueError:
        raise InvalidInput(f"not a date: {value!r}") from None
