def test_home_and_detail_render(client):
    home = client.get("/")
    assert home.status_code == 200
    assert b"Pocket Cinema" in home.data
    assert home.data.count(b'class="movie-card"') == 24
    assert client.get("/movie/afterlight").status_code == 200
    assert client.get("/movie/missing").status_code == 404


def test_catalog_search_and_detail_api(client):
    movies = client.get("/api/movies?q=sci-fi").get_json()
    assert len(movies) >= 3
    assert client.get("/api/movies/afterlight").get_json()["title"] == "Afterlight Station"
    assert client.get("/api/movies/missing").status_code == 404


def test_watchlist_round_trip(client):
    assert client.get("/api/watchlist").get_json() == []
    assert client.post("/api/watchlist", json={"id": "afterlight"}).status_code == 201
    assert [m["id"] for m in client.get("/api/watchlist").get_json()] == ["afterlight"]
    assert client.delete("/api/watchlist/afterlight").get_json() == {"ids": []}
    assert client.post("/api/watchlist", json={"id": "missing"}).status_code == 400
