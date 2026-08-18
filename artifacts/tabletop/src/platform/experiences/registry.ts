// ─────────────────────────────────────────────────────────────────────────
// Experience registry (M5).
//
// Generic registration mechanism — the platform shell discovers Experiences
// ONLY through this registry. No hard-coded game branching ("if rpg → …")
// is permitted anywhere in the shell.
// ─────────────────────────────────────────────────────────────────────────

import { EXPERIENCE_CAPABILITIES, type ExperienceDefinition } from "./types";

const ID_PATTERN = /^[a-z0-9][a-z0-9-]*$/;
const VERSION_PATTERN = /^\d+\.\d+\.\d+$/;

export interface ExperienceRegistry {
  /** Register an Experience. Throws on invalid definition or duplicate ID. */
  register(def: ExperienceDefinition): void;
  /** Resolve an Experience by ID, or undefined when not registered. */
  get(id: string): ExperienceDefinition | undefined;
  /** True when an Experience with this ID is registered. */
  has(id: string): boolean;
  /** All registered Experiences in registration order (defensive copy). */
  list(): readonly ExperienceDefinition[];
}

/** Create an isolated registry (used by the app singleton and by tests). */
export function createExperienceRegistry(): ExperienceRegistry {
  const byId = new Map<string, ExperienceDefinition>();

  return {
    register(def: ExperienceDefinition): void {
      if (!def || typeof def !== "object") {
        throw new Error("Experience registration requires a definition object.");
      }
      if (typeof def.id !== "string" || !ID_PATTERN.test(def.id)) {
        throw new Error(
          `Experience id ${JSON.stringify(def.id)} is invalid — expected lowercase letters, digits, hyphens.`,
        );
      }
      if (typeof def.title !== "string" || def.title.trim().length === 0) {
        throw new Error(`Experience "${def.id}" requires a non-empty title.`);
      }
      if (typeof def.gameType !== "string" || def.gameType.length === 0) {
        throw new Error(`Experience "${def.id}" requires a gameType.`);
      }
      if (typeof def.version !== "string" || !VERSION_PATTERN.test(def.version)) {
        throw new Error(
          `Experience "${def.id}" requires a version in "major.minor.patch" form (got ${JSON.stringify(def.version)}).`,
        );
      }
      if (!Array.isArray(def.capabilities)) {
        throw new Error(`Experience "${def.id}" requires a capabilities array.`);
      }
      for (const cap of def.capabilities) {
        if (!(EXPERIENCE_CAPABILITIES as readonly string[]).includes(cap)) {
          throw new Error(
            `Experience "${def.id}" declares unknown capability ${JSON.stringify(cap)}.`,
          );
        }
      }
      if (new Set(def.capabilities).size !== def.capabilities.length) {
        throw new Error(`Experience "${def.id}" declares duplicate capabilities.`);
      }
      if (
        !def.players ||
        !Number.isInteger(def.players.min) ||
        !Number.isInteger(def.players.max) ||
        def.players.min < 1 ||
        def.players.max < def.players.min
      ) {
        throw new Error(
          `Experience "${def.id}" requires a valid players range (integers, 1 <= min <= max).`,
        );
      }
      if (typeof def.Component !== "function" && typeof def.Component !== "object") {
        throw new Error(`Experience "${def.id}" requires a Component entry point.`);
      }
      if (byId.has(def.id)) {
        throw new Error(`Experience "${def.id}" is already registered.`);
      }
      byId.set(def.id, def);
    },
    get(id: string): ExperienceDefinition | undefined {
      return byId.get(id);
    },
    has(id: string): boolean {
      return byId.has(id);
    },
    list(): readonly ExperienceDefinition[] {
      return [...byId.values()];
    },
  };
}

/** The application-wide registry singleton used by the platform shell. */
export const experienceRegistry: ExperienceRegistry = createExperienceRegistry();
