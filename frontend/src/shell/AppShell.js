import React from "react";
import { Outlet } from "react-router-dom";
import NavBar from "./NavBar";

/**
 * AppShell - the neutral platform chrome that wraps every platform view.
 * Game surfaces are hosted separately by GameHostFrame (fullscreen table),
 * so this shell never assumes anything about a specific game.
 */
export default function AppShell() {
  return (
    <div className="App min-h-screen">
      <NavBar />
      <main className="mx-auto max-w-7xl px-4 py-8 sm:px-8 sm:py-10">
        <Outlet />
      </main>
      <footer className="mx-auto max-w-7xl px-4 py-10 text-center sm:px-8">
        <p className="font-ui text-xs uppercase tracking-[0.2em] text-dim">
          Tabletop Lounge &middot; Platform Foundation v0.1
        </p>
      </footer>
    </div>
  );
}
