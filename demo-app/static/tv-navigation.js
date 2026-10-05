import {nextBrowseFocus, nextDetailAction, recipeHref} from './app-logic.js';

export function focusAndReveal(element) {
  if (!element) return;
  element.focus({preventScroll: true});
  element.scrollIntoView({block: 'nearest', inline: 'nearest'});
}

const ARROWS = new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown']);

// Listen across the document for explicit return, but consume arrows only on
// the two native actions. Enter and content scrolling remain browser behavior.
export function installTvDetail({backAction, cookbookAction, browseUrl,
  navigate = href => globalThis.location.assign(href)}) {
  const document = backAction?.ownerDocument;
  if (!document || cookbookAction?.ownerDocument !== document ||
      !backAction || !cookbookAction || browseUrl !== '/?mode=tv' ||
      typeof navigate !== 'function') {
    throw new Error('Invalid TV recipe detail actions');
  }
  const actions = [backAction, cookbookAction];
  let actionIndex = 0;
  const indexOfTarget = target => actions.findIndex(action => action.contains(target));
  const onFocus = event => {
    const index = indexOfTarget(event.target);
    if (index >= 0) actionIndex = index;
  };
  const onKey = event => {
    if (event.defaultPrevented || event.altKey || event.ctrlKey ||
        event.metaKey || event.shiftKey || isEditable(event.target)) return;
    const actual = indexOfTarget(event.target);
    if (actual >= 0) actionIndex = actual;
    const next = nextDetailAction(actionIndex, event.key);
    if (next.command === 'return') {
      event.preventDefault();
      navigate(browseUrl);
    } else if (next.command === 'focus' && actual >= 0) {
      event.preventDefault();
      actionIndex = next.actionIndex;
      focusAndReveal(actions[actionIndex]);
    }
  };
  // Focus before attaching listeners so an initialization failure cannot leave
  // an unowned listener behind. Subsequent focusin tracks Tab and pointer use.
  focusAndReveal(backAction);
  document.addEventListener('focusin', onFocus);
  document.addEventListener('keydown', onKey);
  return () => {
    document.removeEventListener('focusin', onFocus);
    document.removeEventListener('keydown', onKey);
  };
}

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
