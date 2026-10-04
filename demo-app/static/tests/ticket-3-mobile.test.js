// Ticket 3: pure matching and live-filter presentation seams from Program Design.
// No browser library, network, timers, or production changes are needed.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as logic from '../app-logic.js';

const recipe = {
  id: 'sample', title: 'Lemon bowl', description: 'A bright everyday meal.',
  category: 'Lunch', dietary_tags: ['Vegan', 'Gluten-free'],
  ingredients: ['200 g chickpeas', '1 tbsp olive oil'],
  steps: ['Mix secretly', 'Serve', 'Enjoy'], difficulty: 'Easy',
  prep_minutes: 10, cook_minutes: 0, servings: 2,
  colors: ['#fff', '#000'], featured: true,
};

function matcher() {
  assert.equal(typeof logic.matchesRecipe, 'function',
    'Recipe matching must replace obsolete client matching');
  return logic.matchesRecipe;
}

test('search matches each approved field with case normalization and trimming', () => {
  const match = matcher();
  for (const query of ['', ' \t\n ', '  LEMON ', 'BRIGHT', 'lunch', 'VEGAN', 'gluten-free', 'CHICKPEAS', 'olive oil']) {
    assert.equal(match(recipe, query), true, query);
  }
  for (const query of ['no-match', 'secretly', 'Easy', 'sample', '#fff', 'bowl A', 'Vegan Gluten-free', 'chickpeas 1 tbsp']) {
    assert.equal(match(recipe, query), false, query);
  }
  assert.equal(match({...recipe, dietary_tags: []}, 'vegan'), false);
  assert.equal(match({...recipe, dietary_tags: []}, ''), true);
});

test('literal punctuation and Unicode lowercasing do not become regex or locale search', () => {
  const match = matcher();
  const special = {...recipe, title: 'İstanbul Straße ΟΣ [rice] a+b'};
  for (const q of ['i\u0307stanbul', 'straße', 'ος', '[rice]', 'a+b']) {
    assert.equal(match(special, q), true, q);
  }
  for (const q of ['STRASSE', '.*', '^', 'bowl|rice']) {
    assert.equal(match(special, q), false, q);
  }
});

function element(dataset = {}) {
  const attrs = new Map();
  return {
    dataset, hidden: false, textContent: '',
    setAttribute(key, value) { attrs.set(key, String(value)); },
    getAttribute(key) {
      if (key === 'data-recipe-id') return dataset.recipeId ?? null;
      return attrs.get(key) ?? null;
    },
    removeAttribute(key) { attrs.delete(key); },
    toggleAttribute(key, enabled) {
      if (key === 'hidden') this.hidden = enabled;
      enabled ? attrs.set(key, '') : attrs.delete(key);
    },
  };
}

test('live filtering updates cards, count and exact empty copy; clearing restores all', async () => {
  // app.js may install listeners on import. Supply a harmless document while
  // importing, then exercise its specified deterministic filter seam directly.
  const previousDocument = globalThis.document;
  globalThis.document = {
    querySelector: () => null, querySelectorAll: () => [],
    getElementById: () => null, addEventListener() {},
  };
  let app;
  try {
    app = await import('../app.js');
  } finally {
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
  }
  assert.equal(typeof app.updateBrowseResults, 'function',
    'app.js must expose the Program Design live-filter seam');
  const second = {...recipe, id: 'second', title: 'Apple oats', ingredients: ['100 g oats']};
  const recipes = [recipe, second];
  const cards = recipes.map(r => element({recipeId: r.id}));
  const countElement = element();
  const emptyElement = element();
  // Initial markup is covered by the Python suite; this checks input results.
  for (const [query, visibility, count] of [
    ['', [true, true], 2],
    ['  CHICKPEAS  ', [true, false], 1],
    ['no-match-ticket-3', [false, false], 0],
    ['oats', [false, true], 1],
    [' \t ', [true, true], 2],
  ]) {
    app.updateBrowseResults({recipes, cards, query, countElement, emptyElement});
    assert.deepEqual(cards.map(c => !c.hidden), visibility, query);
    assert.match(countElement.textContent, new RegExp(`\\b${count}\\s+recipe${count === 1 ? '' : 's'}\\b`));
    assert.equal(emptyElement.hidden, count !== 0);
    if (count === 0) {
      assert.equal(emptyElement.textContent, 'No recipes found. Try another ingredient or dish.');
    }
  }
  assert.deepEqual(recipes, [recipe, second], 'Filtering must not mutate recipe data');
});
