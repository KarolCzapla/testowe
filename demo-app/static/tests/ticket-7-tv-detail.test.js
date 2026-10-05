// Ticket 7 QA: deterministic semantic DOM tests. Native activation is modeled
// separately; viewport layout, real scrolling and viewing-distance readability
// require browser acceptance and are not established by these doubles.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as logic from '../app-logic.js';
import * as navigation from '../tv-navigation.js';
import {initializePage} from '../app.js';

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


const recipe = {id: 'lemon-bowl', title: 'Lemon bowl', description: 'A bright lunch.',
  category: 'Lunch', dietary_tags: ['Vegan'], ingredients: ['200 g chickpeas'],
  steps: ['Mix.', 'Season.', 'Serve.'], prep_minutes: 10, cook_minutes: 0,
  difficulty: 'Easy', servings: 2, colors: ['#fff', '#000'], featured: true};

function fixture(mode = 'tv', page = 'detail') {
  const document = new Element('document');
  document.attach(document);
  document.activeElement = null;
  document.destinations = [];
  document.createElement = tag => new Element(tag);
  document.body = document.appendChild(new Element('body', {class: `${mode} detail-page`}));
  const main = document.body.appendChild(new Element('main', {id: 'main', tabindex: '-1'}));
  const article = main.appendChild(new Element('article', {class: 'detail-shell'}));
  const group = article.appendChild(new Element('div', {class: 'detail-actions', 'data-detail-actions': ''}));
  const browseUrl = mode === 'tv' ? '/?mode=tv' : '/';
  const back = group.appendChild(new Element('a', {class: 'back', href: browseUrl}));
  back.textContent = 'Browse recipes';
  const cookbook = (mode === 'tv' ? group : article).appendChild(new Element('button', {
    class: 'cookbook', type: 'button', 'data-recipe-id': recipe.id, 'data-recipe-title': recipe.title,
  }));
  const content = article.appendChild(new Element('section', {class: 'instructions', tabindex: '0'}));
  const brand = document.body.appendChild(new Element('a', {class: 'brand', href: browseUrl}));
  const status = document.body.appendChild(new Element('p', {id: 'cookbook-status'}));
  const bootstrap = document.body.appendChild(new Element('script', {id: 'page-bootstrap', type: 'application/json'}));
  bootstrap.textContent = JSON.stringify({page, mode, recipes: [recipe], saved_recipe_ids: [], browse_url: browseUrl});
  return {document, main, article, group, back, cookbook, content, brand, status, bootstrap, browseUrl};
}
function key(target, value, extra = {}) {
  const event = target.dispatch('keydown', {key: value, ...extra});
  // Browser native Enter runs after the key handlers. Adapter code that also
  // clicks the control will be detected as a duplicate activation.
  if (value === 'Enter' && !event.defaultPrevented && ['A', 'BUTTON'].includes(target.tagName)) target.click();
  return event;
}
function revealed(s, target) {
  assert.ok(s.document.activeElement === target, 'Actual action focus must follow navigation');
  assert.ok(target.focusCalls.length > 0);
  assert.equal(target.focusCalls.at(-1)?.preventScroll, true);
  assert.equal(target.scrollCalls.at(-1)?.block, 'nearest');
  assert.equal(target.scrollCalls.at(-1)?.inline, 'nearest');
}
function listenerCount(node) {
  return [...node.listeners.values()].reduce((n, listeners) => n + listeners.size, 0) +
    node.children.reduce((n, child) => n + listenerCount(child), 0);
}
function installed() {
  assert.equal(typeof navigation.installTvDetail, 'function',
    'TV recipe detail must provide the approved primary-action DOM adapter');
  const s = fixture();
  s.dispose = navigation.installTvDetail({backAction: s.back, cookbookAction: s.cookbook,
    browseUrl: s.browseUrl, navigate: href => s.document.destinations.push(href)});
  assert.equal(typeof s.dispose, 'function', 'Adapter must return listener cleanup');
  return s;
}
const flush = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); };

test('pure detail transition initializes back, clamps boundaries and maps approved keys', () => {
  assert.equal(typeof logic.nextDetailAction, 'function',
    'TV recipe detail must expose a pure action transition');
  const next = logic.nextDetailAction;
  assert.deepEqual(next(0, 'ArrowUp'), {actionIndex: 0, command: 'focus'});
  assert.deepEqual(next(0, 'ArrowDown'), {actionIndex: 1, command: 'focus'});
  assert.deepEqual(next(1, 'ArrowDown'), {actionIndex: 1, command: 'focus'});
  assert.deepEqual(next(1, 'ArrowUp'), {actionIndex: 0, command: 'focus'});
  for (const index of [0, 1]) {
    assert.deepEqual(next(index, 'Enter'), {actionIndex: index, command: 'activate'});
    for (const value of ['Escape', 'Backspace']) {
      assert.deepEqual(next(index, value), {actionIndex: index, command: 'return'});
    }
    for (const value of ['ArrowLeft', 'ArrowRight', 'PageUp', 'PageDown', ' ', 'Tab', 'x']) {
      assert.deepEqual(next(index, value), {actionIndex: index, command: 'none'}, value);
    }
  }
});

test('detail starts on back and Up/Down reveal actions in order with stable boundaries', () => {
  const s = installed();
  try {
    revealed(s, s.back);
    for (const [value, expected] of [['ArrowUp', s.back], ['ArrowDown', s.cookbook],
      ['ArrowDown', s.cookbook], ['ArrowUp', s.back], ['ArrowUp', s.back]]) {
      assert.equal(key(s.document.activeElement, value).defaultPrevented, true);
      revealed(s, expected);
    }
  } finally { s.dispose(); }
});

test('real focus from Tab or pointer resynchronizes the logical action position', () => {
  const s = installed();
  try {
    s.cookbook.focus();
    key(s.cookbook, 'ArrowUp');
    revealed(s, s.back);
    s.cookbook.focus();
    key(s.cookbook, 'ArrowDown');
    revealed(s, s.cookbook);
    s.back.focus();
    key(s.back, 'ArrowDown');
    revealed(s, s.cookbook);
  } finally { s.dispose(); }
});

test('Enter preserves native single activation of each focused action', () => {
  const s = installed();
  let saves = 0;
  const save = () => saves++;
  s.cookbook.addEventListener('click', save);
  try {
    s.cookbook.focus();
    assert.equal(key(s.cookbook, 'Enter').defaultPrevented, false, 'Native Enter must remain available');
    assert.equal(s.cookbook.clicks, 1);
    assert.equal(saves, 1);
    assert.ok(s.document.activeElement === s.cookbook, 'Cookbook retains real focus');
    assert.deepEqual(s.document.destinations, []);
    s.back.focus();
    assert.equal(key(s.back, 'Enter').defaultPrevented, false);
    assert.equal(s.back.clicks, 1);
    assert.deepEqual(s.document.destinations, ['/?mode=tv']);
  } finally { s.cookbook.removeEventListener('click', save); s.dispose(); }
});

for (const returnKey of ['Escape', 'Backspace']) {
  test(`${returnKey} explicitly returns to TV browse and prevents browser history behavior`, () => {
    const s = installed();
    try {
      for (const target of [s.back, s.cookbook, s.content, s.brand, s.document.body]) {
        target.focus();
        assert.equal(key(target, returnKey).defaultPrevented, true);
      }
      assert.deepEqual(s.document.destinations, Array(5).fill('/?mode=tv'));
      assert.equal(s.back.clicks + s.cookbook.clicks, 0, 'Return must not activate another action');
    } finally { s.dispose(); }
  });
}

test('editable targets including inherited contenteditable keep typing and all key defaults', () => {
  const s = installed();
  try {
    const targets = ['input', 'textarea', 'select'].map(tag => s.content.appendChild(new Element(tag)));
    const editable = s.content.appendChild(new Element('div', {contenteditable: 'true'}));
    targets.push(editable, editable.appendChild(new Element('span')));
    const actionEditable = s.back.appendChild(new Element('span', {contenteditable: ''}));
    targets.push(actionEditable, actionEditable.appendChild(new Element('span')));
    for (const target of targets) {
      target.focus();
      for (const value of ['ArrowUp', 'ArrowDown', 'Enter', 'Escape', 'Backspace', ' ', 'PageUp', 'PageDown']) {
        assert.equal(key(target, value).defaultPrevented, false, `${target.tagName} ${value}`);
        assert.ok(s.document.activeElement === target, 'Key must retain focus');
      }
    }
    assert.deepEqual(s.document.destinations, []);
  } finally { s.dispose(); }
});

test('arrows outside primary actions and content-scroll keys retain native defaults', () => {
  const s = installed();
  try {
    for (const target of [s.content, s.main, s.brand, s.document.body]) {
      target.focus();
      for (const value of ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'PageUp', 'PageDown', ' ', 'Tab']) {
        assert.equal(key(target, value).defaultPrevented, false, value);
        assert.ok(s.document.activeElement === target, 'Key must retain focus');
      }
    }
    for (const target of [s.back, s.cookbook]) {
      target.focus();
      for (const value of ['PageUp', 'PageDown', ' ', 'Tab', 'ArrowLeft', 'ArrowRight']) {
        assert.equal(key(target, value).defaultPrevented, false, value);
      }
    }
  } finally { s.dispose(); }
});

test('adapter cleanup removes focus and global return listeners and allows native links', () => {
  const s = installed();
  assert.ok(listenerCount(s.document) > 0);
  s.dispose();
  s.dispose();
  assert.equal(listenerCount(s.document), 0);
  s.cookbook.focus();
  for (const value of ['ArrowUp', 'Escape', 'Backspace']) {
    assert.equal(key(s.cookbook, value).defaultPrevented, false);
    assert.ok(s.document.activeElement === s.cookbook, 'Cookbook retains real focus');
  }
  assert.deepEqual(s.document.destinations, []);
  key(s.back, 'Enter');
  assert.deepEqual(s.document.destinations, ['/?mode=tv']);
});

test('TV initialization combines detail navigation with pending guards, save/remove and cleanup', async () => {
  const s = fixture();
  const requests = [];
  let finish;
  const cleanup = initializePage(s.document, {
    navigate: href => s.document.destinations.push(href),
    transport: (url, options) => {
      requests.push({url, options});
      return new Promise(resolve => { finish = resolve; });
    },
  });
  try {
    revealed(s, s.back);
    key(s.back, 'ArrowDown');
    revealed(s, s.cookbook);
    key(s.cookbook, 'Enter');
    await flush();
    assert.equal(requests.length, 1);
    assert.equal(requests[0].options.method, 'POST');
    assert.deepEqual(JSON.parse(requests[0].options.body), {id: recipe.id});
    assert.equal(s.cookbook.getAttribute('aria-pressed'), 'false', 'Pending save is not confirmed');
    assert.equal(s.cookbook.getAttribute('aria-busy'), 'true');
    assert.equal(s.cookbook.disabled, false, 'Pending action must retain focus');
    assert.ok(s.document.activeElement === s.cookbook, 'Cookbook retains real focus');
    key(s.cookbook, 'Enter');
    await flush();
    assert.equal(requests.length, 1, 'Repeated Enter during pending must not send another mutation');
    key(s.cookbook, 'ArrowUp');
    revealed(s, s.back);
    key(s.back, 'ArrowDown');
    finish({ok: true, json: async () => ({recipe_ids: [recipe.id]})});
    await flush();
    assert.ok(s.document.activeElement === s.cookbook, 'Cookbook retains real focus');
    assert.equal(s.cookbook.getAttribute('aria-pressed'), 'true');
    assert.equal(s.cookbook.getAttribute('aria-busy'), 'false');
    assert.match(s.cookbook.getAttribute('aria-label'), /Remove Lemon bowl from My Cookbook/);
    assert.match(s.status.textContent, /Lemon bowl.*added to My Cookbook/);
    key(s.cookbook, 'Enter');
    await flush();
    assert.equal(requests.length, 2);
    assert.equal(requests[1].url, `/api/cookbook/${recipe.id}`);
    assert.equal(requests[1].options.method, 'DELETE');
    finish({ok: true, json: async () => ({recipe_ids: []})});
    await flush();
    assert.equal(s.cookbook.getAttribute('aria-pressed'), 'false');
    assert.match(s.status.textContent, /removed from My Cookbook/);
    key(s.cookbook, 'Backspace');
    assert.deepEqual(s.document.destinations, ['/?mode=tv']);
  } finally { cleanup(); }
  assert.equal(listenerCount(s.document), 0);
});

test('failed detail save retains confirmed state and focus, announces failure and permits retry', async () => {
  const s = fixture();
  let calls = 0;
  const cleanup = initializePage(s.document, {transport: async () => {
    calls++;
    return calls === 1 ? {ok: false} : {ok: true, json: async () => ({recipe_ids: [recipe.id]})};
  }});
  try {
    s.cookbook.focus();
    key(s.cookbook, 'Enter');
    await flush();
    assert.equal(calls, 1);
    assert.equal(s.cookbook.getAttribute('aria-pressed'), 'false');
    assert.equal(s.cookbook.getAttribute('aria-busy'), 'false');
    assert.ok(s.document.activeElement === s.cookbook, 'Cookbook retains real focus');
    assert.match(s.status.textContent, /Could not update My Cookbook.*Try again/);
    key(s.cookbook, 'Enter');
    await flush();
    assert.equal(calls, 2);
    assert.equal(s.cookbook.getAttribute('aria-pressed'), 'true');
    assert.ok(s.document.activeElement === s.cookbook, 'Cookbook retains real focus');
  } finally { cleanup(); }
  assert.equal(listenerCount(s.document), 0);
});

for (const malformed of ['{broken', 'null', JSON.stringify({page: 'detail', mode: 'invalid', recipes: []}),
  JSON.stringify({page: 'detail', mode: 'tv', recipes: [recipe], saved_recipe_ids: 'wrong'})]) {
  test(`malformed detail bootstrap fails accessibly while content and back link survive: ${malformed.slice(0, 30)}`, async () => {
    const s = fixture();
    s.content.textContent = 'Ingredients and numbered method remain readable.';
    s.bootstrap.textContent = malformed;
    let requests = 0;
    const cleanup = initializePage(s.document, {transport: async () => { requests++; }});
    try {
      assert.match(s.status.textContent, /could not.*recipe|recipe.*could not/i);
      assert.ok(['status', 'alert'].includes(s.status.getAttribute('role')));
      assert.ok(['polite', 'assertive'].includes(s.status.getAttribute('aria-live')));
      assert.equal(s.content.textContent, 'Ingredients and numbered method remain readable.');
      key(s.cookbook, 'Enter');
      await flush();
      assert.equal(requests, 0);
      key(s.back, 'Enter');
      assert.deepEqual(s.document.destinations, ['/?mode=tv']);
    } finally { cleanup(); }
    assert.equal(listenerCount(s.document), 0, 'Failed init must leave no partial listeners');
  });
}

test('mobile detail initializes cookbook without TV focus or return interception', async () => {
  const s = fixture('mobile');
  const requests = [];
  const cleanup = initializePage(s.document, {transport: async (url, options) => {
    requests.push({url, options});
    return {ok: true, json: async () => ({recipe_ids: [recipe.id]})};
  }});
  try {
    assert.equal(s.document.activeElement, null);
    s.cookbook.focus();
    for (const value of ['ArrowUp', 'ArrowDown', 'Escape', 'Backspace']) {
      assert.equal(key(s.cookbook, value).defaultPrevented, false);
      assert.ok(s.document.activeElement === s.cookbook, 'Cookbook retains real focus');
    }
    key(s.cookbook, 'Enter');
    await flush();
    assert.equal(requests.length, 1);
    assert.equal(s.cookbook.getAttribute('aria-pressed'), 'true');
    key(s.back, 'Enter');
    assert.deepEqual(s.document.destinations, ['/']);
  } finally { cleanup(); }
  assert.equal(listenerCount(s.document), 0);
});

test('mobile browse initialization still filters live, clears results and cleans search listeners', () => {
  const s = fixture('mobile', 'browse');
  const search = s.main.appendChild(new Element('input', {id: 'search', type: 'search'}));
  search.value = '';
  const count = s.main.appendChild(new Element('p', {id: 'count'}));
  const empty = s.main.appendChild(new Element('p', {id: 'empty'}));
  const card = s.main.appendChild(new Element('article', {class: 'recipe-card', 'data-recipe-id': recipe.id}));
  const cleanup = initializePage(s.document, {transport: async () => ({ok: true})});
  try {
    assert.equal(s.document.activeElement, null);
    for (const [value, hidden, text] of [['CHICKPEAS', false, '1 recipe'],
      ['unknown-ticket-7', true, '0 recipes'], ['', false, '1 recipe']]) {
      search.value = value;
      search.dispatch('input');
      assert.equal(card.hidden, hidden);
      assert.equal(count.textContent, text);
      assert.equal(empty.hidden, !hidden);
      if (hidden) assert.equal(empty.textContent, 'No recipes found. Try another ingredient or dish.');
    }
  } finally { cleanup(); }
  assert.equal(listenerCount(s.document), 0);
  search.value = 'unknown-ticket-7';
  search.dispatch('input');
  assert.equal(card.hidden, false, 'Disposed search must not update results');
});


test('semantic fixture bubbles focus/key events and models native activation separately', () => {
  const s = fixture();
  let observed;
  s.document.addEventListener('focusin', event => { observed = event.target; });
  s.back.focus();
  assert.ok(observed === s.back && s.document.activeElement === s.back);
  key(s.back, 'Enter');
  assert.equal(s.back.clicks, 1);
  assert.deepEqual(s.document.destinations, ['/?mode=tv']);
  const prevent = event => event.preventDefault();
  s.document.addEventListener('keydown', prevent);
  assert.equal(key(s.back, 'Enter').defaultPrevented, true);
  assert.equal(s.back.clicks, 1);
  s.document.removeEventListener('keydown', prevent);
  assert.equal(s.document.querySelector('[data-detail-actions]'), s.group);
  assert.equal(s.group.querySelector('.back'), s.back);
  assert.equal(s.document.querySelector('.cookbook'), s.cookbook);
});
