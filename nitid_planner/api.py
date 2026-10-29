"""JSON API for the board.

Endpoints:
    GET    /api/board               -> stages, projects, members, every task, the palette keys and the done stage
    POST   /api/tasks               -> create (title + stage + project required)
    PATCH  /api/tasks/<id>          -> partial update
    POST   /api/tasks/<id>/move     -> {stage | project, before}: place above `before`, or last
    DELETE /api/tasks/<id>          -> delete
    POST   /api/projects            -> create {name, color}, added at the right end

The route layer is a thin wrapper around the repository; it does not know
about storage details. Invalid input comes back as 400 {"error": ...}.
Filtering and search are done on the client.
"""
from flask import Blueprint, current_app, jsonify, request

from nitid_planner.board import COLORS, DONE_STAGE, BoardRepository, InvalidInput

api_bp = Blueprint("api", __name__, url_prefix="/api")


def _repo() -> BoardRepository:
    """Return a board repository bound to the data folder configured on the Flask app."""
    return BoardRepository(current_app.config["DATA_DIR"])


@api_bp.errorhandler(InvalidInput)
def invalid_input(err: InvalidInput):
    """Turn a failed validation into a 400 carrying its message."""
    return jsonify({"error": str(err)}), 400


@api_bp.get("/board")
def get_board():
    """Return the whole board, plus the palette keys a new project can use and the done stage id."""
    return jsonify({**_repo().board(), "colors": COLORS, "done_stage": DONE_STAGE})


@api_bp.post("/tasks")
def create_task():
    """Create a task from the JSON body. Returns the stored task."""
    task = _repo().create_task(request.get_json(silent=True) or {})
    return jsonify(task), 201


@api_bp.patch("/tasks/<task_id>")
def update_task(task_id: str):
    """Patch a task with the fields in the JSON body."""
    task = _repo().update_task(task_id, request.get_json(silent=True) or {})
    if task is None:
        return jsonify({"error": "not found"}), 404
    return jsonify(task)


@api_bp.post("/tasks/<task_id>/move")
def move_task(task_id: str):
    """Move a task to a `stage` or `project` column, above task `before` (or last when null)."""
    payload = request.get_json(silent=True) or {}
    target = {k: payload[k] for k in ("stage", "project") if k in payload}
    if len(target) != 1:
        raise InvalidInput("give either a stage or a project")
    task = _repo().move_task(task_id, target, payload.get("before"))
    if task is None:
        return jsonify({"error": "not found"}), 404
    return jsonify(task)


@api_bp.delete("/tasks/<task_id>")
def delete_task(task_id: str):
    """Hard-delete a task."""
    if not _repo().delete_task(task_id):
        return jsonify({"error": "not found"}), 404
    return ("", 204)


@api_bp.post("/projects")
def create_project():
    """Create a project from {name, color}. Returns the stored project."""
    project = _repo().create_project(request.get_json(silent=True) or {})
    return jsonify(project), 201
