"""Pocket Cinema: the intentionally mobile-shaped workshop workpiece."""

from __future__ import annotations

import json
from pathlib import Path

from flask import Flask, abort, jsonify, render_template, request

ROOT = Path(__file__).parent


def load_catalog() -> list[dict]:
    return json.loads((ROOT / "catalog.json").read_text())


def create_app(testing: bool = False) -> Flask:
    app = Flask(__name__)
    app.config.update(TESTING=testing, WATCHLIST=set())
    catalog = load_catalog()
    by_id = {movie["id"]: movie for movie in catalog}

    @app.get("/")
    def index():
        return render_template("index.html", movies=catalog)

    @app.get("/movie/<movie_id>")
    def detail(movie_id: str):
        movie = by_id.get(movie_id)
        if not movie:
            abort(404)
        return render_template("detail.html", movie=movie)

    @app.get("/api/movies")
    def movies_api():
        query = request.args.get("q", "").strip().lower()
        movies = [m for m in catalog if query in (m["title"] + " " + " ".join(m["genres"])).lower()]
        return jsonify(movies)

    @app.get("/api/movies/<movie_id>")
    def movie_api(movie_id: str):
        movie = by_id.get(movie_id)
        return jsonify(movie) if movie else (jsonify({"error": "Movie not found"}), 404)

    @app.get("/api/watchlist")
    def get_watchlist():
        return jsonify([by_id[mid] for mid in app.config["WATCHLIST"] if mid in by_id])

    @app.post("/api/watchlist")
    def add_watchlist():
        movie_id = (request.get_json(silent=True) or {}).get("id")
        if movie_id not in by_id:
            return jsonify({"error": "Unknown movie"}), 400
        app.config["WATCHLIST"].add(movie_id)
        return jsonify({"ids": sorted(app.config["WATCHLIST"])}), 201

    @app.delete("/api/watchlist/<movie_id>")
    def remove_watchlist(movie_id: str):
        app.config["WATCHLIST"].discard(movie_id)
        return jsonify({"ids": sorted(app.config["WATCHLIST"])})

    return app


app = create_app()

if __name__ == "__main__":
    app.run(debug=True, port=5000)
