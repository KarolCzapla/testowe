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
