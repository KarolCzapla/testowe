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

export function recipeHref(recipeId, mode) {
  return `/recipe/${encodeURIComponent(recipeId)}${mode === 'tv' ? '?mode=tv' : ''}`;
}

// Reconcile on every transition: rail membership can change between key events.
// The preferred column survives shorter rails until horizontal or native focus.
export function nextBrowseFocus(rails, current, direction) {
  const populated = rails.filter(rail => Number.isInteger(rail.count) && rail.count > 0);
  if (!populated.length) return null;
  const validPosition = value => Number.isInteger(value) && value >= 0;
  let railIndex = populated.findIndex(rail => rail.id === current?.railId);
  if (railIndex < 0) railIndex = 0;
  const rail = populated[railIndex];
  const preferred = validPosition(current?.preferredCardPosition)
    ? current.preferredCardPosition
    : validPosition(current?.cardIndex) ? current.cardIndex : 0;
  const cardIndex = Math.min(
    validPosition(current?.cardIndex) ? current.cardIndex : 0, rail.count - 1);
  if (direction === 'ArrowLeft' || direction === 'ArrowRight') {
    const nextIndex = Math.max(0, Math.min(rail.count - 1,
      cardIndex + (direction === 'ArrowLeft' ? -1 : 1)));
    return {railId: rail.id, cardIndex: nextIndex, preferredCardPosition: nextIndex};
  }
  if (direction === 'ArrowUp' || direction === 'ArrowDown') {
    const nextRailIndex = Math.max(0, Math.min(populated.length - 1,
      railIndex + (direction === 'ArrowUp' ? -1 : 1)));
    if (nextRailIndex !== railIndex) {
      const target = populated[nextRailIndex];
      return {railId: target.id, cardIndex: Math.min(preferred, target.count - 1),
        preferredCardPosition: preferred};
    }
  }
  return {railId: rail.id, cardIndex, preferredCardPosition: preferred};
}
