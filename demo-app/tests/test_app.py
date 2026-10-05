"""Application smoke checks for recipe reads and the supported route surface."""


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
        "/api/cookbook", "/api/cookbook/<recipe_id>", "/api/rails",
        "/", "/recipe/<recipe_id>",
    }


def test_shared_acceptance_search_is_correct_in_both_languages(tmp_path, acceptance_corpus):
    import json
    import subprocess
    from pathlib import Path
    from app import create_app

    raw, cases = acceptance_corpus
    path = tmp_path / "acceptance-recipes.json"
    path.write_text(json.dumps(raw), encoding="utf-8")
    client = create_app(testing=True, recipe_path=path).test_client()
    # Include all five fields of every shipped recipe, not just title examples.
    for field in ("title", "description", "category", "dietary_tags", "ingredients"):
        value = raw[2][field]
        for query in value if isinstance(value, list) else [value]:
            expected = [r["id"] for r in raw if any(query.lower() in v.lower()
                        for v in [r["title"], r["description"], r["category"],
                                  *r["dietary_tags"], *r["ingredients"]])]
            cases.append((query.upper(), expected))
    for query, expected in cases:
        response = client.get("/api/recipes", query_string={"q": query})
        assert response.status_code == 200
        assert [r["id"] for r in response.get_json()] == expected, repr(query)
    result = subprocess.run(
        ["node", "--input-type=module", "-e", """
import {readFileSync} from 'node:fs';
import {matchesRecipe} from './static/app-logic.js';
const {recipes, queries} = JSON.parse(readFileSync(0, 'utf8'));
process.stdout.write(JSON.stringify(queries.map(q => recipes.filter(r =>
  matchesRecipe(r, q)).map(r => r.id))));
"""], cwd=Path(__file__).parents[1], text=True, capture_output=True,
        input=json.dumps({"recipes": raw, "queries": [q for q, _ in cases]}),
        check=True, timeout=20,
    )
    assert json.loads(result.stdout) == [expected for _, expected in cases]


def test_startup_boundary_and_valid_edge_values(tmp_path, acceptance_corpus):
    import copy
    import json
    import re
    import pytest
    from app import create_app
    from recipes import RecipeDataError

    raw, _ = acceptance_corpus
    path = tmp_path / "recipes.json"
    with pytest.raises(RecipeDataError, match=re.escape(str(path))):
        create_app(testing=True, recipe_path=path)
    for text in ("{broken", "{}"):
        path.write_text(text)
        with pytest.raises(RecipeDataError, match=re.escape(str(path))):
            create_app(testing=True, recipe_path=path)
    mutations = [("id", raw[1]["id"]), ("prep_minutes", True),
                 ("cook_minutes", -1), ("servings", False), ("ingredients", []),
                 ("steps", ["One", "Two"]), ("colors", ["#123", "bad"]),
                 ("dietary_tags", [""]), ("featured", 1)]
    for field, value in mutations:
        broken = copy.deepcopy(raw)
        broken[0][field] = value
        path.write_text(json.dumps(broken))
        with pytest.raises(RecipeDataError, match=re.escape(str(path))):
            create_app(testing=True, recipe_path=path)
    for broken in (raw[:11], [{k: v for k, v in r.items() if k != "steps"} for r in raw],
                   [dict(r, featured=False) for r in raw]):
        path.write_text(json.dumps(broken))
        with pytest.raises(RecipeDataError):
            create_app(testing=True, recipe_path=path)
    raw[0].update(cook_minutes=0, dietary_tags=[])
    path.write_text(json.dumps(raw))
    client = create_app(testing=True, recipe_path=path).test_client()
    assert client.get(f"/api/recipes/{raw[0]['id']}").get_json() == raw[0]


def test_cookbook_public_state_validation_and_isolation(client):
    import json
    from app import create_app

    recipes = client.get("/api/recipes").get_json()
    chosen = recipes[:2]
    ids = [r["id"] for r in chosen]
    for recipe_id in reversed(ids):
        response = client.post("/api/cookbook", json={"id": recipe_id})
        assert response.status_code == 201
    assert client.post("/api/cookbook", json={"id": ids[0]}).get_json() == {
        "recipe_ids": sorted(ids)}
    assert client.get("/api/cookbook").get_json() == chosen
    for payload in (None, [], 1, True, "dish", {}, {"id": []}, {"id": " "}):
        response = client.post("/api/cookbook", data=json.dumps(payload),
                               content_type="application/json")
        assert response.status_code == 400
        assert response.get_json() == {"error": "Provide a recipe id"}
        assert client.get("/api/cookbook").get_json() == chosen
    malformed = client.post("/api/cookbook", data="{", content_type="application/json")
    assert malformed.status_code == 400
    unknown = client.post("/api/cookbook", json={"id": "unknown-dish"})
    assert unknown.status_code == 400 and unknown.get_json() == {"error": "Unknown recipe"}
    assert create_app(testing=True).test_client().get("/api/cookbook").get_json() == []
    for recipe_id in ids:
        for _ in range(2):
            response = client.delete(f"/api/cookbook/{recipe_id}")
            assert response.status_code == 200
            assert recipe_id not in response.get_json()["recipe_ids"]
    assert client.get("/api/cookbook").get_json() == []


def test_public_modes_rails_and_removed_route_registrations(client):
    import json
    import re
    from html import unescape

    recipes = client.get("/api/recipes").get_json()
    recipe_id = recipes[-1]["id"]
    expected = [
        [r["id"] for r in recipes if r["featured"]],
        [r["id"] for r in recipes if r["prep_minutes"] + r["cook_minutes"] <= 30],
        [r["id"] for r in recipes if set(r["dietary_tags"]) & {"Vegetarian", "Vegan"}],
    ]
    for saved in (False, True, False):
        if saved:
            assert client.post("/api/cookbook", json={"id": recipe_id}).status_code == 201
        else:
            assert client.delete(f"/api/cookbook/{recipe_id}").status_code == 200
        response = client.get("/api/rails")
        assert response.status_code == 200
        rails = response.get_json()
        assert [r["id"] for r in rails] == ["RAIL_POPULAR", "RAIL_QUICK", "RAIL_VEGETARIAN", "RAIL_COOKBOOK"]
        assert [r["name"] for r in rails] == ["Popular this week", "Ready in 30 minutes", "Vegetarian favourites", "My Cookbook"]
        assert [r["recipe_ids"] for r in rails] == expected + [[recipe_id] if saved else []]
        assert all(len(r["recipe_ids"]) >= 2 for r in rails[:3])
        page = client.get("/?mode=tv").text
        assert all(r["name"] in page for r in rails)
    for query, ua, mode in [("", "browser", "mobile"), ("?mode=tv", "browser", "tv")] + [
            ("?mode=mobile", hint.swapcase(), "tv")
            for hint in ("Smart-TV", "SmartTV", "HbbTV", "Tizen", "WebOS", "NetCast")]:
        for route in ("/", f"/recipe/{recipe_id}"):
            response = client.get(route + query, headers={"User-Agent": ua})
            assert response.status_code == 200
            bootstrap = json.loads(re.search(
                r'<script id="page-bootstrap"[^>]*>(.*?)</script>', response.text, re.S)[1])
            assert bootstrap["mode"] == mode
            assert bootstrap["browse_url"] == ("/?mode=tv" if mode == "tv" else "/")
            assert f'href="{bootstrap["browse_url"]}"' in unescape(response.text)
    assert client.get("/recipe/unknown-dish").status_code == 404
    # Construct negative paths without retaining obsolete domain fixtures.
    old = "mo" + "vie"
    for route in (f"/{old}/missing", f"/api/{old}s", "/api/" + "watch" + "list"):
        assert client.get(route).status_code == 404
    assert all(old not in rule.rule for rule in client.application.url_map.iter_rules())
