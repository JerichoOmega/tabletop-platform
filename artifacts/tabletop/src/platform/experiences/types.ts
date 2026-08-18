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

/**
 * Generic capabilities the PLATFORM itself needs to understand (M6).
 * These describe how an Experience is hosted — never what it contains.
 * Game concepts (dungeons, cards, territories…) must never appear here.
 */
export const EXPERIENCE_CAPABILITIES = [
  "local",
  "online",
  "synchronous",
  "asynchronous",
  "persistent-session",
  "shared-board",
  "hidden-information",
  "host-authoritative",
] as const;

export type ExperienceCapability = (typeof EXPERIENCE_CAPABILITIES)[number];

/** Supported player range (inclusive). */
export interface PlayerRange {
  readonly min: number;
  readonly max: number;
}

/** A playable tabletop game or mode registered with the platform. */
export interface ExperienceDefinition {
  /** Unique, URL-safe identifier (lowercase letters, digits, hyphens). */
  readonly id: string;
  /** Display title shown on platform surfaces. */
  readonly title: string;
  /** Primary game-type classification. */
  readonly gameType: GameType;
  /**
   * Contract version of THIS Experience, "major.minor.patch". The platform
   * never interprets Experience internals; the version exists so future
   * platform/Experience compatibility decisions have an identifier to key on.
   * Breaking changes to an Experience's externally visible contract bump
   * major (policy in docs/EXPERIENCE_CONTRACT.md).
   */
  readonly version: string;
  /** Hosting capabilities the platform must understand (validated). */
  readonly capabilities: readonly ExperienceCapability[];
  /** Supported player count (inclusive range). */
  readonly players: PlayerRange;
  /** Short player-facing description (optional). */
  readonly description?: string;
  /** Optional visual-asset registry ID for artwork (platform never assumes one exists). */
  readonly artworkAssetId?: string;
  /**
   * Entry point: the React component the shell mounts when the player enters
   * this Experience. The component owns everything inside it (rules,
   * gameplay state, game-specific UI/rendering/content, outcome logic).
   */
  readonly Component: ComponentType;
}
