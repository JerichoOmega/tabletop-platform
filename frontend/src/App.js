import React from "react";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { Toaster } from "sonner";
import "./App.css";

import { initGames } from "./games";
import { PlatformProvider } from "./platform/PlatformProvider";
import AppShell from "./shell/AppShell";
import GameHostFrame from "./shell/GameHostFrame";
import LoungeLanding from "./views/LoungeLanding";
import GameLibrary from "./views/GameLibrary";
import GameDetail from "./views/GameDetail";
import PlayersView from "./views/PlayersView";
import SessionsView from "./views/SessionsView";
import SettingsView from "./views/SettingsView";

// Register all games into the platform registry (once).
initGames();

export default function App() {
  return (
    <PlatformProvider>
      <BrowserRouter
        future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
      >
        <Toaster
          theme="dark"
          position="bottom-right"
          toastOptions={{
            style: {
              background: "var(--bg-surface-2)",
              border: "1px solid var(--border-medium)",
              color: "var(--text-main)",
            },
          }}
        />
        <Routes>
          {/* Fullscreen game host (outside the platform shell chrome) */}
          <Route path="/play/:gameId" element={<GameHostFrame />} />

          {/* Platform shell */}
          <Route element={<AppShell />}>
            <Route path="/" element={<LoungeLanding />} />
            <Route path="/library" element={<GameLibrary />} />
            <Route path="/library/:gameId" element={<GameDetail />} />
            <Route path="/players" element={<PlayersView />} />
            <Route path="/sessions" element={<SessionsView />} />
            <Route path="/settings" element={<SettingsView />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </PlatformProvider>
  );
}
