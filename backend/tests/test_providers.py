from app import db, providers

from .conftest import CURATOR, PARENT, case_id_by_scenario, ready_plan, steps_of


def test_seed_is_demo_only(client):
    items = client.get("/api/providers").json()["providers"]
    assert len(items) == len(providers.SEED)
    assert all(p["is_demo"] is True and p["contact"] is None for p in items)
    assert all(p["name"].startswith("Демо-") and len(p["description"]) <= 200 for p in items)
    with db.tx() as conn:
        assert conn.execute("SELECT COUNT(*) FROM providers WHERE is_demo != 1").fetchone()[0] == 0
    for city in ("Кызылорда", "Петропавловск", "Шымкент"):
        n = sum(1 for p in items if p["city"] == city)
        assert 4 <= n <= 5


def test_filters_city_and_type(client):
    r = client.get("/api/providers", params={"city": "Шымкент"}).json()["providers"]
    assert r and all(p["city"] == "Шымкент" for p in r)
    assert [p["name"] for p in r] == sorted((p["name"] for p in r), key=str.casefold)
    r = client.get("/api/providers", params={"city": "шымкент", "type": "center"}).json()["providers"]
    assert r and all(p["city"] == "Шымкент" and p["type"] == "center" for p in r)
    r = client.get("/api/providers", params={"service_id": "EDU_REHAB"}).json()["providers"]
    assert r and all("EDU_REHAB" in p["service_ids"] for p in r)
    assert client.get("/api/providers", params={"type": "clinic"}).status_code == 422


def test_where_to_get_only_on_match(client):
    cid = ready_plan(client, "2")  # Петропавловск
    steps = steps_of(client, cid, PARENT)
    assert all(s["where_to_get"] == [] for s in steps.values())  # ПМПК, МСЭ, тьютор — state services
    client.post(f"/api/cases/{cid}/steps", json={"service_id": "EDU_REHAB"}, headers=CURATOR)
    rehab = steps_of(client, cid, PARENT)["EDU_REHAB"]["where_to_get"]
    assert 1 <= len(rehab) <= 3
    assert all(p["city"] == "Петропавловск" and "EDU_REHAB" in p["service_ids"] for p in rehab)


def test_where_to_get_needs_same_city(client):
    cid = case_id_by_scenario(client, "2")
    with db.tx() as conn:
        conn.execute("UPDATE cases SET city = 'Актобе' WHERE id = ?", (cid,))
    ready_plan(client, "2")
    client.post(f"/api/cases/{cid}/steps", json={"service_id": "EDU_REHAB"}, headers=CURATOR)
    assert steps_of(client, cid, PARENT)["EDU_REHAB"]["where_to_get"] == []
