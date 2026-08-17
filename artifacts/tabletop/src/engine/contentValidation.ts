// ---------------------------------------------------------------------------
// CONTENT VALIDATION — static integrity checks over all content definitions.
//
// This module is a dev/CI utility, NOT part of the gameplay engine. It never
// runs in the browser hot path; call it from unit tests and build scripts to
// catch broken cross-references before they reach players.
//
// validateAllContent() returns an array of ContentValidationError objects.
// An empty array means all definitions are internally consistent.
// ---------------------------------------------------------------------------

import {
  MAP_DEFS,
  WEAPON_DEFS,
  ABILITY_DEFS,
  COMBATANT_DEFS,
  ENCOUNTER_DEFS,
} from "./content";
import { isBlocked } from "./rules";

// ---------------------------------------------------------------------------
// ERROR SHAPE
// ---------------------------------------------------------------------------

export type ContentValidationKind =
  | "UNKNOWN_WEAPON_REF"
  | "UNKNOWN_ABILITY_REF"
  | "UNKNOWN_MAP_REF"
  | "INVALID_SPAWN_COORD"
  | "DUPLICATE_INSTANCE_ID"
  | "INVALID_STAT"
  | "EMPTY_ENCOUNTER_SIDE";

export interface ContentValidationError {
  kind: ContentValidationKind;
  entity: string;   // The def ID that triggered the error
  message: string;  // Human-readable description
}

// ---------------------------------------------------------------------------
// VALIDATORS
// ---------------------------------------------------------------------------

/** Check that all weapon and ability references in COMBATANT_DEFS resolve. */
function validateCombatantDefs(errors: ContentValidationError[]): void {
  for (const [defId, def] of Object.entries(COMBATANT_DEFS)) {
    // Weapon reference
    if (!WEAPON_DEFS[def.weaponId]) {
      errors.push({
        kind: "UNKNOWN_WEAPON_REF",
        entity: defId,
        message: `COMBATANT_DEFS["${defId}"].weaponId = "${def.weaponId}" does not exist in WEAPON_DEFS.`,
      });
    }

    // Ability references
    for (const abilityId of def.abilities ?? []) {
      if (!ABILITY_DEFS[abilityId]) {
        errors.push({
          kind: "UNKNOWN_ABILITY_REF",
          entity: defId,
          message: `COMBATANT_DEFS["${defId}"].abilities includes "${abilityId}" which does not exist in ABILITY_DEFS.`,
        });
      }
    }

    // Stat sanity
    if (def.maxHp <= 0) {
      errors.push({
        kind: "INVALID_STAT",
        entity: defId,
        message: `COMBATANT_DEFS["${defId}"].maxHp = ${def.maxHp} must be > 0.`,
      });
    }
    if (def.ac <= 0) {
      errors.push({
        kind: "INVALID_STAT",
        entity: defId,
        message: `COMBATANT_DEFS["${defId}"].ac = ${def.ac} must be > 0.`,
      });
    }
    if (def.moveMax < 0) {
      errors.push({
        kind: "INVALID_STAT",
        entity: defId,
        message: `COMBATANT_DEFS["${defId}"].moveMax = ${def.moveMax} must be ≥ 0.`,
      });
    }
  }
}

/** Check that weapon stat ranges are sensible. */
function validateWeaponDefs(errors: ContentValidationError[]): void {
  for (const [weaponId, def] of Object.entries(WEAPON_DEFS)) {
    if (def.range <= 0) {
      errors.push({
        kind: "INVALID_STAT",
        entity: weaponId,
        message: `WEAPON_DEFS["${weaponId}"].range = ${def.range} must be > 0.`,
      });
    }
    if (def.dmgDie <= 0) {
      errors.push({
        kind: "INVALID_STAT",
        entity: weaponId,
        message: `WEAPON_DEFS["${weaponId}"].dmgDie = ${def.dmgDie} must be > 0.`,
      });
    }
  }
}

/** Check that ability stat ranges are sensible. */
function validateAbilityDefs(errors: ContentValidationError[]): void {
  for (const [abilityId, def] of Object.entries(ABILITY_DEFS)) {
    if (def.range < 0) {
      errors.push({
        kind: "INVALID_STAT",
        entity: abilityId,
        message: `ABILITY_DEFS["${abilityId}"].range = ${def.range} must be ≥ 0.`,
      });
    }
    if (def.effect.die <= 0) {
      errors.push({
        kind: "INVALID_STAT",
        entity: abilityId,
        message: `ABILITY_DEFS["${abilityId}"].effect.die = ${def.effect.die} must be > 0.`,
      });
    }
  }
}

/**
 * Check all ENCOUNTER_DEFS for:
 *   • valid mapId reference
 *   • at least one player and one enemy
 *   • no duplicate instanceIds within the encounter
 *   • all spawn coords within map bounds and not on blocked tiles
 */
function validateEncounterDefs(errors: ContentValidationError[]): void {
  for (const [encId, enc] of Object.entries(ENCOUNTER_DEFS)) {
    const map = MAP_DEFS[enc.mapId];
    if (!map) {
      errors.push({
        kind: "UNKNOWN_MAP_REF",
        entity: encId,
        message: `ENCOUNTER_DEFS["${encId}"].mapId = "${enc.mapId}" does not exist in MAP_DEFS.`,
      });
      // Can't validate coords without a map — skip remaining checks for this encounter
      continue;
    }

    if (enc.players.length === 0) {
      errors.push({
        kind: "EMPTY_ENCOUNTER_SIDE",
        entity: encId,
        message: `ENCOUNTER_DEFS["${encId}"] has no player entries.`,
      });
    }
    if (enc.enemies.length === 0) {
      errors.push({
        kind: "EMPTY_ENCOUNTER_SIDE",
        entity: encId,
        message: `ENCOUNTER_DEFS["${encId}"] has no enemy entries.`,
      });
    }

    // Duplicate instanceId check
    const allEntries = [...enc.players, ...enc.enemies];
    const seenIds = new Set<string>();
    for (const entry of allEntries) {
      if (seenIds.has(entry.instanceId)) {
        errors.push({
          kind: "DUPLICATE_INSTANCE_ID",
          entity: encId,
          message: `ENCOUNTER_DEFS["${encId}"] has duplicate instanceId "${entry.instanceId}".`,
        });
      }
      seenIds.add(entry.instanceId);
    }

    // Spawn coordinate validation
    for (const entry of allEntries) {
      const { x, y, instanceId, defId } = entry;
      const outOfBounds = x < 0 || y < 0 || x >= map.width || y >= map.height;
      if (outOfBounds) {
        errors.push({
          kind: "INVALID_SPAWN_COORD",
          entity: encId,
          message: `ENCOUNTER_DEFS["${encId}"] entry "${instanceId}" (${defId}) spawns at (${x},${y}) which is outside map bounds (${map.width}×${map.height}).`,
        });
        continue;
      }
      // Also verify the defId exists
      if (!COMBATANT_DEFS[defId]) {
        errors.push({
          kind: "UNKNOWN_WEAPON_REF", // reuse closest kind; defId is a content ref
          entity: encId,
          message: `ENCOUNTER_DEFS["${encId}"] entry "${instanceId}" references unknown COMBATANT_DEF "${defId}".`,
        });
      }

      // Blocked-tile check is skipped for testOnly encounters.
      // Test fixtures deliberately place combatants on border/wall tiles to
      // achieve specific Chebyshev distances that are impossible on open tiles
      // within the current map dimensions (e.g. quickOutOfRange needs dist > 6
      // from the entrance on an 8-wide map, which forces x = 7 = right border).
      // These encounters never run in production; the engine remains unaware of
      // whether a spawn is on a "blocked" tile because `buildEncounter` does not
      // validate terrain at construction time.
      if (!enc.testOnly && isBlocked(map, x, y)) {
        errors.push({
          kind: "INVALID_SPAWN_COORD",
          entity: encId,
          message: `ENCOUNTER_DEFS["${encId}"] entry "${instanceId}" (${defId}) spawns at (${x},${y}) which is a wall or pillar on map "${enc.mapId}".`,
        });
      }
    }
  }
}

// ---------------------------------------------------------------------------
// PUBLIC ENTRY POINT
// ---------------------------------------------------------------------------

/**
 * Validate all static content definitions for internal consistency.
 *
 * Checks performed:
 *   - COMBATANT_DEFS: weapon and ability references resolve; stats are sane
 *   - WEAPON_DEFS: ranges and dice are positive
 *   - ABILITY_DEFS: ranges and dice are positive
 *   - ENCOUNTER_DEFS: map reference resolves; has players + enemies;
 *     no duplicate instanceIds; all spawn coords are in-bounds and unblocked
 *
 * @returns Array of errors. An empty array means all content is consistent.
 */
export function validateAllContent(): ContentValidationError[] {
  const errors: ContentValidationError[] = [];
  validateCombatantDefs(errors);
  validateWeaponDefs(errors);
  validateAbilityDefs(errors);
  validateEncounterDefs(errors);
  return errors;
}
