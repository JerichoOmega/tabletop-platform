/**
 * ============================================================================
 *  GAME MODULE CONTRACT  (Platform Plugin Interface)
 * ============================================================================
 *
 *  This file defines the ONLY surface area the platform core knows about a
 *  game. The platform core must never import game-specific rules; it only
 *  interacts with games through the shape defined here.
 *
 *  A game module is a plain object implementing this contract. Games are
 *  registered into the GameRegistry (see ./registry.js). Each game owns its
 *  own rules engine, state, board, turn system, AI, UI and statistics.
 *
 *  During the PLATFORM FOUNDATION milestone, games may ship as STUBS:
 *  metadata + a Surface/Placeholder component, with `engine`/`ai` set to null.
 *  When a game is later implemented (e.g. Lexicon Hall porting from the frozen
 *  HTML reference), it fills in the engine/ai hooks WITHOUT any change to the
 *  platform core.
 *
 *  ---------------------------------------------------------------------------
 *  GameModule shape
 *  ---------------------------------------------------------------------------
 *  {
 *    id:        string   // unique slug, e.g. "lexicon-hall"
 *    name:      string
 *    version:   string   // semver of the game module
 *    status:    GameStatus
 *
 *    meta: {
 *      tagline, description,
 *      tags:        string[],
 *      players:     { min:number, max:number },
 *      playtime:    string,      // "30-45 min"
 *      complexity:  string,      // "Light" | "Medium" | "Heavy"
 *      accentColor: string,      // per-game identity accent
 *      glow:        string,      // rgba glow for cards/host frame
 *      cover:       string,      // cover art url
 *      hero:        string,      // wide hero art url
 *      howToPlay:   string[],    // bullet overview
 *    }
 *
 *    capabilities: {
 *      singlePlayer:    boolean,
 *      localMultiplayer:boolean,
 *      ai:              boolean,
 *      save:            boolean,
 *      stats:           boolean,
 *    }
 *
 *    // ---- Rules engine (framework-agnostic, pure). null until implemented.
 *    engine: null | {
 *      createInitialState(config) -> state,
 *      applyAction(state, action) -> state,   // turn system + rules
 *      isGameOver(state) -> boolean,
 *      getWinner(state) -> playerRef | null,
 *      serialize(state) -> json,               // for save/load
 *      deserialize(json) -> state,
 *      getStats(state) -> object,              // per-game statistics
 *    }
 *
 *    // ---- AI factory. null until implemented.
 *    ai: null | ((difficulty) => { chooseAction(state) -> action })
 *
 *    // ---- UI. React components mounted inside the platform GameHostFrame.
 *    Surface:     React.Component  // the interactive game table
 *    Placeholder: React.Component  // shown for coming-soon / unavailable games
 *  }
 * ============================================================================
 */

export const GameStatus = Object.freeze({
  AVAILABLE: "available",
  BETA: "beta",
  COMING_SOON: "coming_soon",
});

const REQUIRED_META = [
  "tagline",
  "description",
  "tags",
  "players",
  "playtime",
  "complexity",
  "accentColor",
  "glow",
  "cover",
];

/**
 * Validate a game module against the contract. Throws on hard violations,
 * returns a list of soft warnings (e.g. missing engine on an AVAILABLE game).
 */
export function validateGameModule(mod) {
  const errors = [];
  const warnings = [];

  if (!mod || typeof mod !== "object") errors.push("module must be an object");
  if (!mod.id) errors.push("missing id");
  if (!mod.name) errors.push("missing name");
  if (!mod.version) errors.push("missing version");
  if (!Object.values(GameStatus).includes(mod.status))
    errors.push(`invalid status: ${mod.status}`);
  if (!mod.meta) errors.push("missing meta");
  else {
    for (const k of REQUIRED_META)
      if (mod.meta[k] === undefined) errors.push(`missing meta.${k}`);
  }
  if (!mod.Placeholder) errors.push("missing Placeholder component");

  if (mod.status === GameStatus.AVAILABLE) {
    if (!mod.Surface) errors.push("AVAILABLE game must provide a Surface");
    if (!mod.engine)
      warnings.push(
        `${mod.id}: AVAILABLE but ships without an engine (stub surface).`
      );
  }

  if (errors.length) {
    throw new Error(
      `Invalid game module "${mod?.id || "?"}": ${errors.join("; ")}`
    );
  }
  return warnings;
}

/**
 * Helper to author a game module with sane defaults for the foundation phase.
 */
export function defineGame(mod) {
  return {
    version: "0.0.0",
    status: GameStatus.COMING_SOON,
    capabilities: {
      singlePlayer: false,
      localMultiplayer: false,
      ai: false,
      save: false,
      stats: false,
    },
    engine: null,
    ai: null,
    Surface: null,
    ...mod,
    meta: { howToPlay: [], ...mod.meta },
  };
}
