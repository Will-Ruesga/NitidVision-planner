"""Nitid Planner: Flask app factory and entrypoint.

Run with `uv run planner` from the project root.
"""
from pathlib import Path

from flask import Flask, render_template

from nitid_planner.api import api_bp


def create_app() -> Flask:
    """Build the Flask app.

    Returns:
        The app, with the board stored in the data/ folder at the project root.
    """
    app = Flask(__name__)
    app.config["DATA_DIR"] = Path(__file__).resolve().parent.parent / "data"
    app.register_blueprint(api_bp)

    @app.route("/")
    def index():
        """Render the planner page. All data is loaded via the JSON API."""
        return render_template("index.html")

    return app


def main() -> None:
    """Run the development server on http://127.0.0.1:5001."""
    create_app().run(host="127.0.0.1", port=5001, debug=True)
