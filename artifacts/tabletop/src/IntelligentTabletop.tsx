// @ts-nocheck
import React, { useState, useMemo, useCallback, useRef, useEffect } from "react";
import { Sword, Wand2, Footprints, Shield, ScrollText, Dice5, Sparkles, ChevronRight, X, Check } from "lucide-react";

/* ============================================================================
   INTELLIGENT TABLETOP — V3 Universal Content Prototype
   Two content-driven encounters (Ruined Crypt, Training Yard) run on the
   same engine — see CONTENT LAYER below for definitions.

   ARCHITECTURE
   ------------------------------------------------------------------
   Player Intent -> Interpreter -> Proposed Action -> Rules Validation
   -> Game State Mutation -> Resolution -> UI Update -> Session Log

   The "AI" in Assisted / Adventure mode is a deterministic intent
   parser — parseIntent() — shared by both modes (Intent Engine V2).
   It NEVER mutates game state directly — it only produces a
   ProposedAction (a proposal, a query answer, or an inspect summary).
   Every proposed action is re-validated by the same rules engine
   that Traditional Mode uses (validateMove / validateAttack) right
   before it is applied, atomically, via executeMove / executeAttack.
   Swapping parseIntent for a real LLM later requires no change to
   anything downstream of it.
   ============================================================================ */

// ---------------------------------------------------------------------------
// MAP CONTENT — data, not engine logic. A MapDefinition describes terrain;
// the engine (isWall/isPillar/reachableTiles/lineOfSight below) only ever
// reads a `map` object, so any new map is usable without touching them.
// ---------------------------------------------------------------------------
const MAP_DEFS = {
  crypt: {
    id: "crypt",
    name: "the ruined crypt",
    width: 8,
    height: 6,
    entrance: { x: 0, y: 3 },
    pillars: [
      { x: 3, y: 2 },
      { x: 5, y: 3 },
    ],
  },
  trainingYard: {
    id: "trainingYard",
    name: "the training yard",
    width: 8,
    height: 6,
    entrance: { x: 0, y: 3 },
    pillars: [], // open ground — no cover, proving cover is optional per-map, not hardcoded
  },
};

function isWall(map, x, y) {
  if (x < 0 || y < 0 || x >= map.width || y >= map.height) return true;
  const border = x === 0 || x === map.width - 1 || y === 0 || y === map.height - 1;
  if (border && !(x === map.entrance.x && y === map.entrance.y)) return true;
  return false;
}
function isPillar(map, x, y) {
  return map.pillars.some((p) => p.x === x && p.y === y);
}
function isBlocked(map, x, y) {
  return isWall(map, x, y) || isPillar(map, x, y);
}
function key(x, y) {
  return x + "," + y;
}

// ---------------------------------------------------------------------------
// RNG — seeded, deterministic, but produces real varying rolls per call
// ---------------------------------------------------------------------------
function mulberry32(seed) {
  let s = seed >>> 0;
  return function () {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function rollDie(sides, rng) {
  return Math.floor(rng() * sides) + 1;
}

// ---------------------------------------------------------------------------
// PATHFINDING / LINE OF SIGHT
// ---------------------------------------------------------------------------
function reachableTiles(map, start, maxRange, occupiedSet) {
  const dist = new Map();
  dist.set(key(start.x, start.y), 0);
  const queue = [start];
  const result = [];
  while (queue.length) {
    const cur = queue.shift();
    const d = dist.get(key(cur.x, cur.y));
    if (d > 0) result.push({ x: cur.x, y: cur.y, dist: d });
    if (d >= maxRange) continue;
    const neighbors = [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ];
    for (const [dx, dy] of neighbors) {
      const nx = cur.x + dx,
        ny = cur.y + dy;
      if (isBlocked(map, nx, ny)) continue;
      if (occupiedSet.has(key(nx, ny))) continue;
      const nk = key(nx, ny);
      if (!dist.has(nk)) {
        dist.set(nk, d + 1);
        queue.push({ x: nx, y: ny });
      }
    }
  }
  return result;
}

function lineTiles(x0, y0, x1, y1) {
  const pts = [];
  const dx = Math.abs(x1 - x0),
    dy = Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1,
    sy = y0 < y1 ? 1 : -1;
  let err = dx - dy;
  let x = x0,
    y = y0;
  while (!(x === x1 && y === y1)) {
    pts.push({ x, y });
    const e2 = 2 * err;
    if (e2 > -dy) {
      err -= dy;
      x += sx;
    }
    if (e2 < dx) {
      err += dx;
      y += sy;
    }
  }
  pts.push({ x: x1, y: y1 });
  return pts;
}
function lineOfSight(map, a, b) {
  const tiles = lineTiles(a.x, a.y, b.x, b.y).slice(1, -1);
  let blocked = false,
    cover = false;
  for (const t of tiles) {
    if (isWall(map, t.x, t.y)) blocked = true;
    if (isPillar(map, t.x, t.y)) cover = true;
  }
  return { blocked, cover };
}
function chebyshev(a, b) {
  return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
}

// ---------------------------------------------------------------------------
// CONTENT LAYER — data describing what exists. None of this is engine logic;
// it only ever gets read by createCombatantInstance/buildEncounter below.
// Adding a new weapon, combatant, map, or encounter never touches the rules
// engine (validateMove/validateAttack/executeMove/executeAttack/endTurn) or
// the intent parser.
// ---------------------------------------------------------------------------
const WEAPON_DEFS = {
  longbow: { id: "longbow", name: "Longbow", range: 6, dmgDie: 8, dmgMod: 2 },
  forceBolt: { id: "forceBolt", name: "Force Bolt", range: 6, dmgDie: 6, dmgMod: 3 },
  rustyShiv: { id: "rustyShiv", name: "Rusty Shiv", range: 1, dmgDie: 6, dmgMod: 1 },
  warAxe: { id: "warAxe", name: "War Axe", range: 1, dmgDie: 10, dmgMod: 3 },
};

// CombatantDefinition: id, name, class, side, icon, stats, and which
// WEAPON_DEFS entry it wields. This is the template — see
// createCombatantInstance for how a runtime instance is produced from it.
const COMBATANT_DEFS = {
  fighter: { id: "fighter", name: "Aldric", cls: "Fighter", type: "pc", icon: "sword", maxHp: 20, ac: 15, atkMod: 5, dexMod: 1, moveMax: 5, weaponId: "longbow" },
  wizard: { id: "wizard", name: "Sable", cls: "Wizard", type: "pc", icon: "wand", maxHp: 14, ac: 12, atkMod: 4, dexMod: 2, moveMax: 4, weaponId: "forceBolt", abilities: ["healingTouch", "fireBolt"] },
  goblin: { id: "goblin", name: "Goblin", cls: "Goblin", type: "enemy", icon: "shield", maxHp: 7, ac: 13, atkMod: 3, dexMod: 2, moveMax: 5, weaponId: "rustyShiv" },
  // New content added for V3 — the engine has no Orc-specific code path;
  // this definition is the entire "implementation" of the Orc.
  orc: { id: "orc", name: "Orc", cls: "Orc", type: "enemy", icon: "shield", maxHp: 16, ac: 15, atkMod: 4, dexMod: 0, moveMax: 4, weaponId: "warAxe" },
};

// AbilityDefinition: range, who it can target, and an `effect` describing
// what happens on resolution. executeAbility (below, in the rules engine
// section) is the ONE function that resolves every ability — it dispatches
// on `effect.type` via EFFECT_HANDLERS rather than branching on which
// ability was used. Adding a second heal-shaped ability, or a second
// damage-shaped spell, needs zero new top-level functions — only a new
// ABILITY_DEFS entry (and a new EFFECT_HANDLERS entry only if it's a
// genuinely new *kind* of effect, not just a new ability).
const ABILITY_DEFS = {
  healingTouch: {
    id: "healingTouch",
    name: "Healing Touch",
    range: 1, // adjacent, or self (distance 0) — no special-casing needed for "self"
    targeting: "ally", // same `type` as the caster; see isValidAbilityTarget
    effect: { type: "heal", die: 6, mod: 2 },
  },
  // V5: a harmful, non-weapon ability — added purely as data. requiresLineOfSight
  // is a small, generic schema extension (not a Fire-Bolt-specific flag): any
  // ability can opt into an LOS check the same way, via validateAbility below.
  fireBolt: {
    id: "fireBolt",
    name: "Fire Bolt",
    range: 4,
    targeting: "enemy",
    requiresLineOfSight: true,
    effect: { type: "damage", die: 8, mod: 1 },
  },
};

// Effect handlers: pure functions of (casterName, abilityName, targetInstance,
// effect, rng) -> { log: string[], result }. Each one is the ENTIRE
// implementation of one kind of effect, shared by every ability that uses
// it. This is the piece that answers both the V4 and V5 questions: a new
// ability is data (an ABILITY_DEFS entry); a new handler is only needed for
// a genuinely new effect shape — "heal" and "damage" together already cover
// both beneficial and harmful abilities with the same dispatch mechanism.
const EFFECT_HANDLERS = {
  heal: (casterName, abilityName, target, effect, rng) => {
    const roll = rollDie(effect.die, rng);
    const amount = roll + effect.mod;
    const before = target.hp;
    target.hp = Math.min(target.maxHp, target.hp + amount);
    const healed = target.hp - before;
    const log = [`${casterName} uses ${abilityName} on ${target.name}. Healing Roll: ${roll} + ${effect.mod} = ${amount}.`];
    log.push(`${target.name} HP: ${target.hp}/${target.maxHp}${healed < amount ? " (capped at max)" : ""}`);
    return { log, result: { type: "heal", roll, amount, healed, targetName: target.name } };
  },
  damage: (casterName, abilityName, target, effect, rng) => {
    const roll = rollDie(effect.die, rng);
    const amount = roll + effect.mod;
    target.hp = Math.max(0, target.hp - amount);
    const log = [`${casterName} casts ${abilityName} at ${target.name}. Damage Roll: ${roll} + ${effect.mod} = ${amount}.`];
    log.push(`${target.name} takes ${amount} damage. ${target.name} HP: ${target.hp}/${target.maxHp}`);
    if (target.hp <= 0) {
      target.alive = false;
      log.push(`${target.name} has fallen.`);
    }
    return { log, result: { type: "damage", roll, amount, targetName: target.name, targetHp: target.hp, dead: !target.alive } };
  },
};

// EncounterDefinition: which map, and which combatant definitions (with
// starting positions) populate the encounter. The engine never constructs
// "Fighter"/"Goblin"/"Orc" directly — it only ever instantiates whatever an
// EncounterDefinition lists.
const ENCOUNTER_DEFS = {
  crypt: {
    id: "crypt",
    name: "Ruined Crypt",
    mapId: "crypt",
    players: [
      { defId: "fighter", instanceId: "fighter", x: 1, y: 3 },
      { defId: "wizard", instanceId: "wizard", x: 1, y: 2 },
    ],
    enemies: [
      { defId: "goblin", instanceId: "goblin1", x: 6, y: 1 },
      { defId: "goblin", instanceId: "goblin2", x: 6, y: 3 },
      { defId: "goblin", instanceId: "goblin3", x: 4, y: 4 },
    ],
  },
  trainingYard: {
    id: "trainingYard",
    name: "Training Yard",
    mapId: "trainingYard",
    players: [{ defId: "fighter", instanceId: "fighter", x: 1, y: 3 }],
    enemies: [{ defId: "orc", instanceId: "orc1", x: 5, y: 2 }],
  },
};

// ---------------------------------------------------------------------------
// DEFINITION -> RUNTIME INSTANCE
// A CombatantDefinition is a template ("what a Goblin is"). A runtime
// instance is one independent, mutable occurrence of that template in a
// specific game state ("Goblin #1, HP 3/7, at (6,3), alive"). Multiple
// instances can be created from the same definition and mutate completely
// independently — see the V3 tests for proof.
// ---------------------------------------------------------------------------
function createCombatantInstance(defId, instanceId, x, y, displayName) {
  const def = COMBATANT_DEFS[defId];
  if (!def) throw new Error(`Unknown combatant definition: "${defId}"`);
  const weapon = WEAPON_DEFS[def.weaponId];
  if (!weapon) throw new Error(`Unknown weapon definition: "${def.weaponId}" (referenced by "${defId}")`);
  return {
    id: instanceId,
    defId,
    name: displayName || def.name,
    cls: def.cls,
    type: def.type,
    icon: def.icon,
    x,
    y,
    hp: def.maxHp,
    maxHp: def.maxHp,
    ac: def.ac,
    atkMod: def.atkMod,
    dexMod: def.dexMod,
    moveMax: def.moveMax,
    moveRemaining: def.moveMax,
    weapon: { name: weapon.name, range: weapon.range, dmgDie: weapon.dmgDie, dmgMod: weapon.dmgMod },
    abilities: def.abilities || [],
    alive: true,
    actionUsed: false,
  };
}

function rollInitiative(combatants, rng) {
  const rolled = Object.values(combatants).map((c) => ({
    id: c.id,
    total: rollDie(20, rng) + c.dexMod,
  }));
  rolled.sort((a, b) => b.total - a.total);
  return rolled;
}

// Reads an EncounterDefinition and produces a fresh game state. This is the
// only place content definitions and runtime state meet — everything below
// this function (validation, execution, turn cycling, the intent parser,
// the UI) only ever deals with runtime instances and never looks up a
// COMBATANT_DEFS/WEAPON_DEFS/MAP_DEFS entry directly.
function buildEncounter(encounterId, seed) {
  const encounterDef = ENCOUNTER_DEFS[encounterId];
  if (!encounterDef) throw new Error(`Unknown encounter: "${encounterId}"`);
  const map = MAP_DEFS[encounterDef.mapId];
  if (!map) throw new Error(`Unknown map: "${encounterDef.mapId}" (referenced by encounter "${encounterId}")`);

  const combatants = {};
  // If an encounter has more than one instance of the same definition
  // (e.g. three Goblins), number their display names ("Goblin 1", "Goblin
  // 2", ...) so both the UI and the intent parser can disambiguate. A
  // single instance of a definition (e.g. one Orc) keeps its plain name.
  const countByDef = {};
  for (const entry of [...encounterDef.players, ...encounterDef.enemies]) {
    countByDef[entry.defId] = (countByDef[entry.defId] || 0) + 1;
  }
  const seenByDef = {};
  for (const entry of [...encounterDef.players, ...encounterDef.enemies]) {
    const def = COMBATANT_DEFS[entry.defId];
    let displayName = def.name;
    if (countByDef[entry.defId] > 1) {
      seenByDef[entry.defId] = (seenByDef[entry.defId] || 0) + 1;
      displayName = `${def.name} ${seenByDef[entry.defId]}`;
    }
    combatants[entry.instanceId] = createCombatantInstance(entry.defId, entry.instanceId, entry.x, entry.y, displayName);
  }

  const rng = mulberry32(seed);
  const initiative = rollInitiative(combatants, rng);
  return {
    started: true,
    encounterId,
    encounterName: encounterDef.name,
    map,
    round: 1,
    turnOrder: initiative.map((i) => i.id),
    initiativeRolls: initiative,
    turnIndex: 0,
    combatants,
    log: [
      `The party enters ${map.name}.`,
      "Initiative: " + initiative.map((i) => `${combatants[i.id].name} (${i.total})`).join(", "),
      `— Round 1 —`,
    ],
    seed,
  };
}

// ---------------------------------------------------------------------------
// RULES ENGINE — validation (pure, read-only)
// ---------------------------------------------------------------------------
function occupiedSet(combatants, excludeId) {
  const s = new Set();
  for (const c of Object.values(combatants)) {
    if (c.alive && c.id !== excludeId) s.add(key(c.x, c.y));
  }
  return s;
}

// ValidationResult shape: { valid, code, reason, ...metadata }
// `code` is a stable machine-readable identifier the UI/intent layer can
// branch on; `reason` is the human-readable sentence. Both are produced
// here, by the rules engine — never invented by the intent parser or UI.
function validateMove(state, actorId, dest) {
  const actor = state.combatants[actorId];
  if (!actor) return { valid: false, code: "ACTOR_UNKNOWN", reason: "Unknown actor." };
  if (!actor.alive) return { valid: false, code: "ACTOR_DEAD", reason: `${actor.name} is down.` };
  if (state.turnOrder[state.turnIndex] !== actorId)
    return { valid: false, code: "NOT_YOUR_TURN", reason: `It is not ${actor.name}'s turn.` };
  if (isBlocked(state.map, dest.x, dest.y))
    return { valid: false, code: "BLOCKED_TILE", reason: "That tile is blocked by a wall or pillar." };
  const occ = occupiedSet(state.combatants, actorId);
  if (occ.has(key(dest.x, dest.y)))
    return { valid: false, code: "TILE_OCCUPIED", reason: "That tile is occupied." };
  const reachable = reachableTiles(state.map, { x: actor.x, y: actor.y }, actor.moveRemaining, occ);
  const found = reachable.find((t) => t.x === dest.x && t.y === dest.y);
  if (!found)
    return { valid: false, code: "OUT_OF_MOVEMENT_RANGE", reason: `Out of movement range (${actor.moveRemaining} left).` };
  return { valid: true, code: "OK", cost: found.dist };
}

function validateAttack(state, actorId, targetId) {
  const actor = state.combatants[actorId];
  const target = state.combatants[targetId];
  if (!actor || !target) return { valid: false, code: "TARGET_UNKNOWN", reason: "Unknown combatant." };
  if (!actor.alive) return { valid: false, code: "ACTOR_DEAD", reason: `${actor.name} is down.` };
  if (!target.alive) return { valid: false, code: "TARGET_DEAD", reason: `${target.name} is already defeated.` };
  if (state.turnOrder[state.turnIndex] !== actorId)
    return { valid: false, code: "NOT_YOUR_TURN", reason: `It is not ${actor.name}'s turn.` };
  if (actor.actionUsed)
    return { valid: false, code: "ACTION_USED", reason: `${actor.name} has already acted this turn.` };
  const dist = chebyshev(actor, target);
  if (dist > actor.weapon.range)
    return { valid: false, code: "OUT_OF_RANGE", reason: `${target.name} is out of range (${dist} > ${actor.weapon.range}).` };
  const los = lineOfSight(state.map, actor, target);
  if (los.blocked) return { valid: false, code: "BLOCKED_LINE_OF_SIGHT", reason: "No line of sight — blocked by a wall." };
  return { valid: true, code: "OK", cover: los.cover, distance: dist };
}

// Whether `target` is a legal target for an ability with the given
// targeting rule, relative to `actor`. Purely a function of `type` (side),
// so it works for any current or future combatant without change.
function isValidAbilityTarget(targeting, actor, target) {
  if (targeting === "self") return target.id === actor.id;
  if (targeting === "ally") return target.type === actor.type;
  if (targeting === "enemy") return target.type !== actor.type;
  if (targeting === "any") return true;
  return false;
}

// Generic ability validator — the same function handles Healing Touch and
// any future ability, because everything it checks (turn, action economy,
// range, target legality) is read from the ability's data, not branched on
// which ability it is.
function validateAbility(state, actorId, abilityId, targetId) {
  const actor = state.combatants[actorId];
  const target = state.combatants[targetId];
  const ability = ABILITY_DEFS[abilityId];
  if (!actor || !target) return { valid: false, code: "TARGET_UNKNOWN", reason: "Unknown combatant." };
  if (!ability) return { valid: false, code: "ABILITY_UNKNOWN", reason: `Unknown ability: "${abilityId}".` };
  if (!actor.alive) return { valid: false, code: "ACTOR_DEAD", reason: `${actor.name} is down.` };
  if (!(actor.abilities || []).includes(abilityId))
    return { valid: false, code: "ABILITY_NOT_LEARNED", reason: `${actor.name} does not know ${ability.name}.` };
  if (!target.alive) return { valid: false, code: "TARGET_DEAD", reason: `${target.name} is already defeated.` };
  if (state.turnOrder[state.turnIndex] !== actorId)
    return { valid: false, code: "NOT_YOUR_TURN", reason: `It is not ${actor.name}'s turn.` };
  if (actor.actionUsed)
    return { valid: false, code: "ACTION_USED", reason: `${actor.name} has already acted this turn.` };
  if (!isValidAbilityTarget(ability.targeting, actor, target))
    return { valid: false, code: "INVALID_TARGET_TYPE", reason: `${target.name} is not a valid target for ${ability.name}.` };
  const dist = chebyshev(actor, target);
  if (dist > ability.range)
    return { valid: false, code: "OUT_OF_RANGE", reason: `${target.name} is out of range for ${ability.name} (${dist} > ${ability.range}).` };
  if (ability.requiresLineOfSight) {
    const los = lineOfSight(state.map, actor, target);
    if (los.blocked) return { valid: false, code: "BLOCKED_LINE_OF_SIGHT", reason: "No line of sight — blocked by a wall." };
    return { valid: true, code: "OK", distance: dist, cover: los.cover };
  }
  return { valid: true, code: "OK", distance: dist };
}

// ---------------------------------------------------------------------------
// RULES ENGINE — mutation (the ONLY functions allowed to change state)
// ---------------------------------------------------------------------------
function cloneState(state) {
  return { ...state, combatants: JSON.parse(JSON.stringify(state.combatants)), log: [...state.log] };
}

function executeMove(state, actorId, dest) {
  const v = validateMove(state, actorId, dest);
  if (!v.valid) return { state, events: [v.reason], ok: false, code: v.code };
  const next = cloneState(state);
  const actor = next.combatants[actorId];
  actor.x = dest.x;
  actor.y = dest.y;
  actor.moveRemaining -= v.cost;
  const line = `${actor.name} moved to (${dest.x}, ${dest.y}).`;
  next.log.push(line);
  return { state: next, events: [line], ok: true };
}

function executeAttack(state, actorId, targetId, rng) {
  const v = validateAttack(state, actorId, targetId);
  if (!v.valid) return { state, events: [v.reason], ok: false, code: v.code };
  const next = cloneState(state);
  const actor = next.combatants[actorId];
  const target = next.combatants[targetId];
  actor.actionUsed = true;

  const d20 = rollDie(20, rng);
  const atkTotal = d20 + actor.atkMod;
  const effectiveAc = target.ac + (v.cover ? 2 : 0);
  const events = [];
  const coverNote = v.cover ? ` (target has cover, AC ${target.ac}+2=${effectiveAc})` : "";
  events.push(
    `${actor.name} attacks ${target.name} with ${actor.weapon.name}. Attack Roll: ${d20} + ${actor.atkMod} = ${atkTotal} vs AC ${effectiveAc}${coverNote}.`
  );

  let dmgRoll = null,
    dmgTotal = 0,
    hit = false,
    crit = d20 === 20;

  if (crit || atkTotal >= effectiveAc) {
    hit = true;
    dmgRoll = rollDie(actor.weapon.dmgDie, rng);
    dmgTotal = dmgRoll + actor.weapon.dmgMod;
    if (crit) {
      const bonus = rollDie(actor.weapon.dmgDie, rng);
      dmgTotal += bonus;
      events.push(
        `Critical hit! Damage: ${dmgTotal} (d${actor.weapon.dmgDie}:${dmgRoll}+${bonus} crit +${actor.weapon.dmgMod}).`
      );
    } else {
      events.push(`Hit! Damage: ${dmgTotal} (d${actor.weapon.dmgDie}:${dmgRoll}+${actor.weapon.dmgMod}).`);
    }
    target.hp = Math.max(0, target.hp - dmgTotal);
    events.push(`${target.name} HP: ${target.hp}/${target.maxHp}`);
    if (target.hp <= 0) {
      target.alive = false;
      events.push(`${target.name} has fallen.`);
    }
  } else {
    events.push(`Miss.`);
  }

  next.log.push(...events);
  return {
    state: next,
    events,
    ok: true,
    result: { hit, crit, d20, atkTotal, effectiveAc, dmgTotal },
  };
}

// Resolves ANY ability. This is the function the V4 stress test is about:
// it is not "executeHeal" — it looks up ABILITY_DEFS for range/targeting
// and EFFECT_HANDLERS[ability.effect.type] for what the roll actually does.
// Healing Touch works because "heal" has a handler, not because this
// function knows Healing Touch exists. A second heal-shaped ability needs
// zero changes here; a genuinely new effect shape needs one new entry in
// EFFECT_HANDLERS, still zero new top-level execute functions.
function executeAbility(state, actorId, abilityId, targetId, rng) {
  const v = validateAbility(state, actorId, abilityId, targetId);
  if (!v.valid) return { state, events: [v.reason], ok: false, code: v.code };
  const ability = ABILITY_DEFS[abilityId];
  const handler = EFFECT_HANDLERS[ability.effect.type];
  if (!handler) return { state, events: [`No handler for effect type "${ability.effect.type}".`], ok: false, code: "NO_EFFECT_HANDLER" };

  const next = cloneState(state);
  const actor = next.combatants[actorId];
  const target = next.combatants[targetId];
  actor.actionUsed = true;

  const { log, result } = handler(actor.name, ability.name, target, ability.effect, rng);
  next.log.push(...log);
  return { state: next, events: log, ok: true, result };
}

function endTurn(state) {
  const next = cloneState(state);
  const currentId = next.turnOrder[next.turnIndex];
  const actor = next.combatants[currentId];
  if (actor) next.log.push(`${actor.name} ends their turn.`);

  // advance to next living combatant
  let idx = next.turnIndex;
  let loops = 0;
  do {
    idx = (idx + 1) % next.turnOrder.length;
    loops++;
    if (idx === 0) next.round += 1;
    if (loops > next.turnOrder.length * 2) break;
  } while (!next.combatants[next.turnOrder[idx]].alive);

  if (idx <= next.turnIndex && idx !== 0) {
    // no-op guard
  }
  const wrapped = idx === 0 && next.turnIndex !== 0;
  next.turnIndex = idx;
  const nextActor = next.combatants[next.turnOrder[idx]];
  nextActor.moveRemaining = nextActor.moveMax;
  nextActor.actionUsed = false;
  if (wrapped) next.log.push(`— Round ${next.round} —`);
  next.log.push(`${nextActor.name}'s turn.`);
  return next;
}

function checkEncounterStatus(state) {
  const pcs = Object.values(state.combatants).filter((c) => c.type === "pc");
  const enemies = Object.values(state.combatants).filter((c) => c.type === "enemy");
  if (enemies.every((e) => !e.alive)) return "victory";
  if (pcs.every((p) => !p.alive)) return "defeat";
  return "ongoing";
}

// Small deterministic enemy AI: close distance to the nearest living PC,
// attack if in range. Uses the SAME validate/execute functions as the
// player, and reads only generic combatant/weapon fields — nothing here
// is specific to Goblins, so it works unmodified for Orcs or any future
// enemy definition.
function runEnemyAI(state, actorId, rng) {
  let cur = state;
  const events = [];
  const actor = cur.combatants[actorId];
  const pcs = Object.values(cur.combatants).filter((c) => c.type === "pc" && c.alive);
  if (!actor.alive || pcs.length === 0) return { state: cur, events };

  pcs.sort((a, b) => chebyshev(actor, a) - chebyshev(actor, b));
  const target = pcs[0];

  // Attack immediately if already in range + LOS
  let v = validateAttack(cur, actorId, target.id);
  if (!v.valid && chebyshev(actor, target) > actor.weapon.range) {
    // move toward target
    const occ = occupiedSet(cur.combatants, actorId);
    const reach = reachableTiles(cur.map, { x: actor.x, y: actor.y }, actor.moveRemaining, occ);
    reach.push({ x: actor.x, y: actor.y, dist: 0 });
    reach.sort((a, b) => chebyshev(a, target) - chebyshev(b, target) || a.dist - b.dist);
    const dest = reach[0];
    if (dest && !(dest.x === actor.x && dest.y === actor.y)) {
      const mv = executeMove(cur, actorId, { x: dest.x, y: dest.y });
      cur = mv.state;
      events.push(...mv.events);
    }
    v = validateAttack(cur, actorId, target.id);
  }
  if (v.valid) {
    const atk = executeAttack(cur, actorId, target.id, rng);
    cur = atk.state;
    events.push(...atk.events);
  } else {
    events.push(`${actor.name} could not reach a target.`);
  }
  return { state: cur, events };
}

// If initiative happens to place one or more enemies before any PC, the
// encounter must not just sit there waiting for player input that can never
// come — those leading enemy turns need to resolve on their own, same as
// any other enemy turn. This uses the exact same runEnemyAI/endTurn used
// mid-encounter; it is not special-cased combat logic.
function resolveLeadingEnemyTurns(state, rng) {
  let next = state;
  let guard = 0;
  while (
    checkEncounterStatus(next) === "ongoing" &&
    next.combatants[next.turnOrder[next.turnIndex]].type === "enemy" &&
    guard < 10
  ) {
    const aid = next.turnOrder[next.turnIndex];
    const res = runEnemyAI(next, aid, rng);
    next = res.state;
    if (checkEncounterStatus(next) !== "ongoing") break;
    next = endTurn(next);
    guard++;
  }
  return next;
}


//
// Boundary, restated: everything in this section only ever PROPOSES.
// It reads state and calls the read-only validate* functions above; it
// never calls executeMove / executeAttack and never assigns into `state`.
// A real LLM could replace parseIntent() wholesale — every function
// downstream of it (revalidateProposal, executeProposalSteps, and the
// UI) would not need to change.
//
// ProposedAction (the return shape of parseIntent) is one of:
//   { type: "proposal", steps: Step[], summary }
//   { type: "query",    question, items: CheckItem[], overall, headline }
//   { type: "inspect",  lines: string[] }
//   { type: "error",    message }
// Step is one of:
//   { kind: "move",   dest: {x,y}, description }
//   { kind: "attack", targetId,    description }
//   { kind: "endTurn" }
// ---------------------------------------------------------------------------

// ---- small contextual view for the interpreter (not the whole game state) ----
function buildIntentContext(state, actorId) {
  const actor = state.combatants[actorId];
  if (!actor) return null;
  const enemies = Object.values(state.combatants)
    .filter((c) => c.type === "enemy" && c.alive)
    .map((e) => ({
      id: e.id,
      name: e.name,
      distance: chebyshev(actor, e),
      inRange: chebyshev(actor, e) <= actor.weapon.range,
      visible: !lineOfSight(state.map, actor, e).blocked,
    }));
  return {
    actorId,
    actorName: actor.name,
    position: { x: actor.x, y: actor.y },
    moveRemaining: actor.moveRemaining,
    weapon: actor.weapon,
    actionAvailable: !actor.actionUsed,
    hp: actor.hp,
    maxHp: actor.maxHp,
    isCurrentTurn: state.turnOrder[state.turnIndex] === actorId,
    enemies,
    pillars: state.map.pillars,
  };
}

// ---- intent vocabulary ----
const MOVE_VERBS = /\b(move|walk|run|go|dash|step|slip|duck|retreat|approach|advance|reposition)\b/;
const ATTACK_VERBS = /\b(attack|hit|strike|shoot|fire|slash|stab|cast)\b/;
const END_TURN_PHRASE = /\b(end (my )?turn|i'?m done|i pass|nothing else|that'?s (all|it))\b/;
const QUERY_PREFIX = /^(can i|could i|is it possible|would i be able to|do i have|am i able to)\b/;
const INSPECT_PHRASE = /\b(what can i do|what are my options|options\??$|inspect|look around|show me my options)\b/;
const COVER_PHRASE = /\b(pillar|cover)\b/;
const NEXT_TO_PHRASE = /\b(next to|beside|adjacent to|close to|up to)\b/;
const TOWARD_PHRASE = /\b(toward|towards|closer)\b/;
const RETREAT_PHRASE = /\b(retreat|back away|fall back|away from)\b/;
const STAY_PHRASE = /\b(stay|remain|don'?t move|from here|where i am|without moving)\b/;
const GENERIC_TARGET_WORDS = /\benemy\b|\bit\b|\bhim\b|\bthat\b|closest|nearest/;

function classifyIntent(t) {
  return {
    isQuery: QUERY_PREFIX.test(t),
    isInspect: INSPECT_PHRASE.test(t),
    isEndTurn: END_TURN_PHRASE.test(t),
    wantsMove: MOVE_VERBS.test(t) || COVER_PHRASE.test(t) || NEXT_TO_PHRASE.test(t) || TOWARD_PHRASE.test(t),
    wantsAttack: ATTACK_VERBS.test(t),
    wantsCover: COVER_PHRASE.test(t),
    wantsNextTo: NEXT_TO_PHRASE.test(t),
    wantsToward: TOWARD_PHRASE.test(t),
    wantsRetreat: RETREAT_PHRASE.test(t),
    staysPut: STAY_PHRASE.test(t),
  };
}

function normalizeForMatch(s) {
  return s.toLowerCase().replace(/[^a-z0-9]/g, "");
}

// Used only for example/hint copy (error messages, input placeholders) so
// that text doesn't hardcode "the goblin" — it names whatever enemy is
// actually present in the current encounter.
function exampleTargetPhrase(state) {
  const enemies = Object.values(state.combatants).filter((c) => c.type === "enemy" && c.alive);
  if (!enemies.length) return "your target";
  return "the " + enemies[0].cls.toLowerCase();
}

// ---- target resolution: matches by whatever enemies actually exist in the
// CURRENT encounter (their instance name, e.g. "Goblin 2", or their class,
// e.g. "Orc") — never a hardcoded enemy type. "Attack the orc" works only
// because an Orc happens to be present, the same way "attack the goblin"
// works only because a Goblin is present. No per-species branching. ----
function findTargetByText(text, state, actorPos) {
  const enemies = Object.values(state.combatants).filter((c) => c.type === "enemy" && c.alive);
  if (!enemies.length) return null;
  const norm = normalizeForMatch(text);

  // Exact/partial instance-name match, e.g. "goblin 2", "goblin2", "orc".
  const named = enemies.find((e) => norm.includes(normalizeForMatch(e.name)));
  if (named) return named;

  // Class match, e.g. "the orc" when cls is "Orc" but name might differ.
  const byClass = enemies.filter((e) => norm.includes(normalizeForMatch(e.cls)));
  if (byClass.length === 1) return byClass[0];

  // Generic pronoun/"nearest"/"closest" fallback — narrowed to a class match
  // if the text also mentioned one (e.g. multiple Goblins + "nearest goblin").
  const t = text.toLowerCase();
  if (byClass.length > 1 || GENERIC_TARGET_WORDS.test(t)) {
    const pool = byClass.length ? byClass : enemies;
    return [...pool].sort((a, b) => chebyshev(actorPos, a) - chebyshev(actorPos, b))[0];
  }
  return null;
}

// ---- ability resolution: matches against whatever abilities the ACTOR
// actually has (data-driven — the parser has no hardcoded "healing touch"
// string; it only ever compares text against ABILITY_DEFS[id].name for
// ids the actor's own definition granted it). ----
// Generic verbs tied to an EFFECT TYPE, not a specific ability's name — so
// "heal myself" works for any ability whose effect.type is "heal" (current
// or future), the same way ATTACK_VERBS works for any weapon rather than
// any specific weapon name.
const EFFECT_TYPE_VERBS = {
  heal: /\b(heal|healing|cure|mend)\b/,
  damage: /\b(fire|flame|burn|scorch|blast|bolt|spell)\b/,
};

function findAbilityByText(text, actor) {
  const abilities = actor.abilities || [];
  if (!abilities.length) return null;
  const norm = normalizeForMatch(text);
  const byName = abilities.find((id) => ABILITY_DEFS[id] && norm.includes(normalizeForMatch(ABILITY_DEFS[id].name)));
  if (byName) return byName;
  const t = text.toLowerCase();
  const byEffectVerb = abilities.find((id) => {
    const ability = ABILITY_DEFS[id];
    const verbPattern = ability && EFFECT_TYPE_VERBS[ability.effect.type];
    return verbPattern && verbPattern.test(t);
  });
  return byEffectVerb || null;
}

// ---- ally/self target resolution for abilities (as opposed to
// findTargetByText, which resolves enemies for attacks) ----
function findAllyTargetByText(text, state, actor) {
  const t = text.toLowerCase();
  if (/\b(myself|herself|himself|itself|on me|on herself|on himself|on myself)\b/.test(t)) return actor;
  const allies = Object.values(state.combatants).filter((c) => c.type === actor.type && c.alive);
  const norm = normalizeForMatch(text);
  const named = allies.find((a) => norm.includes(normalizeForMatch(a.name)));
  if (named) return named;
  return null;
}

// ---- generic target resolution for ANY ability, dispatched on the
// ability's own `targeting` rule (V5) — this is what lets Fire Bolt
// (targeting: "enemy") and Healing Touch (targeting: "ally") share one
// intent-parsing path instead of Fire Bolt needing its own branch. ----
function findAbilityTargetByText(text, state, actor, ability) {
  if (ability.targeting === "self") return actor;
  if (ability.targeting === "enemy") return findTargetByText(text, state, actor);
  if (ability.targeting === "ally") return findAllyTargetByText(text, state, actor) || actor;
  // "any": try enemy first, then ally/self
  return findTargetByText(text, state, actor) || findAllyTargetByText(text, state, actor);
}

// ---- destination resolvers: each finds a reachable tile satisfying an
// intent, reading terrain from state.map (never a module-level map) ----
function findCoverTile(state, actor, target) {
  const occ = occupiedSet(state.combatants, actor.id);
  const reach = reachableTiles(state.map, { x: actor.x, y: actor.y }, actor.moveRemaining, occ);
  let best = null;
  for (const tile of reach) {
    if (!state.map.pillars.some((p) => chebyshev(p, tile) === 1)) continue;
    if (target && lineOfSight(state.map, tile, target).blocked) continue;
    if (!best || tile.dist < best.dist) best = tile;
  }
  return best;
}
function findAttackPositionTile(state, actor, target) {
  const occ = occupiedSet(state.combatants, actor.id);
  const reach = reachableTiles(state.map, { x: actor.x, y: actor.y }, actor.moveRemaining, occ);
  let best = null;
  for (const tile of reach) {
    if (chebyshev(tile, target) > actor.weapon.range) continue;
    if (lineOfSight(state.map, tile, target).blocked) continue;
    if (!best || tile.dist < best.dist) best = tile;
  }
  return best;
}
function findAdjacentTile(state, actor, target) {
  const occ = occupiedSet(state.combatants, actor.id);
  const reach = reachableTiles(state.map, { x: actor.x, y: actor.y }, actor.moveRemaining, occ);
  let best = null;
  for (const tile of reach) {
    if (chebyshev(tile, target) !== 1) continue;
    if (!best || tile.dist < best.dist) best = tile;
  }
  return best;
}
function findCloserTile(state, actor, target) {
  const occ = occupiedSet(state.combatants, actor.id);
  const reach = reachableTiles(state.map, { x: actor.x, y: actor.y }, actor.moveRemaining, occ);
  const curDist = chebyshev(actor, target);
  let best = null;
  for (const tile of reach) {
    const d = chebyshev(tile, target);
    if (d >= curDist) continue;
    if (!best || d < best.dToTarget || (d === best.dToTarget && tile.dist < best.dist)) best = { ...tile, dToTarget: d };
  }
  return best;
}
function findRetreatTile(state, actor) {
  const occ = occupiedSet(state.combatants, actor.id);
  const reach = reachableTiles(state.map, { x: actor.x, y: actor.y }, actor.moveRemaining, occ);
  const enemies = Object.values(state.combatants).filter((c) => c.type === "enemy" && c.alive);
  if (!enemies.length) return null;
  const minDistToEnemies = (tile) => Math.min(...enemies.map((e) => chebyshev(tile, e)));
  const curSafety = minDistToEnemies(actor);
  let best = null;
  for (const tile of reach) {
    const safety = minDistToEnemies(tile);
    if (safety <= curSafety) continue;
    if (!best || safety > best.safety) best = { ...tile, safety };
  }
  return best;
}

// ---- "Can I...?" explainability: itemized, built ONLY from real validation ----
function explainAttack(state, actorId, targetId) {
  const actor = state.combatants[actorId];
  const target = state.combatants[targetId];
  if (!target) return { overall: false, items: [{ ok: false, label: "No such target." }] };
  const items = [];
  items.push({ ok: target.alive, label: target.alive ? `${target.name} is alive` : `${target.name} is already defeated` });
  const turnOk = state.turnOrder[state.turnIndex] === actorId;
  items.push({ ok: turnOk, label: turnOk ? `It is ${actor.name}'s turn` : `It is not ${actor.name}'s turn` });
  items.push({ ok: !actor.actionUsed, label: !actor.actionUsed ? "Attack action is available" : "Attack action already used this turn" });
  const dist = chebyshev(actor, target);
  const inRange = dist <= actor.weapon.range;
  items.push({ ok: inRange, label: inRange ? `Target is within weapon range (${dist}/${actor.weapon.range})` : `Target is out of weapon range (${dist}/${actor.weapon.range})` });
  const los = lineOfSight(state.map, actor, target);
  items.push({ ok: !los.blocked, label: !los.blocked ? "Line of sight is clear" : "Line of sight is blocked by a wall" });
  if (!los.blocked && los.cover) items.push({ ok: true, label: "Target has pillar cover (+2 effective AC)" });
  return { overall: items.every((i) => i.ok), items };
}
function explainReachCover(state, actorId) {
  const actor = state.combatants[actorId];
  const tile = findCoverTile(state, actor, null);
  const items = [
    { ok: !!tile, label: tile ? `A tile beside a pillar is reachable (${actor.moveRemaining} movement available)` : "No reachable tile is adjacent to a pillar" },
  ];
  return { overall: items.every((i) => i.ok), items, tile };
}
function explainAbility(state, actorId, abilityId, targetId) {
  const actor = state.combatants[actorId];
  const target = state.combatants[targetId];
  const ability = ABILITY_DEFS[abilityId];
  if (!target || !ability) return { overall: false, items: [{ ok: false, label: "No such ability or target." }] };
  const items = [];
  items.push({ ok: (actor.abilities || []).includes(abilityId), label: (actor.abilities || []).includes(abilityId) ? `${actor.name} knows ${ability.name}` : `${actor.name} does not know ${ability.name}` });
  const turnOk = state.turnOrder[state.turnIndex] === actorId;
  items.push({ ok: turnOk, label: turnOk ? `It is ${actor.name}'s turn` : `It is not ${actor.name}'s turn` });
  items.push({ ok: !actor.actionUsed, label: !actor.actionUsed ? "Action is available" : "Action already used this turn" });
  const validTargetType = isValidAbilityTarget(ability.targeting, actor, target);
  items.push({ ok: validTargetType, label: validTargetType ? `${target.name} is a valid target` : `${target.name} is not a valid target for ${ability.name}` });
  const dist = chebyshev(actor, target);
  const inRange = dist <= ability.range;
  items.push({ ok: inRange, label: inRange ? `Target is within range (${dist}/${ability.range})` : `Target is out of range (${dist}/${ability.range})` });
  if (ability.requiresLineOfSight) {
    const los = lineOfSight(state.map, actor, target);
    items.push({ ok: !los.blocked, label: !los.blocked ? "Line of sight is clear" : "Line of sight is blocked by a wall" });
  }
  return { overall: items.every((i) => i.ok), items };
}

// ---- the interpreter itself: text + state + actor -> ProposedAction ----
function parseIntent(text, state, actorId) {
  const raw = text.trim();
  const t = raw.toLowerCase();
  const actor = state.combatants[actorId];
  if (!t) return { type: "error", message: `Type an instruction, e.g. "attack ${exampleTargetPhrase(state)}".` };

  // 1. "Can I...?" queries — answered with the real rules engine, never invented
  if (QUERY_PREFIX.test(t)) {
    const rest = t.replace(QUERY_PREFIX, "").trim();
    const queryAbilityId = findAbilityByText(rest, actor);
    if (queryAbilityId) {
      const ability = ABILITY_DEFS[queryAbilityId];
      const target = findAbilityTargetByText(rest, state, actor, ability);
      if (!target) return { type: "error", message: `Could not identify a target for ${ability.name}.` };
      const verb = ability.targeting === "enemy" ? "CAST" : "USE";
      const prep = ability.targeting === "enemy" ? "AT" : "ON";
      const ex = explainAbility(state, actorId, queryAbilityId, target.id);
      return { type: "query", question: raw, items: ex.items, overall: ex.overall, headline: `CAN I ${verb} ${ability.name.toUpperCase()} ${prep} ${target.name.toUpperCase()}?` };
    }
    if (ATTACK_VERBS.test(rest) || GENERIC_TARGET_WORDS.test(rest)) {
      const target = findTargetByText(rest, state, actor);
      if (!target) return { type: "error", message: "No matching target found for that question." };
      const ex = explainAttack(state, actorId, target.id);
      return { type: "query", question: raw, items: ex.items, overall: ex.overall, headline: `CAN I ATTACK ${target.name.toUpperCase()}?` };
    }
    if (COVER_PHRASE.test(rest) || /reach|get behind/.test(rest)) {
      const ex = explainReachCover(state, actorId);
      return { type: "query", question: raw, items: ex.items, overall: ex.overall, headline: "CAN I REACH COVER?" };
    }
    return { type: "error", message: `Could not interpret the question "${raw}".` };
  }

  // 2. Inspect — informational only, never mutates or proposes
  if (INSPECT_PHRASE.test(t)) {
    const enemies = Object.values(state.combatants).filter((c) => c.type === "enemy" && c.alive);
    const lines = enemies.map((e) => {
      const v = validateAttack(state, actorId, e.id);
      return `${e.name}: ${v.valid ? "attack available" : v.reason}`;
    });
    return {
      type: "inspect",
      lines: [`Movement remaining: ${actor.moveRemaining}/${actor.moveMax}`, `Action: ${actor.actionUsed ? "used" : "available"}`, ...lines],
    };
  }

  // 3. End Turn
  if (END_TURN_PHRASE.test(t)) {
    return { type: "proposal", steps: [{ kind: "endTurn", description: "End Turn" }], summary: `${actor.name} → End Turn` };
  }

  // 3.5. Ability use (e.g. "Sable uses Healing Touch on Aldric") — checked
  // before Move/Attack classification since an ability's own vocabulary
  // (e.g. "cast") can overlap with ATTACK_VERBS; abilities take priority.
  const abilityId = findAbilityByText(t, actor);
  if (abilityId) {
    const ability = ABILITY_DEFS[abilityId];
    const target = findAbilityTargetByText(t, state, actor, ability);
    if (!target) return { type: "error", message: `Could not identify a target for ${ability.name} in "${raw}".` };
    const verb = ability.targeting === "enemy" ? "Cast" : "Use";
    const prep = ability.targeting === "enemy" ? "at" : "on";
    const description = `${verb} ${ability.name} ${prep} ${target.name}`;
    return {
      type: "proposal",
      steps: [{ kind: "ability", abilityId, targetId: target.id, description }],
      summary: `${actor.name}\n→ ${description}`,
    };
  }

  // 4. Move / Attack / Move+Attack sequences
  const c = classifyIntent(t);
  const needsTarget = c.wantsAttack || c.wantsNextTo || c.wantsToward;
  const target = needsTarget ? findTargetByText(t, state, actor) : null;
  if (c.wantsAttack && !target) return { type: "error", message: `Could not identify a target in "${raw}".` };
  if ((c.wantsNextTo || c.wantsToward) && !target && !c.wantsAttack)
    return { type: "error", message: `Could not identify what to move toward in "${raw}".` };

  const steps = [];
  if (c.wantsMove && !c.staysPut) {
    let tile = null;
    let moveDescription = null;
    // "through/into the pillar" is a literal request to occupy a blocked
    // tile — propose exactly that (instead of quietly rerouting to nearby
    // cover) so the rules engine rejects it with a real explanation.
    if (/\b(through|into|onto)\b.*\bpillar\b/.test(t)) {
      if (!state.map.pillars.length) {
        return { type: "error", message: `There is no pillar on ${state.map.name}.` };
      }
      const nearestPillar = [...state.map.pillars].sort((a, b) => chebyshev(actor, a) - chebyshev(actor, b))[0];
      steps.push({ kind: "move", dest: { x: nearestPillar.x, y: nearestPillar.y }, description: "Move through the pillar" });
    } else if (c.wantsCover) {
      tile = findCoverTile(state, actor, target);
      moveDescription = "Move to Pillar Cover";
      if (!tile) return { type: "error", message: target ? "No reachable position near a pillar has line of sight to that target." : "No reachable tile is adjacent to a pillar." };
    } else if (c.wantsRetreat) {
      tile = findRetreatTile(state, actor);
      moveDescription = "Retreat to Safer Position";
      if (!tile) return { type: "error", message: "There is no reachable tile that increases distance from enemies." };
    } else if (c.wantsNextTo && target) {
      tile = findAdjacentTile(state, actor, target);
      moveDescription = `Move Adjacent to ${target.name}`;
      if (!tile) return { type: "error", message: `No reachable tile is adjacent to ${target.name}.` };
    } else if (c.wantsToward && target) {
      tile = findCloserTile(state, actor, target);
      moveDescription = `Move Toward ${target.name}`;
      if (!tile) return { type: "error", message: `${actor.name} cannot move any closer to ${target.name}.` };
    } else if (target) {
      tile = findAttackPositionTile(state, actor, target);
      moveDescription = "Move to Attack Position";
      if (!tile) return { type: "error", message: `No reachable position has line of sight to ${target.name} within weapon range.` };
    } else {
      return { type: "error", message: 'Move where? Try mentioning a landmark, e.g. "move behind the pillar".' };
    }
    if (tile && !(tile.x === actor.x && tile.y === actor.y)) {
      steps.push({ kind: "move", dest: { x: tile.x, y: tile.y }, description: moveDescription });
    }
  }

  if (c.wantsAttack && target) {
    steps.push({ kind: "attack", targetId: target.id, description: `Attack ${target.name}` });
  }

  if (steps.length === 0) {
    return { type: "error", message: `Could not interpret "${raw}". Try describing a move and/or an attack.` };
  }

  const summary = `${actor.name}\n` + steps.map((s) => `→ ${s.description}`).join("\n");
  return { type: "proposal", steps, summary };
}

// ---------------------------------------------------------------------------
// PROPOSAL LIFECYCLE — revalidate-then-execute, atomically
// A proposal is a *snapshot of intent*, never permission to skip the rules
// engine. Every step is re-checked against the CURRENT state right before
// execution; if anything has changed (target moved, died, action already
// used), nothing is applied — see executeProposalSteps below.
// ---------------------------------------------------------------------------
function revalidateProposal(state, actorId, steps) {
  let sim = cloneState(state);
  const checks = [];
  for (const step of steps) {
    if (step.kind === "move") {
      const v = validateMove(sim, actorId, step.dest);
      checks.push({ step, valid: v.valid, reason: v.reason, code: v.code });
      if (v.valid) {
        const a = sim.combatants[actorId];
        a.x = step.dest.x;
        a.y = step.dest.y;
        a.moveRemaining -= v.cost;
      }
    } else if (step.kind === "attack") {
      const v = validateAttack(sim, actorId, step.targetId);
      checks.push({ step, valid: v.valid, reason: v.reason, code: v.code, cover: v.cover });
    } else if (step.kind === "ability") {
      const v = validateAbility(sim, actorId, step.abilityId, step.targetId);
      checks.push({ step, valid: v.valid, reason: v.reason, code: v.code });
    } else if (step.kind === "endTurn") {
      checks.push({ step, valid: true, reason: null, code: "OK" });
    }
  }
  return checks;
}

// Executes a pre-validated sequence atomically: if any step turns out to be
// invalid when it is actually applied (should not happen after a fresh
// revalidateProposal, but the check stays as a safety net), the ORIGINAL
// input state is returned untouched — no partial mutation is possible.
function executeProposalSteps(state, actorId, steps, rng) {
  let cur = state;
  const events = [];
  let lastAttackResult = null;
  let lastAbilityResult = null;
  for (const step of steps) {
    if (step.kind === "move") {
      const res = executeMove(cur, actorId, step.dest);
      if (!res.ok) return { ok: false, state, events: res.events };
      cur = res.state;
      events.push(...res.events);
    } else if (step.kind === "attack") {
      const res = executeAttack(cur, actorId, step.targetId, rng);
      if (!res.ok) return { ok: false, state, events: res.events };
      cur = res.state;
      events.push(...res.events);
      lastAttackResult = res.result;
    } else if (step.kind === "ability") {
      const res = executeAbility(cur, actorId, step.abilityId, step.targetId, rng);
      if (!res.ok) return { ok: false, state, events: res.events };
      cur = res.state;
      events.push(...res.events);
      lastAbilityResult = res.result;
    }
    // 'endTurn' steps are handled by the caller (turn cycling + enemy AI
    // live outside this pure engine call) — see handleEndTurn / approveProposal.
  }
  return { ok: true, state: cur, events, lastAttackResult, lastAbilityResult };
}

// ---------------------------------------------------------------------------
// UI PRIMITIVES
// ---------------------------------------------------------------------------
const FONT_IMPORT = `@import url('https://fonts.googleapis.com/css2?family=Cinzel:wght@500;700&family=EB+Garamond:ital,wght@0,400;0,600;1,400&display=swap');`;

function ClassIcon({ icon, size = 16, className = "" }) {
  if (icon === "sword") return <Sword size={size} className={className} />;
  if (icon === "wand") return <Wand2 size={size} className={className} />;
  return <Shield size={size} className={className} />;
}

function HpBar({ hp, maxHp }) {
  const pct = Math.max(0, Math.min(100, (hp / maxHp) * 100));
  const color = pct > 50 ? "#6b8f4e" : pct > 20 ? "#c9962c" : "#8b2e2e";
  return (
    <div style={{ background: "#241a12", borderRadius: 4, height: 8, overflow: "hidden", border: "1px solid #5a4326" }}>
      <div style={{ width: pct + "%", height: "100%", background: color, transition: "width .4s ease" }} />
    </div>
  );
}

function CharacterPanel({ c, isCurrent, isSelected, onSelect }) {
  return (
    <button
      onClick={() => onSelect(c.id)}
      disabled={!c.alive}
      style={{
        textAlign: "left",
        width: "100%",
        background: isSelected ? "#4a3620" : "#2e2216",
        border: isCurrent ? "1.5px solid #c9a227" : "1px solid #5a4326",
        borderRadius: 8,
        padding: "8px 10px",
        marginBottom: 8,
        cursor: c.alive ? "pointer" : "default",
        opacity: c.alive ? 1 : 0.45,
        boxShadow: isCurrent ? "0 0 10px rgba(201,162,39,0.35)" : "none",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <ClassIcon icon={c.icon} size={14} className="" />
          <span style={{ fontFamily: "Cinzel, serif", fontSize: 13, color: "#e8dcc0", letterSpacing: 0.3 }}>
            {c.name}
          </span>
        </div>
        <span style={{ fontFamily: "'EB Garamond', serif", fontSize: 11, color: "#a89468" }}>{c.cls}</span>
      </div>
      <div style={{ marginTop: 6, fontFamily: "'EB Garamond', serif", fontSize: 11, color: "#c9bd9e" }}>
        HP {c.hp}/{c.maxHp}
      </div>
      <HpBar hp={c.hp} maxHp={c.maxHp} />
      <div style={{ marginTop: 4, fontFamily: "'EB Garamond', serif", fontSize: 10.5, color: "#8a795a", display: "flex", justifyContent: "space-between" }}>
        <span>
          <Footprints size={10} style={{ verticalAlign: -1, marginRight: 3 }} />
          {c.moveRemaining}/{c.moveMax}
        </span>
        <span>AC {c.ac}</span>
        <span>{c.actionUsed ? "Action used" : "Action ready"}</span>
      </div>
    </button>
  );
}

// ---------------------------------------------------------------------------
// MAIN APP
// ---------------------------------------------------------------------------
export default function IntelligentTabletop() {
  const seedRef = useRef(1337);
  const encounterIdRef = useRef("crypt");
  const rngRef = useRef(null);
  const [gameState, setGameState] = useState(() => {
    const fresh = buildEncounter(encounterIdRef.current, seedRef.current);
    const rng = mulberry32(seedRef.current + 9999); // separate stream for combat rolls
    rngRef.current = rng;
    return resolveLeadingEnemyTurns(fresh, rng);
  });
  const [mode, setMode] = useState("traditional"); // traditional | assisted | adventure
  const [selectedId, setSelectedId] = useState(null);
  const [pendingAction, setPendingAction] = useState(null); // 'move' | 'attack' | null (traditional mode)
  const [lastRoll, setLastRoll] = useState(null);
  const [textInput, setTextInput] = useState("");
  const [proposal, setProposal] = useState(null); // {steps, summary, checks, actorId, text, stale}
  const [infoResult, setInfoResult] = useState(null); // {type:'query'|'inspect', ...} — read-only, non-mutating
  const [banner, setBanner] = useState(null); // transient messages only (errors, "situation changed", etc.)

  const currentActorId = gameState.turnOrder[gameState.turnIndex];
  const currentActor = gameState.combatants[currentActorId];
  const isPlayerTurn = currentActor && currentActor.type === "pc";
  const selected = selectedId ? gameState.combatants[selectedId] : null;

  // Auto-select the current PC actor whenever the active actor changes.
  // Keying on [currentActorId, isPlayerTurn] means this fires exactly once per
  // turn handover — not on every render — so a user can still click an enemy
  // panel mid-turn without immediately losing that selection, while a new
  // player turn always starts with the right character pre-selected.
  useEffect(() => {
    if (isPlayerTurn) {
      setSelectedId(currentActorId);
    }
  }, [currentActorId, isPlayerTurn]);

  // Derived straight from gameState so it's correct regardless of which code
  // path produced that state — including the lazy useState initializer and
  // newEncounter(), where calling a setter isn't an option.
  const encounterStatus = useMemo(() => checkEncounterStatus(gameState), [gameState]);
  const encounterBanner =
    encounterStatus === "victory"
      ? `Victory! The ${gameState.encounterName} encounter is cleared.`
      : encounterStatus === "defeat"
      ? `Defeat. The party has fallen in the ${gameState.encounterName}.`
      : null;

  const reachable = useMemo(() => {
    if (!isPlayerTurn || pendingAction !== "move" || !selected || selected.id !== currentActorId) return [];
    const occ = occupiedSet(gameState.combatants, selected.id);
    return reachableTiles(gameState.map, { x: selected.x, y: selected.y }, selected.moveRemaining, occ);
  }, [gameState, pendingAction, selected, currentActorId, isPlayerTurn]);

  const attackPreview = useMemo(() => {
    if (!isPlayerTurn || pendingAction !== "attack" || !selected || selected.id !== currentActorId) return {};
    const map = {};
    Object.values(gameState.combatants).forEach((c) => {
      if (c.type === "enemy" && c.alive) {
        map[c.id] = validateAttack(gameState, selected.id, c.id);
      }
    });
    return map;
  }, [gameState, pendingAction, selected, currentActorId, isPlayerTurn]);

  const pendingAbilityId = typeof pendingAction === "string" && pendingAction.startsWith("ability:") ? pendingAction.slice(8) : null;
  const abilityPreview = useMemo(() => {
    if (!isPlayerTurn || !pendingAbilityId || !selected || selected.id !== currentActorId) return {};
    const map = {};
    Object.values(gameState.combatants).forEach((c) => {
      if (c.alive) map[c.id] = validateAbility(gameState, selected.id, pendingAbilityId, c.id);
    });
    return map;
  }, [gameState, pendingAbilityId, selected, currentActorId, isPlayerTurn]);

  function pushLogAndSet(next) {
    setGameState(next);
  }

  function afterPlayerAction(next) {
    pushLogAndSet(next);
  }

  function doEndTurnAndMaybeAI(state) {
    const next = endTurn(state);
    return resolveLeadingEnemyTurns(next, rngRef.current);
  }

  const handleSelectToken = useCallback(
    (id) => {
      setSelectedId(id);
      setPendingAction(null);
      setProposal(null);
    },
    []
  );

  function handleTileClick(x, y) {
    if (mode !== "traditional" || pendingAction !== "move" || !selected) return;
    const res = executeMove(gameState, selected.id, { x, y });
    if (res.ok) {
      setPendingAction(null);
      afterPlayerAction(res.state);
    } else {
      setBanner(res.events[0]);
      setTimeout(() => setBanner(null), 2200);
    }
  }

  function handleAttackTarget(targetId) {
    if (mode !== "traditional" || pendingAction !== "attack" || !selected) return;
    const v = attackPreview[targetId];
    if (!v || !v.valid) {
      // Surface the real rules-engine reason. Do NOT mutate state, do NOT
      // consume the action, and stay in Attack mode so the player can pick
      // a different target.
      const targetName = gameState.combatants[targetId] ? gameState.combatants[targetId].name : "That target";
      setBanner(`${targetName} cannot be attacked: ${v ? v.reason : "Unknown target."}`);
      setTimeout(() => setBanner(null), 2800);
      return;
    }
    const res = executeAttack(gameState, selected.id, targetId, rngRef.current);
    setPendingAction(null);
    if (res.ok) {
      setLastRoll({ kind: "attack", actor: selected.name, ...res.result, targetName: gameState.combatants[targetId].name });
    }
    afterPlayerAction(res.state);
  }

  function handleAbilityTarget(abilityId, targetId) {
    if (mode !== "traditional" || pendingAction !== "ability:" + abilityId || !selected) return;
    const v = validateAbility(gameState, selected.id, abilityId, targetId);
    if (!v.valid) {
      // Same fix as handleAttackTarget: real reason, no mutation, no
      // consumed action, stay in ability-targeting mode.
      const targetName = gameState.combatants[targetId] ? gameState.combatants[targetId].name : "That target";
      setBanner(`${ABILITY_DEFS[abilityId].name} cannot target ${targetName}: ${v.reason}`);
      setTimeout(() => setBanner(null), 2800);
      return;
    }
    const res = executeAbility(gameState, selected.id, abilityId, targetId, rngRef.current);
    setPendingAction(null);
    if (res.ok) {
      setLastRoll({ kind: "ability", actor: selected.name, abilityName: ABILITY_DEFS[abilityId].name, ...res.result });
    }
    afterPlayerAction(res.state);
  }

  function handleEndTurn() {
    const next = doEndTurnAndMaybeAI(gameState);
    setPendingAction(null);
    afterPlayerAction(next);
  }

  // Both Assisted and Adventure modes funnel through the same interpreter
  // and the same validation/execution engine — there is no separate combat
  // logic per mode. `mode` only changes placeholder copy in the UI.
  function runIntent() {
    if (!isPlayerTurn) return;
    setInfoResult(null);
    const parsed = parseIntent(textInput, gameState, currentActorId);
    if (parsed.type === "error") {
      setBanner(parsed.message);
      setTimeout(() => setBanner(null), 2800);
      return;
    }
    if (parsed.type === "query" || parsed.type === "inspect") {
      setProposal(null);
      setInfoResult(parsed);
      return;
    }
    // type === "proposal"
    const checks = revalidateProposal(gameState, currentActorId, parsed.steps);
    setProposal({ steps: parsed.steps, summary: parsed.summary, checks, actorId: currentActorId, text: textInput, stale: false });
  }

  function approveProposal() {
    if (!proposal) return;

    // End Turn proposals route through the same turn-cycling + AI flow as
    // the Traditional Mode "End Turn" button — no duplicate logic.
    if (proposal.steps.length === 1 && proposal.steps[0].kind === "endTurn") {
      const next = doEndTurnAndMaybeAI(gameState);
      setProposal(null);
      setTextInput("");
      afterPlayerAction(next);
      return;
    }

    // Revalidate against the CURRENT state right before execution. A
    // proposal is a snapshot of intent, not permission to skip the rules
    // engine — if anything has changed since it was drafted, reject it.
    const freshChecks = revalidateProposal(gameState, proposal.actorId, proposal.steps);
    if (!freshChecks.every((c) => c.valid)) {
      setProposal({ ...proposal, checks: freshChecks, stale: true });
      setBanner("The situation has changed since this was proposed.");
      setTimeout(() => setBanner(null), 2800);
      return;
    }

    // Atomic: either every step applies, or none do.
    const exec = executeProposalSteps(gameState, proposal.actorId, proposal.steps, rngRef.current);
    if (!exec.ok) {
      setBanner(exec.events[0] || "That action could not be resolved.");
      setTimeout(() => setBanner(null), 2800);
      setProposal(null);
      return;
    }
    if (exec.lastAttackResult) {
      const atkStep = proposal.steps.find((s) => s.kind === "attack");
      setLastRoll({ kind: "attack", actor: exec.state.combatants[proposal.actorId].name, targetName: exec.state.combatants[atkStep.targetId].name, ...exec.lastAttackResult });
    } else if (exec.lastAbilityResult) {
      const abilityStep = proposal.steps.find((s) => s.kind === "ability");
      setLastRoll({ kind: "ability", actor: exec.state.combatants[proposal.actorId].name, abilityName: ABILITY_DEFS[abilityStep.abilityId].name, ...exec.lastAbilityResult });
    }
    setProposal(null);
    setTextInput("");
    afterPlayerAction(exec.state);
  }

  function recalculateProposal() {
    if (!proposal) return;
    const parsed = parseIntent(proposal.text, gameState, proposal.actorId);
    if (parsed.type !== "proposal") {
      setProposal(null);
      setBanner(parsed.message || "That is no longer possible.");
      setTimeout(() => setBanner(null), 2800);
      return;
    }
    const checks = revalidateProposal(gameState, proposal.actorId, parsed.steps);
    setProposal({ steps: parsed.steps, summary: parsed.summary, checks, actorId: proposal.actorId, text: proposal.text, stale: false });
  }



  function cancelProposal() {
    setProposal(null);
  }

  function cancelInfo() {
    setInfoResult(null);
  }

  function newEncounter(encounterId) {
    if (encounterId) encounterIdRef.current = encounterId;
    seedRef.current += 1;
    const fresh = buildEncounter(encounterIdRef.current, seedRef.current);
    const rng = mulberry32(seedRef.current + 9999);
    rngRef.current = rng;
    setGameState(resolveLeadingEnemyTurns(fresh, rng));
    setSelectedId(null);
    setPendingAction(null);
    setProposal(null);
    setInfoResult(null);
    setLastRoll(null);
    setBanner(null);
    setMode("traditional");
  }

  // ---- grid rendering helpers ----
  const reachSet = useMemo(() => new Set(reachable.map((t) => key(t.x, t.y))), [reachable]);
  const tokensByTile = useMemo(() => {
    const m = {};
    Object.values(gameState.combatants).forEach((c) => {
      if (c.alive) m[key(c.x, c.y)] = c;
    });
    return m;
  }, [gameState]);

  const cellPx = 52;

  return (
    <div
      style={{
        fontFamily: "'EB Garamond', serif",
        minHeight: "100vh",
        background:
          "radial-gradient(1200px 600px at 20% -10%, #2c2013 0%, #1a130c 55%, #100c07 100%)",
        color: "#e8dcc0",
        padding: 18,
      }}
    >
      <style>{FONT_IMPORT}</style>

      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14, flexWrap: "wrap", gap: 10 }}>
        <div>
          <div style={{ fontFamily: "Cinzel, serif", fontSize: 22, letterSpacing: 1, color: "#e8dcc0" }}>
            {gameState.encounterName}
          </div>
          <div style={{ fontSize: 12.5, color: "#a89468" }}>
            Round {gameState.round} · {currentActor ? `${currentActor.name}'s turn` : ""}
          </div>
        </div>
        <div style={{ display: "flex", gap: 6, background: "#241a12", border: "1px solid #5a4326", borderRadius: 10, padding: 4 }}>
          {[
            { id: "traditional", label: "Traditional" },
            { id: "assisted", label: "Assisted" },
            { id: "adventure", label: "Adventure" },
          ].map((m) => (
            <button
              key={m.id}
              onClick={() => {
                setMode(m.id);
                setPendingAction(null);
                setProposal(null);
                setInfoResult(null);
              }}
              style={{
                fontFamily: "Cinzel, serif",
                fontSize: 11.5,
                letterSpacing: 0.5,
                padding: "7px 14px",
                borderRadius: 7,
                border: "none",
                cursor: "pointer",
                background: mode === m.id ? "#c9a227" : "transparent",
                color: mode === m.id ? "#241a12" : "#c9bd9e",
                transition: "all .15s ease",
              }}
            >
              {m.label}
            </button>
          ))}
        </div>
      </div>

      <div style={{ display: "flex", gap: 6, marginBottom: 14 }}>
        {Object.values(ENCOUNTER_DEFS).map((enc) => (
          <button
            key={enc.id}
            onClick={() => newEncounter(enc.id)}
            style={{
              fontFamily: "'EB Garamond', serif",
              fontSize: 11.5,
              padding: "5px 12px",
              borderRadius: 6,
              border: "1px solid #5a4326",
              cursor: "pointer",
              background: gameState.encounterId === enc.id ? "#4a3620" : "transparent",
              color: gameState.encounterId === enc.id ? "#e8dcc0" : "#8a795a",
            }}
          >
            {enc.name}
          </button>
        ))}
      </div>

      {banner && (
        <div style={{ marginBottom: 10, padding: "8px 12px", background: "#3b2418", border: "1px solid #8b2e2e", borderRadius: 8, fontSize: 13, color: "#e8b8a8" }}>
          {banner}
        </div>
      )}

      {encounterStatus !== "ongoing" && (
        <div style={{ marginBottom: 10, padding: "12px 16px", background: encounterStatus === "victory" ? "#243b1e" : "#3b1e1e", border: `1px solid ${encounterStatus === "victory" ? "#4c6b3f" : "#8b2e2e"}`, borderRadius: 8, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span style={{ fontFamily: "Cinzel, serif", fontSize: 15 }}>{encounterBanner}</span>
          <button onClick={() => newEncounter()} style={{ fontFamily: "Cinzel, serif", fontSize: 12, background: "#c9a227", color: "#241a12", border: "none", borderRadius: 6, padding: "6px 12px", cursor: "pointer" }}>
            New Encounter
          </button>
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "220px 1fr 260px", gap: 16, alignItems: "start" }}>
        {/* LEFT: character panels */}
        <div>
          <div style={{ fontFamily: "Cinzel, serif", fontSize: 12, color: "#a89468", marginBottom: 8, letterSpacing: 1 }}>PARTY</div>
          {Object.values(gameState.combatants)
            .filter((c) => c.type === "pc")
            .map((c) => (
              <CharacterPanel key={c.id} c={c} isCurrent={c.id === currentActorId} isSelected={c.id === selectedId} onSelect={handleSelectToken} />
            ))}

          {/* Action controls sit immediately below the PC panels so they are
              always visible without scrolling, regardless of how many enemy
              panels appear below. */}
          {selected && mode === "traditional" && selected.id === currentActorId && isPlayerTurn && (
            <div style={{ marginTop: 10, display: "flex", gap: 6, flexWrap: "wrap" }}>
              <button
                onClick={() => setPendingAction(pendingAction === "move" ? null : "move")}
                style={actionBtnStyle(pendingAction === "move")}
              >
                <Footprints size={13} /> Move
              </button>
              <button
                onClick={() => setPendingAction(pendingAction === "attack" ? null : "attack")}
                disabled={selected.actionUsed}
                style={{ ...actionBtnStyle(pendingAction === "attack"), opacity: selected.actionUsed ? 0.4 : 1 }}
              >
                <Sword size={13} /> Attack
              </button>
              {(selected.abilities || []).map((abilityId) => (
                <button
                  key={abilityId}
                  onClick={() => setPendingAction(pendingAction === "ability:" + abilityId ? null : "ability:" + abilityId)}
                  disabled={selected.actionUsed}
                  style={{ ...actionBtnStyle(pendingAction === "ability:" + abilityId), opacity: selected.actionUsed ? 0.4 : 1 }}
                >
                  <Sparkles size={13} /> {ABILITY_DEFS[abilityId].name}
                </button>
              ))}
            </div>
          )}
          {isPlayerTurn && (
            <button onClick={handleEndTurn} style={{ marginTop: 10, width: "100%", fontFamily: "Cinzel, serif", fontSize: 12, background: "transparent", color: "#c9a227", border: "1px solid #5a4326", borderRadius: 7, padding: "8px 0", cursor: "pointer" }}>
              End Turn
            </button>
          )}

          <div style={{ fontFamily: "Cinzel, serif", fontSize: 12, color: "#a89468", margin: "14px 0 8px", letterSpacing: 1 }}>ENEMIES</div>
          {Object.values(gameState.combatants)
            .filter((c) => c.type === "enemy")
            .map((c) => (
              <CharacterPanel key={c.id} c={c} isCurrent={c.id === currentActorId} isSelected={c.id === selectedId} onSelect={handleSelectToken} />
            ))}
        </div>

        {/* CENTER: tabletop */}
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
          <div
            style={{
              background: "linear-gradient(160deg, #4a3320, #2c1e12)",
              border: "10px solid #2c1e12",
              borderRadius: 12,
              padding: 16,
              boxShadow: "0 12px 34px rgba(0,0,0,0.55), inset 0 0 40px rgba(0,0,0,0.4)",
              position: "relative",
            }}
          >
            <div style={{ position: "absolute", top: 8, left: 8, width: 18, height: 18, border: "2px solid #c9a227", borderRight: "none", borderBottom: "none", opacity: 0.7 }} />
            <div style={{ position: "absolute", top: 8, right: 8, width: 18, height: 18, border: "2px solid #c9a227", borderLeft: "none", borderBottom: "none", opacity: 0.7 }} />
            <div style={{ position: "absolute", bottom: 8, left: 8, width: 18, height: 18, border: "2px solid #c9a227", borderRight: "none", borderTop: "none", opacity: 0.7 }} />
            <div style={{ position: "absolute", bottom: 8, right: 8, width: 18, height: 18, border: "2px solid #c9a227", borderLeft: "none", borderTop: "none", opacity: 0.7 }} />

            <div
              style={{
                display: "grid",
                gridTemplateColumns: `repeat(${gameState.map.width}, ${cellPx}px)`,
                gridTemplateRows: `repeat(${gameState.map.height}, ${cellPx}px)`,
                gap: 2,
              }}
            >
              {Array.from({ length: gameState.map.height }).map((_, y) =>
                Array.from({ length: gameState.map.width }).map((__, x) => {
                  const wall = isWall(gameState.map, x, y);
                  const pillar = isPillar(gameState.map, x, y);
                  const tok = tokensByTile[key(x, y)];
                  const isReach = reachSet.has(key(x, y));
                  let bg = "#c9bd9e";
                  if (wall) bg = "#1c140c";
                  else bg = ((x + y) % 2 === 0) ? "#d8cba6" : "#ccbe97";
                  return (
                    <div
                      key={key(x, y)}
                      onClick={() => handleTileClick(x, y)}
                      style={{
                        width: cellPx,
                        height: cellPx,
                        background: bg,
                        border: wall ? "1px solid #0d0906" : "1px solid rgba(90,67,38,0.35)",
                        borderRadius: 3,
                        position: "relative",
                        cursor: isReach ? "pointer" : "default",
                        boxShadow: isReach ? "inset 0 0 0 2px #6b8f4e" : "none",
                        backgroundImage: !wall && !pillar ? "repeating-linear-gradient(90deg, rgba(0,0,0,0.03) 0 2px, transparent 2px 8px)" : "none",
                      }}
                    >
                      {pillar && (
                        <div style={{ position: "absolute", inset: 5, borderRadius: "50%", background: "radial-gradient(circle at 35% 30%, #7a6a52, #382c1c)", boxShadow: "0 3px 6px rgba(0,0,0,0.5)" }} />
                      )}
                      {tok && (
                        <div
                          onClick={(e) => {
                            e.stopPropagation();
                            if (mode === "traditional" && pendingAction === "attack" && tok.type === "enemy") {
                              handleAttackTarget(tok.id);
                            } else if (mode === "traditional" && pendingAbilityId) {
                              handleAbilityTarget(pendingAbilityId, tok.id);
                            } else {
                              handleSelectToken(tok.id);
                            }
                          }}
                          style={{
                            position: "absolute",
                            inset: 4,
                            borderRadius: "50%",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            background: tok.type === "pc" ? "radial-gradient(circle at 35% 30%, #3d5a86, #1c2c40)" : "radial-gradient(circle at 35% 30%, #5a7a3d, #263c1c)",
                            border: tok.id === selectedId ? "2px solid #c9a227" : "2px solid rgba(0,0,0,0.4)",
                            boxShadow:
                              mode === "traditional" && pendingAction === "attack" && tok.type === "enemy" && attackPreview[tok.id] && attackPreview[tok.id].valid
                                ? "0 0 0 3px rgba(139,46,46,0.6)"
                                : mode === "traditional" && pendingAbilityId && abilityPreview[tok.id] && abilityPreview[tok.id].valid
                                ? "0 0 0 3px rgba(76,107,63,0.7)"
                                : "0 2px 5px rgba(0,0,0,0.5)",
                            cursor: "pointer",
                          }}
                          title={tok.name}
                        >
                          <ClassIcon icon={tok.icon} size={18} className="" />
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          </div>

          {lastRoll && lastRoll.kind === "attack" && (
            <div style={{ marginTop: 14, background: "#2e2216", border: "1px solid #c9a227", borderRadius: 10, padding: "10px 16px", display: "flex", alignItems: "center", gap: 10 }}>
              <Dice5 size={20} color="#c9a227" />
              <div style={{ fontSize: 13 }}>
                <b style={{ fontFamily: "Cinzel, serif", fontWeight: 500 }}>{lastRoll.actor}</b> vs {lastRoll.targetName}: d20 {lastRoll.d20} + mod ={" "}
                <b>{lastRoll.atkTotal}</b> vs AC {lastRoll.effectiveAc} — {lastRoll.hit ? (lastRoll.crit ? "CRITICAL HIT" : "HIT") : "MISS"}
                {lastRoll.hit ? `, ${lastRoll.dmgTotal} dmg` : ""}
              </div>
            </div>
          )}
          {lastRoll && lastRoll.kind === "ability" && lastRoll.type === "heal" && (
            <div style={{ marginTop: 14, background: "#1e2e1a", border: "1px solid #4c6b3f", borderRadius: 10, padding: "10px 16px", display: "flex", alignItems: "center", gap: 10 }}>
              <Sparkles size={20} color="#8fb56f" />
              <div style={{ fontSize: 13 }}>
                <b style={{ fontFamily: "Cinzel, serif", fontWeight: 500 }}>{lastRoll.actor}</b> uses {lastRoll.abilityName} on {lastRoll.targetName}: roll {lastRoll.roll}
                {" "}→ <b>+{lastRoll.healed}</b> HP{lastRoll.healed < lastRoll.amount ? " (capped at max)" : ""}
              </div>
            </div>
          )}
          {lastRoll && lastRoll.kind === "ability" && lastRoll.type === "damage" && (
            <div style={{ marginTop: 14, background: "#2e1a1a", border: "1px solid #8b2e2e", borderRadius: 10, padding: "10px 16px", display: "flex", alignItems: "center", gap: 10 }}>
              <Sparkles size={20} color="#d97a5a" />
              <div style={{ fontSize: 13 }}>
                <b style={{ fontFamily: "Cinzel, serif", fontWeight: 500 }}>{lastRoll.actor}</b> casts {lastRoll.abilityName} at {lastRoll.targetName}: roll {lastRoll.roll}
                {" "}→ <b>{lastRoll.amount}</b> dmg{lastRoll.dead ? ` — ${lastRoll.targetName} has fallen` : ` (HP ${lastRoll.targetHp})`}
              </div>
            </div>
          )}
        </div>

        {/* RIGHT: initiative + log */}
        <div>
          <div style={{ fontFamily: "Cinzel, serif", fontSize: 12, color: "#a89468", marginBottom: 8, letterSpacing: 1 }}>INITIATIVE</div>
          <div style={{ background: "#241a12", border: "1px solid #5a4326", borderRadius: 8, padding: 8, marginBottom: 14 }}>
            {gameState.turnOrder.map((id, i) => {
              const c = gameState.combatants[id];
              return (
                <div
                  key={id}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                    padding: "4px 6px",
                    borderRadius: 5,
                    background: i === gameState.turnIndex ? "#4a3620" : "transparent",
                    opacity: c.alive ? 1 : 0.4,
                    textDecoration: c.alive ? "none" : "line-through",
                  }}
                >
                  {i === gameState.turnIndex && <ChevronRight size={12} color="#c9a227" />}
                  <ClassIcon icon={c.icon} size={12} className="" />
                  <span style={{ fontSize: 12 }}>{c.name}</span>
                </div>
              );
            })}
          </div>

          <div style={{ fontFamily: "Cinzel, serif", fontSize: 12, color: "#a89468", marginBottom: 8, letterSpacing: 1, display: "flex", alignItems: "center", gap: 5 }}>
            <ScrollText size={13} /> SESSION LOG
          </div>
          <div style={{ background: "#241a12", border: "1px solid #5a4326", borderRadius: 8, padding: 10, height: 320, overflowY: "auto", fontSize: 12, lineHeight: 1.5 }}>
            {gameState.log.map((line, i) => (
              <div key={i} style={{ color: line.startsWith("—") ? "#c9a227" : "#c9bd9e", fontStyle: line.startsWith("—") ? "italic" : "normal", marginBottom: 3 }}>
                {line}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Assisted / Adventure input bar */}
      {mode !== "traditional" && (
        <div style={{ marginTop: 16, maxWidth: 720, marginLeft: "auto", marginRight: "auto" }}>
          <div style={{ display: "flex", gap: 8 }}>
            <Sparkles size={16} color="#c9a227" style={{ marginTop: 10 }} />
            <input
              value={textInput}
              onChange={(e) => setTextInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") runIntent();
              }}
              placeholder={
                !isPlayerTurn
                  ? "Waiting for enemy turn..."
                  : mode === "assisted"
                  ? `${currentActor.name}: "move next to ${exampleTargetPhrase(gameState)} and attack"`
                  : `${currentActor.name}: "I duck behind the pillar and attack ${exampleTargetPhrase(gameState)}"`
              }
              disabled={!isPlayerTurn}
              style={{
                flex: 1,
                background: "#2e2216",
                border: "1px solid #5a4326",
                borderRadius: 8,
                padding: "10px 12px",
                color: "#e8dcc0",
                fontFamily: "'EB Garamond', serif",
                fontSize: 14,
              }}
            />
            <button
              onClick={runIntent}
              disabled={!isPlayerTurn}
              style={{ fontFamily: "Cinzel, serif", fontSize: 12, background: "#c9a227", color: "#241a12", border: "none", borderRadius: 8, padding: "0 16px", cursor: "pointer" }}
            >
              Interpret
            </button>
          </div>
          <div style={{ fontSize: 10.5, color: "#8a795a", marginTop: 5, paddingLeft: 24 }}>
            Try: "attack {exampleTargetPhrase(gameState)}" · "move next to {exampleTargetPhrase(gameState)} and attack" · "can I attack {exampleTargetPhrase(gameState)}?" · "end my turn"
          </div>

          {proposal && (
            <div
              style={{
                marginTop: 12,
                background: "linear-gradient(180deg, #ece0bd, #ddcf9f)",
                color: "#2b2016",
                borderRadius: 10,
                padding: 16,
                boxShadow: "0 10px 30px rgba(0,0,0,0.5)",
                border: proposal.stale ? "1px solid #8b2e2e" : "1px solid #a8925a",
              }}
            >
              <div style={{ fontFamily: "Cinzel, serif", fontSize: 12, letterSpacing: 1, marginBottom: 4, color: "#6b4f24" }}>
                PROPOSED ACTION
              </div>
              <div style={{ fontSize: 12.5, fontStyle: "italic", color: "#5a4a2e", marginBottom: 10 }}>“{proposal.text}”</div>

              {proposal.stale && (
                <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 10, fontSize: 12.5, color: "#8b2e2e" }}>
                  <X size={13} /> The situation has changed since this was proposed.
                </div>
              )}

              {proposal.checks.map((c, i) => (
                <div key={i} style={{ display: "flex", alignItems: "flex-start", gap: 8, marginBottom: 6, fontSize: 13.5 }}>
                  <span style={{ fontFamily: "Cinzel, serif", fontSize: 11, color: "#6b4f24", minWidth: 14 }}>{i + 1}.</span>
                  {c.valid ? <Check size={14} color="#4c6b3f" style={{ marginTop: 1 }} /> : <X size={14} color="#8b2e2e" style={{ marginTop: 1 }} />}
                  <span>
                    {c.step.kind === "move"
                      ? c.step.description || `Move to (${c.step.dest.x}, ${c.step.dest.y})`
                      : c.step.kind === "attack"
                      ? `${c.step.description || `Attack ${gameState.combatants[c.step.targetId].name}`}${c.cover ? " (target has cover)" : ""}`
                      : c.step.kind === "ability"
                      ? c.step.description
                      : "End Turn"}
                    {!c.valid && <span style={{ color: "#8b2e2e", fontSize: 12 }}> — {c.reason}</span>}
                  </span>
                </div>
              ))}

              <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
                {proposal.stale ? (
                  <button
                    onClick={recalculateProposal}
                    style={{ fontFamily: "Cinzel, serif", fontSize: 12, background: "#c9a227", color: "#241a12", border: "none", borderRadius: 6, padding: "8px 16px", cursor: "pointer" }}
                  >
                    Recalculate
                  </button>
                ) : (
                  <button
                    onClick={approveProposal}
                    disabled={proposal.checks.some((c) => !c.valid)}
                    style={{
                      fontFamily: "Cinzel, serif",
                      fontSize: 12,
                      background: proposal.checks.some((c) => !c.valid) ? "#a8a190" : "#4c6b3f",
                      color: "#f4f1e8",
                      border: "none",
                      borderRadius: 6,
                      padding: "8px 16px",
                      cursor: proposal.checks.some((c) => !c.valid) ? "not-allowed" : "pointer",
                    }}
                  >
                    Approve
                  </button>
                )}
                <button onClick={cancelProposal} style={{ fontFamily: "Cinzel, serif", fontSize: 12, background: "transparent", color: "#6b4f24", border: "1px solid #a8925a", borderRadius: 6, padding: "8px 16px", cursor: "pointer" }}>
                  Cancel
                </button>
              </div>
            </div>
          )}

          {infoResult && infoResult.type === "query" && (
            <div
              style={{
                marginTop: 12,
                background: "linear-gradient(180deg, #ece0bd, #ddcf9f)",
                color: "#2b2016",
                borderRadius: 10,
                padding: 16,
                boxShadow: "0 10px 30px rgba(0,0,0,0.5)",
                border: "1px solid #a8925a",
              }}
            >
              <div style={{ fontFamily: "Cinzel, serif", fontSize: 12, letterSpacing: 1, marginBottom: 10, color: "#6b4f24" }}>{infoResult.headline}</div>
              {infoResult.items.map((it, i) => (
                <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6, fontSize: 13.5 }}>
                  {it.ok ? <Check size={14} color="#4c6b3f" /> : <X size={14} color="#8b2e2e" />}
                  <span>{it.label}</span>
                </div>
              ))}
              <div style={{ marginTop: 8, fontFamily: "Cinzel, serif", fontSize: 13, color: infoResult.overall ? "#2f5223" : "#7a2323" }}>
                {infoResult.overall ? "Yes — this is currently valid." : "No — this is not currently valid."}
              </div>
              <button onClick={cancelInfo} style={{ marginTop: 10, fontFamily: "Cinzel, serif", fontSize: 12, background: "transparent", color: "#6b4f24", border: "1px solid #a8925a", borderRadius: 6, padding: "6px 14px", cursor: "pointer" }}>
                Dismiss
              </button>
            </div>
          )}

          {infoResult && infoResult.type === "inspect" && (
            <div
              style={{
                marginTop: 12,
                background: "linear-gradient(180deg, #ece0bd, #ddcf9f)",
                color: "#2b2016",
                borderRadius: 10,
                padding: 16,
                boxShadow: "0 10px 30px rgba(0,0,0,0.5)",
                border: "1px solid #a8925a",
              }}
            >
              <div style={{ fontFamily: "Cinzel, serif", fontSize: 12, letterSpacing: 1, marginBottom: 10, color: "#6b4f24" }}>OPTIONS FROM HERE</div>
              {infoResult.lines.map((line, i) => (
                <div key={i} style={{ fontSize: 13, marginBottom: 4 }}>
                  {line}
                </div>
              ))}
              <button onClick={cancelInfo} style={{ marginTop: 10, fontFamily: "Cinzel, serif", fontSize: 12, background: "transparent", color: "#6b4f24", border: "1px solid #a8925a", borderRadius: 6, padding: "6px 14px", cursor: "pointer" }}>
                Dismiss
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function actionBtnStyle(active) {
  return {
    flex: 1,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 5,
    fontFamily: "Cinzel, serif",
    fontSize: 11.5,
    padding: "8px 0",
    borderRadius: 7,
    border: "1px solid #5a4326",
    background: active ? "#c9a227" : "transparent",
    color: active ? "#241a12" : "#c9bd9e",
    cursor: "pointer",
  };
}
