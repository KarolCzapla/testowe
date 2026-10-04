"""Independent acceptance for the recipe collection and read API slice only."""

import copy
import importlib
import importlib.util
import json
import re
from dataclasses import FrozenInstanceError
from pathlib import Path

import pytest

from app import create_app


FIELDS = {
    "id", "title", "description", "category", "dietary_tags", "prep_minutes",
    "cook_minutes", "difficulty", "servings", "ingredients", "steps", "colors",
    "featured",
}
CATALOG = Path(__file__).parents[1] / "catalog.json"


def recipe_domain():
    # Missing functionality must fail as an assertion, not a collection/import error.
    assert importlib.util.find_spec("recipes") is not None, "Recipe domain module is missing"
    module = importlib.import_module("recipes")
    for name in (
        "Recipe", "RecipeCollection", "RecipeDataError", "load_recipes",
        "validate_recipes", "total_minutes", "find_recipe", "search_recipes",
        "recipe_to_json",
    ):
        assert hasattr(module, name), f"Missing approved recipe operation: {name}"
    return module


@pytest.fixture
def corpus():
    """Independent, offline valid corpus; never bootstrap invalid cases from production."""
    dishes = (
        ("Berry porridge", "Breakfast", "rolled oats", "berries"),
        ("Tomato toast", "Breakfast", "bread", "tomatoes"),
        ("Chickpea salad", "Lunch", "cooked chickpeas", "cucumber"),
        ("Lentil soup", "Lunch", "cooked lentils", "vegetable stock"),
        ("Mushroom rice", "Dinner", "cooked rice", "mushrooms"),
        ("Pepper pasta", "Dinner", "pasta", "red peppers"),
        ("Baked apples", "Dessert", "apples", "cinnamon"),
        ("Berry compote", "Dessert", "berries", "sugar"),
        ("Bean wrap", "Lunch", "tortillas", "cooked beans"),
        ("Tomato soup", "Dinner", "tomatoes", "vegetable stock"),
        ("Banana oats", "Breakfast", "rolled oats", "banana"),
        ("Potato skillet", "Dinner", "cooked potatoes", "onion"),
    )
    return [
        {
            "id": f"dish-{index}", "title": title,
            "description": f"A simple {title.lower()} for everyday cooking.",
            "category": category, "dietary_tags": ["Vegan"],
            "prep_minutes": 10, "cook_minutes": 15, "difficulty": "Easy",
            "servings": 2, "ingredients": [f"200 g {first}", f"100 g {second}"],
            "steps": ["Measure the ingredients.", "Combine and cook until tender.",
                      "Divide between two bowls and serve."],
            "colors": ["#abc", "#A1b2C3"], "featured": index < 2,
        }
        for index, (title, category, first, second) in enumerate(dishes)
    ]


def read_collection(client, query=None):
    response = client.get("/api/recipes", query_string={} if query is None else {"q": query})
    assert response.status_code == 200, "Recipe collection read must succeed"
    assert response.is_json
    data = response.get_json()
    assert type(data) is list
    return data


def assert_recipe(record):
    assert type(record) is dict and set(record) == FIELDS
    for field in ("id", "title", "description", "category", "difficulty"):
        assert type(record[field]) is str and record[field].strip()
    assert re.fullmatch(r"[A-Za-z0-9_-]+", record["id"])
    assert record["difficulty"] in {"Easy", "Medium", "Confident Cook"}
    for field, minimum in (("prep_minutes", 1), ("cook_minutes", 0), ("servings", 1)):
        assert type(record[field]) is int and record[field] >= minimum
    for field, minimum in (("dietary_tags", 0), ("ingredients", 1), ("steps", 3), ("colors", 2)):
        assert type(record[field]) is list and len(record[field]) >= minimum
        assert all(type(value) is str and value.strip() for value in record[field])
    assert len(record["colors"]) == 2
    assert all(re.fullmatch(r"#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})", color)
               for color in record["colors"])
    assert type(record["featured"]) is bool


def expected_ids(records, query):
    needle = query.strip().lower()
    return [record["id"] for record in records if any(
        needle in value.lower() for value in (
            record["title"], record["description"], record["category"],
            *record["dietary_tags"], *record["ingredients"],
        )
    )]


def test_shipped_dataset_and_complete_deterministic_reads(client):
    records = read_collection(client)
    assert len(records) >= 12
    assert records == json.loads(CATALOG.read_text(encoding="utf-8"))
    assert records == read_collection(client)
    assert records == read_collection(create_app(testing=True).test_client())
    for record in records:
        assert_recipe(record)
        response = client.get(f"/api/recipes/{record['id']}")
        assert response.status_code == 200 and response.get_json() == record
    assert len({record["id"] for record in records}) == len(records)
    assert len({record["title"].strip().lower() for record in records}) == len(records)
    assert {"Breakfast", "Lunch", "Dinner", "Dessert"} <= {r["category"] for r in records}
    assert sum(bool({"Vegetarian", "Vegan"} & set(r["dietary_tags"])) for r in records) >= 3
    assert sum("Vegan" in r["dietary_tags"] for r in records) >= 2
    assert sum(r["prep_minutes"] + r["cook_minutes"] <= 30 for r in records) >= 3
    assert sum(r["category"] == "Dessert" for r in records) >= 2
    assert sum(r["featured"] for r in records) >= 2


def test_shipped_api_search_all_approved_fields(client):
    records = read_collection(client)
    queries = ["", " \t\n", "no-such-ingredient-7a2e"]
    for record in records:
        queries.extend([record["title"], record["description"], record["category"],
                        *record["dietary_tags"], *record["ingredients"]])
    for query in queries:
        query = f"  {query.upper()}  "
        assert [r["id"] for r in read_collection(client, query)] == expected_ids(records, query)


def test_missing_recipe_error_is_exact(client):
    response = client.get("/api/recipes/unknown-recipe-7a2e")
    assert response.status_code == 404
    assert response.is_json and response.get_json() == {"error": "Recipe not found"}


def test_deprecated_routes_have_no_aliases(client):
    old_domain = "mo" + "vie"
    old_saved = "watch" + "list"
    forbidden = (f"/{old_domain}/", f"/api/{old_domain}s", f"/api/{old_saved}")
    for rule in client.application.url_map.iter_rules():
        assert not any(rule.rule.startswith(prefix) for prefix in forbidden)
    for method, path in (
        ("GET", f"/{old_domain}/afterlight"),
        ("GET", f"/api/{old_domain}s"),
        ("GET", f"/api/{old_domain}s/afterlight"),
        ("GET", f"/api/{old_saved}"),
        ("POST", f"/api/{old_saved}"),
        ("DELETE", f"/api/{old_saved}/afterlight"),
    ):
        assert client.open(path, method=method).status_code == 404


def make_application(tmp_path, records):
    path = tmp_path / "recipes-boundary.json"
    path.write_text(json.dumps(records, ensure_ascii=False), encoding="utf-8")
    # Test an absent seam as behavior rather than allowing an unexpected TypeError.
    import inspect
    assert "recipe_path" in inspect.signature(create_app).parameters, "Missing recipe_path seam"
    return create_app(testing=True, recipe_path=path)


def test_fresh_immutable_collection_and_serialization(corpus, tmp_path):
    domain = recipe_domain()
    collection = domain.validate_recipes(corpus)
    assert isinstance(collection, domain.RecipeCollection)
    assert type(collection.recipes) is tuple
    recipe = collection.recipes[0]
    assert isinstance(recipe, domain.Recipe)
    for field in ("dietary_tags", "ingredients", "steps", "colors"):
        assert type(getattr(recipe, field)) is tuple
    with pytest.raises((FrozenInstanceError, AttributeError, TypeError)):
        recipe.title = "Changed"
    with pytest.raises((FrozenInstanceError, AttributeError, TypeError)):
        collection.recipes = ()
    with pytest.raises(TypeError):
        collection.by_id[recipe.id] = recipe
    assert domain.find_recipe(collection, recipe.id) is recipe
    assert domain.find_recipe(collection, "unknown") is None
    assert domain.total_minutes(recipe) == 25
    first = domain.recipe_to_json(recipe)
    assert first == corpus[0]
    for field in ("dietary_tags", "ingredients", "steps", "colors"):
        first[field].append("Changed")
    first["title"] = "Changed"
    corpus[0]["ingredients"].append("Changed input")
    second = domain.recipe_to_json(recipe)
    assert second["title"] == "Berry porridge"
    assert second["ingredients"] == ["200 g rolled oats", "100 g berries"]
    assert_recipe(second)
    application = make_application(tmp_path, [domain.recipe_to_json(r) for r in collection.recipes])
    assert any(isinstance(value, domain.RecipeCollection) for value in application.extensions.values())


def test_valid_zero_cook_empty_tags_and_difficulties(corpus, tmp_path):
    domain = recipe_domain()
    corpus[0].update(cook_minutes=0, dietary_tags=[], difficulty="Confident Cook")
    corpus[1]["difficulty"] = "Medium"
    application = make_application(tmp_path, corpus)
    assert read_collection(application.test_client()) == corpus
    assert domain.total_minutes(domain.validate_recipes(corpus).recipes[0]) == 10


def test_literal_unicode_search_and_field_boundaries(corpus, tmp_path):
    domain = recipe_domain()
    corpus[0].update(title="Straße salad", description="İSTANBUL lemon bowl.",
                     ingredients=["1 spoon a+b", "200 g boundaryfirst"],
                     dietary_tags=["Vegan", "boundarysecond"], category="Breakfast")
    corpus[1]["ingredients"] = ["200 g boundarythird", "1 tsp boundaryfourth"]
    collection = domain.validate_recipes(corpus)
    client = make_application(tmp_path, corpus).test_client()
    for query in (
        "", " \t\n", " STRAßE ", "STRASSE", "i\u0307stanbul", "istanbul",
        "A+B", "a.b", ".*", "lemon", "BREAKFAST", " vegan ",
        "boundaryfirst boundarysecond", "boundarythird 1 tsp boundaryfourth",
        "salad İSTANBUL", "no-such-ingredient-7a2e",
    ):
        wanted = expected_ids(corpus, query)
        matches = domain.search_recipes(collection.recipes, query)
        assert type(matches) is tuple
        assert [r.id for r in matches] == wanted
        assert [r["id"] for r in read_collection(client, query)] == wanted
    assert [r.id for r in domain.search_recipes(collection.recipes)] == [r["id"] for r in corpus]


INVALID_FIELDS = [
    ("id", "bad/id"), ("id", "bad id"), ("id", ""), ("id", 12),
    ("title", " "), ("title", 3), ("description", ""), ("description", []),
    ("category", " "), ("category", ["Dinner"]),
    ("dietary_tags", "Vegan"), ("dietary_tags", [""]), ("dietary_tags", [True]),
    ("prep_minutes", 0), ("prep_minutes", -1), ("prep_minutes", True),
    ("prep_minutes", 1.5), ("prep_minutes", "10"),
    ("cook_minutes", -1), ("cook_minutes", False), ("cook_minutes", 2.5),
    ("servings", 0), ("servings", -1), ("servings", True), ("servings", "2"),
    ("difficulty", "Hard"), ("difficulty", "easy"), ("difficulty", None),
    ("ingredients", []), ("ingredients", "rice"), ("ingredients", [" "]),
    ("ingredients", [1]), ("steps", ["One", "Two"]), ("steps", "Cook"),
    ("steps", ["One", "Two", " "]), ("steps", ["One", "Two", None]),
    ("colors", ["#abc"]), ("colors", ["#abc", "#def", "#123"]),
    ("colors", ["red", "#abc"]), ("colors", ["#abcd", "#abc"]),
    ("colors", ["#gggggg", "#abc"]), ("colors", [123, "#abc"]),
    ("featured", 1), ("featured", "true"), ("featured", None),
]


@pytest.mark.parametrize("field,value", INVALID_FIELDS)
def test_invalid_field_fails_startup_visibly(corpus, tmp_path, field, value):
    domain = recipe_domain()
    corpus[4][field] = value
    with pytest.raises(domain.RecipeDataError) as failure:
        make_application(tmp_path, corpus)
    message = str(failure.value)
    assert "recipes-boundary.json" in message
    assert field in message
    assert "4" in message or "dish-4" in message


@pytest.mark.parametrize("field", sorted(FIELDS))
def test_missing_fields_rejected(corpus, field):
    domain = recipe_domain()
    del corpus[0][field]
    with pytest.raises(domain.RecipeDataError, match=field):
        domain.validate_recipes(corpus)


def test_extra_fields_duplicate_ids_and_root_shape_rejected(corpus):
    domain = recipe_domain()
    extra = copy.deepcopy(corpus)
    extra[0]["unexpected"] = "not public"
    duplicate = copy.deepcopy(corpus)
    duplicate[1]["id"] = duplicate[0]["id"]
    for invalid in (None, {}, "recipes", [None] * 12, extra, duplicate):
        with pytest.raises(domain.RecipeDataError):
            domain.validate_recipes(invalid)


@pytest.mark.parametrize("quota", ["count", "Breakfast", "Lunch", "Dinner", "Dessert",
                                    "two desserts", "vegetarian", "vegan", "quick", "featured"])
def test_collection_quotas_rejected(corpus, tmp_path, quota):
    domain = recipe_domain()
    if quota == "count":
        corpus.pop()
    elif quota in {"Breakfast", "Lunch", "Dinner", "Dessert"}:
        for recipe in corpus:
            if recipe["category"] == quota:
                recipe["category"] = "Snack"
    elif quota == "two desserts":
        corpus[6]["category"] = "Snack"
    elif quota == "vegetarian":
        for index, recipe in enumerate(corpus):
            recipe["dietary_tags"] = ["Vegan"] if index < 2 else []
    elif quota == "vegan":
        for index, recipe in enumerate(corpus):
            recipe["dietary_tags"] = ["Vegan"] if index == 0 else ["Vegetarian"]
    elif quota == "quick":
        for index, recipe in enumerate(corpus):
            recipe["cook_minutes"] = 20 if index < 2 else 21
    elif quota == "featured":
        corpus[1]["featured"] = False
    with pytest.raises(domain.RecipeDataError) as failure:
        make_application(tmp_path, corpus)
    assert "recipes-boundary.json" in str(failure.value)
    assert str(failure.value).strip()


@pytest.mark.parametrize("kind", ["missing", "malformed", "invalid UTF-8"])
def test_unreadable_data_does_not_fall_back(tmp_path, kind):
    domain = recipe_domain()
    path = tmp_path / "broken-recipes.json"
    if kind == "malformed":
        path.write_text("[{", encoding="utf-8")
    elif kind == "invalid UTF-8":
        path.write_bytes(b"\xff")
    with pytest.raises(domain.RecipeDataError) as failure:
        domain.load_recipes(path)
    assert path.name in str(failure.value)
    import inspect
    assert "recipe_path" in inspect.signature(create_app).parameters
    with pytest.raises(domain.RecipeDataError):
        create_app(testing=True, recipe_path=path)


def test_default_factory_still_serves_reads():
    application = create_app()
    assert application.config["TESTING"] is False
    assert len(read_collection(application.test_client())) >= 12
