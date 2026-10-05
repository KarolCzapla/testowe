"""Independent TableStory acceptance through public startup, HTTP and JS seams.

Human viewport, contrast, editorial and journey review remains a separate gate.
"""

import copy
import html
import json
import re
import subprocess
from html.parser import HTMLParser
from pathlib import Path

import pytest

from app import create_app
from recipes import RecipeDataError


ROOT = Path(__file__).resolve().parents[1]
FIELDS = {
    "id", "title", "description", "category", "dietary_tags", "prep_minutes",
    "cook_minutes", "difficulty", "servings", "ingredients", "steps", "colors", "featured",
}


class Page(HTMLParser):
    """Capture semantic structure without a browser or third-party parser."""

    def __init__(self, source):
        super().__init__(convert_charrefs=True)
        self.nodes = []
        self.stack = []
        self.feed(source)

    def handle_starttag(self, tag, attrs):
        node = {"tag": tag, "attrs": dict(attrs), "text": "", "parents": list(self.stack)}
        self.nodes.append(node)
        if tag not in {"meta", "link", "input", "br", "img", "hr"}:
            self.stack.append(node)

    def handle_endtag(self, tag):
        for index in range(len(self.stack) - 1, -1, -1):
            if self.stack[index]["tag"] == tag:
                del self.stack[index:]
                break

    def handle_data(self, data):
        for node in self.stack:
            node["text"] += data

    def select(self, tag=None, **attrs):
        return [node for node in self.nodes if (tag is None or node["tag"] == tag)
                and all(node["attrs"].get(key) == value for key, value in attrs.items())]


def catalog():
    return json.loads((ROOT / "catalog.json").read_text(encoding="utf-8"))


def test_documented_offline_single_process_handoff():
    readme = ROOT / "README.md"
    assert readme.is_file(), "R26: TableStory needs application-local setup and verification instructions"
    text = readme.read_text(encoding="utf-8")
    for required in ("TableStory", "-m pip install -r demo-app/requirements.txt",
                     "demo-app/app.py", "/?mode=tv", "-m pytest -q demo-app/tests",
                     "node --test demo-app/static/tests/*.test.js", "git diff --check"):
        assert required in text, f"R26/R30: missing documented command or URL: {required}"
    for pattern in (r"single[ -]process", r"offline", r"375", r"1920", r"human", r"contrast"):
        assert re.search(pattern, text, re.I), f"Missing local-operation/acceptance instruction: {pattern}"
    assert re.search(r"(?:https?://[^\s`]+/|mobile.{0,80}`/`)", text, re.I)
    assert re.search(r"(?:no|neither|without).{0,100}(?:credentials|secrets|API key)", text, re.I)


def test_complete_deterministic_recipe_objects_and_quotas(client):
    response = client.get("/api/recipes")
    assert response.status_code == 200
    recipes = response.get_json()
    assert recipes == catalog() == client.get("/api/recipes").get_json()
    assert len(recipes) >= 12
    assert len({r["id"] for r in recipes}) == len(recipes)
    assert len({r["title"].strip().lower() for r in recipes}) == len(recipes)
    assert {"Breakfast", "Lunch", "Dinner", "Dessert"} <= {r["category"] for r in recipes}
    predicates = [(lambda r: bool({"Vegetarian", "Vegan"} & set(r["dietary_tags"])), 3),
                  (lambda r: "Vegan" in r["dietary_tags"], 2),
                  (lambda r: r["prep_minutes"] + r["cook_minutes"] <= 30, 3),
                  (lambda r: r["category"] == "Dessert", 2), (lambda r: r["featured"], 2)]
    for predicate, minimum in predicates:
        assert sum(predicate(r) for r in recipes) >= minimum
    for recipe in recipes:
        assert set(recipe) == FIELDS
        assert re.fullmatch(r"[A-Za-z0-9_-]+", recipe["id"])
        for field in ("title", "description", "category"):
            assert isinstance(recipe[field], str) and recipe[field].strip()
        for field, minimum in (("prep_minutes", 1), ("cook_minutes", 0), ("servings", 1)):
            assert type(recipe[field]) is int and recipe[field] >= minimum
        assert recipe["difficulty"] in {"Easy", "Medium", "Confident Cook"}
        assert type(recipe["featured"]) is bool
        for field, minimum in (("ingredients", 1), ("steps", 3), ("dietary_tags", 0), ("colors", 2)):
            assert isinstance(recipe[field], list) and len(recipe[field]) >= minimum
            assert all(isinstance(value, str) and value.strip() for value in recipe[field])
        assert len(recipe["colors"]) == 2
        assert all(re.fullmatch(r"#(?:[\da-fA-F]{3}|[\da-fA-F]{6})", c) for c in recipe["colors"])


@pytest.mark.parametrize("fault", [
    "missing-file", "malformed", "root", "duplicate", "missing-field", "extra-field",
    "prep-bool", "cook-bool", "servings-bool", "prep-zero", "cook-negative",
    "bad-id", "blank-title", "difficulty", "ingredients", "steps", "tags", "colors",
    "featured-type", "count", "category-quota", "vegan-quota", "vegetarian-quota",
    "quick-quota", "dessert-quota", "featured-quota",
])
def test_startup_rejects_invalid_data_without_fallback(tmp_path, fault):
    raw = copy.deepcopy(catalog())
    path = tmp_path / "recipes.json"
    mutations = {
        "duplicate": ("id", raw[1]["id"]), "extra-field": ("unexpected", "x"),
        "prep-bool": ("prep_minutes", True), "cook-bool": ("cook_minutes", False),
        "servings-bool": ("servings", True), "prep-zero": ("prep_minutes", 0),
        "cook-negative": ("cook_minutes", -1), "bad-id": ("id", "not/url/safe"),
        "blank-title": ("title", " "), "difficulty": ("difficulty", "Hard"),
        "ingredients": ("ingredients", [""]), "steps": ("steps", ["One", "Two"]),
        "tags": ("dietary_tags", "Vegan"), "colors": ("colors", ["#123", "invalid"]),
        "featured-type": ("featured", 1),
    }
    if fault in mutations:
        field, value = mutations[fault]
        raw[0][field] = value
    elif fault == "missing-field":
        del raw[0]["ingredients"]
    elif fault == "root":
        raw = {"recipes": raw}
    elif fault == "count":
        raw = raw[:11]
    elif fault.endswith("quota"):
        for record in raw:
            if fault == "category-quota" and record["category"] == "Breakfast":
                record["category"] = "Lunch"
            elif fault == "dessert-quota" and record["category"] == "Dessert":
                record["category"] = "Dinner"
            elif fault == "vegan-quota":
                record["dietary_tags"] = ["Vegetarian"]
            elif fault == "vegetarian-quota":
                record["dietary_tags"] = []
            elif fault == "quick-quota":
                record["cook_minutes"] = 90
            elif fault == "featured-quota":
                record["featured"] = False
    if fault != "missing-file":
        path.write_text("{" if fault == "malformed" else json.dumps(raw), encoding="utf-8")
    with pytest.raises(RecipeDataError, match=re.escape(str(path))):
        create_app(testing=True, recipe_path=path)


def test_shared_search_cases_api_and_browser_with_explicit_expectations(tmp_path):
    raw = catalog()
    raw[0].update(title="Crème İ Σ ΟΣ Straße", description="Boundary left.",
                  ingredients=["Onlyneedle chickpeas + lemon (fresh)", "separate ingredient"])
    raw[1]["description"] = "Boundary right."
    raw[1]["dietary_tags"] = ["Vegetarian", "Distincttag"]
    path = tmp_path / "search-recipes.json"
    path.write_text(json.dumps(raw), encoding="utf-8")
    client = create_app(testing=True, recipe_path=path).test_client()
    first, second = raw[0]["id"], raw[1]["id"]
    cases = [("", [r["id"] for r in raw]), ("\x85 \t", [r["id"] for r in raw]),
             (" CRÈME ", [first]), ("İ", [first]), ("ΟΣ", [first]), ("Straße", [first]),
             ("STRASSE", []), ("\x1cONLYNEEDLE\x85", [first]),
             ("+ lemon (", [first]), ("distinctTAG", [second]),
             ("Boundary right.", [second]), ("left. Breakfast", []),
             ("(fresh) separate", []), ("Vegetarian Distincttag", []),
             ("\ufeffOnlyneedle\ufeff", []), ("no-such-ingredient-zz", [])]
    for field in ("title", "description", "category", "dietary_tags", "ingredients"):
        value = raw[2][field]
        query = value[0] if isinstance(value, list) else value
        expected = [r["id"] for r in raw if any(query.strip().lower() in v.lower()
                    for v in [r["title"], r["description"], r["category"],
                              *r["dietary_tags"], *r["ingredients"]])]
        cases.append((query.upper(), expected))
    actual = []
    for query, expected in cases:
        response = client.get("/api/recipes", query_string={"q": query})
        assert response.status_code == 200
        ids = [r["id"] for r in response.get_json()]
        assert ids == expected, repr(query)
        actual.append(ids)
    result = subprocess.run(["node", "--input-type=module", "-e", """
import {matchesRecipe} from './static/app-logic.js';
import {readFileSync} from 'node:fs';
const {recipes, queries} = JSON.parse(readFileSync(0, 'utf8'));
console.log(JSON.stringify(queries.map(q => recipes.filter(r => matchesRecipe(r, q)).map(r => r.id))));
"""], cwd=ROOT, input=json.dumps({"recipes": raw, "queries": [q for q, _ in cases]}),
                            text=True, capture_output=True, check=True, timeout=20)
    assert json.loads(result.stdout) == actual


def test_lookup_mutations_validation_order_and_application_isolation(client):
    recipes = client.get("/api/recipes").get_json()
    ids = [r["id"] for r in recipes[:2]]
    assert client.get("/api/cookbook").get_json() == []
    for recipe in recipes:
        response = client.get(f"/api/recipes/{recipe['id']}")
        assert response.status_code == 200 and response.get_json() == recipe
    missing = client.get("/api/recipes/not-a-recipe")
    assert missing.status_code == 404 and missing.get_json() == {"error": "Recipe not found"}
    page = client.get("/recipe/not-a-recipe")
    assert page.status_code == 404 and "TableStory" in page.text and "Recipe" in page.text
    for recipe_id in reversed(ids):
        response = client.post("/api/cookbook", json={"id": recipe_id})
        assert response.status_code == 201
    response = client.post("/api/cookbook", json={"id": ids[0]})
    assert response.status_code == 201 and response.get_json() == {"recipe_ids": sorted(ids)}
    assert client.get("/api/cookbook").get_json() == recipes[:2]
    invalid = [None, [], "id", 3, True, {}, {"id": []}, {"id": 3}, {"id": " "}]
    for payload in invalid:
        response = client.post("/api/cookbook", data=json.dumps(payload), content_type="application/json")
        assert response.status_code == 400 and response.get_json() == {"error": "Provide a recipe id"}
    for data, content_type in (("{", "application/json"), ("id=x", "text/plain")):
        response = client.post("/api/cookbook", data=data, content_type=content_type)
        assert response.status_code == 400 and response.get_json() == {"error": "Provide a recipe id"}
    unknown = client.post("/api/cookbook", json={"id": "not-a-recipe"})
    assert unknown.status_code == 400 and unknown.get_json() == {"error": "Unknown recipe"}
    assert client.get("/api/cookbook").get_json() == recipes[:2]
    assert create_app(testing=True).test_client().get("/api/cookbook").get_json() == []
    remaining = set(ids)
    for recipe_id in (*ids, *ids, "not-a-recipe"):
        response = client.delete(f"/api/cookbook/{recipe_id}")
        assert response.status_code == 200
        remaining.discard(recipe_id)
        assert response.get_json() == {"recipe_ids": sorted(remaining)}
    assert client.get("/api/cookbook").get_json() == []


@pytest.mark.parametrize("hint", ["Smart-TV", "SmartTV", "HbbTV", "Tizen", "WebOS", "NetCast"])
def test_mode_selection_and_return_destinations(client, hint):
    recipe = catalog()[0]
    for query, agent, mode in (("", "Ordinary browser", "mobile"),
                               ("?mode=tv", "Ordinary browser", "tv"),
                               ("?mode=mobile", hint.swapcase(), "tv")):
        browse = "/?mode=tv" if mode == "tv" else "/"
        for route in ("/", f"/recipe/{recipe['id']}"):
            response = client.get(route + query, headers={"User-Agent": agent})
            assert response.status_code == 200
            page = Page(response.text)
            bootstrap = json.loads(page.select("script", id="page-bootstrap")[0]["text"])
            assert bootstrap["mode"] == mode and bootstrap["browse_url"] == browse
            brand = [n for n in page.select("a") if "brand" in n["attrs"].get("class", "").split()]
            assert brand[0]["attrs"]["href"] == browse
            if route != "/":
                assert any(n["attrs"].get("class") == "back" and n["attrs"]["href"] == browse
                           for n in page.select("a"))


def test_rails_api_matches_rendered_membership_after_save_and_remove(client):
    recipes = catalog()
    predicates = [lambda r: r["featured"], lambda r: r["prep_minutes"] + r["cook_minutes"] <= 30,
                  lambda r: bool({"Vegetarian", "Vegan"} & set(r["dietary_tags"]))]
    labels = ["Popular this week", "Ready in 30 minutes", "Vegetarian favourites", "My Cookbook"]
    rail_ids = ["RAIL_POPULAR", "RAIL_QUICK", "RAIL_VEGETARIAN", "RAIL_COOKBOOK"]
    for saved in (False, True, False):
        recipe_id = recipes[-1]["id"]
        if saved:
            client.post("/api/cookbook", json={"id": recipe_id})
        else:
            client.delete(f"/api/cookbook/{recipe_id}")
        response = client.get("/api/rails")
        assert response.status_code == 200
        rails = response.get_json()
        assert [r["id"] for r in rails] == rail_ids
        assert [r["name"] for r in rails] == labels
        expected = [[r["id"] for r in recipes if predicate(r)] for predicate in predicates]
        expected.append([recipe_id] if saved else [])
        assert [r["recipe_ids"] for r in rails] == expected
        assert all(set(r) == {"id", "name", "recipe_ids"} for r in rails)
        assert all(len(r["recipe_ids"]) >= 2 for r in rails[:3])
        page = Page(client.get("/?mode=tv").text)
        sections = [n for n in page.select("section") if "data-rail-id" in n["attrs"]]
        assert [n["attrs"]["data-rail-id"] for n in sections] == rail_ids
        for section, rail in zip(sections, rails):
            cards = [n for n in page.select("article") if section in n["parents"]]
            assert [n["attrs"]["data-recipe-id"] for n in cards] == rail["recipe_ids"]
            for node in page.select("a"):
                if section in node["parents"]:
                    assert node["attrs"]["href"].endswith("?mode=tv")


def test_all_cards_detail_order_accessible_states_and_safe_bootstrap(client, tmp_path):
    recipes = catalog()
    page = Page(client.get("/").text)
    assert "Good food, clearly told." in page.select("h1")[0]["text"]
    cards = page.select("article")
    assert [n["attrs"]["data-recipe-id"] for n in cards] == [r["id"] for r in recipes]
    assert page.select("p", id="count")[0]["attrs"]["aria-live"] == "polite"
    assert page.select("p", id="empty")[0]["text"] == "No recipes found. Try another ingredient or dish."
    for card, recipe in zip(cards, recipes):
        assert recipe["title"] in card["text"] and recipe["difficulty"] in card["text"]
        assert recipe["category"] in card["text"]
        assert f"{recipe['prep_minutes'] + recipe['cook_minutes']} minutes" in card["text"]
        button = [n for n in page.select("button") if card in n["parents"]][0]
        assert button["attrs"]["aria-label"] == f"Add {recipe['title']} to My Cookbook"
        assert button["attrs"]["aria-pressed"] == "false"
        assert not any(n["tag"] == "a" for n in button["parents"])
    for recipe in recipes:
        detail = Page(client.get(f"/recipe/{recipe['id']}").text)
        assert detail.select("h1")[0]["text"] == recipe["title"]
        assert html.escape(recipe["description"]) in client.get(f"/recipe/{recipe['id']}").text
        for tag, field in (("ul", "ingredients"), ("ol", "steps")):
            parent = detail.select(tag)[0]
            assert [n["text"] for n in detail.select("li") if parent in n["parents"]] == recipe[field]
        assert [n["text"] for n in detail.select("dd")] == [
            f"{recipe['prep_minutes']} minutes", f"{recipe['cook_minutes']} minutes",
            f"{recipe['prep_minutes'] + recipe['cook_minutes']} minutes", recipe["difficulty"], str(recipe["servings"])]
    recipe = recipes[0]
    client.post("/api/cookbook", json={"id": recipe["id"]})
    saved = Page(client.get(f"/recipe/{recipe['id']}").text).select("button")[0]
    assert saved["attrs"]["aria-pressed"] == "true"
    assert saved["attrs"]["aria-label"] == f"Remove {recipe['title']} from My Cookbook"
    recipes[0].update(title='Soup </script><script>alert("x")</script> & herbs',
                      dietary_tags=[], cook_minutes=0)
    path = tmp_path / "safe.json"
    path.write_text(json.dumps(recipes), encoding="utf-8")
    safe = create_app(testing=True, recipe_path=path).test_client()
    source = safe.get(f"/recipe/{recipe['id']}").text
    parsed = Page(source)
    assert len(parsed.select("script")) == 2
    assert json.loads(parsed.select("script", id="page-bootstrap")[0]["text"])["recipes"] == [recipes[0]]


def prohibited_pattern():
    # Construct deprecated vocabulary so the audit does not retain obsolete fixtures.
    words = ["mo" + "vie", "fi" + "lm", "cine" + "ma", "watch" + "list",
             "pos" + "ter", "run" + "time", "rat" + "ing", "gen" + "re", "P" + "C"]
    return words, re.compile(r"(?<![A-Za-z0-9])(?:" + "|".join(words) + r")(?:s)?(?![A-Za-z0-9])", re.I)


def test_word_aware_source_symbols_fixtures_and_tests():
    _, pattern = prohibited_pattern()
    allowed = {".py", ".js", ".ts", ".tsx", ".json", ".html", ".css", ".md", ".txt"}
    for path in ROOT.rglob("*"):
        if path.is_file() and path.suffix in allowed and not any(
            part in {"__pycache__", ".pytest_cache", "node_modules", ".venv"} for part in path.parts
        ):
            assert not pattern.search(path.read_text(encoding="utf-8")), str(path.relative_to(ROOT))
def test_rendered_terminology_payloads_and_deprecated_route_absence(client):
    words, pattern = prohibited_pattern()
    for route in ("/", "/?mode=tv", f"/recipe/{catalog()[0]['id']}", "/recipe/missing",
                  "/api/recipes", "/api/cookbook", "/api/rails", "/api/recipes/missing"):
        assert not pattern.search(client.get(route).text), route
    deprecated = ["/" + words[0] + "/x", "/api/" + words[0] + "s", "/api/" + words[0] + "s/x",
                  "/api/" + words[3], "/api/" + words[3] + "/x"]
    for route in deprecated:
        for method in ("GET", "POST", "DELETE"):
            assert client.open(route, method=method).status_code == 404
    rules = {rule.rule for rule in client.application.url_map.iter_rules()}
    assert rules == {"/", "/recipe/<recipe_id>", "/api/recipes", "/api/recipes/<recipe_id>",
                     "/api/cookbook", "/api/cookbook/<recipe_id>", "/api/rails", "/static/<path:filename>"}


def test_offline_pages_request_only_served_local_assets(client):
    for route in ("/", "/?mode=tv", f"/recipe/{catalog()[0]['id']}?mode=tv"):
        page = Page(client.get(route).text)
        for node in page.nodes:
            if node["tag"] in {"script", "link", "img", "iframe", "source"}:
                asset = node["attrs"].get("src") or node["attrs"].get("href")
                if asset:
                    assert asset.startswith("/static/") and not asset.startswith("//")
                    assert client.get(asset).status_code == 200
    css = (ROOT / "static/styles.css").read_text(encoding="utf-8")
    assert not re.search(r"@import|url\(\s*['\"]?(?:https?:)?//", css, re.I)
    dependencies = (ROOT / "requirements.txt").read_text(encoding="utf-8").splitlines()
    names = {re.split(r"[<>=!~\[]", line.strip())[0].lower() for line in dependencies
             if line.strip() and not line.lstrip().startswith("#")}
    assert names == {"flask", "pytest"}, "R28: no new external dependencies"
