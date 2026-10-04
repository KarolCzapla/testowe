const RETRY_ERROR = 'Could not update My Cookbook. Try again.';

function membership(ids) {
  if (!Array.isArray(ids) || ids.some(id => typeof id !== 'string' || !id.trim()) ||
      new Set(ids).size !== ids.length) {
    throw new Error('Invalid My Cookbook membership');
  }
  return new Set(ids);
}

// Complete server snapshots must be applied in request order across all recipes.
export function createCookbookController({initialIds, controls, transport = globalThis.fetch,
  announce = () => {}}) {
  let confirmedIds = membership(initialIds);
  const buttons = [...controls];
  const titles = new Map();
  for (const button of buttons) {
    const {recipeId, recipeTitle} = button.dataset;
    if (!recipeId || !recipeTitle ||
        (titles.has(recipeId) && titles.get(recipeId) !== recipeTitle)) {
      throw new Error('Invalid recipe cookbook control');
    }
    titles.set(recipeId, recipeTitle);
  }
  if (typeof transport !== 'function') throw new Error('Missing cookbook transport');
  const pendingIds = new Set();
  let queue = Promise.resolve();
  let disposed = false;

  function syncControls() {
    if (disposed) return;
    for (const button of buttons) {
      const id = button.dataset.recipeId;
      const saved = confirmedIds.has(id);
      const pending = pendingIds.has(id);
      const action = saved ? 'Remove' : 'Add';
      const preposition = saved ? 'from' : 'to';
      button.textContent = `${saved ? '✓' : '+'} ${action} ${preposition} My Cookbook`;
      button.setAttribute('aria-label', `${action} ${titles.get(id)} ${preposition} My Cookbook`);
      button.setAttribute('aria-pressed', String(saved));
      button.setAttribute('aria-disabled', String(pending));
      button.setAttribute('aria-busy', String(pending));
      button.classList.toggle('saved', saved);
    }
  }

  function toggle(id) {
    if (disposed || pendingIds.has(id)) return Promise.resolve();
    if (!titles.has(id)) return Promise.reject(new Error('Unknown recipe control'));
    pendingIds.add(id);
    syncControls();
    const completion = queue.then(async () => {
      if (disposed) return;
      const saved = confirmedIds.has(id);
      try {
        const response = await transport(saved ? `/api/cookbook/${encodeURIComponent(id)}` :
          '/api/cookbook', saved ? {method: 'DELETE'} : {
            method: 'POST', headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({id}),
          });
        if (!response.ok) throw new Error('Cookbook request failed');
        const envelope = await response.json();
        const nextIds = membership(envelope?.recipe_ids);
        if (disposed) return;
        confirmedIds = nextIds;
        syncControls();
        announce(`${titles.get(id)} ${nextIds.has(id) ? 'added to' : 'removed from'} My Cookbook.`);
      } catch {
        if (!disposed) announce(RETRY_ERROR);
      } finally {
        pendingIds.delete(id);
        syncControls();
      }
    });
    // Keep later requests runnable even if an integration callback throws.
    queue = completion.catch(() => {});
    return completion;
  }

  const listeners = buttons.map(button => {
    const activate = () => { void toggle(button.dataset.recipeId); };
    button.addEventListener('click', activate);
    return [button, activate];
  });
  syncControls();
  return {
    toggle, syncControls,
    dispose() {
      if (disposed) return;
      pendingIds.clear();
      syncControls();
      disposed = true;
      for (const [button, activate] of listeners) button.removeEventListener('click', activate);
    },
  };
}
