/**
 * Persistence layer - HYBRID strategy.
 *
 * Every read/write goes to the FastAPI backend first, and mirrors the result
 * into localStorage. If the backend is unreachable, the local mirror is used
 * so the platform keeps working offline. This keeps the interface identical
 * whether we're backend-backed or local-only, which is exactly the
 * "local now, backend-ready" contract the platform needs.
 *
 * The platform core is game-agnostic: sessions carry an opaque `state` blob
 * owned by the individual game module.
 */
import axios from "axios";

const BACKEND = process.env.REACT_APP_BACKEND_URL;
const api = axios.create({ baseURL: `${BACKEND}/api`, timeout: 8000 });

const LS = {
  players: "tl.players",
  sessions: "tl.sessions",
  settings: "tl.settings",
  activeSeats: "tl.activeSeats",
};

function readLocal(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}
function writeLocal(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* ignore quota errors */
  }
}

/* ---- Players ---------------------------------------------------------- */
export const playersStore = {
  async list() {
    try {
      const { data } = await api.get("/players");
      writeLocal(LS.players, data);
      return data;
    } catch {
      return readLocal(LS.players, []);
    }
  },
  async create(payload) {
    const { data } = await api.post("/players", payload);
    const list = [...readLocal(LS.players, []), data];
    writeLocal(LS.players, list);
    return data;
  },
  async update(id, payload) {
    const { data } = await api.put(`/players/${id}`, payload);
    const list = readLocal(LS.players, []).map((p) => (p.id === id ? data : p));
    writeLocal(LS.players, list);
    return data;
  },
  async remove(id) {
    await api.delete(`/players/${id}`);
    writeLocal(
      LS.players,
      readLocal(LS.players, []).filter((p) => p.id !== id)
    );
  },
};

/* ---- Sessions --------------------------------------------------------- */
export const sessionsStore = {
  async list() {
    try {
      const { data } = await api.get("/sessions");
      writeLocal(LS.sessions, data);
      return data;
    } catch {
      return readLocal(LS.sessions, []);
    }
  },
  async create(payload) {
    const { data } = await api.post("/sessions", payload);
    writeLocal(LS.sessions, [data, ...readLocal(LS.sessions, [])]);
    return data;
  },
  async update(id, payload) {
    const { data } = await api.put(`/sessions/${id}`, payload);
    writeLocal(
      LS.sessions,
      readLocal(LS.sessions, []).map((s) => (s.id === id ? data : s))
    );
    return data;
  },
  async remove(id) {
    await api.delete(`/sessions/${id}`);
    writeLocal(
      LS.sessions,
      readLocal(LS.sessions, []).filter((s) => s.id !== id)
    );
  },
};

/* ---- Settings --------------------------------------------------------- */
export const settingsStore = {
  async get() {
    try {
      const { data } = await api.get("/settings");
      writeLocal(LS.settings, data);
      return data;
    } catch {
      return readLocal(LS.settings, null);
    }
  },
  async save(payload) {
    writeLocal(LS.settings, payload);
    try {
      const { data } = await api.put("/settings", payload);
      return data;
    } catch {
      return payload;
    }
  },
};

/* ---- Active seats (purely local UI state) ----------------------------- */
export const seatsStore = {
  get: () => readLocal(LS.activeSeats, []),
  set: (ids) => writeLocal(LS.activeSeats, ids),
};
