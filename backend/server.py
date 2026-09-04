"""
Tabletop Lounge - Platform Core API.

Game-agnostic backend for a multi-game digital tabletop platform.
The core stores local player profiles, generic game sessions (opaque game
state blobs keyed by gameId), platform settings and per-game statistics.

IMPORTANT: The platform core contains NO game-specific rules. A session's
`state` is an opaque JSON document owned by the individual game module on the
client. This keeps games (Valora, Lexicon Hall, future titles) fully
independent of the platform core.
"""
import os
import uuid
from datetime import datetime, timezone
from typing import Annotated, Any, Optional

from dotenv import load_dotenv
from fastapi import APIRouter, FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
from pydantic import BaseModel, Field

ROOT_DIR = os.path.dirname(os.path.abspath(__file__))
load_dotenv(os.path.join(ROOT_DIR, ".env"))

MONGO_URL = os.environ["MONGO_URL"]
DB_NAME = os.environ["DB_NAME"]

client = AsyncIOMotorClient(MONGO_URL)
db = client[DB_NAME]

app = FastAPI(title="Tabletop Lounge Platform Core", version="0.1.0")
api = APIRouter(prefix="/api")


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def new_id() -> str:
    return uuid.uuid4().hex


# ---------------------------------------------------------------------------
# Models (platform-core, game-agnostic)
# ---------------------------------------------------------------------------
class PlayerBase(BaseModel):
    name: str
    avatar: str = "seat-1"
    color: str = "#e5a93c"


class PlayerCreate(PlayerBase):
    pass


class PlayerUpdate(BaseModel):
    name: Optional[str] = None
    avatar: Optional[str] = None
    color: Optional[str] = None


class Player(PlayerBase):
    id: str = Field(default_factory=new_id)
    stats: dict[str, Any] = Field(default_factory=dict)
    created_at: str = Field(default_factory=now_iso)
    updated_at: str = Field(default_factory=now_iso)


class SessionBase(BaseModel):
    game_id: str
    title: Optional[str] = None
    players: list[str] = Field(default_factory=list)  # player ids seated
    config: dict[str, Any] = Field(default_factory=dict)
    state: dict[str, Any] = Field(default_factory=dict)  # opaque game state
    status: str = "active"  # active | paused | completed


class SessionCreate(SessionBase):
    pass


class SessionUpdate(BaseModel):
    title: Optional[str] = None
    players: Optional[list[str]] = None
    config: Optional[dict[str, Any]] = None
    state: Optional[dict[str, Any]] = None
    status: Optional[str] = None
    turn: Optional[int] = None


class Session(SessionBase):
    id: str = Field(default_factory=new_id)
    turn: int = 0
    created_at: str = Field(default_factory=now_iso)
    updated_at: str = Field(default_factory=now_iso)


class SettingsModel(BaseModel):
    theme: str = "mahogany"
    sfx_volume: float = 0.7
    music_volume: float = 0.4
    animation_speed: str = "normal"
    reduced_motion: bool = False
    high_contrast: bool = False


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
def clean(doc: dict) -> dict:
    doc.pop("_id", None)
    return doc


# ---------------------------------------------------------------------------
# Health
# ---------------------------------------------------------------------------
@api.get("/")
async def root():
    return {"service": "tabletop-lounge-core", "status": "ok", "time": now_iso()}


# ---------------------------------------------------------------------------
# Players
# ---------------------------------------------------------------------------
@api.get("/players", response_model=list[Player])
async def list_players():
    docs = await db.players.find().sort("created_at", 1).to_list(500)
    return [Player(**clean(d)) for d in docs]


@api.post("/players", response_model=Player)
async def create_player(payload: PlayerCreate):
    player = Player(**payload.model_dump())
    await db.players.insert_one(player.model_dump())
    return player


@api.put("/players/{player_id}", response_model=Player)
async def update_player(player_id: str, payload: PlayerUpdate):
    updates = {k: v for k, v in payload.model_dump().items() if v is not None}
    updates["updated_at"] = now_iso()
    res = await db.players.find_one_and_update(
        {"id": player_id}, {"$set": updates}, return_document=True
    )
    if not res:
        raise HTTPException(404, "Player not found")
    return Player(**clean(res))


@api.delete("/players/{player_id}")
async def delete_player(player_id: str):
    res = await db.players.delete_one({"id": player_id})
    if res.deleted_count == 0:
        raise HTTPException(404, "Player not found")
    return {"deleted": player_id}


# ---------------------------------------------------------------------------
# Sessions (opaque, game-agnostic state)
# ---------------------------------------------------------------------------
@api.get("/sessions", response_model=list[Session])
async def list_sessions(game_id: Optional[str] = None):
    query = {"game_id": game_id} if game_id else {}
    docs = await db.sessions.find(query).sort("updated_at", -1).to_list(500)
    return [Session(**clean(d)) for d in docs]


@api.get("/sessions/{session_id}", response_model=Session)
async def get_session(session_id: str):
    doc = await db.sessions.find_one({"id": session_id})
    if not doc:
        raise HTTPException(404, "Session not found")
    return Session(**clean(doc))


@api.post("/sessions", response_model=Session)
async def create_session(payload: SessionCreate):
    session = Session(**payload.model_dump())
    await db.sessions.insert_one(session.model_dump())
    return session


@api.put("/sessions/{session_id}", response_model=Session)
async def update_session(session_id: str, payload: SessionUpdate):
    updates = {k: v for k, v in payload.model_dump().items() if v is not None}
    updates["updated_at"] = now_iso()
    res = await db.sessions.find_one_and_update(
        {"id": session_id}, {"$set": updates}, return_document=True
    )
    if not res:
        raise HTTPException(404, "Session not found")
    return Session(**clean(res))


@api.delete("/sessions/{session_id}")
async def delete_session(session_id: str):
    res = await db.sessions.delete_one({"id": session_id})
    if res.deleted_count == 0:
        raise HTTPException(404, "Session not found")
    return {"deleted": session_id}


# ---------------------------------------------------------------------------
# Settings (single global platform document)
# ---------------------------------------------------------------------------
@api.get("/settings", response_model=SettingsModel)
async def get_settings():
    doc = await db.settings.find_one({"_key": "platform"})
    if not doc:
        return SettingsModel()
    return SettingsModel(**{k: v for k, v in doc.items() if k not in ("_id", "_key")})


@api.put("/settings", response_model=SettingsModel)
async def update_settings(payload: SettingsModel):
    await db.settings.update_one(
        {"_key": "platform"},
        {"$set": {**payload.model_dump(), "_key": "platform"}},
        upsert=True,
    )
    return payload


app.include_router(api)

app.add_middleware(
    CORSMiddleware,
    allow_origins=os.environ.get("CORS_ORIGINS", "*").split(","),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
