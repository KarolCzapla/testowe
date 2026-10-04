import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parents[1]))

import pytest
from app import create_app


@pytest.fixture()
def client():
    return create_app(testing=True).test_client()
