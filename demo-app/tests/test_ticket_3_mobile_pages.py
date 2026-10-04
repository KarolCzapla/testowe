"""Ticket 3: public mobile HTML, authoritative state, and search parity.

Browser observations (375px layout, actual focus, computed contrast and offline
artwork) remain required; markup assertions cannot establish those properties.
"""

import json
import re
import subprocess
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import urlsplit

import pytest

from app import create_app


class Element:
    def __init__(self, tag, attrs=(), parent=None):
        self.tag, self.attrs, self.parent = tag, dict(attrs), parent
        self.children = []

    def all(self, tag=None):
        for child in self.children:
            if isinstance(child, Element):
                if tag is None or child.tag == tag:
                    yield child
                yield from child.all(tag)

    def text(self):
        return "".join(c.text() if isinstance(c, Element) else c for c in self.children)

    def visible(self):
        if self.tag in {"script", "style"} or "hidden" in self.attrs or self.attrs.get("aria-hidden") == "true":
            return ""
        return " ".join(c.visible() if isinstance(c, Element) else c for c in self.children)


class Document(HTMLParser):
    VOID = {"area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr"}

    def __init__(self, html):
        super().__init__(convert_charrefs=True)
        self.root = Element("document")
        self.current = self.root
        self.feed(html)

    def handle_starttag(self, tag, attrs):
        node = Element(tag, attrs, self.current)
        self.current.children.append(node)
        if tag not in self.VOID:
            self.current = node

    def handle_endtag(self, tag):
        node = self.current
        while node.parent is not None:
            if node.tag == tag:
                self.current = node.parent
                return
            node = node.parent

    def handle_data(self, data):
        self.current.children.append(data)


def normalized(text):
    return " ".join(text.split())


def page(client, url, status=200):
    response = client.get(url)
    assert response.status_code == status, f"{url} must return branded recipe HTML ({status})"
    assert response.mimetype == "text/html"
    return Document(response.get_data(as_text=True)).root


def recipes(client):
    response = client.get("/api/recipes")
    assert response.status_code == 200
    return response.get_json()


def name(node, root):
    if node.attrs.get("aria-label"):
        return node.attrs["aria-label"]
    if node.attrs.get("aria-labelledby"):
        ids = node.attrs["aria-labelledby"].split()
        return " ".join(n.text() for n in root.all() if n.attrs.get("id") in ids)
    return normalized(node.visible())


def bootstrap(root):
    candidates = [json.loads(n.text()) for n in root.all("script")
                  if n.attrs.get("type") == "application/json"]
    found = [data for data in candidates if isinstance(data, dict) and "saved_recipe_ids" in data]
    assert len(found) == 1, "One safely encoded authoritative page bootstrap is required"
    return found[0]


def chrome(root):
    assert any("TableStory" in n.text() for n in root.all("title"))
    assert any(n.attrs.get("name") == "viewport" and "width=device-width" in n.attrs.get("content", "")
               for n in root.all("meta"))
    assert any("TableStory" in name(a, root) and a.attrs.get("href") == "/"
               for h in root.all("header") for a in h.all("a"))
    customer_text = " ".join([root.visible(), *[n.attrs.get("aria-label", "") for n in root.all()],
                              *[n.text() for n in root.all("title")],
                              *[n.attrs.get("content", "") for n in root.all("meta")]])
    assert not re.search(r"\b(pocket cinema|PC|movies?|films?|cinema|watchlist|posters?|runtime|rating|genres?|profile|account)\b",
                         customer_text, re.I)
    assert not any(n.attrs.get("src", "").startswith(("http:", "https:", "//")) for n in root.all())


def cookbook_button(root, recipe, saved):
    matches = [b for b in root.all("button") if recipe["title"] in name(b, root) and "My Cookbook" in name(b, root)]
    assert len(matches) == 1, f"Separate dish-specific cookbook button required for {recipe['id']}"
    button = matches[0]
    assert ("Remove" if saved else "Add") in name(button, root)
    assert button.attrs.get("aria-pressed") == str(saved).lower()
    assert "My Cookbook" in button.visible(), "Current state needs a visible non-color cue"
    assert ("Remove" if saved else "Add") in button.visible()
    ancestor = button.parent
    while ancestor:
        assert ancestor.tag != "a", "Cookbook actions must not be nested in recipe links"
        ancestor = ancestor.parent
    return button


def test_mobile_browse_all_recipe_cards_chrome_search_and_bootstrap(client):
    expected = recipes(client)
    root = page(client, "/")
    chrome(root)
    assert "Good food, clearly told." in normalized(root.visible())
    assert re.search(r"everyday", root.visible(), re.I), "Home must introduce everyday cooking"
    search = [n for n in root.all("input") if n.attrs.get("type") == "search"]
    assert len(search) == 1
    label = name(search[0], root)
    if not label:
        label = " ".join(n.text() for n in root.all("label")
                         if n.attrs.get("for") == search[0].attrs.get("id") or search[0] in list(n.all()))
    assert re.search(r"recipe|dish|ingredient", label, re.I), "Search needs an accessible recipe name"
    cards = [n for n in root.all("article") if any(urlsplit(a.attrs.get("href", "")).path.startswith("/recipe/") for a in n.all("a"))]
    assert len(cards) == len(expected)
    for card, recipe in zip(cards, expected):
        assert "hidden" not in card.attrs
        links = [a for a in card.all("a") if urlsplit(a.attrs.get("href", "")).path == f"/recipe/{recipe['id']}"]
        assert links and any(recipe["title"] in name(a, root) for a in links)
        text = normalized(card.visible())
        assert recipe["title"] in text
        assert recipe["difficulty"] in text
        assert any(label in text for label in [recipe["category"], *recipe["dietary_tags"]])
        total = recipe["prep_minutes"] + recipe["cook_minutes"]
        assert re.search(rf"\b{total}\s*(?:minutes|mins?|m)\b", text, re.I)
        cookbook_button(card, recipe, False)
    statuses = [n for n in root.all() if n.attrs.get("role") == "status" or n.attrs.get("aria-live") == "polite"]
    assert any(re.search(rf"\b{len(expected)}\s+recipes\b", n.visible(), re.I) for n in statuses)
    assert any(normalized(n.text()) == "No recipes found. Try another ingredient or dish."
               and "hidden" in n.attrs for n in root.all())
    data = bootstrap(root)
    assert data["page"] == "browse" and data["mode"] == "mobile"
    assert data["recipes"] == expected
    assert data["saved_recipe_ids"] == [] and data["browse_url"] == "/"
    assert any(n.attrs.get("type") == "module" and urlsplit(n.attrs.get("src", "")).path == "/static/app.js"
               for n in root.all("script"))


@pytest.mark.parametrize("recipe_id", [r["id"] for r in json.loads(
    (Path(__file__).parents[1] / "catalog.json").read_text(encoding="utf-8"))])
def test_details_show_metadata_and_preserve_order(client, recipe_id):
    recipe = next(r for r in recipes(client) if r["id"] == recipe_id)
    root = page(client, f"/recipe/{recipe['id']}")
    chrome(root)
    assert any(normalized(n.visible()) == recipe["title"] for n in root.all("h1"))
    text = normalized(root.visible())
    for value in [recipe["description"], recipe["category"], recipe["difficulty"], *recipe["dietary_tags"]]:
        assert value in text
    for label, value in [("Prep", recipe["prep_minutes"]), ("Cook", recipe["cook_minutes"]),
                         ("Total", recipe["prep_minutes"] + recipe["cook_minutes"])]:
        assert re.search(rf"{label}(?:\s+time)?\s*:?\s*{value}\s*(?:minutes|mins?|m)\b", text, re.I), text
    assert re.search(rf"Servings\s*:?\s*{recipe['servings']}\b", text, re.I)
    for tag, field in [("ul", "ingredients"), ("ol", "steps")]:
        assert any([normalized(n.visible()) for n in listing.children if isinstance(n, Element) and n.tag == "li"]
                   == recipe[field] for listing in root.all(tag)), f"{field} must retain stored order"
    cookbook_button(root, recipe, False)
    assert any(a.attrs.get("href") == "/" and re.search(r"browse|back", name(a, root), re.I) for a in root.all("a"))
    data = bootstrap(root)
    assert data["page"] == "detail" and data["mode"] == "mobile"
    assert recipe in data["recipes"] and data["browse_url"] == "/"


def test_saved_state_is_server_authoritative_on_browse_and_detail(client):
    recipe = recipes(client)[0]
    assert client.post("/api/cookbook", json={"id": recipe["id"]}).status_code == 201
    for url in ["/", f"/recipe/{recipe['id']}"]:
        root = page(client, url)
        cookbook_button(root, recipe, True)
        assert bootstrap(root)["saved_recipe_ids"] == [recipe["id"]]
    assert client.delete(f"/api/cookbook/{recipe['id']}").status_code == 200
    for url in ["/", f"/recipe/{recipe['id']}"]:
        root = page(client, url)
        cookbook_button(root, recipe, False)
        assert bootstrap(root)["saved_recipe_ids"] == []


def test_unknown_recipe_returns_branded_recipe_specific_404(client):
    root = page(client, "/recipe/unknown-ticket-3", 404)
    chrome(root)
    assert re.search(r"recipe.*(?:not found|could not|couldn't|missing)", normalized(root.visible()), re.I)
    assert any(a.attrs.get("href") == "/" and re.search(r"browse|recipe", name(a, root), re.I) for a in root.all("a"))


def test_html_sensitive_long_content_zero_cook_and_empty_tags(tmp_path, client):
    catalog = recipes(client)
    special = catalog[0]
    special.update(title='A <script>alert("recipe")</script> & "long" dish ' + "x" * 160,
                   description="Everyday cooking with <b>literal</b> text & calm instructions.",
                   dietary_tags=[], cook_minutes=0,
                   ingredients=["First <img src=x onerror=alert(1)> ingredient", "Second " + "long " * 100],
                   steps=["First <script>unsafe()</script> instruction", "Second instruction", "Third " + "long " * 100])
    path = tmp_path / "recipes.json"
    path.write_text(json.dumps(catalog), encoding="utf-8")
    local = create_app(testing=True, recipe_path=path).test_client()
    for url in ["/", f"/recipe/{special['id']}"]:
        root = page(local, url)
        assert special["title"] in normalized(root.visible())
        assert special in bootstrap(root)["recipes"]
        assert not any("alert(" in n.text() or "unsafe()" in n.text() for n in root.all("script")
                       if n.attrs.get("type") != "application/json")
        assert not any("onerror" in n.attrs for n in root.all())
    detail = page(local, f"/recipe/{special['id']}")
    assert re.search(r"Cook(?:\s+time)?\s*:?\s*0\s*(?:minutes|mins?|m)\b", normalized(detail.visible()), re.I)
    assert "undefined" not in detail.visible() and "None" not in detail.visible()


def test_local_styles_supply_approved_palette_focus_and_offline_artwork(client):
    response = client.get("/static/styles.css")
    assert response.status_code == 200
    css = response.get_data(as_text=True)
    for color in ["#FFF8ED", "#C9472D", "#3F6B4F", "#26231F", "#E9B44C"]:
        assert color.lower() in css.lower(), f"Approved palette token {color} required"
    assert re.search(r":focus(?:-visible|-within)?\b", css), "Visible keyboard-focus styling required"
    assert "gradient(" in css, "Varied food-inspired CSS artwork required"
    assert not re.search(r"(?:url\(\s*['\"]?|@import\s*['\"])(?:https?:|//)", css, re.I)
    # These source checks establish local tokens/treatments only. Applied
    # contrast, meaningful artwork, actual focus and overflow require a browser.


def test_browser_and_api_matching_have_identical_ordered_ids(client):
    corpus = recipes(client)
    queries = ["", "  ", "no-such-dish-ticket-3", "CHICKPEAS", "tomato", "Vegetarian", "Dinner", "İ", "Σ", "ß"]
    for recipe in corpus:
        queries.extend([recipe["title"].swapcase(), recipe["description"], recipe["category"],
                        *recipe["dietary_tags"], *recipe["ingredients"]])
    queries += ["  " + q + "  " for q in queries[:10]]
    module = Path(__file__).parents[1] / "static/app-logic.js"
    script = """
        import fs from 'node:fs';
        import {pathToFileURL} from 'node:url';
        const logic = await import(pathToFileURL(process.argv[1]));
        if (typeof logic.matchesRecipe !== 'function') {
          process.stdout.write(JSON.stringify({missing: 'matchesRecipe'}));
        } else {
          const {corpus, queries} = JSON.parse(fs.readFileSync(0, 'utf8'));
          process.stdout.write(JSON.stringify(queries.map(q => corpus.filter(r => logic.matchesRecipe(r, q)).map(r => r.id))));
        }
    """
    result = subprocess.run(["node", "--input-type=module", "-e", script, str(module)],
                            input=json.dumps({"corpus": corpus, "queries": queries}), text=True,
                            capture_output=True, timeout=20, check=True)
    browser_ids = json.loads(result.stdout)
    assert isinstance(browser_ids, list), "Pure matchesRecipe(recipe, query) is required"
    assert browser_ids == [[r["id"] for r in client.get("/api/recipes", query_string={"q": q}).get_json()] for q in queries]
