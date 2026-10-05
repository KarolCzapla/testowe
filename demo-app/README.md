# TableStory

Good food, clearly told. TableStory is a local recipe discovery application
built with Python, Flask, HTML, CSS, and vanilla JavaScript. Find an everyday
dish by ingredient, read its method, and save it to My Cookbook.

## Install and start

Run these commands from the repository root. Use Python 3.11 or later and
Node.js with support for `node:test` for verification. Node is not needed to
serve the application. Dependency installation requires package access;
application operation after installation is offline.

```sh
python -m venv /tmp/tablestory-venv
. /tmp/tablestory-venv/bin/activate
python -m pip install -r demo-app/requirements.txt
python demo-app/app.py
```

The existing dependencies are Flask and pytest. There is no frontend build,
database, external media service, or additional package to configure.
No credentials, secrets, or API key are required.

Open mobile `/` at <http://127.0.0.1:5000/>.
Open TV `/?mode=tv` at <http://127.0.0.1:5000/?mode=tv>.
Recognized TV user agents also select TV presentation.
Use Ctrl-C in the server terminal to stop it.

Use the documented single-process `app.py` server for the local demonstration.
Its debug reloader may restart the application when a source file changes.
My Cookbook is shared by requests in one application instance, held only in
memory, and starts empty after restart. Multiple workers would have separate
saved collections. Accounts and cross-device synchronization are outside scope.

Recipes, CSS artwork, fonts, scripts, and styles are local. After installation,
disconnect external network access and keep loopback available for the browser.
The same discovery, detail, and save/remove operations should work offline.
Invalid or missing recipe data fails startup visibly; there is no fallback data.

## Verify the checkout

Run the unchanged required gates from the repository root:

```sh
python -m pytest -q demo-app/tests
node --test demo-app/static/tests/*.test.js
git diff --check
```

Use the Python interpreter in your installed environment in place of `python`.
Optional syntax verification is `python -m compileall -q demo-app`.
Record each command, exit status, checkout revision, and evidence location.
For release evidence, repeat the gates against the reviewed clean checkout.
A missing, skipped, or failing required gate prevents acceptance.

The Python suite verifies public startup and HTTP behavior. The Node suite
checks search, confirmed cookbook state, live filtering, pure TV rules, and
DOM adapters without a browser or network dependency. Shared search cases use
identical recipe objects and explicit expected IDs, including Unicode, literal
punctuation, whitespace, ingredient-only, and cross-field-boundary queries.
DOM doubles verify event handling; they cannot prove browser layout, native
activation, actual scrolling, or distance legibility.

## Human mobile acceptance

1. Open `/` at 375 CSS pixels wide. Record browser, viewport height, revision,
   and screenshots. Recognize TableStory, its promise, and recipe discovery.
2. Verify all recipe cards show dish, total time, difficulty, and labels.
   Check CSS artwork with external networking disconnected.
3. Type `CHICKPEAS`. Results and count should change without page navigation.
   Clear the input to restore all cards. Try an unmatched query and confirm
   “No recipes found. Try another ingredient or dish.”
4. Open the matching recipe. Compare metadata, ordered ingredients, and
   numbered method with the API object. Include a long recipe in the review.
5. Add and remove the dish from My Cookbook on both card and detail controls.
   Record visible labels, accessible action names, pressed state, announcements,
   and non-color saved cues. Refresh and verify confirmed state.
6. Follow Browse recipes and the brand link. Both return to mobile browse.
   Check empty results and both save states for horizontal page overflow.

## Human TV acceptance

1. Open `/?mode=tv` at 1920×1080. Record the actual viewing distance and browser.
   Confirm all four headings: Popular this week, Ready in 30 minutes,
   Vegetarian favourites, and My Cookbook, including the empty cookbook.
2. Use Left/Right across a rail and Up/Down across at least two populated rails.
   Include unequal lengths, boundaries, and a card outside the initial view.
   Confirm real focus and horizontal/vertical scrolling keep the card visible.
3. Press Enter once to open the focused recipe. Its URL retains `?mode=tv`.
   Read long ingredients and steps from typical television viewing distance.
4. Use Up/Down to reach back and cookbook actions. Press Enter to save/remove;
   verify each press produces one action and pending controls retain focus.
   Use Tab to reach independent cookbook buttons on browse cards.
5. Verify Escape and Backspace separately return to `/?mode=tv`. Back and brand
   links also preserve mode. Content scrolling remains possible using keys.
6. Refresh TV browse after saving and removing. Compare My Cookbook membership
   with the saved API collection. Check navigation controls remain unclipped.

## Public API acceptance

Exercise these supported operations against the same running process:

| Operation | Expected result |
| --- | --- |
| `GET /api/recipes` | 200, complete recipe objects in collection order |
| `GET /api/recipes?q=chickpeas` | 200, IDs agree with live browse search |
| `GET /api/recipes/<recipe_id>` | 200, complete known recipe |
| Unknown recipe API ID | 404, `{"error":"Recipe not found"}` |
| Unknown recipe page ID | 404, TableStory recipe error page |
| `POST /api/cookbook` with `{"id":"<recipe_id>"}` | 201, sorted `recipe_ids`; repeat succeeds |
| Invalid JSON/object/id in cookbook POST | 400, recipe-specific error; state unchanged |
| Unknown cookbook POST ID | 400, `{"error":"Unknown recipe"}` |
| `GET /api/cookbook` | 200, complete saved objects in collection order |
| `DELETE /api/cookbook/<recipe_id>` | 200, sorted `recipe_ids`; repeated deletion succeeds |
| `GET /api/rails` | 200, four named groups with ordered `recipe_ids` |

## Accessibility, terminology, and handoff

Inspect predictable keyboard order, visible focus, accessible action names,
live result/save announcements, and text or symbols communicating saved state.
Measure actual foreground/background pairs, including focus and essential UI
states: AA needs 4.5:1 for ordinary text, 3:1 for large text and essential UI.
Record ratios and the elements/states measured; palette inspection alone does
not establish contrast acceptance. Review both viewports, long content,
matching/empty results, and saved/unsaved states for overflow and clipping.

Audit applicable application symbols, fixtures, tests, rendered pages, labels,
metadata, errors, JSON field names, and registered routes with word-aware
checks. Include standalone abbreviations; exclude only historical Git data and
the supplied PRD. Obsolete route aliases must be absent, not merely hidden.

Submit evidence through the orchestrator-controlled AcceptanceRecord, mapping
R1–R31 to checks and observations. Include input revisions and policy hashes,
checkout revision, gate results, protected-test human review status, integrated
journeys, measured contrast, offline evidence, risks, and remaining next actions.
Test edits need human review and humans retain merge authority. Operational records
and Evidence Packets are not automatically committed. Pending review or human
acceptance prevents completion even when all automated checks pass. Workshop
time ending never establishes completion. Product failures return to the owning
implementation ticket; this verification ticket does not repair production code.
