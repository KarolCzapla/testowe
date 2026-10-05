import test from 'node:test';
import assert from 'node:assert/strict';
import {installTvBrowse, installTvDetail} from '../tv-navigation.js';

// Event bubbling and native activation are separate in this offline adapter seam.
class Node {
  constructor(tag, attrs = {}, dataset = {}) {
    this.tagName = tag; this.attrs = attrs; this.dataset = dataset;
    this.children = []; this.listeners = new Map(); this.clicks = 0; this.reveals = [];
  }
  add(child) {
    child.parentElement = this; child.ownerDocument = this.ownerDocument;
    this.children.push(child); return child;
  }
  addEventListener(name, fn) {
    if (!this.listeners.has(name)) this.listeners.set(name, new Set());
    this.listeners.get(name).add(fn);
  }
  removeEventListener(name, fn) { this.listeners.get(name)?.delete(fn); }
  getAttribute(name) { return this.attrs[name] ?? null; }
  hasAttribute(name) { return Object.hasOwn(this.attrs, name); }
  contains(node) {
    for (; node; node = node.parentElement) if (node === this) return true;
    return false;
  }
  matches(selector) {
    if (selector.startsWith('.')) return this.attrs.class === selector.slice(1);
    if (selector === '[data-rail-id]') return Boolean(this.dataset.railId);
    return selector.toUpperCase() === this.tagName;
  }
  closest(selector) {
    for (let node = this; node; node = node.parentElement) {
      if (selector.split(',').some(s => node.matches(s.trim()))) return node;
    }
    return null;
  }
  querySelectorAll(selector) {
    const nodes = this.children.flatMap(c => [c, ...c.querySelectorAll('*')]);
    if (selector === '*') return nodes;
    if (selector === '.recipe-card .recipe-link') return nodes.filter(n =>
      n.matches('.recipe-link') && n.parentElement.closest('.recipe-card'));
    return nodes.filter(n => n.matches(selector));
  }
  emit(name, data = {}) {
    const event = {target: this, defaultPrevented: false,
      preventDefault() { this.defaultPrevented = true; }, ...data};
    for (let node = this; node; node = node.parentElement) {
      for (const fn of node.listeners.get(name) || []) fn(event);
    }
    return event;
  }
  focus(options) { this.focusOptions = options; this.ownerDocument.activeElement = this; this.emit('focusin'); }
  scrollIntoView(options) { this.reveals.push(options); }
  key(key, extra = {}) {
    const event = this.emit('keydown', {key, ...extra});
    if (key === 'Enter' && !event.defaultPrevented) this.clicks++;
    return event;
  }
}
function document() {
  const doc = new Node('DOCUMENT'); doc.ownerDocument = doc; return doc;
}
function revealed(doc, node) {
  assert.equal(doc.activeElement, node);
  assert.deepEqual(node.focusOptions, {preventScroll: true});
  assert.deepEqual(node.reveals.at(-1), {block: 'nearest', inline: 'nearest'});
}

test('browse adapter keeps repeated occurrences separate and skips unavailable links', () => {
  const doc = document(), root = doc.add(new Node('MAIN'));
  const groups = [4, 0, 1, 4].map((size, index) => {
    const rail = root.add(new Node('SECTION', {}, {railId: `rail-${index}`}));
    return Array.from({length: size}, (_, i) => {
      const card = rail.add(new Node('ARTICLE', {class: 'recipe-card'}, {recipeId: `pear-${i}`}));
      return {card, link: card.add(new Node('A', {class: 'recipe-link', href: '/recipe/pear'})),
        button: card.add(new Node('BUTTON', {class: 'cookbook'}))};
    });
  });
  const cleanup = installTvBrowse({root});
  revealed(doc, groups[0][0].link);
  for (let i = 0; i < 3; i++) assert.equal(doc.activeElement.key('ArrowRight').defaultPrevented, true);
  revealed(doc, groups[0][3].link);
  doc.activeElement.key('ArrowDown');
  revealed(doc, groups[2][0].link);
  doc.activeElement.key('ArrowDown');
  revealed(doc, groups[3][3].link);
  const selected = doc.activeElement;
  assert.equal(selected.href, '/recipe/pear-3?mode=tv');
  assert.equal(selected.key('Enter').defaultPrevented, false);
  assert.equal(selected.clicks, 1);
  const button = groups[3][3].button;
  button.focus();
  assert.equal(button.key('ArrowUp').defaultPrevented, false);
  button.key('Enter');
  assert.equal(button.clicks, 1);
  assert.equal(selected.clicks, 1);
  groups[0][1].card.hidden = true;
  groups[0][0].link.focus();
  doc.activeElement.key('ArrowRight');
  revealed(doc, groups[0][2].link);
  assert.equal(doc.activeElement.key('ArrowLeft', {ctrlKey: true}).defaultPrevented, false);
  const input = root.add(new Node('INPUT'));
  input.focus();
  assert.equal(input.key('ArrowDown').defaultPrevented, false);
  cleanup();
  selected.focus();
  assert.equal(selected.key('ArrowLeft').defaultPrevented, false);
});

test('detail adapter preserves native actions, content scrolling, editing and cleanup', () => {
  const doc = document();
  const back = doc.add(new Node('A', {href: '/?mode=tv'}));
  const cookbook = doc.add(new Node('BUTTON'));
  const content = doc.add(new Node('P'));
  const input = doc.add(new Node('INPUT'));
  const returns = [];
  const cleanup = installTvDetail({backAction: back, cookbookAction: cookbook,
    browseUrl: '/?mode=tv', navigate: href => returns.push(href)});
  revealed(doc, back);
  assert.equal(back.key('ArrowDown').defaultPrevented, true);
  revealed(doc, cookbook);
  cookbook.key('Enter');
  assert.equal(cookbook.clicks, 1);
  cookbook.key('ArrowUp');
  revealed(doc, back);
  for (const key of ['ArrowDown', 'PageDown', ' ']) {
    assert.equal(content.key(key).defaultPrevented, false);
  }
  for (const key of ['Escape', 'Backspace', 'ArrowDown']) {
    assert.equal(input.key(key).defaultPrevented, false);
  }
  for (const key of ['Escape', 'Backspace']) assert.equal(content.key(key).defaultPrevented, true);
  assert.deepEqual(returns, ['/?mode=tv', '/?mode=tv']);
  assert.equal(content.key('Escape', {altKey: true}).defaultPrevented, false);
  cleanup();
  assert.equal(content.key('Escape').defaultPrevented, false);
  assert.deepEqual(returns, ['/?mode=tv', '/?mode=tv']);
  assert.throws(() => installTvDetail({backAction: back, cookbookAction: cookbook,
    browseUrl: '/'}), /Invalid TV recipe detail actions/);
});
