"""Application-local My Cookbook membership and consistent snapshots."""

from __future__ import annotations

from threading import RLock
from typing import TypedDict

from recipes import Recipe, RecipeCollection, find_recipe


class CookbookMutation(TypedDict):
    recipe_ids: list[str]


class CookbookState:
    """Own one application's process-local saves; expose detached snapshots.

    All membership access uses the same lock. Mutation envelopes are captured
    while holding it so each response represents that mutation's saved state.
    """

    def __init__(self) -> None:
        self._saved_recipe_ids: set[str] = set()
        self._lock = RLock()


def cookbook_snapshot(state: CookbookState) -> frozenset[str]:
    """Copy membership under the lock without exposing the mutable set."""
    with state._lock:
        return frozenset(state._saved_recipe_ids)


def saved_recipes(
    collection: RecipeCollection, state: CookbookState
) -> tuple[Recipe, ...]:
    """Resolve a single snapshot to complete recipes in collection order."""
    saved_ids = cookbook_snapshot(state)
    if not saved_ids <= collection.by_id.keys():
        raise RuntimeError("Cookbook contains an unknown recipe")
    return tuple(recipe for recipe in collection.recipes if recipe.id in saved_ids)


def save_recipe(
    collection: RecipeCollection, state: CookbookState, recipe_id: str
) -> CookbookMutation:
    """Validate before mutation; repeated saves return the same membership."""
    if find_recipe(collection, recipe_id) is None:
        raise ValueError("Unknown recipe")
    with state._lock:
        state._saved_recipe_ids.add(recipe_id)
        return {"recipe_ids": sorted(state._saved_recipe_ids)}


def remove_recipe(state: CookbookState, recipe_id: str) -> CookbookMutation:
    """Remove if present, including successful deletion of unknown IDs."""
    with state._lock:
        state._saved_recipe_ids.discard(recipe_id)
        return {"recipe_ids": sorted(state._saved_recipe_ids)}
