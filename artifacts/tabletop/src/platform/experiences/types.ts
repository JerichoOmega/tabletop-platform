// ─────────────────────────────────────────────────────────────────────────
// Platform Experience model (M5).
//
// An Experience is a playable tabletop game or mode of ANY type — RPG, card
// game, board game, strategy, economic, party, etc. This abstraction is
// game-agnostic by contract: nothing in this file may reference RPG concepts
// (campaign, dungeon, character, encounter, miniature). Those belong inside
// individual Experiences.
//
// See docs/PLATFORM_EXPERIENCE_PHILOSOPHY.md (locked design direction).
// ─────────────────────────────────────────────────────────────────────────

import type { ComponentType } from "react";

/**
 * Broad game-type taxonomy for Experiences. Deliberately open-ended
 * (string union today, expandable without shell changes — the taxonomy is
 * NOT final per the platform philosophy §Browse).
 */
export type GameType =
  | "rpg"
  | "card"
  | "board"
  | "strategy"
  | "war"
  | "economic"
  | "party"
  | "puzzle"
  | "social";

/** A playable tabletop game or mode registered with the platform. */
export interface ExperienceDefinition {
  /** Unique, URL-safe identifier (lowercase letters, digits, hyphens). */
  readonly id: string;
  /** Display title shown on platform surfaces. */
  readonly title: string;
  /** Primary game-type classification. */
  readonly gameType: GameType;
  /** Short player-facing description (optional). */
  readonly description?: string;
  /** Optional visual-asset registry ID for artwork (platform never assumes one exists). */
  readonly artworkAssetId?: string;
  /**
   * Entry point: the React component the shell mounts when the player enters
   * this Experience. The component owns everything inside it (rules,
   * gameplay state, game-specific UI/rendering/content).
   */
  readonly Component: ComponentType;
}
