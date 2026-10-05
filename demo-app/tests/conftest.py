import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parents[1]))

import pytest
from app import create_app


@pytest.fixture()
def client():
    return create_app(testing=True).test_client()


@pytest.fixture()
def acceptance_corpus():
    """One offline corpus with explicit cases, shared with Node via stdin."""
    import json
    raw = json.loads((Path(__file__).parents[1] / "catalog.json").read_text())
    raw[0].update(title="Crème pear İ Σ ΟΣ Straße", description="Amber boundary.",
                  ingredients=["Uniqueingredient + zest (fresh)", "Second line"])
    raw[1]["dietary_tags"] = ["Vegetarian", "Uniquetag"]
    first, second = raw[0]["id"], raw[1]["id"]
    cases = [
        ("", [r["id"] for r in raw]), ("\x85\x1c\t", [r["id"] for r in raw]),
        ("  CRÈME PEAR  ", [first]), ("İ", [first]), ("ΟΣ", [first]),
        ("Straße", [first]), ("STRASSE", []), ("\x85UNIQUEINGREDIENT\x1c", [first]),
        ("+ zest (", [first]), ("Uniquetag", [second]), ("Amber boundary.", [first]),
        ("boundary. Breakfast", []), ("(fresh) Second", []),
        ("Vegetarian Uniquetag", []), ("\ufeffUniqueingredient\ufeff", []),
        ("unmatched-ingredient-918", []),
    ]
    return raw, cases
