import { defineGame, GameStatus } from "../../platform/contract";
import ComingSoon from "../shared/ComingSoon";

/**
 * GAME #2 - Lexicon Hall (Scrabble-like word & tile game).
 *
 * Registered as COMING_SOON. The rules engine, game state, board, tile
 * distribution, dictionary, scoring, turn system and AI are FROZEN in the
 * supplied `lexicon-hall.html` reference artifact and are deliberately NOT
 * implemented in this platform-foundation milestone. When ported, this module
 * fills in its `engine`/`ai`/`Surface` and flips status to AVAILABLE.
 */
export default defineGame({
  id: "lexicon-hall",
  name: "Lexicon Hall",
  version: "0.0.0-reference",
  status: GameStatus.COMING_SOON,
  meta: {
    tagline: "Craft words, claim premium squares, out-score the table.",
    description:
      "A refined word & tile master's game. Draw from the bag, build interlocking words across a 15x15 board, chase double- and triple-word bonuses, and outwit sharp AI opponents.",
    tags: ["Word & Tile Master", "Scrabble-like", "2-4 Players", "Casual Strategy"],
    players: { min: 1, max: 4 },
    playtime: "30-45 min",
    complexity: "Medium",
    accentColor: "#3b72b0",
    glow: "rgba(59, 114, 176, 0.35)",
    cover:
      "https://images.unsplash.com/photo-1676651471150-0e3a5f8de05e?crop=entropy&cs=srgb&fm=jpg&ixid=M3w4NTYxODF8MHwxfHNlYXJjaHwzfHx0YWJsZXRvcCUyMGdhbWluZyUyMGJvYXJkJTIwZ2FtZSUyMGxvdW5nZXxlbnwwfHx8fDE3ODg1NTY2ODR8MA&ixlib=rb-4.1.0&q=85",
    hero:
      "https://images.unsplash.com/photo-1677188010559-0667a1ed33a0?crop=entropy&cs=srgb&fm=jpg&ixid=M3w4NTYxODF8MHwxfHNlYXJjaHwxfHx0YWJsZXRvcCUyMGdhbWluZyUyMGJvYXJkJTIwZ2FtZSUyMGxvdW5nZXxlbnwwfHx8fDE3ODg1NTY2ODR8MA&ixlib=rb-4.1.0&q=85",
    howToPlay: [
      "Draw 7 tiles from the bag onto your rack.",
      "Place tiles to form valid, connected words on the board.",
      "Score letter values boosted by premium squares; use all 7 for a bingo bonus.",
      "Pass, exchange or play until the bag and racks are empty.",
    ],
  },
  capabilities: {
    singlePlayer: true,
    localMultiplayer: true,
    ai: true,
    save: true,
    stats: true,
  },
  engine: null, // frozen in lexicon-hall.html reference; ported later
  ai: null,
  Surface: null,
  Placeholder: ComingSoon,
});
