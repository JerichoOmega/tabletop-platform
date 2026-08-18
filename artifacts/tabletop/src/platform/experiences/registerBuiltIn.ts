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
    description:
      "Tactical tabletop role-playing on the Grand Gaming Table — dungeon encounters and open-world exploration with miniatures.",
    Component: IntelligentTabletop,
  });
}
