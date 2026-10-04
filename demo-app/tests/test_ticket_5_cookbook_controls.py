"""Ticket 5: real browse/detail markup and refreshed authoritative membership.

Client mutation timing and failures are exercised by ticket-5-cookbook.test.js.
Actual focus visibility, screen-reader output, and contrast need browser review.
"""
import json
from html.parser import HTMLParser


class CookbookMarkup(HTMLParser):
    def __init__(self, html):
        super().__init__(convert_charrefs=True)
        self.buttons = []
        self.scripts = []
        self.current_button = None
        self.current_script = None
        self.feed(html)

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if tag == "button" and "cookbook" in attrs.get("class", "").split():
            self.current_button = {"attrs": attrs, "text": ""}
            self.buttons.append(self.current_button)
        if tag == "script" and attrs.get("type") == "application/json":
            self.current_script = ""

    def handle_data(self, data):
        if self.current_button is not None:
            self.current_button["text"] += data
        if self.current_script is not None:
            self.current_script += data

    def handle_endtag(self, tag):
        if tag == "button":
            self.current_button = None
        if tag == "script" and self.current_script is not None:
            self.scripts.append(json.loads(self.current_script))
            self.current_script = None


def assert_page(client, url, recipe, saved_ids):
    response = client.get(url)
    assert response.status_code == 200
    markup = CookbookMarkup(response.get_data(as_text=True))
    data = [s for s in markup.scripts if "saved_recipe_ids" in s]
    assert len(data) == 1, "Pages must supply one authoritative cookbook snapshot"
    assert set(data[0]["saved_recipe_ids"]) == set(saved_ids)
    buttons = [b for b in markup.buttons if b["attrs"].get("data-recipe-id") == recipe["id"]]
    assert buttons, "Both browse and detail must expose cookbook controls"
    for button in buttons:
        attrs = button["attrs"]
        saved = recipe["id"] in saved_ids
        action = "Remove" if saved else "Add"
        assert recipe["title"] in attrs.get("aria-label", "")
        assert action in attrs["aria-label"] and "My Cookbook" in attrs["aria-label"]
        assert action in button["text"] and "My Cookbook" in button["text"]
        assert attrs.get("aria-pressed") == str(saved).lower()
        assert ("saved" in attrs.get("class", "").split()) == saved
        assert "disabled" not in attrs
    # Bootstrap is useful only if the page also starts its client adapter.
    assert '/static/app.js' in response.get_data(as_text=True)


def test_browse_detail_refresh_preserves_complete_membership_and_dish_specific_states(client):
    recipes = client.get("/api/recipes").get_json()
    first, second = recipes[:2]
    saved = set()
    for recipe, method, expected_status in [
        (first, "POST", 201), (second, "POST", 201),
        (first, "DELETE", 200), (first, "DELETE", 200), (second, "DELETE", 200),
    ]:
        if method == "POST":
            response = client.post("/api/cookbook", json={"id": recipe["id"]})
            saved.add(recipe["id"])
        else:
            response = client.delete(f"/api/cookbook/{recipe['id']}")
            saved.discard(recipe["id"])
        assert response.status_code == expected_status
        assert response.get_json() == {"recipe_ids": sorted(saved)}
        assert {r["id"] for r in client.get("/api/cookbook").get_json()} == saved
        for dish in [first, second]:
            for url in ["/", f"/recipe/{dish['id']}"]:
                assert_page(client, url, dish, saved)
