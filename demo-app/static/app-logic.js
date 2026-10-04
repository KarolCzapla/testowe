// Match Python str.strip() whitespace explicitly. JavaScript trim() additionally
// removes U+FEFF and omits U+0085 and U+001C–U+001F, causing API/browser drift.
const SEARCH_EDGE_WHITESPACE = /^[\u0009-\u000d\u001c-\u0020\u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]+|[\u0009-\u000d\u001c-\u0020\u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]+$/g;

// Keep search fields separate: text spanning two fields is not a match.
export function matchesRecipe(recipe, query) {
  const needle = query.replace(SEARCH_EDGE_WHITESPACE, '').toLowerCase();
  if (!needle) return true;
  return [recipe.title, recipe.description, recipe.category,
    ...recipe.dietary_tags, ...recipe.ingredients]
    .some(value => value.toLowerCase().includes(needle));
}
