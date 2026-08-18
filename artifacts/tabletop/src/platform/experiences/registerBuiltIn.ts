// ─────────────────────────────────────────────────────────────────────────
// Built-in Experience registration (M5).
//
// This is the ONLY place that knows which concrete Experiences ship with the
// app. The shell itself never imports game code — it discovers everything
// through the registry. The RPG is the first registered Experience; future
// Experiences (card, board, strategy, …) register here the same way without
// any shell changes.
// ─────────────────────────────────────────────────────────────────────────

import IntelligentTabletop from "@/IntelligentTabletop";
import { experienceRegistry } from "./registry";

let registered = false;

/** Idempotent — safe to call from app bootstrap and tests. */
export function registerBuiltInExperiences(): void {
  if (registered) return;
  registered = true;

  experienceRegistry.register({
    id: "rpg",
    title: "Tabletop RPG",
    gameType: "rpg",
    version: "1.0.0",
    // Hosting capabilities only — how the game is hosted, never what's in it.
    capabilities: ["local", "synchronous", "shared-board"],
    players: { min: 1, max: 1 },
    description:
      "Tactical tabletop role-playing on the Grand Gaming Table — dungeon encounters and open-world exploration with miniatures.",
    Component: IntelligentTabletop,
  });

  // E2E-only fixture: a deliberately failing Experience used to verify the
  // launch-failure boundary. Double-gated: the `import.meta.env.DEV` check is
  // a BUILD-TIME gate (dead-code-eliminated from production bundles, so no
  // URL parameter can ever register it in production), and the ?e2e flag
  // keeps it out of ordinary dev sessions.
  if (
    import.meta.env.DEV &&
    typeof window !== "undefined" &&
    new URLSearchParams(window.location.search).has("e2e")
  ) {
    experienceRegistry.register({
      id: "e2e-broken",
      title: "E2E Broken Experience",
      gameType: "puzzle",
      version: "1.0.0",
      capabilities: ["local"],
      players: { min: 1, max: 1 },
      description: "Test fixture that throws on mount.",
      Component: () => {
        throw new Error("e2e-broken: intentional launch failure");
      },
    });
  }
}
