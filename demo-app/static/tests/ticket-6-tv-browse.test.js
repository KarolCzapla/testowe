// Ticket 6 public acceptance seams. DOM doubles verify event/focus contracts;
// native browser scrolling, contrast and the 1920×1080 journey need browser review.
import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import * as logic from '../app-logic.js';
import {initializePage} from '../app.js';

function transition() {
  assert.equal(typeof logic.nextBrowseFocus, 'function', 'TV browse must provide pure focus transitions');
  return logic.nextBrowseFocus;
}
async function adapter() {
  const url = new URL('../tv-navigation.js', import.meta.url);
  assert.ok(existsSync(url), 'TV browse must provide its DOM navigation adapter');
  const module = await import(url);
  assert.equal(typeof module.installTvBrowse, 'function');
  assert.equal(typeof module.focusAndReveal, 'function');
  return module;
}
const position = (railId, cardIndex, preferredCardPosition = cardIndex) =>
  ({railId, cardIndex, preferredCardPosition});
const topology = [
  {id: 'empty-first', count: 0}, {id: 'popular', count: 5},
  {id: 'empty-middle', count: 0}, {id: 'quick', count: 2},
  {id: 'vegetarian', count: 6}, {id: 'cookbook', count: 0},
];

test('recipe destinations encode IDs and retain TV mode only in TV mode', () => {
  assert.equal(typeof logic.recipeHref, 'function', 'Recipe URL generation must be pure and reusable');
  for (const id of ['lemon-lentils', 'a/b ?#%é']) {
    assert.equal(logic.recipeHref(id, 'mobile'), `/recipe/${encodeURIComponent(id)}`);
    assert.equal(logic.recipeHref(id, 'tv'), `/recipe/${encodeURIComponent(id)}?mode=tv`);
  }
});

test('initial and all-empty focus never select an empty rail', () => {
  const next = transition();
  assert.deepEqual(next(topology, null, null), position('popular', 0));
  assert.equal(next([], null, 'ArrowRight'), null);
  assert.equal(next([{id: 'empty', count: 0}], position('gone', 9), 'ArrowDown'), null);
});

test('horizontal boundaries clamp, update preference, and do not mutate inputs', () => {
  const next = transition();
  const cases = [
    [position('popular', 0), 'ArrowLeft', position('popular', 0)],
    [position('popular', 4), 'ArrowRight', position('popular', 4)],
    [position('popular', 2), 'ArrowLeft', position('popular', 1)],
    [position('popular', 2), 'ArrowRight', position('popular', 3)],
    [position('quick', 1, 4), 'ArrowLeft', position('quick', 0)],
  ];
  const rails = topology.map(rail => Object.freeze({...rail}));
  Object.freeze(rails);
  for (const [current, key, expected] of cases) {
    const before = {...current};
    Object.freeze(current);
    assert.deepEqual(next(rails, current, key), expected, key);
    assert.deepEqual(current, before);
  }
});

test('vertical movement skips empty rails and preserves preference through unequal lengths', () => {
  const next = transition();
  let current = position('popular', 4);
  current = next(topology, current, 'ArrowDown');
  assert.deepEqual(current, position('quick', 1, 4));
  current = next(topology, current, 'ArrowDown');
  assert.deepEqual(current, position('vegetarian', 4));
  assert.deepEqual(next(topology, current, 'ArrowDown'), current);
  current = next(topology, current, 'ArrowUp');
  assert.deepEqual(current, position('quick', 1, 4));
  current = next(topology, current, 'ArrowUp');
  assert.deepEqual(current, position('popular', 4));
  assert.deepEqual(next(topology, current, 'ArrowUp'), current);
  assert.deepEqual(next(topology, next(topology, position('quick', 1, 4), 'ArrowLeft'),
    'ArrowDown'), position('vegetarian', 0), 'Horizontal selection resets vertical preference');
});

test('stale topology reconciles removed, emptied and shortened current rails', () => {
  const next = transition();
  const rails = [{id: 'popular', count: 0}, {id: 'quick', count: 2}];
  for (const stale of [position('removed', 8), position('popular', 3), position('quick', 99)]) {
    const result = next(rails, stale, null);
    assert.equal(result.railId, 'quick');
    assert.ok(Number.isInteger(result.cardIndex) && result.cardIndex >= 0 && result.cardIndex < 2);
    assert.ok(Number.isInteger(result.preferredCardPosition) && result.preferredCardPosition >= 0);
  }
  assert.deepEqual(next([{id: 'quick', count: 2}], position('quick', 4), null), position('quick', 1, 4));
});

// Small semantic tree with bubbling, actual activeElement, and observable native
// defaults. No automatic layout/scroll visibility or browser rendering is claimed.
class Element {
  constructor(tag = 'div', attrs = {}) {
    this.tagName = tag.toUpperCase();
    this.attrs = new Map();
    this.dataset = {};
    this.children = [];
    this.listeners = new Map();
    this.hidden = false;
    this.disabled = false;
    this.textContent = '';
    this.focusCalls = [];
    this.scrollCalls = [];
    this.clicks = 0;
    for (const [key, value] of Object.entries(attrs)) this.setAttribute(key, value);
    this.classList = {
      contains: c => (this.getAttribute('class') || '').split(/\s+/).includes(c),
      toggle: (c, enabled) => {
        const values = new Set((this.getAttribute('class') || '').split(/\s+/).filter(Boolean));
        enabled = enabled ?? !values.has(c);
        enabled ? values.add(c) : values.delete(c);
        this.setAttribute('class', [...values].join(' '));
        return enabled;
      },
      add: (...values) => values.forEach(c => this.classList.toggle(c, true)),
      remove: (...values) => values.forEach(c => this.classList.toggle(c, false)),
    };
  }
  get href() { return this.getAttribute('href'); }
  set href(value) { this.setAttribute('href', value); }
  get isConnected() { return !!this.parentElement || this === this.ownerDocument; }
  get isContentEditable() {
    return this.getAttribute('contenteditable') === 'true' || !!this.parentElement?.isContentEditable;
  }
  setAttribute(key, value) {
    this.attrs.set(key, String(value));
    if (key.startsWith('data-')) this.dataset[key.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = String(value);
  }
  getAttribute(key) { return this.attrs.get(key) ?? null; }
  hasAttribute(key) { return this.attrs.has(key); }
  addEventListener(type, listener) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type).add(listener);
  }
  removeEventListener(type, listener) { this.listeners.get(type)?.delete(listener); }
  appendChild(child) {
    child.parentElement = this;
    child.attach(this.ownerDocument);
    this.children.push(child);
    return child;
  }
  attach(document) { this.ownerDocument = document; this.children.forEach(c => c.attach(document)); }
  remove() {
    this.parentElement.children = this.parentElement.children.filter(c => c !== this);
    this.parentElement = null;
  }
  contains(element) { return element === this || this.children.some(c => c.contains(element)); }
  matches(selector) {
    return selector.split(',').some(part => {
      part = part.trim();
      const pieces = part.split(/\s+(?![^\[]*\])/);
      if (pieces.length > 1) {
        if (!this.matches(pieces.pop())) return false;
        let ancestor = this.parentElement;
        while (pieces.length && ancestor) {
          if (ancestor.matches(pieces.at(-1))) pieces.pop();
          ancestor = ancestor.parentElement;
        }
        return pieces.length === 0;
      }
      const tag = part.match(/^[a-z]+/i)?.[0];
      if (tag && tag.toUpperCase() !== this.tagName) return false;
      const id = part.match(/#([\w-]+)/)?.[1];
      if (id && this.getAttribute('id') !== id) return false;
      for (const [, name] of part.matchAll(/\.([\w-]+)/g)) if (!this.classList.contains(name)) return false;
      for (const [, key, value] of part.matchAll(/\[([\w-]+)(?:=["']?([^\]"']+)["']?)?\]/g)) {
        if (!this.hasAttribute(key) || (value !== undefined && this.getAttribute(key) !== value)) return false;
      }
      return true;
    });
  }
  closest(selector) { return this.matches(selector) ? this : this.parentElement?.closest(selector) ?? null; }
  querySelectorAll(selector) {
    return this.children.flatMap(c => [...(c.matches(selector) ? [c] : []), ...c.querySelectorAll(selector)]);
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] ?? null; }
  dispatch(type, extra = {}) {
    const event = {type, target: this, defaultPrevented: false, ...extra,
      preventDefault() { this.defaultPrevented = true; },
      stopPropagation() { this.stopped = true; },
    };
    for (let node = this; node; node = node.parentElement) {
      event.currentTarget = node;
      for (const listener of [...(node.listeners.get(type) || [])]) listener(event);
      if (event.stopped) break;
    }
    return event;
  }
  focus(options) {
    this.focusCalls.push(options);
    this.ownerDocument.activeElement = this;
    this.dispatch('focusin');
  }
  scrollIntoView(options) { this.scrollCalls.push(options); }
  click() {
    this.clicks++;
    const event = this.dispatch('click');
    if (!event.defaultPrevented && this.tagName === 'A') this.ownerDocument.destinations.push(this.href);
  }
}

function fixture(lengths = [5, 0, 2, 6, 0]) {
  const document = new Element('document');
  document.attach(document);
  document.activeElement = null;
  document.destinations = [];
  document.createElement = tag => new Element(tag);
  document.body = document.appendChild(new Element('body'));
  const root = document.body.appendChild(new Element('div', {'data-tv-browse': '', class: 'discovery-rails'}));
  const rows = lengths.map((length, row) => {
    const rail = root.appendChild(new Element('section', {'data-rail-id': `rail-${row}`, id: `rail-${row}`, class: 'recipe-rail'}));
    const container = rail.appendChild(new Element('div', {class: 'rail-cards'}));
    const cards = Array.from({length}, (_, col) => {
      // Deliberately repeat recipe IDs between rails: DOM occurrence is identity.
      const id = `dish-${col}`;
      const card = container.appendChild(new Element('article', {class: 'recipe-card', 'data-recipe-id': id, id: `rail-${row}-${id}`}));
      const link = card.appendChild(new Element('a', {class: 'recipe-link', href: `/recipe/${id}?mode=tv`}));
      const title = link.appendChild(new Element('span'));
      const button = card.appendChild(new Element('button', {class: 'cookbook', 'data-recipe-id': id, 'data-recipe-title': `Dish ${col}`, type: 'button'}));
      return {card, link, button, title};
    });
    return {rail, container, cards};
  });
  return {document, root, rows};
}
function key(target, value, extra = {}) {
  const event = target.dispatch('keydown', {key: value, ...extra});
  // Browser's native Enter default is modeled separately from installed handlers.
  if (value === 'Enter' && !event.defaultPrevented && ['A', 'BUTTON'].includes(target.tagName)) target.click();
  return event;
}
function revealed(document, target) {
  assert.ok(document.activeElement === target, 'Real recipe link must receive focus');
  assert.ok(target.focusCalls.length > 0);
  assert.ok(target.scrollCalls.length > 0, 'Selected card must be revealed');
  assert.equal(target.focusCalls.at(-1)?.preventScroll, true);
  assert.equal(target.scrollCalls.at(-1)?.block, 'nearest');
  assert.equal(target.scrollCalls.at(-1)?.inline, 'nearest');
}
async function installed(lengths) {
  const api = await adapter();
  const s = fixture(lengths);
  s.dispose = api.installTvBrowse({root: s.root, navigate: href => s.document.destinations.push(href)});
  assert.equal(typeof s.dispose, 'function');
  return s;
}

test('focus helper ignores null and requests horizontal and vertical reveal on real focus', async () => {
  const {focusAndReveal} = await adapter();
  assert.doesNotThrow(() => focusAndReveal(null));
  const s = fixture([1]);
  focusAndReveal(s.rows[0].cards[0].link);
  revealed(s.document, s.rows[0].cards[0].link);
});

test('adapter initializes first populated rail and all-empty topology remains unfocused', async () => {
  const s = await installed([0, 2, 0]);
  try { revealed(s.document, s.rows[1].cards[0].link); } finally { s.dispose(); }
  const empty = await installed([0, 0]);
  try {
    assert.equal(empty.document.activeElement, null);
    assert.equal(key(empty.root, 'ArrowDown').defaultPrevented, false);
  } finally { empty.dispose(); }
});

test('arrow journey reveals every link, skips empties and preserves preferred column', async () => {
  const s = await installed();
  try {
    for (let col = 1; col <= 4; col++) {
      assert.equal(key(s.document.activeElement, 'ArrowRight').defaultPrevented, true);
      revealed(s.document, s.rows[0].cards[col].link);
    }
    key(s.document.activeElement, 'ArrowRight');
    assert.equal(s.document.activeElement, s.rows[0].cards[4].link);
    key(s.document.activeElement, 'ArrowDown');
    revealed(s.document, s.rows[2].cards[1].link);
    key(s.document.activeElement, 'ArrowDown');
    revealed(s.document, s.rows[3].cards[4].link);
    key(s.document.activeElement, 'ArrowDown');
    assert.equal(s.document.activeElement, s.rows[3].cards[4].link);
    key(s.document.activeElement, 'ArrowUp');
    key(s.document.activeElement, 'ArrowUp');
    revealed(s.document, s.rows[0].cards[4].link);
  } finally { s.dispose(); }
});

test('Tab/pointer focusin synchronizes repeated occurrences and resets vertical preference', async () => {
  const s = await installed();
  try {
    s.rows[3].cards[1].link.focus(); // Native Tab or pointer-induced focus.
    key(s.document.activeElement, 'ArrowLeft');
    revealed(s.document, s.rows[3].cards[0].link);
    s.rows[0].cards[4].link.focus();
    key(s.document.activeElement, 'ArrowDown');
    s.rows[2].cards[0].link.focus();
    key(s.document.activeElement, 'ArrowDown');
    revealed(s.document, s.rows[3].cards[0].link);
    s.rows[3].cards[2].link.focus();
    assert.equal(key(s.rows[3].cards[2].title, 'ArrowRight').defaultPrevented, true);
    revealed(s.document, s.rows[3].cards[3].link);
  } finally { s.dispose(); }
});

test('native Enter opens only the focused occurrence once; cookbook activation stays independent', async () => {
  const s = await installed();
  try {
    s.rows[3].cards[2].link.focus();
    key(s.document.activeElement, 'Enter');
    assert.deepEqual(s.document.destinations, ['/recipe/dish-2?mode=tv']);
    const button = s.rows[3].cards[2].button;
    let saves = 0;
    button.addEventListener('click', () => saves++);
    button.focus();
    assert.equal(key(button, 'Tab').defaultPrevented, false);
    for (const arrow of ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown']) {
      assert.equal(key(button, arrow).defaultPrevented, false);
      assert.equal(s.document.activeElement, button);
    }
    key(button, 'Enter');
    assert.equal(saves, 1);
    assert.equal(button.clicks, 1);
    assert.deepEqual(s.document.destinations, ['/recipe/dish-2?mode=tv']);
  } finally { s.dispose(); }
});

test('editable and unrelated targets retain defaults; unsupported keys remain native', async () => {
  const s = await installed();
  try {
    const controls = ['input', 'textarea', 'select', 'button', 'a'].map(tag =>
      s.root.appendChild(new Element(tag, tag === 'a' ? {href: '/?mode=tv'} : {})));
    const editable = s.rows[0].cards[0].link.appendChild(new Element('span', {contenteditable: 'true'}));
    const nested = editable.appendChild(new Element('span'));
    for (const target of [...controls, editable, nested]) {
      target.focus();
      for (const value of ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Tab', ' ']) {
        assert.equal(key(target, value).defaultPrevented, false, `${target.tagName} ${value}`);
        assert.equal(s.document.activeElement, target);
      }
    }
    const link = s.rows[0].cards[0].link;
    link.focus();
    for (const value of ['Tab', 'Escape', 'PageDown', 'PageUp', 'x', ' ']) {
      assert.equal(key(link, value).defaultPrevented, false, value);
    }
  } finally { s.dispose(); }
});

test('adapter rereads topology before movement and never focuses removed or empty cards', async () => {
  const s = await installed([3, 2, 3]);
  try {
    s.rows[0].cards[2].link.focus();
    s.rows[1].cards.forEach(({card}) => card.remove());
    key(s.document.activeElement, 'ArrowDown');
    revealed(s.document, s.rows[2].cards[2].link);
    s.rows[2].cards[2].card.remove();
    s.rows[2].cards[1].link.focus();
    key(s.document.activeElement, 'ArrowRight');
    assert.equal(s.document.activeElement, s.rows[2].cards[1].link);
    s.rows[2].rail.remove();
    s.rows[0].cards[0].link.focus();
    key(s.document.activeElement, 'ArrowDown');
    assert.equal(s.document.activeElement, s.rows[0].cards[0].link);
  } finally { s.dispose(); }
});

function listenerCount(node) {
  return [...node.listeners.values()].reduce((sum, listeners) => sum + listeners.size, 0) +
    node.children.reduce((sum, child) => sum + listenerCount(child), 0);
}
test('offline event fixture bubbles focus and keys and separates native activation from handlers', () => {
  const s = fixture([1]);
  const {link, button} = s.rows[0].cards[0];
  assert.equal(s.root.querySelectorAll('[data-rail-id]').length, 1);
  assert.equal(s.root.querySelectorAll('.recipe-card .recipe-link')[0], link);
  assert.equal(link.closest('[data-rail-id]'), s.rows[0].rail);
  let focused;
  const observe = event => { focused = event.target; };
  s.root.addEventListener('focusin', observe);
  link.focus();
  assert.equal(focused, link);
  key(link, 'Enter');
  assert.deepEqual(s.document.destinations, ['/recipe/dish-0?mode=tv']);
  const consume = event => event.preventDefault();
  s.root.addEventListener('keydown', consume);
  key(link, 'Enter');
  assert.equal(link.clicks, 1);
  s.root.removeEventListener('keydown', consume);
  let saves = 0;
  const save = () => saves++;
  button.addEventListener('click', save);
  key(button, 'Enter');
  assert.equal(saves, 1);
  assert.equal(s.document.destinations.length, 1);
  button.removeEventListener('click', save);
  s.root.removeEventListener('focusin', observe);
  assert.equal(listenerCount(s.document), 0);
});
test('cleanup removes installed listeners and leaves native controls usable', async () => {
  const s = await installed([2]);
  assert.ok(listenerCount(s.document) > 0, 'Adapter installs event listeners');
  s.dispose();
  assert.equal(listenerCount(s.document), 0, 'All installed listeners must be removed');
  const link = s.rows[0].cards[1].link;
  link.focus();
  assert.equal(key(link, 'ArrowLeft').defaultPrevented, false);
  assert.equal(s.document.activeElement, link);
  key(link, 'Enter');
  assert.deepEqual(s.document.destinations, ['/recipe/dish-1?mode=tv']);
});

test('initializePage installs TV browse alongside cookbook controls and cleans up both', async () => {
  const s = fixture([2, 0, 3]);
  const bootstrap = s.document.body.appendChild(new Element('script', {id: 'page-bootstrap'}));
  bootstrap.textContent = JSON.stringify({page: 'browse', mode: 'tv', saved_recipe_ids: [],
    browse_url: '/?mode=tv', recipes: [0, 1, 2].map(col => ({id: `dish-${col}`, title: `Dish ${col}`}))});
  const status = s.document.body.appendChild(new Element('p', {id: 'cookbook-status'}));
  const requests = [];
  const cleanup = initializePage(s.document, {
    navigate: href => s.document.destinations.push(href),
    transport: async (url, options) => {
      requests.push({url, options});
      return {ok: true, json: async () => ({recipe_ids: ['dish-0']})};
    },
  });
  try {
    revealed(s.document, s.rows[0].cards[0].link);
    const button = s.rows[0].cards[0].button;
    button.focus();
    key(button, 'Enter');
    for (let i = 0; i < 20; i++) await Promise.resolve();
    assert.equal(requests.length, 1, 'One Enter means one cookbook mutation');
    assert.equal(requests[0].url, '/api/cookbook');
    assert.equal(requests[0].options.method, 'POST');
    assert.deepEqual(JSON.parse(requests[0].options.body), {id: 'dish-0'});
    assert.equal(s.document.destinations.length, 0);
    assert.match(status.textContent, /added to My Cookbook/);
    s.rows[2].cards[0].link.focus();
    key(s.document.activeElement, 'ArrowRight');
    revealed(s.document, s.rows[2].cards[1].link);
    key(s.document.activeElement, 'Enter');
    assert.deepEqual(s.document.destinations, ['/recipe/dish-1?mode=tv']);
  } finally { cleanup(); }
  assert.equal(listenerCount(s.document), 0);
});
