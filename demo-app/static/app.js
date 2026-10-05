import {matchesRecipe} from './app-logic.js';
import {createCookbookController} from './cookbook.js';
import {installTvBrowse} from './tv-navigation.js';

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

// Both page types share authoritative membership and accessible announcements.
export function initializePage(document, {transport} = {}) {
  const bootstrapElement = document.querySelector('#page-bootstrap');
  if (!bootstrapElement) return () => {};
  const countElement = document.querySelector('#count');
  let statusElement = document.querySelector('#cookbook-status');
  if (!statusElement) {
    statusElement = document.createElement('p');
    statusElement.setAttribute('id', 'cookbook-status');
    (document.querySelector('#main') || document.body).appendChild(statusElement);
  }
  statusElement.setAttribute('role', 'status');
  statusElement.setAttribute('aria-live', 'polite');
  statusElement.setAttribute('aria-atomic', 'true');
  const announce = message => { statusElement.textContent = message; };
  const cleanups = [];
  const cleanup = () => cleanups.splice(0).forEach(dispose => dispose());
  let bootstrap;
  try {
    bootstrap = JSON.parse(bootstrapElement.textContent);
    if (!bootstrap || !Array.isArray(bootstrap.recipes) ||
        !['browse', 'detail'].includes(bootstrap.page) ||
        !['mobile', 'tv'].includes(bootstrap.mode)) {
      throw new Error('Invalid recipe bootstrap');
    }
    const knownIds = new Set(bootstrap.recipes.map(recipe => recipe.id));
    const controls = [...document.querySelectorAll('.cookbook')];
    if (controls.some(button => !knownIds.has(button.dataset.recipeId))) {
      throw new Error('Unknown recipe cookbook control');
    }
    const cookbook = createCookbookController({
      initialIds: bootstrap.saved_recipe_ids, controls, transport, announce,
    });
    cleanups.push(() => cookbook.dispose());
  } catch {
    announce('Could not start My Cookbook for these recipes. Please reload.');
    if (countElement) countElement.textContent = 'Could not start recipe search. Please reload.';
    cleanup();
    return cleanup;
  }
  if (bootstrap.page === 'browse' && bootstrap.mode === 'tv') {
    cleanups.push(installTvBrowse({root: document.querySelector('[data-tv-browse]')}));
  }
  const search = document.querySelector('#search');
  if (bootstrap.page !== 'browse' || bootstrap.mode !== 'mobile' || !search) return cleanup;
  const cards = [...document.querySelectorAll('.recipe-card')];
  const emptyElement = document.querySelector('#empty');
  const update = () => updateBrowseResults({
    recipes: bootstrap.recipes, cards, query: search.value, countElement, emptyElement,
  });
  search.addEventListener('input', update);
  update();
  cleanups.push(() => search.removeEventListener('input', update));
  return cleanup;
}

if (typeof document !== 'undefined') initializePage(document);
