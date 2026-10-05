"""Ticket 7 server-rendered detail contract, including long recipes.

Actual 375px/1920x1080 layout, native scrolling, focus contrast and distance
readability still require browser review. No source CSS check substitutes for it.
"""
import json
from html.parser import HTMLParser

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
    return ' '.join(text.split())


@pytest.mark.parametrize('mode', ['mobile', 'tv'])
@pytest.mark.parametrize('saved', [False, True])
def test_long_detail_retains_ordered_content_native_actions_and_mode(tmp_path, client, mode, saved):
    catalog = client.get('/api/recipes').get_json()
    recipe = catalog[0]
    recipe.update(
        title='Long lemon & chickpea <b>bowl</b>',
        description='A generous everyday lunch with clearly told instructions.',
        ingredients=[f'{i + 1} spoonfuls of chickpeas with ' + 'lemon and herbs ' * 25
                     for i in range(30)],
        steps=[f'Step {i + 1}: ' + 'Stir gently, taste and season. ' * 25 for i in range(18)],
    )
    path = tmp_path / 'long-recipes.json'
    path.write_text(json.dumps(catalog), encoding='utf-8')
    local = create_app(testing=True, recipe_path=path).test_client()
    if saved:
        assert local.post('/api/cookbook', json={'id': recipe['id']}).status_code == 201
    suffix = '?mode=tv' if mode == 'tv' else ''
    response = local.get(f"/recipe/{recipe['id']}{suffix}")
    assert response.status_code == 200
    root = Document(response.get_data(as_text=True)).root
    assert any(normalized(n.visible()) == recipe['title'] for n in root.all('h1'))
    for tag, field in [('ul', 'ingredients'), ('ol', 'steps')]:
        assert any([normalized(n.visible()) for n in listing.children
                    if isinstance(n, Element) and n.tag == 'li']
                   == [normalized(value) for value in recipe[field]]
                   for listing in root.all(tag)), f'All long {field} must retain stored order'
    assert not list(root.all('b')), 'Recipe text must remain escaped'
    groups = [n for n in root.all() if 'data-detail-actions' in n.attrs]
    assert len(groups) == 1
    back = list(groups[0].all('a'))
    assert len(back) == 1 and back[0].attrs.get('href') == '/' + suffix
    assert 'Browse' in back[0].text() or 'Back' in back[0].text()
    buttons = [n for n in root.all('button') if 'cookbook' in n.attrs.get('class', '').split()]
    assert len(buttons) == 1
    button = buttons[0]
    assert button.attrs.get('type') == 'button'
    assert button.attrs.get('aria-pressed') == str(saved).lower()
    assert recipe['title'] in button.attrs.get('aria-label', '')
    assert ('Remove' if saved else 'Add') in button.attrs.get('aria-label', '')
    assert 'My Cookbook' in button.text()
    if mode == 'tv':
        assert button in list(groups[0].all('button'))
        actions = [n for n in groups[0].all() if n.tag in {'a', 'button'}]
        assert actions == [back[0], button], 'Primary action order must be back, then cookbook'
    for action in [back[0], button]:
        assert action.attrs.get('tabindex', '0') != '-1'
        ancestor = action
        while ancestor:
            assert 'hidden' not in ancestor.attrs and 'inert' not in ancestor.attrs
            assert ancestor.attrs.get('aria-hidden') != 'true'
            ancestor = ancestor.parent
    brand = [n for n in root.all('a') if 'brand' in n.attrs.get('class', '').split()]
    assert len(brand) == 1 and brand[0].attrs['href'] == '/' + suffix
    bootstrap = [n for n in root.all('script') if n.attrs.get('id') == 'page-bootstrap']
    assert len(bootstrap) == 1 and bootstrap[0].attrs.get('type') == 'application/json'
    data = json.loads(bootstrap[0].text())
    assert data['page'] == 'detail' and data['mode'] == mode
    assert data['browse_url'] == '/' + suffix
    assert recipe in data['recipes']
    assert data['saved_recipe_ids'] == ([recipe['id']] if saved else [])
    assert any(n.attrs.get('type') == 'module' and n.attrs.get('src') == '/static/app.js'
               for n in root.all('script'))


def test_tv_user_agent_detail_has_explicit_tv_return_destinations(client):
    recipe = client.get('/api/recipes').get_json()[0]
    response = client.get(f"/recipe/{recipe['id']}", headers={'User-Agent': 'Kitchen HbbTV'})
    assert response.status_code == 200
    root = Document(response.get_data(as_text=True)).root
    for class_name in ['back', 'brand']:
        links = [n for n in root.all('a') if class_name in n.attrs.get('class', '').split()]
        assert len(links) == 1 and links[0].attrs['href'] == '/?mode=tv'
    data = json.loads(next(n.text() for n in root.all('script') if n.attrs.get('id') == 'page-bootstrap'))
    assert data['mode'] == 'tv' and data['browse_url'] == '/?mode=tv'
