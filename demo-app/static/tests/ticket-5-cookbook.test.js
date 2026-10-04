// Ticket 5: confirmed cookbook behavior at the approved controller/page seams.
// Offline DOM doubles establish state/listener behavior, not browser rendering.
import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {initializePage} from '../app.js';

const ERROR = 'Could not update My Cookbook. Try again.';
const moduleUrl = new URL('../cookbook.js', import.meta.url);

async function factory() {
  // A missing feature is an assertion failure, never an import/collection error.
  assert.ok(existsSync(moduleUrl), 'The confirmed cookbook controller must be provided');
  const module = await import(moduleUrl);
  assert.equal(typeof module.createCookbookController, 'function');
  return module.createCookbookController;
}

class Element {
  constructor(tagName = 'button', attrs = {}, text = '') {
    this.tagName = tagName.toUpperCase();
    this.attrs = new Map(Object.entries(attrs));
    this.dataset = {};
    this.listeners = new Map();
    this.children = [];
    this.textContent = text;
    this.disabled = false;
    this.hidden = false;
    for (const [key, value] of this.attrs) this.setAttribute(key, value);
    this.classList = {
      contains: c => (this.getAttribute('class') || '').split(/\s+/).includes(c),
      toggle: (c, force) => {
        const classes = new Set((this.getAttribute('class') || '').split(/\s+/).filter(Boolean));
        const enabled = force ?? !classes.has(c);
        enabled ? classes.add(c) : classes.delete(c);
        this.setAttribute('class', [...classes].join(' '));
        return enabled;
      },
      add: (...cs) => cs.forEach(c => this.classList.toggle(c, true)),
      remove: (...cs) => cs.forEach(c => this.classList.toggle(c, false)),
    };
  }
  setAttribute(key, value) {
    this.attrs.set(key, String(value));
    if (key.startsWith('data-')) {
      this.dataset[key.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = String(value);
    }
  }
  getAttribute(key) { return this.attrs.get(key) ?? null; }
  hasAttribute(key) { return this.attrs.has(key); }
  removeAttribute(key) { this.attrs.delete(key); }
  addEventListener(type, fn) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type).add(fn);
  }
  removeEventListener(type, fn) { this.listeners.get(type)?.delete(fn); }
  click() {
    if (this.disabled) return;
    const event = {target: this, currentTarget: this, preventDefault() {}, stopPropagation() {}};
    for (const listener of this.listeners.get('click') || []) listener(event);
  }
  focus() { this.ownerDocument.activeElement = this; }
  appendChild(child) {
    child.ownerDocument = this.ownerDocument;
    child.parentElement = this;
    this.children.push(child);
    return child;
  }
  append(...children) { children.forEach(child => this.appendChild(child)); }
  matches(selector) {
    return selector.split(',').some(s => {
      s = s.trim();
      const tag = s.match(/^[a-z]+/i)?.[0];
      if (tag && tag.toUpperCase() !== this.tagName) return false;
      const id = s.match(/#([\w-]+)/)?.[1];
      if (id && this.getAttribute('id') !== id) return false;
      for (const [, c] of s.matchAll(/\.([\w-]+)/g)) if (!this.classList.contains(c)) return false;
      for (const [, key, value] of s.matchAll(/\[([\w-]+)(?:=["']?([^\]"']+)["']?)?\]/g)) {
        if (!this.hasAttribute(key) || (value !== undefined && this.getAttribute(key) !== value)) return false;
      }
      return true;
    });
  }
  querySelectorAll(selector) {
    return this.children.flatMap(c => [...(c.matches(selector) ? [c] : []), ...c.querySelectorAll(selector)]);
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] ?? null; }
  closest(selector) { return this.matches(selector) ? this : this.parentElement?.closest(selector) ?? null; }
}

function control(id = 'lentils', title = 'Lemon lentils') {
  return new Element('button', {
    class: 'cookbook', 'data-recipe-id': id, 'data-recipe-title': title,
    'aria-pressed': 'false', 'aria-label': `Add ${title} to My Cookbook`,
  }, 'Add to My Cookbook');
}

function attach(controls) {
  const document = {activeElement: null};
  controls.forEach(c => { c.ownerDocument = document; });
  return document;
}

function deferredTransport() {
  const calls = [];
  const transport = (url, options) => new Promise((resolve, reject) => {
    calls.push({url, options, resolve, reject});
  });
  return {calls, transport};
}
const response = ids => ({ok: true, status: 200, json: async () => ({recipe_ids: ids})});
async function drain() { for (let i = 0; i < 30; i++) await Promise.resolve(); }

function state(button, saved, pending = false) {
  assert.equal(button.getAttribute('aria-pressed'), String(saved));
  assert.match(button.getAttribute('aria-label') || '', new RegExp(saved ? 'Remove' : 'Add', 'i'));
  assert.ok((button.getAttribute('aria-label') || '').includes(button.dataset.recipeTitle));
  assert.ok((button.getAttribute('aria-label') || '').includes('My Cookbook'));
  assert.match(button.textContent, new RegExp(saved ? 'Remove|Saved' : 'Add', 'i'));
  assert.equal(button.classList.contains('saved'), saved, 'Saved appearance must agree with confirmed state');
  assert.equal(button.disabled, false, 'Pending native buttons must retain focus and keyboard reachability');
  for (const key of ['aria-disabled', 'aria-busy']) {
    if (pending) assert.equal(button.getAttribute(key), 'true', key);
    else assert.notEqual(button.getAttribute(key), 'true', key);
  }
}

function request(call, id, method) {
  assert.equal(call.options.method, method);
  if (method === 'POST') {
    assert.equal(call.url, '/api/cookbook');
    assert.deepEqual(JSON.parse(call.options.body), {id});
    const headers = call.options.headers;
    assert.match(typeof headers?.get === 'function' ? headers.get('Content-Type') :
      headers?.['Content-Type'] ?? headers?.['content-type'] ?? '', /application\/json/i);
  } else assert.equal(call.url, `/api/cookbook/${encodeURIComponent(id)}`);
}

async function setup(initialIds = [], controls = [control(), control()]) {
  const create = await factory();
  const document = attach(controls);
  const wire = deferredTransport();
  const announcements = [];
  const controller = create({initialIds, controls, transport: wire.transport,
    announce: message => announcements.push(message)});
  assert.equal(typeof controller.toggle, 'function');
  assert.equal(typeof controller.syncControls, 'function');
  assert.equal(typeof controller.dispose, 'function');
  return {controller, controls, document, announcements, ...wire};
}

test('authoritative saved initialization; pending POST/DELETE reconcile every occurrence and retain focus', async () => {
  const s = await setup(['lentils']);
  try {
    s.controls.forEach(c => state(c, true));
    s.controls[0].focus();
    s.controls[0].click();
    await drain();
    assert.equal(s.calls.length, 1);
    request(s.calls[0], 'lentils', 'DELETE');
    s.controls.forEach(c => state(c, true, true));
    assert.equal(s.document.activeElement, s.controls[0]);
    s.controls[1].click();
    void s.controller.toggle('lentils');
    await drain();
    assert.equal(s.calls.length, 1, 'Repeated occurrence and direct pending activation must not duplicate requests');
    s.calls[0].resolve(response([]));
    await drain();
    s.controls.forEach(c => state(c, false));
    assert.equal(s.document.activeElement, s.controls[0]);
    assert.ok(s.announcements.some(m => /removed/i.test(m) && m.includes('Lemon lentils')));
    s.controls[1].click();
    await drain();
    assert.equal(s.calls.length, 2);
    request(s.calls[1], 'lentils', 'POST');
    s.controls.forEach(c => state(c, false, true));
    s.calls[1].resolve(response(['lentils']));
    await drain();
    s.controls.forEach(c => state(c, true));
    assert.ok(s.announcements.some(m => /added|saved/i.test(m) && m.includes('Lemon lentils')));
  } finally { s.controller.dispose(); }
});

test('different recipes serialize full snapshots; queued method uses membership at execution', async () => {
  const s = await setup([], [control(), control(), control('oats', 'Apple oats')]);
  try {
    s.controls[0].click();
    s.controls[2].click();
    await drain();
    assert.equal(s.calls.length, 1, 'Only one complete-snapshot mutation may be in flight globally');
    s.controls.forEach(c => state(c, false, true));
    request(s.calls[0], 'lentils', 'POST');
    // Authoritative snapshot may also change a recipe queued behind this one.
    s.calls[0].resolve(response(['lentils', 'oats']));
    await drain();
    assert.equal(s.calls.length, 2);
    request(s.calls[1], 'oats', 'DELETE');
    s.controls.slice(0, 2).forEach(c => state(c, true));
    state(s.controls[2], true, true);
    s.calls[1].resolve(response(['lentils']));
    await drain();
    s.controls.slice(0, 2).forEach(c => state(c, true));
    state(s.controls[2], false);
  } finally { s.controller.dispose(); }
});

const failures = [
  ['HTTP', call => call.resolve({ok: false, status: 503, json: async () => ({recipe_ids: []})})],
  ['network', call => call.reject(new Error('offline'))],
  ['JSON parsing', call => call.resolve({ok: true, json: async () => { throw new SyntaxError('bad JSON'); }})],
  ...[null, {}, {recipe_ids: 'lentils'}, {recipe_ids: [1]}, {recipe_ids: [null]}, {recipe_ids: ['lentils', {}]}]
    .map((body, index) => [`invalid envelope ${index}`, call => call.resolve({ok: true, json: async () => body})]),
];
for (const [failure, complete] of failures) {
  for (const saved of [false, true]) {
    test(`${failure} preserves ${saved ? 'saved' : 'unsaved'} state, announces approved error, permits retry`, async () => {
      const s = await setup(saved ? ['lentils'] : []);
      s.announcements.length = 0; // Isolate mutation announcements from initialization.
      try {
        s.controls[0].focus();
        s.controls[0].click();
        await drain();
        request(s.calls[0], 'lentils', saved ? 'DELETE' : 'POST');
        complete(s.calls[0]);
        await drain();
        s.controls.forEach(c => state(c, saved));
        assert.equal(s.document.activeElement, s.controls[0]);
        assert.ok(s.announcements.includes(ERROR));
        assert.ok(!s.announcements.some(m => /added|removed|saved/i.test(m)), 'Failure must never announce success');
        s.controls[1].click();
        await drain();
        assert.equal(s.calls.length, 2);
        request(s.calls[1], 'lentils', saved ? 'DELETE' : 'POST');
        s.calls[1].resolve(response(saved ? [] : ['lentils']));
        await drain();
        s.controls.forEach(c => state(c, !saved));
      } finally { s.controller.dispose(); }
    });
  }
}

test('failed queue head does not strand another recipe', async () => {
  const s = await setup([], [control(), control('oats', 'Apple oats')]);
  try {
    s.controls.forEach(c => c.click());
    await drain();
    assert.equal(s.calls.length, 1);
    s.calls[0].reject(new Error('offline'));
    await drain();
    assert.equal(s.calls.length, 2);
    request(s.calls[1], 'oats', 'POST');
    state(s.controls[0], false);
    s.calls[1].resolve(response(['oats']));
    await drain();
    state(s.controls[0], false);
    state(s.controls[1], true);
  } finally { s.controller.dispose(); }
});

for (const initialIds of [null, 'lentils', [42], [null], ['lentils', {}]]) {
  test(`controller rejects malformed authoritative membership ${JSON.stringify(initialIds)}`, async () => {
    const create = await factory();
    const controls = [control()];
    attach(controls);
    const wire = deferredTransport();
    const announcements = [];
    let controller;
    let reported = false;
    try {
      controller = create({initialIds, controls, transport: wire.transport,
        announce: message => announcements.push(message)});
    } catch (error) {
      assert.ok(error instanceof Error);
      reported = true;
    }
    try {
      assert.ok(reported || announcements.some(m => /could not|unable|error|invalid|failed/i.test(m)),
        'Malformed saved membership must be reported, never silently treated as an empty cookbook');
      controls[0].click();
      await drain();
      assert.equal(wire.calls.length, 0);
      assert.equal(controls[0].getAttribute('aria-pressed'), 'false');
    } finally { controller?.dispose(); }
  });
}

test('programmatic toggle returns a settled promise and explicit sync restores confirmed controls', async () => {
  const s = await setup();
  try {
    const completion = s.controller.toggle('lentils');
    assert.equal(typeof completion?.then, 'function', 'toggle must expose an awaitable mutation');
    await drain();
    assert.equal(s.calls.length, 1);
    s.calls[0].resolve(response(['lentils']));
    await completion;
    s.controls.forEach(c => state(c, true));
    s.controls[1].setAttribute('aria-pressed', 'false');
    s.controls[1].setAttribute('aria-label', 'incorrect');
    s.controls[1].classList.remove('saved');
    s.controller.syncControls();
    s.controls.forEach(c => state(c, true));
    assert.equal(s.calls.length, 1, 'Rendering confirmed state does not mutate server membership');
  } finally { s.controller.dispose(); }
});

test('dispose removes control activation listeners', async () => {
  const s = await setup();
  s.controller.dispose();
  s.controls.forEach(c => c.click());
  await drain();
  assert.equal(s.calls.length, 0);
});

function pageDocument(page, savedIds = [], raw) {
  const document = new Element('document');
  document.ownerDocument = document;
  document.activeElement = null;
  document.createElement = tag => { const e = new Element(tag); e.ownerDocument = document; return e; };
  document.getElementById = id => document.querySelector(`#${id}`);
  document.body = document.appendChild(new Element('body'));
  const add = e => document.body.appendChild(e);
  const recipe = {id: 'lentils', title: 'Lemon lentils', description: 'A bright bowl.', category: 'Lunch',
    dietary_tags: ['Vegan'], ingredients: ['Lentils'], steps: ['Rinse', 'Cook', 'Serve'],
    prep_minutes: 5, cook_minutes: 20, difficulty: 'Easy', servings: 2, colors: ['#fff', '#000'], featured: true};
  const bootstrap = {page, mode: 'mobile', recipes: [recipe], saved_recipe_ids: savedIds, browse_url: '/'};
  add(new Element('script', {id: 'page-bootstrap', type: 'application/json'}, raw ?? JSON.stringify(bootstrap)));
  add(new Element('p', {id: 'cookbook-status', role: 'status', 'aria-live': 'polite'}));
  const controls = [add(control())];
  const link = add(new Element('a', {class: 'back recipe-link', href: '/recipe/lentils'}, 'Read recipe'));
  if (page === 'browse') {
    const search = add(new Element('input', {id: 'search', type: 'search'}));
    search.value = '';
    add(new Element('p', {id: 'count', role: 'status', 'aria-live': 'polite'}));
    add(new Element('p', {id: 'empty'}));
    add(new Element('article', {class: 'recipe-card', 'data-recipe-id': 'lentils'}));
  }
  return {document, controls, link};
}
function liveText(document) {
  return document.querySelectorAll('[role="status"], [role="alert"], [aria-live="polite"], [aria-live="assertive"]')
    .map(e => e.textContent).join(' ');
}
for (const page of ['browse', 'detail']) {
  test(`app initializer binds ${page} cookbook from authoritative bootstrap, reports failure and cleans up`, async () => {
    const {document, controls, link} = pageDocument(page, ['lentils']);
    const wire = deferredTransport();
    const cleanup = initializePage(document, {transport: wire.transport});
    assert.equal(typeof cleanup, 'function');
    try {
      state(controls[0], true);
      controls[0].focus();
      controls[0].click();
      await drain();
      assert.equal(wire.calls.length, 1, `${page} cookbook activation must call injected transport`);
      request(wire.calls[0], 'lentils', 'DELETE');
      state(controls[0], true, true);
      assert.equal(link.disabled, false, 'Navigation remains available during mutations');
      assert.notEqual(link.getAttribute('aria-disabled'), 'true');
      wire.calls[0].reject(new Error('offline'));
      await drain();
      state(controls[0], true);
      assert.equal(document.activeElement, controls[0]);
      assert.ok(liveText(document).includes(ERROR), 'Approved retry error must reach a live region');
      controls[0].click();
      await drain();
      assert.equal(wire.calls.length, 2);
      wire.calls[1].resolve(response([]));
      await drain();
      state(controls[0], false);
      assert.match(liveText(document), /Lemon lentils/);
    } finally { cleanup(); }
    controls[0].click();
    await drain();
    assert.equal(wire.calls.length, 2, 'Page cleanup removes cookbook listeners');
  });
  for (const [label, ids, raw] of [
    ['invalid JSON', [], '{broken'], ['null membership', null],
    ['non-string member', [42]], ['non-array membership', 'lentils'],
  ]) {
    test(`${page} malformed bootstrap reports accessible initialization failure (${label})`, async () => {
      const {document, controls, link} = pageDocument(page, ids, raw);
      const wire = deferredTransport();
      const original = controls[0].getAttribute('aria-pressed');
      const cleanup = initializePage(document, {transport: wire.transport});
      try {
        assert.match(liveText(document), /could not|couldn't|unable|error|failed/i);
        assert.match(liveText(document), /recipe|cookbook/i);
        controls[0].click();
        await drain();
        assert.equal(wire.calls.length, 0, 'Invalid initialization cannot invent saved membership');
        assert.equal(controls[0].getAttribute('aria-pressed'), original);
        assert.equal(link.getAttribute('href'), '/recipe/lentils');
      } finally { if (typeof cleanup === 'function') cleanup(); }
    });
  }
}
