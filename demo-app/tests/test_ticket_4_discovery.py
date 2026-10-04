"""Ticket 4 acceptance through HTTP, without production-module assumptions.

Browser review must still capture 375px mobile and 1920x1080 TV browse/detail,
check horizontal rails, unclipped controls, focus contrast and distance-readable
long content. Parsed HTML cannot establish computed layout or readability.
TV remote key transitions belong to the later navigation slice.
"""

import json
from html.parser import HTMLParser
from urllib.parse import parse_qs, urlsplit

import pytest

from app import create_app


RAILS = (
    ("RAIL_POPULAR", "Popular this week"),
    ("RAIL_QUICK", "Ready in 30 minutes"),
    ("RAIL_VEGETARIAN", "Vegetarian favourites"),
    ("RAIL_COOKBOOK", "My Cookbook"),
)
HINTS = ("Smart-TV", "SmartTV", "HbbTV", "Tizen", "WebOS", "NetCast")


class Node:
    def __init__(self, tag, attrs=(), parent=None):
        self.tag, self.attrs, self.parent = tag, dict(attrs), parent
        self.children = []

    def all(self, tag=None):
        for child in self.children:
            if isinstance(child, Node):
                if tag is None or child.tag == tag:
                    yield child
                yield from child.all(tag)

    def text(self):
        return "".join(c.text() if isinstance(c, Node) else c for c in self.children)


class Document(HTMLParser):
    VOID = {"area", "base", "br", "col", "embed", "hr", "img", "input",
            "link", "meta", "param", "source", "track", "wbr"}

    def __init__(self, html):
        super().__init__(convert_charrefs=True)
        self.root = self.current = Node("document")
        self.feed(html)

    def handle_starttag(self, tag, attrs):
        node = Node(tag, attrs, self.current)
        self.current.children.append(node)
        if tag not in self.VOID:
            self.current = node

    def handle_endtag(self, tag):
        node = self.current
        while node.parent:
            if node.tag == tag:
                self.current = node.parent
                return
            node = node.parent

    def handle_data(self, data):
        self.current.children.append(data)


def text(node):
    return " ".join(node.text().split())


def page(client, path="/", query=None, ua="Workshop browser"):
    response = client.get(path, query_string=query or {}, headers={"User-Agent": ua})
    assert response.status_code == 200
    assert response.mimetype == "text/html"
    return Document(response.get_data(as_text=True)).root


def bootstrap(root):
    data = [json.loads(n.text()) for n in root.all("script")
            if n.attrs.get("type") == "application/json"]
    matches = [d for d in data if isinstance(d, dict) and "mode" in d]
    assert len(matches) == 1, "Page must expose one authoritative mode bootstrap"
    return matches[0]


def corpus(client):
    response = client.get("/api/recipes")
    assert response.status_code == 200
    return response.get_json()


def expected_rails(recipes, saved=()):
    predicates = (
        lambda r: r["featured"],
        lambda r: r["prep_minutes"] + r["cook_minutes"] <= 30,
        lambda r: bool({"Vegetarian", "Vegan"} & set(r["dietary_tags"])),
        lambda r: r["id"] in saved,
    )
    return [{"id": rid, "name": label,
             "recipe_ids": [r["id"] for r in recipes if predicate(r)]}
            for (rid, label), predicate in zip(RAILS, predicates)]


def api_rails(client, expected):
    response = client.get("/api/rails")
    assert response.status_code == 200, "GET /api/rails must expose discovery groups"
    assert response.mimetype == "application/json"
    assert response.get_json() == expected, "Rail fields, names, order and memberships must match"
    for rail in response.get_json()[:3]:
        assert len(rail["recipe_ids"]) >= 2


def destination(href, path, mode):
    url = urlsplit(href)
    assert url.path == path
    assert not url.scheme and not url.netloc
    assert parse_qs(url.query).get("mode") == (["tv"] if mode == "tv" else None)


def html_rails(root, expected):
    headings = [h for h in root.all() if h.tag in {"h2", "h3"}
                and text(h) in {label for _, label in RAILS}]
    assert [text(h) for h in headings] == [r["name"] for r in expected]
    for heading, rail in zip(headings, expected):
        group = heading.parent
        while group.parent and not any(
                rail["id"] == group.attrs.get(key) for key in ("id", "data-rail-id")):
            group = group.parent
        assert group.parent, f"Rendered rail must expose stable ID {rail['id']}"
        assert "hidden" not in group.attrs and group.attrs.get("aria-hidden") != "true"
        links = [a for a in group.all("a")
                 if urlsplit(a.attrs.get("href", "")).path.startswith("/recipe/")]
        assert [urlsplit(a.attrs["href"]).path.removeprefix("/recipe/")
                for a in links] == rail["recipe_ids"]
        for link in links:
            destination(link.attrs["href"], urlsplit(link.attrs["href"]).path, "tv")
    ids = [n.attrs["id"] for n in root.all() if "id" in n.attrs]
    assert len(ids) == len(set(ids)), "Repeated rail recipes must have unique DOM IDs"


MODE_CASES = [
    pytest.param({}, "Workshop browser", "mobile", id="default"),
    pytest.param({"mode": "tv"}, "Workshop browser", "tv", id="explicit-tv"),
    *[pytest.param({"mode": mode}, "Workshop browser", "mobile", id=f"fallback-{mode!r}")
      for mode in ("TV", "Tv", " tv", "tv ", "mobile", "desktop", "")],
    *[pytest.param(query, f"Workshop {hint.swapcase()}/1.0", "tv",
                   id=f"{hint}-{'query' if query else 'ua'}")
      for hint in HINTS for query in ({}, {"mode": "mobile"})],
    pytest.param({"mode": "TV"}, "Workshop TiZeN", "tv", id="nonexact-query-with-hint"),
    pytest.param({}, "Mozilla Television Android", "mobile", id="unrecognized-ua"),
]


@pytest.mark.parametrize("query,ua,mode", MODE_CASES)
def test_mode_selection_and_destinations_on_both_pages(client, query, ua, mode):
    recipe = corpus(client)[0]
    for path in ("/", f"/recipe/{recipe['id']}"):
        root = page(client, path, query, ua)
        state = bootstrap(root)
        assert state["mode"] == mode, "Exact tv query or approved UA hint must select TV"
        destination(state["browse_url"], "/", mode)
        brand = [a for h in root.all("header") for a in h.all("a")
                 if "TableStory" in a.attrs.get("aria-label", text(a))]
        assert len(brand) == 1
        destination(brand[0].attrs["href"], "/", mode)
        if path != "/":
            back = [a for a in root.all("a") if "browse" in text(a).lower()
                    or "back" in text(a).lower()]
            assert back, "Detail needs a mode-preserving browse/back action"
            for link in back:
                destination(link.attrs["href"], "/", mode)
        elif mode == "tv":
            html_rails(root, expected_rails(corpus(client)))
        else:
            links = [a for a in root.all("a") if a.attrs.get("href", "").startswith("/recipe/")]
            assert [urlsplit(a.attrs["href"]).path for a in links] == [
                f"/recipe/{r['id']}" for r in corpus(client)]


def test_api_and_html_rail_membership_boundaries(tmp_path, client):
    recipes = corpus(client)
    # Keep the validated collection's quotas while making decisive boundaries:
    # total time uses both fields, category alone is not a dietary tag.
    recipes[0].update(prep_minutes=20, cook_minutes=10, featured=True,
                      dietary_tags=["Vegan"])
    recipes[1].update(prep_minutes=20, cook_minutes=11, featured=False,
                      dietary_tags=[], category="Vegetarian")
    recipes[2].update(prep_minutes=30, cook_minutes=0, featured=True,
                      dietary_tags=["Vegetarian", "Vegan"])
    recipes[3].update(prep_minutes=1, cook_minutes=30, featured=False,
                      dietary_tags=["Vegetarian"])
    path = tmp_path / "ticket-4-recipes.json"
    path.write_text(json.dumps(recipes), encoding="utf-8")
    local = create_app(testing=True, recipe_path=path).test_client()
    expected = expected_rails(recipes)
    api_rails(local, expected)
    html_rails(page(local, query={"mode": "tv"}), expected)
    html_rails(page(local, ua="Workshop sMaRtTv"), expected)


def test_cookbook_rail_refresh_order_removal_and_application_isolation(client):
    recipes = corpus(client)
    saved = set()
    for recipe in reversed(recipes[:3]):
        assert client.post("/api/cookbook", json={"id": recipe["id"]}).status_code == 201
        saved.add(recipe["id"])
        expected = expected_rails(recipes, saved)
        api_rails(client, expected)
        html_rails(page(client, query={"mode": "tv"}), expected)
    assert client.post("/api/cookbook", json={"id": "unknown-ticket-4"}).status_code == 400
    api_rails(client, expected_rails(recipes, saved))
    for recipe in recipes[:3]:
        for _ in range(2):
            assert client.delete(f"/api/cookbook/{recipe['id']}").status_code == 200
            saved.discard(recipe["id"])
            expected = expected_rails(recipes, saved)
            api_rails(client, expected)
            html_rails(page(client, ua="Workshop WEBOS"), expected)
    # Empty cookbook must still have its fourth API entry and visible heading.
    fresh = create_app(testing=True).test_client()
    api_rails(fresh, expected_rails(recipes))
    html_rails(page(fresh, query={"mode": "tv"}), expected_rails(recipes))


def test_tv_detail_retains_readable_content_and_primary_actions(client):
    recipe = max(corpus(client), key=lambda r: sum(map(len, r["steps"])))
    root = page(client, f"/recipe/{recipe['id']}", ua="Workshop NETCAST")
    assert bootstrap(root)["mode"] == "tv"
    assert recipe["title"] in text(root) and recipe["description"] in text(root)
    for tag, field in (("ul", "ingredients"), ("ol", "steps")):
        assert any([text(n) for n in listing.children if isinstance(n, Node) and n.tag == "li"]
                   == recipe[field] for listing in root.all(tag))
    actions = [b for b in root.all("button") if "My Cookbook" in b.attrs.get("aria-label", "")]
    assert len(actions) == 1
    assert recipe["title"] in actions[0].attrs["aria-label"]
    assert "hidden" not in actions[0].attrs and "disabled" not in actions[0].attrs
    assert any(n.attrs.get("name") == "viewport" and "width=device-width" in n.attrs.get("content", "")
               for n in root.all("meta"))
