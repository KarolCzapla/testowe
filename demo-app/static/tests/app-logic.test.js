import test from 'node:test';
import assert from 'node:assert/strict';
import {matchesMovie, nextWatchlist} from '../app-logic.js';

test('movie matching ignores case and surrounding whitespace', () => {
  assert.equal(matchesMovie('Afterlight Station Sci-Fi', '  sci-FI '), true);
  assert.equal(matchesMovie('Afterlight Station Sci-Fi', 'comedy'), false);
});

test('watchlist toggles deterministically', () => {
  assert.deepEqual(nextWatchlist(['b'], 'a'), ['a', 'b']);
  assert.deepEqual(nextWatchlist(['a', 'b'], 'a'), ['b']);
});
