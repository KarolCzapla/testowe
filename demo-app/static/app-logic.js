// Keep search fields separate: text spanning two fields is not a match.
export function matchesRecipe(recipe, query) {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  return [recipe.title, recipe.description, recipe.category,
    ...recipe.dietary_tags, ...recipe.ingredients]
    .some(value => value.toLowerCase().includes(needle));
}
