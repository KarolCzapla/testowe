"""Ticket #2: application-local My Cookbook API acceptance contracts."""

from concurrent.futures import ThreadPoolExecutor
import importlib
import importlib.util
from threading import Barrier

import pytest

from app import create_app


def recipe_objects(client):
    response = client.get("/api/recipes")
    assert response.status_code == 200
    return response.get_json()


def membership(response, status, expected_ids):
    assert response.status_code == status
    assert response.get_json() == {"recipe_ids": sorted(expected_ids)}


def cookbook_objects(client, expected):
    response = client.get("/api/cookbook")
    assert response.status_code == 200
    assert response.get_json() == expected


def test_round_trip_complete_objects_collection_order_and_idempotency(client):
    recipes = recipe_objects(client)
    cookbook_objects(client, [])
    # Saving in reverse order separates insertion order from collection order.
    selected = recipes[::2]
    saved_ids = set()
    for recipe in reversed(selected):
        saved_ids.add(recipe["id"])
        membership(client.post("/api/cookbook", json={"id": recipe["id"]}),
                   201, saved_ids)
        cookbook_objects(client, [r for r in recipes if r["id"] in saved_ids])
    for recipe in selected:
        membership(client.post("/api/cookbook", json={"id": recipe["id"]}),
                   201, saved_ids)
    cookbook_objects(client, selected)

    for recipe in selected:
        saved_ids.remove(recipe["id"])
        for _ in range(2):
            membership(client.delete(f"/api/cookbook/{recipe['id']}"),
                       200, saved_ids)
            cookbook_objects(client, [r for r in recipes if r["id"] in saved_ids])
    membership(client.delete("/api/cookbook/unknown-ticket-2"), 200, set())
    cookbook_objects(client, [])


INVALID_REQUESTS = [
    pytest.param({}, id="missing-body"),
    pytest.param({"data": '{"id":', "content_type": "application/json"},
                 id="malformed-json"),
    pytest.param({"data": "", "content_type": "application/json"},
                 id="empty-json-body"),
    pytest.param({"data": '{"id":"anything"}', "content_type": "text/plain"},
                 id="non-json-content-type"),
    *[pytest.param({"data": body, "content_type": "application/json"}, id=name)
      for name, body in [
          ("null", "null"), ("array", "[]"),
          ("array-with-object", '[{"id":"anything"}]'),
          ("string", '"anything"'), ("integer", "7"),
          ("boolean", "true"), ("missing-id", "{}"),
          ("unrelated-key", '{"recipe_id":"anything"}'),
          ("null-id", '{"id":null}'), ("numeric-id", '{"id":7}'),
          ("boolean-id", '{"id":false}'), ("array-id", '{"id":[]}'),
          ("object-id", '{"id":{}}'), ("empty-id", '{"id":""}'),
          ("blank-id", '{"id":" \\t\\n"}'),
      ]],
]


@pytest.mark.parametrize("request_kwargs", INVALID_REQUESTS)
def test_invalid_input_returns_exact_error_and_preserves_membership(client, request_kwargs):
    selected = recipe_objects(client)[::3]
    ids = {r["id"] for r in selected}
    for recipe in selected:
        response = client.post("/api/cookbook", json={"id": recipe["id"]})
        assert response.status_code == 201
    response = client.post("/api/cookbook", **request_kwargs)
    assert response.status_code == 400
    assert response.get_json() == {"error": "Provide a recipe id"}
    cookbook_objects(client, selected)
    membership(client.post("/api/cookbook", json={"id": selected[0]["id"]}), 201, ids)


def test_unknown_string_id_and_absent_delete_preserve_nonempty_cookbook(client):
    recipe = recipe_objects(client)[0]
    membership(client.post("/api/cookbook", json={"id": recipe["id"]}),
               201, {recipe["id"]})
    response = client.post("/api/cookbook", json={"id": "unknown-ticket-2"})
    assert response.status_code == 400
    assert response.get_json() == {"error": "Unknown recipe"}
    for _ in range(2):
        membership(client.delete("/api/cookbook/unknown-ticket-2"),
                   200, {recipe["id"]})
    cookbook_objects(client, [recipe])


def test_new_application_and_fresh_clients_have_correct_state_ownership():
    first_app = create_app(testing=True)
    first_client = first_app.test_client()
    recipe = recipe_objects(first_client)[0]
    membership(first_client.post("/api/cookbook", json={"id": recipe["id"]}),
               201, {recipe["id"]})
    cookbook_objects(first_app.test_client(), [recipe])
    second_client = create_app(testing=True).test_client()
    cookbook_objects(second_client, [])
    membership(second_client.delete(f"/api/cookbook/{recipe['id']}"), 200, set())
    cookbook_objects(first_client, [recipe])
    membership(second_client.post("/api/cookbook", json={"id": recipe["id"]}),
               201, {recipe["id"]})
    membership(first_client.delete(f"/api/cookbook/{recipe['id']}"), 200, set())
    cookbook_objects(second_client, [recipe])


def test_concurrent_api_operations_return_consistent_detached_snapshots():
    application = create_app(testing=True)
    client = application.test_client()
    recipes = recipe_objects(client)
    cookbook_objects(client, [])
    ids = {r["id"] for r in recipes}
    workers = 4

    def phase(remove):
        start = Barrier(workers)

        def mutate_and_read(worker):
            # Each thread owns its Flask client and disjoint IDs. No sleeps or
            # assumptions about which request wins the scheduling race.
            local = application.test_client()
            captured = []
            start.wait(timeout=10)
            for recipe in recipes[worker::workers]:
                recipe_id = recipe["id"]
                response = (local.delete(f"/api/cookbook/{recipe_id}") if remove
                            else local.post("/api/cookbook", json={"id": recipe_id}))
                assert response.status_code == (200 if remove else 201)
                envelope = response.get_json()
                assert set(envelope) == {"recipe_ids"}
                snapshot = envelope["recipe_ids"]
                assert snapshot == sorted(set(snapshot))
                assert set(snapshot) <= ids
                assert (recipe_id in snapshot) is (not remove)
                read = local.get("/api/cookbook")
                assert read.status_code == 200
                objects = read.get_json()
                read_ids = [r["id"] for r in objects]
                assert len(read_ids) == len(set(read_ids))
                assert set(read_ids) <= ids
                assert objects == [r for r in recipes if r["id"] in read_ids]
                captured.append((response, envelope, read, objects))
            return captured

        with ThreadPoolExecutor(max_workers=workers) as executor:
            results = list(executor.map(mutate_and_read, range(workers)))
        return [capture for batch in results for capture in batch]

    captured = phase(remove=False)
    cookbook_objects(client, recipes)
    captured.extend(phase(remove=True))
    cookbook_objects(client, [])
    for response, envelope, read, objects in captured:
        assert response.get_json() == envelope
        assert read.get_json() == objects


def test_domain_snapshot_is_immutable_and_detached_from_future_mutations(client):
    # Missing implementation is an assertion failure, never a collection error.
    assert importlib.util.find_spec("cookbook") is not None, "CookbookState is required"
    cookbook = importlib.import_module("cookbook")
    state = cookbook.CookbookState()
    collection = client.application.extensions["recipe_collection"]
    recipe_id = collection.recipes[0].id
    empty = cookbook.cookbook_snapshot(state)
    assert isinstance(empty, frozenset)
    assert empty == frozenset()
    added = cookbook.save_recipe(collection, state, recipe_id)
    saved = cookbook.cookbook_snapshot(state)
    assert isinstance(saved, frozenset)
    assert saved == frozenset({recipe_id})
    assert empty == frozenset()
    cookbook.remove_recipe(state, recipe_id)
    assert cookbook.cookbook_snapshot(state) == frozenset()
    assert saved == frozenset({recipe_id})
    assert added == {"recipe_ids": [recipe_id]}
