"""Application smoke checks for the recipe read slice.

Page composition is delivered by later tickets.
"""


def test_collection_and_single_recipe_reads(client):
    response = client.get("/api/recipes")
    assert response.status_code == 200
    recipes = response.get_json()
    assert len(recipes) >= 12
    first = recipes[0]
    detail = client.get(f"/api/recipes/{first['id']}")
    assert detail.status_code == 200
    assert detail.get_json() == first
    assert first["title"] == "Apple and Cinnamon Porridge"
    assert first["ingredients"][0] == "100 g rolled oats"


def test_recipe_search_and_missing_api(client):
    recipes = client.get("/api/recipes?q=  CHICKPEAS  ").get_json()
    assert [recipe["id"] for recipe in recipes] == ["chickpea-lemon-salad"]
    empty = client.get("/api/recipes?q=no-such-dish-7a2e")
    assert empty.status_code == 200
    assert empty.get_json() == []
    missing = client.get("/api/recipes/missing")
    assert missing.status_code == 404
    assert missing.get_json() == {"error": "Recipe not found"}


def test_application_instances_own_immutable_recipe_state(client):
    from app import create_app
    from recipes import RecipeCollection

    collection = client.application.extensions["recipe_collection"]
    other = create_app(testing=True)
    assert isinstance(collection, RecipeCollection)
    assert collection is not other.extensions["recipe_collection"]
    assert collection.recipes == other.extensions["recipe_collection"].recipes
    assert client.application.config["TESTING"] is True
    assert {rule.rule for rule in client.application.url_map.iter_rules()} == {
        "/static/<path:filename>", "/api/recipes", "/api/recipes/<recipe_id>",
        "/api/cookbook", "/api/cookbook/<recipe_id>",
    }
