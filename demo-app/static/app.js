import {matchesRecipe} from './app-logic.js';

const EMPTY_MESSAGE = 'No recipes found. Try another ingredient or dish.';

export function updateBrowseResults({recipes, cards, query, countElement, emptyElement}) {
  const matchingIds = new Set(recipes.filter(recipe => matchesRecipe(recipe, query))
    .map(recipe => recipe.id));
  for (const card of cards) card.hidden = !matchingIds.has(card.dataset.recipeId);
  const count = matchingIds.size;
  countElement.textContent = `${count} recipe${count === 1 ? '' : 's'}`;
  emptyElement.textContent = EMPTY_MESSAGE;
  emptyElement.hidden = count !== 0;
}

// This initializer is the integration seam for cookbook and TV controllers.
export function initializePage(document) {
  const bootstrapElement = document.querySelector('#page-bootstrap');
  if (!bootstrapElement) return () => {};
  const countElement = document.querySelector('#count');
  let bootstrap;
  try {
    bootstrap = JSON.parse(bootstrapElement.textContent);
    if (!Array.isArray(bootstrap.recipes) || !Array.isArray(bootstrap.saved_recipe_ids)) {
      throw new Error('Invalid recipe bootstrap');
    }
  } catch {
    if (countElement) countElement.textContent = 'Could not start recipe search. Please reload.';
    return () => {};
  }
  const search = document.querySelector('#search');
  if (bootstrap.page !== 'browse' || bootstrap.mode !== 'mobile' || !search) return () => {};
  const cards = [...document.querySelectorAll('.recipe-card')];
  const emptyElement = document.querySelector('#empty');
  const update = () => updateBrowseResults({
    recipes: bootstrap.recipes, cards, query: search.value, countElement, emptyElement,
  });
  search.addEventListener('input', update);
  update();
  return () => search.removeEventListener('input', update);
}

if (typeof document !== 'undefined') initializePage(document);
