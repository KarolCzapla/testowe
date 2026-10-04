"""TableStory's local recipe read APIs."""

from __future__ import annotations

from pathlib import Path

from flask import Flask, jsonify, request

from recipes import find_recipe, load_recipes, recipe_to_json, search_recipes

ROOT = Path(__file__).parent


def create_app(testing: bool = False, *, recipe_path: Path | None = None) -> Flask:
    app = Flask(__name__)
    app.config.update(TESTING=testing)
    collection = load_recipes(ROOT / "catalog.json" if recipe_path is None else recipe_path)
    app.extensions["recipe_collection"] = collection

    @app.get("/api/recipes")
    def recipes_api():
        matches = search_recipes(collection.recipes, request.args.get("q", ""))
        return jsonify([recipe_to_json(recipe) for recipe in matches])

    @app.get("/api/recipes/<recipe_id>")
    def recipe_api(recipe_id: str):
        recipe = find_recipe(collection, recipe_id)
        if recipe is None:
            return jsonify({"error": "Recipe not found"}), 404
        return jsonify(recipe_to_json(recipe))

    return app


app = create_app()

if __name__ == "__main__":
    app.run(debug=True, port=5000)
