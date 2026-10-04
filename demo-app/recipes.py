"""Validated, immutable recipes and deterministic collection operations.

Structural validation runs at startup. Realistic instructions, truthful dietary
tags, and one or two sentence descriptions also need editorial review.
"""

from __future__ import annotations

import json
import re
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from pathlib import Path
from types import MappingProxyType
from typing import Literal


class RecipeDataError(ValueError):
    """Recipe content failed at an identified loading or validation boundary."""


@dataclass(frozen=True)
class Recipe:
    id: str
    title: str
    description: str
    category: str
    dietary_tags: tuple[str, ...]
    prep_minutes: int
    cook_minutes: int
    difficulty: Literal["Easy", "Medium", "Confident Cook"]
    servings: int
    ingredients: tuple[str, ...]
    steps: tuple[str, ...]
    colors: tuple[str, str]
    featured: bool


@dataclass(frozen=True)
class RecipeCollection:
    recipes: tuple[Recipe, ...]
    by_id: Mapping[str, Recipe]


FIELDS = frozenset({
    "id", "title", "description", "category", "dietary_tags", "prep_minutes",
    "cook_minutes", "difficulty", "servings", "ingredients", "steps", "colors",
    "featured",
})
ID_PATTERN = re.compile(r"[A-Za-z0-9_-]+")
COLOR_PATTERN = re.compile(r"#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})")


def load_recipes(path: Path) -> RecipeCollection:
    """Load UTF-8 JSON once; include the source path in every data failure."""
    path = Path(path)
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, ValueError) as error:
        raise RecipeDataError(f"{path}: unable to read recipe JSON: {error}") from error
    try:
        return validate_recipes(raw)
    except RecipeDataError as error:
        raise RecipeDataError(f"{path}: {error}") from error


def validate_recipes(raw: object) -> RecipeCollection:
    """Reject invalid records and unmet content/rail quotas without fallback.

    JSON arrays must be lists, integers must not be Booleans, and colors use
    the approved hexadecimal CSS subset. Lists become independent tuples.
    """
    if type(raw) is not list:
        raise RecipeDataError("collection: expected a JSON array")
    recipes = []
    seen_ids = set()
    seen_titles = set()
    for index, record in enumerate(raw):
        boundary = f"record[{index}]"
        if type(record) is not dict:
            raise RecipeDataError(f"{boundary}: expected a recipe object")
        missing = FIELDS - record.keys()
        extra = record.keys() - FIELDS
        if missing or extra:
            raise RecipeDataError(
                f"{boundary}: missing fields {sorted(missing)}; extra fields {sorted(extra)}"
            )

        def fail(field: str, reason: str) -> None:
            raise RecipeDataError(f"{boundary}.{field}: {reason}")

        for field in ("id", "title", "description", "category", "difficulty"):
            if type(record[field]) is not str or not record[field].strip():
                fail(field, "expected a non-blank string")
        if not ID_PATTERN.fullmatch(record["id"]):
            fail("id", "expected URL-safe letters, digits, underscores or hyphens")
        if record["id"] in seen_ids:
            fail("id", f"duplicate ID {record['id']!r}")
        title_key = record["title"].strip().lower()
        if title_key in seen_titles:
            fail("title", "expected a distinct dish name")
        if record["difficulty"] not in {"Easy", "Medium", "Confident Cook"}:
            fail("difficulty", "expected Easy, Medium or Confident Cook")
        for field, minimum in (("prep_minutes", 1), ("cook_minutes", 0), ("servings", 1)):
            if type(record[field]) is not int or record[field] < minimum:
                fail(field, f"expected an integer >= {minimum}; Booleans are invalid")
        for field, minimum in (("dietary_tags", 0), ("ingredients", 1), ("steps", 3), ("colors", 2)):
            values = record[field]
            if type(values) is not list or len(values) < minimum:
                fail(field, f"expected an ordered list with at least {minimum} entries")
            for entry_index, value in enumerate(values):
                if type(value) is not str or not value.strip():
                    fail(field, f"entry[{entry_index}] must be a non-blank string")
        if len(record["colors"]) != 2:
            fail("colors", "expected exactly two colors")
        for entry_index, color in enumerate(record["colors"]):
            if not COLOR_PATTERN.fullmatch(color):
                fail("colors", f"entry[{entry_index}] must be #RGB or #RRGGBB")
        if type(record["featured"]) is not bool:
            fail("featured", "expected a Boolean")
        recipe = Recipe(
            id=record["id"], title=record["title"], description=record["description"],
            category=record["category"], dietary_tags=tuple(record["dietary_tags"]),
            prep_minutes=record["prep_minutes"], cook_minutes=record["cook_minutes"],
            difficulty=record["difficulty"], servings=record["servings"],
            ingredients=tuple(record["ingredients"]), steps=tuple(record["steps"]),
            colors=tuple(record["colors"]), featured=record["featured"],
        )
        recipes.append(recipe)
        seen_ids.add(recipe.id)
        seen_titles.add(title_key)

    categories = {recipe.category for recipe in recipes}
    missing_categories = {"Breakfast", "Lunch", "Dinner", "Dessert"} - categories
    if missing_categories:
        raise RecipeDataError(f"collection.category: missing {sorted(missing_categories)}")
    quotas = (
        ("count", len(recipes), 12),
        ("vegetarian", sum(bool({"Vegetarian", "Vegan"} & set(r.dietary_tags)) for r in recipes), 3),
        ("vegan", sum("Vegan" in r.dietary_tags for r in recipes), 2),
        ("quick", sum(total_minutes(r) <= 30 for r in recipes), 3),
        ("desserts", sum(r.category == "Dessert" for r in recipes), 2),
        ("featured", sum(r.featured for r in recipes), 2),
    )
    for name, count, minimum in quotas:
        if count < minimum:
            raise RecipeDataError(f"collection.{name}: expected at least {minimum}, got {count}")
    ordered = tuple(recipes)
    return RecipeCollection(ordered, MappingProxyType({recipe.id: recipe for recipe in ordered}))


def total_minutes(recipe: Recipe) -> int:
    return recipe.prep_minutes + recipe.cook_minutes


def find_recipe(collection: RecipeCollection, recipe_id: str) -> Recipe | None:
    return collection.by_id.get(recipe_id)


def search_recipes(recipes: Sequence[Recipe], query: str = "") -> tuple[Recipe, ...]:
    """Match literal substrings per field using Unicode lower, preserving order."""
    needle = query.strip().lower()
    if not needle:
        return tuple(recipes)
    return tuple(recipe for recipe in recipes if any(
        needle in value.lower() for value in (
            recipe.title, recipe.description, recipe.category,
            *recipe.dietary_tags, *recipe.ingredients,
        )
    ))


def recipe_to_json(recipe: Recipe) -> dict[str, object]:
    """Return exactly the thirteen public fields, with fresh ordered arrays."""
    return {
        "id": recipe.id,
        "title": recipe.title,
        "description": recipe.description,
        "category": recipe.category,
        "dietary_tags": list(recipe.dietary_tags),
        "prep_minutes": recipe.prep_minutes,
        "cook_minutes": recipe.cook_minutes,
        "difficulty": recipe.difficulty,
        "servings": recipe.servings,
        "ingredients": list(recipe.ingredients),
        "steps": list(recipe.steps),
        "colors": list(recipe.colors),
        "featured": recipe.featured,
    }
