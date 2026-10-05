import test from 'node:test';
import assert from 'node:assert/strict';
import {matchesRecipe} from '../app-logic.js';

test('recipe search matches ingredient text without crossing field boundaries', () => {
  const recipe = {title: 'Apple oats', description: 'Warm breakfast',
    category: 'Breakfast', dietary_tags: [], ingredients: ['100 g rolled oats']};
  assert.equal(matchesRecipe(recipe, '  ROLLED OATS '), true);
  assert.equal(matchesRecipe(recipe, 'oats Warm'), false);
  assert.equal(matchesRecipe(recipe, 'lemon'), false);
  assert.equal(matchesRecipe(recipe, ''), true);
});

import {readFileSync} from 'node:fs';
import {recipeHref, nextBrowseFocus, nextDetailAction} from '../app-logic.js';
import {initializePage, updateBrowseResults} from '../app.js';
const collection = JSON.parse(readFileSync(new URL('../../catalog.json', import.meta.url)));

test('every approved field is searchable on the shipped offline collection', () => {
  for (const recipe of collection) {
    for (const value of [recipe.title, recipe.description, recipe.category,
      ...recipe.dietary_tags, ...recipe.ingredients]) {
      assert.equal(matchesRecipe(recipe, `\x85${value.toUpperCase()}\x1c`), true, value);
    }
  }
});

test('live result updates restore ordered cards and exact empty copy', () => {
  const cards = collection.map(r => ({dataset: {recipeId: r.id}, hidden: false}));
  const countElement = {}, emptyElement = {};
  for (const [query, ids] of [['CHICKPEAS', ['chickpea-lemon-salad']],
    ['unmatched-dish-918', []], ['', collection.map(r => r.id)]]) {
    updateBrowseResults({recipes: collection, cards, query, countElement, emptyElement});
    assert.deepEqual(cards.filter(c => !c.hidden).map(c => c.dataset.recipeId), ids);
    assert.equal(countElement.textContent, `${ids.length} recipe${ids.length === 1 ? '' : 's'}`);
    assert.equal(emptyElement.hidden, ids.length > 0);
    assert.equal(emptyElement.textContent, 'No recipes found. Try another ingredient or dish.');
  }
});

test('mobile initialization handles input locally and removes its listener', () => {
  const listeners = new Map();
  const search = {value: '', addEventListener: (k, fn) => listeners.set(k, fn),
    removeEventListener: (k, fn) => { if (listeners.get(k) === fn) listeners.delete(k); }};
  const cards = collection.map(r => ({dataset: {recipeId: r.id}}));
  const count = {}, empty = {}, status = {setAttribute() {}};
  const nodes = {'#page-bootstrap': {textContent: JSON.stringify({page: 'browse', mode: 'mobile',
    recipes: collection, saved_recipe_ids: [], browse_url: '/'})},
    '#search': search, '#count': count, '#empty': empty, '#cookbook-status': status};
  const doc = {querySelector: s => nodes[s], querySelectorAll: s => s === '.cookbook' ? [] : cards};
  const cleanup = initializePage(doc, {transport: () => assert.fail('Search must not request a mutation'),
    navigate: () => assert.fail('Input must not navigate')});
  search.value = 'chickpeas';
  listeners.get('input')();
  assert.equal(count.textContent, '1 recipe');
  assert.deepEqual(cards.filter(c => !c.hidden).map(c => c.dataset.recipeId), ['chickpea-lemon-salad']);
  cleanup();
  assert.equal(listeners.size, 0);
});

test('TV rules preserve preferred position and reconcile changed topology', () => {
  const rails = [{id: 'first', count: 5}, {id: 'empty', count: 0},
    {id: 'short', count: 2}, {id: 'last', count: 5}, {id: 'trailing', count: 0}];
  let focus = nextBrowseFocus(rails, null, null);
  assert.deepEqual(focus, {railId: 'first', cardIndex: 0, preferredCardPosition: 0});
  assert.deepEqual(nextBrowseFocus(rails, focus, 'ArrowLeft'), focus);
  for (let i = 0; i < 8; i++) focus = nextBrowseFocus(rails, focus, 'ArrowRight');
  assert.equal(focus.cardIndex, 4);
  focus = nextBrowseFocus(rails, focus, 'ArrowDown');
  assert.deepEqual(focus, {railId: 'short', cardIndex: 1, preferredCardPosition: 4});
  focus = nextBrowseFocus(rails, focus, 'ArrowDown');
  assert.deepEqual(focus, {railId: 'last', cardIndex: 4, preferredCardPosition: 4});
  assert.deepEqual(nextBrowseFocus(rails, focus, 'ArrowDown'), focus);
  assert.equal(nextBrowseFocus([{id: 'last', count: 1}], focus, null).cardIndex, 0);
  assert.equal(nextBrowseFocus([{id: 'new', count: 2}], focus, null).railId, 'new');
  assert.equal(nextBrowseFocus([{id: 'empty', count: 0}], focus, 'ArrowUp'), null);
  assert.equal(nextBrowseFocus([], null, null), null);
  for (const [index, key, actionIndex, command] of [
    [0, 'ArrowUp', 0, 'focus'], [1, 'ArrowDown', 1, 'focus'],
    [0, 'ArrowDown', 1, 'focus'], [1, 'ArrowUp', 0, 'focus'],
    [1, 'Enter', 1, 'activate'], [0, 'Escape', 0, 'return'],
    [1, 'Backspace', 1, 'return'], [1, 'Tab', 1, 'none'],
  ]) assert.deepEqual(nextDetailAction(index, key), {actionIndex, command});
  assert.equal(recipeHref('dish / pear', 'tv'), '/recipe/dish%20%2F%20pear?mode=tv');
  assert.equal(recipeHref('pear', 'mobile'), '/recipe/pear');
});
