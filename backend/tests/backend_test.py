"""Backend API tests for Tabletop Lounge Platform Core."""
import os
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL") or open("/app/frontend/.env").read().split("REACT_APP_BACKEND_URL=")[1].splitlines()[0]
BASE_URL = BASE_URL.rstrip("/")
API = f"{BASE_URL}/api"


@pytest.fixture(scope="module")
def s():
    sess = requests.Session()
    sess.headers.update({"Content-Type": "application/json"})
    return sess


# ---- Health ----
def test_health(s):
    r = s.get(f"{API}/")
    assert r.status_code == 200
    d = r.json()
    assert d["status"] == "ok"
    assert d["service"] == "tabletop-lounge-core"


# ---- Players CRUD ----
class TestPlayers:
    def test_players_full_cycle(self, s):
        # Create
        r = s.post(f"{API}/players", json={"name": "TEST_Alice", "avatar": "seat-2", "color": "#ff0000"})
        assert r.status_code == 200, r.text
        p = r.json()
        assert p["name"] == "TEST_Alice"
        assert p["avatar"] == "seat-2"
        assert p["color"] == "#ff0000"
        assert isinstance(p["id"], str) and len(p["id"]) == 32
        assert isinstance(p["stats"], dict)
        assert "created_at" in p and "updated_at" in p
        pid = p["id"]

        # List
        r = s.get(f"{API}/players")
        assert r.status_code == 200
        assert any(x["id"] == pid for x in r.json())

        # Update
        r = s.put(f"{API}/players/{pid}", json={"name": "TEST_Alice2"})
        assert r.status_code == 200
        assert r.json()["name"] == "TEST_Alice2"

        # Verify persisted
        r = s.get(f"{API}/players")
        assert any(x["id"] == pid and x["name"] == "TEST_Alice2" for x in r.json())

        # Delete
        r = s.delete(f"{API}/players/{pid}")
        assert r.status_code == 200

        # Verify removed
        r = s.get(f"{API}/players")
        assert not any(x["id"] == pid for x in r.json())

    def test_update_missing_player_404(self, s):
        r = s.put(f"{API}/players/nonexistent123", json={"name": "x"})
        assert r.status_code == 404

    def test_delete_missing_player_404(self, s):
        r = s.delete(f"{API}/players/nonexistent123")
        assert r.status_code == 404


# ---- Sessions CRUD ----
class TestSessions:
    def test_sessions_full_cycle(self, s):
        r = s.post(f"{API}/sessions", json={"game_id": "valora", "state": {"turn_meta": "x"}})
        assert r.status_code == 200, r.text
        sess = r.json()
        assert sess["game_id"] == "valora"
        assert sess["turn"] == 0
        assert sess["status"] == "active"
        assert isinstance(sess["id"], str) and len(sess["id"]) == 32
        assert sess["state"] == {"turn_meta": "x"}
        sid = sess["id"]

        # Get
        r = s.get(f"{API}/sessions/{sid}")
        assert r.status_code == 200
        assert r.json()["id"] == sid

        # List (most recent first)
        r = s.get(f"{API}/sessions")
        assert r.status_code == 200
        lst = r.json()
        assert any(x["id"] == sid for x in lst)

        # Update (note: SessionUpdate model does not expose 'turn' -- known limitation)
        r = s.put(f"{API}/sessions/{sid}", json={"status": "paused", "state": {"a": 1}})
        assert r.status_code == 200
        d = r.json()
        assert d["status"] == "paused"
        assert d["state"] == {"a": 1}

        # Delete
        r = s.delete(f"{API}/sessions/{sid}")
        assert r.status_code == 200
        r = s.get(f"{API}/sessions/{sid}")
        assert r.status_code == 404

    def test_get_missing_session_404(self, s):
        r = s.get(f"{API}/sessions/nonexistent123")
        assert r.status_code == 404


# ---- Settings ----
class TestSettings:
    def test_settings_defaults_and_persist(self, s):
        r = s.get(f"{API}/settings")
        assert r.status_code == 200
        d = r.json()
        # defaults
        assert d["theme"] in ("mahogany", "emerald", "onyx")  # persisted maybe from prior
        # persist
        payload = {
            "theme": "emerald",
            "sfx_volume": 0.5,
            "music_volume": 0.2,
            "animation_speed": "fast",
            "reduced_motion": True,
            "high_contrast": True,
        }
        r = s.put(f"{API}/settings", json=payload)
        assert r.status_code == 200
        r = s.get(f"{API}/settings")
        got = r.json()
        for k, v in payload.items():
            assert got[k] == v, f"{k}: {got[k]} != {v}"

        # restore defaults for downstream tests
        s.put(f"{API}/settings", json={
            "theme": "mahogany", "sfx_volume": 0.7, "music_volume": 0.4,
            "animation_speed": "normal", "reduced_motion": False, "high_contrast": False,
        })
