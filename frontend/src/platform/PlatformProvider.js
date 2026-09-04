import React, {
  createContext,
  useContext,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  playersStore,
  sessionsStore,
  settingsStore,
  seatsStore,
} from "./storage";
import { registry } from "./registry";

const PlatformContext = createContext(null);

const DEFAULT_SETTINGS = {
  theme: "mahogany",
  sfx_volume: 0.7,
  music_volume: 0.4,
  animation_speed: "normal",
  reduced_motion: false,
  high_contrast: false,
};

const THEME_ATTR = { mahogany: "mahogany", emerald: "emerald", onyx: "onyx" };

export function PlatformProvider({ children }) {
  const [players, setPlayers] = useState([]);
  const [sessions, setSessions] = useState([]);
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  const [activeSeats, setActiveSeats] = useState(seatsStore.get());
  const [loading, setLoading] = useState(true);

  const games = useMemo(() => registry.all(), []);

  useEffect(() => {
    (async () => {
      const [p, s, cfg] = await Promise.all([
        playersStore.list(),
        sessionsStore.list(),
        settingsStore.get(),
      ]);
      setPlayers(p);
      setSessions(s);
      if (cfg) setSettings({ ...DEFAULT_SETTINGS, ...cfg });
      setLoading(false);
    })();
  }, []);

  // Apply settings to the document root (theme / motion / contrast).
  useEffect(() => {
    const root = document.documentElement;
    root.setAttribute("data-theme", THEME_ATTR[settings.theme] || "mahogany");
    root.setAttribute("data-reduced-motion", String(settings.reduced_motion));
    root.setAttribute("data-contrast", settings.high_contrast ? "high" : "normal");
  }, [settings]);

  /* ---- players ---- */
  const createPlayer = useCallback(async (payload) => {
    const p = await playersStore.create(payload);
    setPlayers((prev) => [...prev, p]);
    return p;
  }, []);
  const updatePlayer = useCallback(async (id, payload) => {
    const p = await playersStore.update(id, payload);
    setPlayers((prev) => prev.map((x) => (x.id === id ? p : x)));
    return p;
  }, []);
  const removePlayer = useCallback(async (id) => {
    await playersStore.remove(id);
    setPlayers((prev) => prev.filter((x) => x.id !== id));
    setActiveSeats((prev) => {
      const next = prev.filter((x) => x !== id);
      seatsStore.set(next);
      return next;
    });
  }, []);

  const toggleSeat = useCallback((id) => {
    setActiveSeats((prev) => {
      const next = prev.includes(id)
        ? prev.filter((x) => x !== id)
        : [...prev, id];
      seatsStore.set(next);
      return next;
    });
  }, []);

  /* ---- sessions ---- */
  const createSession = useCallback(async (payload) => {
    const s = await sessionsStore.create(payload);
    setSessions((prev) => [s, ...prev]);
    return s;
  }, []);
  const updateSession = useCallback(async (id, payload) => {
    const s = await sessionsStore.update(id, payload);
    setSessions((prev) => prev.map((x) => (x.id === id ? s : x)));
    return s;
  }, []);
  const removeSession = useCallback(async (id) => {
    await sessionsStore.remove(id);
    setSessions((prev) => prev.filter((x) => x.id !== id));
  }, []);

  /* ---- settings ---- */
  const saveSettings = useCallback(async (partial) => {
    const next = { ...settings, ...partial };
    setSettings(next);
    await settingsStore.save(next);
    return next;
  }, [settings]);

  const value = {
    loading,
    games,
    registry,
    players,
    sessions,
    settings,
    activeSeats,
    createPlayer,
    updatePlayer,
    removePlayer,
    toggleSeat,
    createSession,
    updateSession,
    removeSession,
    saveSettings,
  };

  return (
    <PlatformContext.Provider value={value}>
      {children}
    </PlatformContext.Provider>
  );
}

export function usePlatform() {
  const ctx = useContext(PlatformContext);
  if (!ctx) throw new Error("usePlatform must be used within PlatformProvider");
  return ctx;
}
