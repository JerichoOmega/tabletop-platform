import { defineGame, GameStatus } from "../../platform/contract";
import ValoraSurface from "./Surface";
import ComingSoon from "../shared/ComingSoon";

/**
 * GAME #1 - Valora: Tactical Front (stylized 3D tactical RPG).
 * Registered as AVAILABLE with a stub Surface. Engine/AI are null during the
 * platform-foundation milestone and will be implemented later without touching
 * the platform core.
 */
export default defineGame({
  id: "valora",
  name: "Valora: Tactical Front",
  version: "0.1.0-stub",
  status: GameStatus.AVAILABLE,
  meta: {
    tagline: "Command a squad across a living tactical grid.",
    description:
      "A stylized 3D tactical RPG of positioning, initiative and daring gambits. Deploy your party, seize high ground and out-maneuver the enemy across hand-crafted battle tables.",
    tags: ["3D Tactical RPG", "Turn-Based", "Grid Combat", "1-4 Players"],
    players: { min: 1, max: 4 },
    playtime: "45-90 min",
    complexity: "Heavy",
    accentColor: "#b83a3a",
    glow: "rgba(184, 58, 58, 0.35)",
    cover:
      "https://images.unsplash.com/photo-1773216344341-e5ca0a1f0df9?crop=entropy&cs=srgb&fm=jpg&ixid=M3w4NjA0MTJ8MHwxfHNlYXJjaHwzfHxfYW50YXN5JTIwcnBnJTIwd2FycmlvciUyMHRhY3RpY2FsJTIwYXJ0d29ya3xlbnwwfHx8fDE3ODg1NTY2ODR8MA&ixlib=rb-4.1.0&q=85",
    hero:
      "https://images.unsplash.com/photo-1581337204818-5f755d7916dd?crop=entropy&cs=srgb&fm=jpg&ixid=M3w4NjA0MTJ8MHwxfHNlYXJjaHwxfHxmYW50YXN5JTIwcnBnJTIwd2FycmlvciUyMHRhY3RpY2FsJTIwYXJ0d29ya3xlbnwwfHx8fDE3ODg1NTY2ODR8MA&ixlib=rb-4.1.0&q=85",
    howToPlay: [
      "Deploy your party onto the tactical grid.",
      "Spend action points to move, attack and use abilities.",
      "Control the initiative order to chain devastating combos.",
      "Defeat the enemy warband or complete the scenario objective.",
    ],
  },
  capabilities: {
    singlePlayer: true,
    localMultiplayer: true,
    ai: true,
    save: true,
    stats: true,
  },
  engine: null, // implemented in a later milestone
  ai: null,
  Surface: ValoraSurface,
  Placeholder: ComingSoon,
});
