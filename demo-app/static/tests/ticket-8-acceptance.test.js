import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, existsSync} from 'node:fs';
import {matchesRecipe, recipeHref, nextBrowseFocus, nextDetailAction} from '../app-logic.js';
import {initializePage, updateBrowseResults} from '../app.js';
import {createCookbookController} from '../cookbook.js';
import {installTvBrowse, installTvDetail} from '../tv-navigation.js';

const recipes = JSON.parse(readFileSync(new URL('../../catalog.json', import.meta.url), 'utf8'));

test('TableStory handoff documents the unchanged Node acceptance gate', () => {
  const readme = new URL('../../README.md', import.meta.url);
  assert.equal(existsSync(readme), true, 'R26: application-local TableStory README is required');
  const text = readFileSync(readme, 'utf8');
  assert.match(text, /TableStory/);
  assert.ok(text.includes('node --test demo-app/static/tests/*.test.js'));
});

// Minimal event/DOM seam. Native Enter is modeled separately from dispatched
// key events: these tests cannot establish real browser scrolling or contrast.
class Element {
  constructor(tag = 'DIV', attrs = {}, dataset = {}) {
    this.tagName = tag;
    this.attrs = {...attrs};
    this.dataset = {...dataset};
    this.children = [];
    this.listeners = new Map();
    this.textContent = '';
    this.hidden = false;
    this.clicks = 0;
    this.reveals = [];
    this.classes = new Set((attrs.class || '').split(' ').filter(Boolean));
    this.classList = {toggle: (name, state) => state ? this.classes.add(name) : this.classes.delete(name)};
  }
  appendChild(child) {
    child.parentElement = this;
    child.ownerDocument = this.ownerDocument;
    this.children.push(child);
    return child;
  }
  setAttribute(name, value) { this.attrs[name] = String(value); }
  getAttribute(name) { return this.attrs[name] ?? null; }
  hasAttribute(name) { return Object.hasOwn(this.attrs, name); }
  addEventListener(type, callback) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type).add(callback);
  }
  removeEventListener(type, callback) { this.listeners.get(type)?.delete(callback); }
  emit(type, event = {}) {
    event.target ??= this;
    event.defaultPrevented ??= false;
    event.preventDefault ??= () => { event.defaultPrevented = true; };
    for (let node = this; node; node = node.parentElement) {
      for (const callback of node.listeners.get(type) || []) callback(event);
    }
    return event;
  }
  contains(target) {
    for (let node = target; node; node = node.parentElement) if (node === this) return true;
    return false;
  }
  matches(selector) {
    if (selector.includes(',')) return selector.split(',').some(s => this.matches(s.trim()));
    if (selector.startsWith('.')) return this.classes.has(selector.slice(1));
    if (selector.startsWith('#')) return this.attrs.id === selector.slice(1);
    if (selector.startsWith('[data-')) {
      const key = selector.slice(6, -1).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
      return Object.hasOwn(this.dataset, key);
    }
    return this.tagName.toLowerCase() === selector;
  }
  closest(selector) {
    for (let node = this; node; node = node.parentElement) if (node.matches(selector)) return node;
    return null;
  }
  querySelectorAll(selector) {
    const result = [];
    const visit = node => {
      for (const child of node.children) {
        const parts = selector.split(' ');
        if (child.matches(parts.at(-1)) && (parts.length === 1 || child.parentElement.closest(parts[0]))) {
          result.push(child);
        }
        visit(child);
      }
    };
    visit(this);
    return result;
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  focus(options) {
    this.focusOptions = options;
    this.ownerDocument.activeElement = this;
    this.emit('focusin');
  }
  scrollIntoView(options) { this.reveals.push(options); }
  click() { this.clicks++; this.emit('click'); }
}

function documentFixture() {
  const doc = new Element('DOCUMENT');
  doc.ownerDocument = doc;
  doc.body = doc.appendChild(new Element('BODY'));
  doc.createElement = tag => {
    const node = new Element(tag.toUpperCase());
    node.ownerDocument = doc;
    return node;
  };
  return doc;
}
function button(doc, id, parent = doc.body) {
  return parent.appendChild(new Element('BUTTON', {class: 'cookbook'},
    {recipeId: id, recipeTitle: `Dish ${id}`}));
}
function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return {promise, resolve};
}
const envelope = ids => ({ok: true, json: async () => ({recipe_ids: ids})});
const flush = async () => { await Promise.resolve(); await Promise.resolve(); };

test('all five search fields, literal punctuation and ordered live result restoration', () => {
  for (const recipe of recipes) {
    for (const field of ['title', 'description', 'category', 'dietary_tags', 'ingredients']) {
      const value = recipe[field];
      for (const text of Array.isArray(value) ? value : [value]) {
        assert.equal(matchesRecipe(recipe, `\x85${text.toUpperCase()}\x1c`), true);
      }
    }
  }
  const recipe = {...recipes[0], title: 'Crème İ Σ ΟΣ Straße', description: 'Boundary left.',
    ingredients: ['Onlyneedle + lemon (fresh)', 'separate ingredient']};
  for (const q of ['CRÈME', 'İ', 'ΟΣ', 'Straße', '+ lemon (', 'onlyneedle']) {
    assert.equal(matchesRecipe(recipe, q), true, q);
  }
  for (const q of ['STRASSE', 'left. Breakfast', '(fresh) separate', '\ufeffonlyneedle\ufeff']) {
    assert.equal(matchesRecipe(recipe, q), false, q);
  }
  const cards = recipes.map(r => ({dataset: {recipeId: r.id}, hidden: false}));
  const countElement = {}, emptyElement = {};
  for (const query of ['chickpeas', 'not-a-real-ingredient-zz', '']) {
    updateBrowseResults({recipes, cards, query, countElement, emptyElement});
    const expected = query === 'chickpeas' ? ['chickpea-lemon-salad'] : query ? [] : recipes.map(r => r.id);
    assert.deepEqual(cards.filter(c => !c.hidden).map(c => c.dataset.recipeId), expected);
    assert.equal(countElement.textContent, `${expected.length} recipe${expected.length === 1 ? '' : 's'}`);
    assert.equal(emptyElement.hidden, expected.length !== 0);
    assert.equal(emptyElement.textContent, 'No recipes found. Try another ingredient or dish.');
  }
});

test('initialization responds to input without navigation and cleans listeners', () => {
  const doc = documentFixture();
  const bootstrap = doc.body.appendChild(new Element('SCRIPT', {id: 'page-bootstrap'}));
  bootstrap.textContent = JSON.stringify({page: 'browse', mode: 'mobile', recipes,
    saved_recipe_ids: [], browse_url: '/'});
  const search = doc.body.appendChild(new Element('INPUT', {id: 'search'}));
  search.value = '';
  const count = doc.body.appendChild(new Element('P', {id: 'count'}));
  const empty = doc.body.appendChild(new Element('P', {id: 'empty'}));
  const cards = recipes.map(r => doc.body.appendChild(new Element('ARTICLE',
    {class: 'recipe-card'}, {recipeId: r.id})));
  const navigate = [];
  const cleanup = initializePage(doc, {transport: async () => envelope([]), navigate: url => navigate.push(url)});
  search.value = 'CHICKPEAS';
  search.emit('input');
  assert.deepEqual(cards.filter(c => !c.hidden).map(c => c.dataset.recipeId), ['chickpea-lemon-salad']);
  assert.equal(count.textContent, '1 recipe');
  search.value = 'no-real-dish-zz';
  search.emit('input');
  assert.equal(empty.hidden, false);
  search.value = '';
  search.emit('input');
  assert.equal(cards.every(c => !c.hidden), true);
  assert.deepEqual(navigate, []);
  assert.equal(doc.querySelector('#cookbook-status').attrs['aria-live'], 'polite');
  cleanup();
  search.value = 'no-real-dish-zz';
  search.emit('input');
  assert.equal(cards.every(c => !c.hidden), true);
});

test('cookbook confirms all occurrences, guards duplicates and serializes whole snapshots', async () => {
  const doc = documentFixture();
  const controls = [button(doc, 'a'), button(doc, 'a'), button(doc, 'b')];
  const requests = [], messages = [], gates = [deferred(), deferred(), deferred()];
  const controller = createCookbookController({initialIds: [], controls,
    transport: (url, options) => { requests.push({url, options}); return gates[requests.length - 1].promise; },
    announce: text => messages.push(text)});
  controls[0].focus();
  const first = controller.toggle('a');
  await controller.toggle('a');
  const second = controller.toggle('b');
  await flush();
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, '/api/cookbook');
  assert.deepEqual(JSON.parse(requests[0].options.body), {id: 'a'});
  assert.equal(requests[0].options.method, 'POST');
  for (const control of controls) assert.equal(control.attrs['aria-pressed'], 'false');
  assert.equal(controls[0].attrs['aria-busy'], 'true');
  assert.equal(doc.activeElement, controls[0]);
  gates[0].resolve(envelope(['a']));
  await first;
  await flush();
  assert.equal(requests.length, 2);
  assert.equal(controls[1].attrs['aria-label'], 'Remove Dish a from My Cookbook');
  gates[1].resolve(envelope(['a', 'b']));
  await second;
  assert.equal(controls.every(c => c.attrs['aria-pressed'] === 'true'), true);
  const removal = controller.toggle('a');
  await flush();
  assert.equal(requests[2].url, '/api/cookbook/a');
  assert.equal(requests[2].options.method, 'DELETE');
  gates[2].resolve(envelope(['b']));
  await removal;
  assert.deepEqual(controls.map(c => c.attrs['aria-pressed']), ['false', 'false', 'true']);
  assert.equal(messages.at(-1), 'Dish a removed from My Cookbook.');
  controller.dispose();
  controls[0].click();
  await flush();
  assert.equal(requests.length, 3);
});

for (const failure of ['HTTP', 'network', 'JSON', 'missing-envelope', 'wrong-type', 'duplicates']) {
  test(`cookbook ${failure} failure retains confirmed state and permits retry`, async () => {
    const doc = documentFixture(), controls = [button(doc, 'a'), button(doc, 'a')];
    const messages = [];
    let fail = true;
    const controller = createCookbookController({initialIds: ['a'], controls,
      announce: text => messages.push(text), transport: async () => {
        if (!fail) return envelope([]);
        if (failure === 'network') throw new Error('offline');
        if (failure === 'HTTP') return {ok: false};
        if (failure === 'JSON') return {ok: true, json: async () => { throw new Error('invalid JSON'); }};
        return {ok: true, json: async () => failure === 'missing-envelope' ? {} :
          {recipe_ids: failure === 'wrong-type' ? [1] : ['a', 'a']}};
      }});
    controls[0].focus();
    await controller.toggle('a');
    assert.equal(doc.activeElement, controls[0]);
    for (const c of controls) {
      assert.equal(c.attrs['aria-pressed'], 'true');
      assert.equal(c.attrs['aria-busy'], 'false');
      assert.equal(c.attrs['aria-disabled'], 'false');
    }
    assert.equal(messages.at(-1), 'Could not update My Cookbook. Try again.');
    fail = false;
    await controller.toggle('a');
    assert.equal(controls.every(c => c.attrs['aria-pressed'] === 'false'), true);
    controller.dispose();
  });
}

test('malformed initial membership fails visibly rather than inventing state', () => {
  for (const initialIds of [undefined, {}, ['a', 'a'], [2], ['']]) {
    assert.throws(() => createCookbookController({initialIds, controls: [], transport: async () => envelope([])}));
  }
  const doc = documentFixture();
  const bootstrap = doc.body.appendChild(new Element('SCRIPT', {id: 'page-bootstrap'}));
  bootstrap.textContent = '{';
  initializePage(doc);
  assert.match(doc.querySelector('#cookbook-status').textContent, /Could not start My Cookbook/);
});

test('pure TV transitions retain preferred column, skip empties and reconcile stale positions', () => {
  const rails = [{id: 'a', count: 4}, {id: 'empty', count: 0}, {id: 'b', count: 1},
    {id: 'c', count: 4}, {id: 'trailing', count: 0}];
  let focus = nextBrowseFocus(rails, null, null);
  assert.deepEqual(focus, {railId: 'a', cardIndex: 0, preferredCardPosition: 0});
  for (let i = 0; i < 6; i++) focus = nextBrowseFocus(rails, focus, 'ArrowRight');
  assert.equal(focus.cardIndex, 3);
  focus = nextBrowseFocus(rails, focus, 'ArrowDown');
  assert.deepEqual(focus, {railId: 'b', cardIndex: 0, preferredCardPosition: 3});
  focus = nextBrowseFocus(rails, focus, 'ArrowDown');
  assert.deepEqual(focus, {railId: 'c', cardIndex: 3, preferredCardPosition: 3});
  assert.deepEqual(nextBrowseFocus(rails, focus, 'ArrowDown'), focus);
  assert.equal(nextBrowseFocus([{id: 'c', count: 1}], focus, null).cardIndex, 0);
  assert.equal(nextBrowseFocus([{id: 'a', count: 2}], focus, null).railId, 'a');
  assert.equal(nextBrowseFocus([{id: 'empty', count: 0}], focus, 'ArrowDown'), null);
  for (const [index, key, expected] of [
    [0, 'ArrowUp', {actionIndex: 0, command: 'focus'}],
    [0, 'ArrowDown', {actionIndex: 1, command: 'focus'}],
    [1, 'ArrowDown', {actionIndex: 1, command: 'focus'}],
    [1, 'ArrowUp', {actionIndex: 0, command: 'focus'}],
    [1, 'Enter', {actionIndex: 1, command: 'activate'}],
    [0, 'Escape', {actionIndex: 0, command: 'return'}],
    [1, 'Backspace', {actionIndex: 1, command: 'return'}],
    [0, 'PageDown', {actionIndex: 0, command: 'none'}],
  ]) assert.deepEqual(nextDetailAction(index, key), expected);
  assert.equal(recipeHref('dish a/b', 'tv'), '/recipe/dish%20a%2Fb?mode=tv');
  assert.equal(recipeHref('dish', 'mobile'), '/recipe/dish');
});

test('TV browse adapter focuses and reveals real occurrences; buttons and native Enter stay independent', () => {
  const doc = documentFixture(), root = doc.body.appendChild(new Element());
  const groups = [4, 0, 1, 4].map((count, index) => {
    const rail = root.appendChild(new Element('SECTION', {}, {railId: `r${index}`}));
    const links = [], buttons = [];
    for (let i = 0; i < count; i++) {
      const card = rail.appendChild(new Element('ARTICLE', {class: 'recipe-card'}, {recipeId: `dish-${i}`}));
      links.push(card.appendChild(new Element('A', {class: 'recipe-link', href: '/recipe/start'})));
      buttons.push(button(doc, `dish-${i}`, card));
    }
    return {rail, links, buttons};
  });
  const cleanup = installTvBrowse({root});
  assert.equal(doc.activeElement, groups[0].links[0]);
  const key = name => doc.activeElement.emit('keydown', {key: name});
  for (let i = 0; i < 3; i++) assert.equal(key('ArrowRight').defaultPrevented, true);
  assert.equal(doc.activeElement, groups[0].links[3]);
  key('ArrowDown');
  assert.equal(doc.activeElement, groups[2].links[0]);
  key('ArrowDown');
  assert.equal(doc.activeElement, groups[3].links[3]);
  const link = doc.activeElement;
  assert.deepEqual(link.focusOptions, {preventScroll: true});
  assert.deepEqual(link.reveals.at(-1), {block: 'nearest', inline: 'nearest'});
  assert.equal(link.href, '/recipe/dish-3?mode=tv');
  assert.equal(key('Enter').defaultPrevented, false);
  assert.equal(link.clicks, 0);
  link.click(); // Browser native default action, after unconsumed keydown.
  assert.equal(link.clicks, 1);
  const action = groups[3].buttons[3];
  action.focus();
  assert.equal(key('ArrowUp').defaultPrevented, false);
  assert.equal(key('Enter').defaultPrevented, false);
  action.click();
  assert.equal(action.clicks, 1);
  assert.equal(link.clicks, 1);
  groups[0].links[1].focus(); // Tab/pointer resets the preferred column.
  key('ArrowDown');
  key('ArrowDown');
  assert.equal(doc.activeElement, groups[3].links[1]);
  const input = root.appendChild(new Element('INPUT'));
  input.focus();
  assert.equal(key('ArrowDown').defaultPrevented, false);
  cleanup();
  link.focus();
  assert.equal(key('ArrowLeft').defaultPrevented, false);
  assert.equal(doc.activeElement, link);
});

test('TV detail adapter keeps actions native, ignores editing, preserves scrolling and returns explicitly', () => {
  const doc = documentFixture();
  const back = doc.body.appendChild(new Element('A', {href: '/?mode=tv'}));
  const cookbook = button(doc, 'dish');
  const returns = [];
  const cleanup = installTvDetail({backAction: back, cookbookAction: cookbook,
    browseUrl: '/?mode=tv', navigate: url => returns.push(url)});
  assert.equal(doc.activeElement, back);
  assert.equal(back.emit('keydown', {key: 'ArrowDown'}).defaultPrevented, true);
  assert.equal(doc.activeElement, cookbook);
  assert.equal(cookbook.emit('keydown', {key: 'Enter'}).defaultPrevented, false);
  assert.equal(cookbook.clicks, 0);
  cookbook.click();
  assert.equal(cookbook.clicks, 1);
  assert.equal(cookbook.emit('keydown', {key: 'ArrowUp'}).defaultPrevented, true);
  assert.equal(doc.activeElement, back);
  const content = doc.body.appendChild(new Element('P'));
  for (const key of ['ArrowDown', 'PageDown', ' ']) {
    assert.equal(content.emit('keydown', {key}).defaultPrevented, false);
  }
  const input = doc.body.appendChild(new Element('INPUT'));
  for (const key of ['Escape', 'Backspace', 'ArrowDown']) {
    assert.equal(input.emit('keydown', {key}).defaultPrevented, false);
  }
  for (const key of ['Escape', 'Backspace']) {
    assert.equal(content.emit('keydown', {key}).defaultPrevented, true);
  }
  assert.deepEqual(returns, ['/?mode=tv', '/?mode=tv']);
  cleanup();
  assert.equal(content.emit('keydown', {key: 'Escape'}).defaultPrevented, false);
  assert.equal(returns.length, 2);
});
