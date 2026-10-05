import {nextBrowseFocus, recipeHref} from './app-logic.js';

export function focusAndReveal(element) {
  if (!element) return;
  element.focus({preventScroll: true});
  element.scrollIntoView({block: 'nearest', inline: 'nearest'});
}

const ARROWS = new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown']);

function isEditable(target) {
  if (target?.isContentEditable || target?.closest?.('input, textarea, select')) return true;
  for (let node = target; node; node = node.parentElement) {
    const editable = node.getAttribute?.('contenteditable');
    if (editable !== null && editable !== undefined) {
      return editable.toLowerCase() !== 'false';
    }
  }
  return false;
}

function isAvailable(element, root) {
  for (let node = element; node; node = node.parentElement) {
    if (node.hidden || node.hasAttribute('inert') || node.getAttribute('aria-hidden') === 'true') {
      return false;
    }
    if (node === root) return true;
  }
  return false;
}

// Enter remains the link/button's native activation. Keeping it out of the key
// handler also preserves modified clicks and independent cookbook actions.
export function installTvBrowse({root}) {
  if (!root) return () => {};
  let current = null;
  let movingFocus = false;

  const readRails = () => [...root.querySelectorAll('[data-rail-id]')].map(rail => {
    const links = [...rail.querySelectorAll('.recipe-card .recipe-link')]
      .filter(link => link.tagName === 'A' && link.hasAttribute('href') &&
        link.closest('[data-rail-id]') === rail && isAvailable(link, root));
    for (const link of links) {
      const recipeId = link.closest('.recipe-card')?.dataset.recipeId;
      if (recipeId) link.href = recipeHref(recipeId, 'tv');
    }
    return {id: rail.dataset.railId, count: links.length, links};
  });

  const findOccurrence = (rails, link) => {
    for (const rail of rails) {
      const cardIndex = rail.links.indexOf(link);
      if (cardIndex >= 0) {
        return {railId: rail.id, cardIndex, preferredCardPosition: cardIndex};
      }
    }
    return null;
  };

  const move = (rails, next) => {
    const link = rails.find(rail => rail.id === next?.railId)?.links[next?.cardIndex];
    if (!link) return false;
    current = next;
    // Programmatic focusin must not reset the column preserved by vertical moves.
    movingFocus = true;
    try { focusAndReveal(link); } finally { movingFocus = false; }
    return true;
  };

  const onFocus = event => {
    if (movingFocus) return;
    const rails = readRails();
    current = findOccurrence(rails, event.target);
  };
  const onKey = event => {
    if (event.defaultPrevented || !ARROWS.has(event.key) ||
        event.altKey || event.ctrlKey || event.metaKey || event.shiftKey ||
        isEditable(event.target)) return;
    const link = event.target?.closest?.('.recipe-link');
    if (!link || !root.contains(link)) return;
    const rails = readRails();
    const actual = findOccurrence(rails, link);
    if (!actual) return;
    // Account for reordering/shrinking even when no new focusin was dispatched.
    const sameOccurrence = current?.railId === actual.railId &&
      current?.cardIndex === actual.cardIndex;
    const next = nextBrowseFocus(rails, sameOccurrence ? current : actual, event.key);
    if (move(rails, next)) event.preventDefault();
  };

  root.addEventListener('focusin', onFocus);
  root.addEventListener('keydown', onKey);
  const rails = readRails();
  move(rails, nextBrowseFocus(rails, null, null));
  return () => {
    root.removeEventListener('focusin', onFocus);
    root.removeEventListener('keydown', onKey);
  };
}
