"""Compare public API results with browser matching on the same recipe objects."""

import json
import subprocess
from pathlib import Path


def test_unicode_query_whitespace_matches_between_api_and_browser(client):
    recipes = client.get("/api/recipes").get_json()
    # Python whitespace includes control separators and NEXT LINE; FEFF and
    # ZERO WIDTH SPACE remain literal search characters in both implementations.
    whitespace = (
        "\t\n\v\f\r\x1c\x1d\x1e\x1f \x85\xa0\u1680"
        "\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007"
        "\u2008\u2009\u200a\u2028\u2029\u202f\u205f\u3000"
    )
    queries = ["", "chickpeas", "no-such-ingredient", whitespace]
    for character in whitespace + "\ufeff\u200b":
        queries.extend((character, character * 2,
                        f"{character}CHICKPEAS{character}",
                        f" {character}chickpeas{character} "))
    expected = [
        [recipe["id"] for recipe in client.get(
            "/api/recipes", query_string={"q": query}
        ).get_json()]
        for query in queries
    ]
    # Explicit expectations ensure equal-but-wrong normalization cannot pass.
    assert expected[1] == ["chickpea-lemon-salad"]
    assert expected[3] == [recipe["id"] for recipe in recipes]
    assert expected[queries.index("\x85CHICKPEAS\x85")] == expected[1]
    assert expected[queries.index("\ufeffCHICKPEAS\ufeff")] == []
    assert expected[queries.index("\ufeff")] == []
    result = subprocess.run(
        ["node", "--input-type=module", "-e", """
import {matchesRecipe} from './static/app-logic.js';
import {readFileSync} from 'node:fs';
const {recipes, queries} = JSON.parse(readFileSync(0, 'utf8'));
console.log(JSON.stringify(queries.map(query => recipes
  .filter(recipe => matchesRecipe(recipe, query)).map(recipe => recipe.id))));
"""],
        cwd=Path(__file__).parents[1],
        input=json.dumps({"recipes": recipes, "queries": queries}),
        capture_output=True, text=True, check=True,
    )
    assert json.loads(result.stdout) == expected
