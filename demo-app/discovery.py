"""Pure presentation mode selection and deterministic recipe discovery."""

from __future__ import annotations

from collections.abc import Set
from dataclasses import dataclass
from typing import Literal

from recipes import RecipeCollection, total_minutes


TV_HINTS = ("smart-tv", "smarttv", "hbbtv", "tizen", "webos", "netcast")


@dataclass(frozen=True)
class ViewMode:
    mode: Literal["mobile", "tv"]
    selection_source: Literal["explicit query", "recognized user agent", "default"]


@dataclass(frozen=True)
class RecipeRail:
    id: Literal["RAIL_POPULAR", "RAIL_QUICK", "RAIL_VEGETARIAN", "RAIL_COOKBOOK"]
    name: str
    recipe_ids: tuple[str, ...]

    def to_json(self) -> dict[str, object]:
        """Return fresh public membership arrays without internal state."""
        return {"id": self.id, "name": self.name, "recipe_ids": list(self.recipe_ids)}


def resolve_view_mode(mode_parameter: str | None, user_agent: str) -> ViewMode:
    """Only exact tv overrides hints; other query values permit UA detection."""
    if mode_parameter == "tv":
        return ViewMode("tv", "explicit query")
    if any(hint in user_agent.lower() for hint in TV_HINTS):
        return ViewMode("tv", "recognized user agent")
    return ViewMode("mobile", "default")


def build_rails(collection: RecipeCollection, saved_ids: Set[str]) -> tuple[RecipeRail, ...]:
    """Group validated recipes in collection order, including an empty cookbook."""
    if saved_ids - collection.by_id.keys():
        raise ValueError("Cookbook contains unknown recipe IDs")
    recipes = collection.recipes
    return (
        RecipeRail("RAIL_POPULAR", "Popular this week",
                   tuple(recipe.id for recipe in recipes if recipe.featured)),
        RecipeRail("RAIL_QUICK", "Ready in 30 minutes",
                   tuple(recipe.id for recipe in recipes if total_minutes(recipe) <= 30)),
        RecipeRail("RAIL_VEGETARIAN", "Vegetarian favourites",
                   tuple(recipe.id for recipe in recipes
                         if {"Vegetarian", "Vegan"}.intersection(recipe.dietary_tags))),
        RecipeRail("RAIL_COOKBOOK", "My Cookbook",
                   tuple(recipe.id for recipe in recipes if recipe.id in saved_ids)),
    )
