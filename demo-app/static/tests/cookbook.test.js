import test from 'node:test';
import assert from 'node:assert/strict';
import {createCookbookController} from '../cookbook.js';

function control(id) {
  const attrs = {}, listeners = new Map(), classes = new Set();
  return {dataset: {recipeId: id, recipeTitle: `Pear dish ${id}`}, attrs, classes,
    textContent: '', disabled: false,
    setAttribute: (name, value) => { attrs[name] = value; },
    classList: {toggle: (name, on) => on ? classes.add(name) : classes.delete(name)},
    addEventListener: (name, fn) => listeners.set(name, fn),
    removeEventListener: (name, fn) => { if (listeners.get(name) === fn) listeners.delete(name); },
    click: () => listeners.get('click')?.(),
  };
}
const response = ids => ({ok: true, json: async () => ({recipe_ids: ids})});
const tick = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };
function check(button, saved, pending = false) {
  assert.equal(button.attrs['aria-pressed'], String(saved));
  assert.equal(button.attrs['aria-busy'], String(pending));
  assert.equal(button.attrs['aria-disabled'], String(pending));
  assert.equal(button.classes.has('saved'), saved);
  assert.equal(button.disabled, false);
  assert.equal(button.attrs['aria-label'], `${saved ? 'Remove' : 'Add'} Pear dish ${button.dataset.recipeId} ${saved ? 'from' : 'to'} My Cookbook`);
}

test('all occurrences retain confirmed state until serialized responses arrive', async () => {
  const buttons = [control('a'), control('a'), control('b')];
  const calls = [], messages = [];
  const controller = createCookbookController({initialIds: ['a'], controls: buttons,
    announce: message => messages.push(message), transport: (url, options) => new Promise(resolve => {
      calls.push({url, options, resolve});
    })});
  buttons.slice(0, 2).forEach(b => check(b, true));
  check(buttons[2], false);
  const remove = controller.toggle('a');
  await controller.toggle('a');
  const add = controller.toggle('b');
  await tick();
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, '/api/cookbook/a');
  assert.equal(calls[0].options.method, 'DELETE');
  buttons.slice(0, 2).forEach(b => check(b, true, true));
  check(buttons[2], false, true);
  calls[0].resolve(response([]));
  await remove;
  await tick();
  assert.equal(calls.length, 2);
  assert.equal(calls[1].options.method, 'POST');
  assert.equal(calls[1].url, '/api/cookbook');
  assert.deepEqual(JSON.parse(calls[1].options.body), {id: 'b'});
  assert.equal(calls[1].options.headers['Content-Type'], 'application/json');
  calls[1].resolve(response(['b']));
  await add;
  buttons.slice(0, 2).forEach(b => check(b, false));
  check(buttons[2], true);
  assert.deepEqual(messages, ['Pear dish a removed from My Cookbook.', 'Pear dish b added to My Cookbook.']);
  controller.dispose();
  buttons[0].click();
  await tick();
  assert.equal(calls.length, 2);
});

for (const kind of ['HTTP', 'network', 'JSON', 'missing', 'typed', 'duplicate']) {
  test(`failed ${kind} response keeps confirmed labels and allows retry`, async () => {
    const buttons = [control('a'), control('a')], messages = [];
    let retry = false, count = 0;
    const controller = createCookbookController({initialIds: ['a'], controls: buttons,
      announce: message => messages.push(message), transport: async () => {
        count++;
        if (retry) return response([]);
        if (kind === 'HTTP') return {ok: false};
        if (kind === 'network') throw new Error('Network unavailable');
        if (kind === 'JSON') return {ok: true, json: async () => { throw new Error('Bad JSON'); }};
        return {ok: true, json: async () => kind === 'missing' ? {} :
          {recipe_ids: kind === 'typed' ? [2] : ['a', 'a']}};
      }});
    await controller.toggle('a');
    buttons.forEach(b => check(b, true));
    assert.equal(messages.at(-1), 'Could not update My Cookbook. Try again.');
    retry = true;
    await controller.toggle('a');
    assert.equal(count, 2);
    buttons.forEach(b => check(b, false));
    controller.dispose();
  });
}

test('bad initial membership and unknown controls fail visibly', async () => {
  for (const initialIds of [undefined, {}, [3], [''], ['a', 'a']]) {
    assert.throws(() => createCookbookController({initialIds, controls: []}));
  }
  const controller = createCookbookController({initialIds: [], controls: [control('a')]});
  await assert.rejects(controller.toggle('absent'), /Unknown recipe control/);
  controller.dispose();
});
