# backend/app.py
from flask import Flask, send_from_directory
from pathlib import Path
import logging

# Serve static files from ./static (we will copy frontend/dist -> ./static in Dockerfile)
app = Flask(__name__, static_folder="static")

logger = logging.getLogger("werkzeug")
logger.setLevel(logging.INFO)

@app.route("/", defaults={"path": ""})
@app.route("/<path:path>")
def serve(path):
    """
    Serve files from ./static (where frontend/dist is placed by Dockerfile).
    If file exists -> return file, otherwise return index.html (SPA fallback).
    """
    static_dir = Path(app.static_folder)

    # Safety: if static_folder does not exist, give a helpful error
    if not static_dir.exists():
        return (
            "Frontend build not found. Please run `npm run build` in frontend and "
            "rebuild the backend image (or copy frontend/dist into backend/static).",
            500,
        )

    # Serve actual file if present
    if path != "" and (static_dir / path).exists():
        return send_from_directory(app.static_folder, path)

    # Otherwise SPA fallback to index.html
    index_file = static_dir / "index.html"
    if index_file.exists():
        return send_from_directory(app.static_folder, "index.html")

    return "index.html not found in static folder.", 500


if __name__ == "__main__":
    # for local dev you can still run this directly
    app.run(host="0.0.0.0", port=5000, debug=True)
