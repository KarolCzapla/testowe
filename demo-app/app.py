"""TableStory's mobile recipe pages and local recipe/My Cookbook APIs."""

from __future__ import annotations

from pathlib import Path

from flask import Flask, jsonify, render_template, request, url_for

from cookbook import CookbookState, cookbook_snapshot, remove_recipe, save_recipe, saved_recipes
from recipes import find_recipe, load_recipes, recipe_to_json, search_recipes

ROOT = Path(__file__).parent


def create_app(testing: bool = False, *, recipe_path: Path | None = None) -> Flask:
    app = Flask(__name__)
    app.config.update(TESTING=testing)
    collection = load_recipes(ROOT / "catalog.json" if recipe_path is None else recipe_path)
    app.extensions["recipe_collection"] = collection
    cookbook = CookbookState()
    app.extensions["cookbook"] = cookbook

    def page_context(page, recipes):
        saved_ids = cookbook_snapshot(cookbook)
        browse_url = url_for("index")
        return {
            "mode": "mobile", "browse_url": browse_url,
            "saved_recipe_ids": saved_ids,
            "bootstrap": {
                "page": page, "mode": "mobile", "browse_url": browse_url,
                "recipes": [recipe_to_json(recipe) for recipe in recipes],
                "saved_recipe_ids": sorted(saved_ids),
            },
        }

    @app.get("/")
    def index():
        return render_template(
            "index.html", recipes=collection.recipes,
            **page_context("browse", collection.recipes),
        )

    @app.get("/recipe/<recipe_id>")
    def recipe_detail(recipe_id: str):
        recipe = find_recipe(collection, recipe_id)
        if recipe is None:
            return render_template(
                "not_found.html", **page_context("missing", ()),
            ), 404
        return render_template(
            "detail.html", recipe=recipe,
            **page_context("detail", (recipe,)),
        )

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

    @app.get("/api/cookbook")
    def get_cookbook():
        return jsonify([
            recipe_to_json(recipe) for recipe in saved_recipes(collection, cookbook)
        ])

    @app.post("/api/cookbook")
    def add_to_cookbook():
        payload = request.get_json(silent=True)
        if not isinstance(payload, dict):
            return jsonify({"error": "Provide a recipe id"}), 400
        recipe_id = payload.get("id")
        if not isinstance(recipe_id, str) or not recipe_id.strip():
            return jsonify({"error": "Provide a recipe id"}), 400
        try:
            result = save_recipe(collection, cookbook, recipe_id)
        except ValueError:
            return jsonify({"error": "Unknown recipe"}), 400
        return jsonify(result), 201

    @app.delete("/api/cookbook/<recipe_id>")
    def remove_from_cookbook(recipe_id: str):
        return jsonify(remove_recipe(cookbook, recipe_id))

    return app


app = create_app()

if __name__ == "__main__":
    app.run(debug=True, port=5000)
