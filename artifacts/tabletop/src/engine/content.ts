// @ts-nocheck
// ---------------------------------------------------------------------------
// CONTENT — static data definitions, RNG utilities, and encounter factory.
//
// This is the "world data" layer. Nothing here is rules logic. Content
// designers edit this file; the engine and intent parser only ever READ it.
//
// Dependency: none (standalone module).
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// MAP DEFINITIONS — describe terrain. Engine (isWall/isPillar/reachable…)
// only ever reads a `map` object; adding a new map never touches the engine.
// ---------------------------------------------------------------------------
export const MAP_DEFS = {
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
    pillars: [], // open ground — proves cover is optional per-map, not hardcoded
  },
};

// ---------------------------------------------------------------------------
// RNG — seeded, deterministic. mulberry32 returns a stateful thunk so the
// caller advances the same sequence call by call across game events.
// ---------------------------------------------------------------------------
export function mulberry32(seed) {
  let s = seed >>> 0;
  return function () {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function rollDie(sides, rng) {
  return Math.floor(rng() * sides) + 1;
}

// ---------------------------------------------------------------------------
// WEAPON DEFINITIONS
// ---------------------------------------------------------------------------
export const WEAPON_DEFS = {
  longbow:   { id: "longbow",   name: "Longbow",    range: 6, dmgDie: 8,  dmgMod: 2 },
  forceBolt: { id: "forceBolt", name: "Force Bolt", range: 6, dmgDie: 6,  dmgMod: 3 },
  rustyShiv: { id: "rustyShiv", name: "Rusty Shiv", range: 1, dmgDie: 6,  dmgMod: 1 },
  warAxe:    { id: "warAxe",    name: "War Axe",    range: 1, dmgDie: 10, dmgMod: 3 },
};

// ---------------------------------------------------------------------------
// COMBATANT DEFINITIONS — templates; never mutated. Runtime instances are
// produced by createCombatantInstance() below.
// ---------------------------------------------------------------------------
export const COMBATANT_DEFS = {
  fighter: {
    id: "fighter", name: "Aldric", cls: "Fighter", type: "pc",
    icon: "sword", maxHp: 20, ac: 15, atkMod: 5, dexMod: 1, moveMax: 5,
    weaponId: "longbow",
  },
  wizard: {
    id: "wizard", name: "Sable", cls: "Wizard", type: "pc",
    icon: "wand", maxHp: 14, ac: 12, atkMod: 4, dexMod: 2, moveMax: 4,
    weaponId: "forceBolt",
    abilities: ["healingTouch", "fireBolt"],
  },
  goblin: {
    id: "goblin", name: "Goblin", cls: "Goblin", type: "enemy",
    icon: "shield", maxHp: 7, ac: 13, atkMod: 3, dexMod: 2, moveMax: 5,
    weaponId: "rustyShiv",
  },
  orc: {
    id: "orc", name: "Orc", cls: "Orc", type: "enemy",
    icon: "shield", maxHp: 16, ac: 15, atkMod: 4, dexMod: 0, moveMax: 4,
    weaponId: "warAxe",
  },
};

// ---------------------------------------------------------------------------
// ABILITY DEFINITIONS — each ability is entirely described by its data.
// executeAbility() dispatches on effect.type via EFFECT_HANDLERS; it has
// no knowledge of which specific ability it is executing.
// ---------------------------------------------------------------------------
export const ABILITY_DEFS = {
  healingTouch: {
    id: "healingTouch",
    name: "Healing Touch",
    range: 1,           // adjacent or self (distance 0)
    targeting: "ally",  // same type as caster
    effect: { type: "heal", die: 6, mod: 2 },
  },
  fireBolt: {
    id: "fireBolt",
    name: "Fire Bolt",
    range: 4,
    targeting: "enemy",
    requiresLineOfSight: true,
    effect: { type: "damage", die: 8, mod: 1 },
  },
};

// ---------------------------------------------------------------------------
// EFFECT HANDLERS — pure functions dispatched by executeAbility().
// A new ability with a known effect type (heal/damage) needs zero new code
// here. A genuinely new effect shape adds ONE new entry.
// ---------------------------------------------------------------------------
export const EFFECT_HANDLERS = {
  heal: (casterName, abilityName, target, effect, rng) => {
    const roll = rollDie(effect.die, rng);
    const amount = roll + effect.mod;
    const before = target.hp;
    target.hp = Math.min(target.maxHp, target.hp + amount);
    const healed = target.hp - before;
    const log = [
      `${casterName} uses ${abilityName} on ${target.name}. Healing Roll: ${roll} + ${effect.mod} = ${amount}.`,
      `${target.name} HP: ${target.hp}/${target.maxHp}${healed < amount ? " (capped at max)" : ""}`,
    ];
    return { log, result: { type: "heal", roll, amount, healed, targetName: target.name } };
  },
  damage: (casterName, abilityName, target, effect, rng) => {
    const roll = rollDie(effect.die, rng);
    const amount = roll + effect.mod;
    target.hp = Math.max(0, target.hp - amount);
    const log = [
      `${casterName} casts ${abilityName} at ${target.name}. Damage Roll: ${roll} + ${effect.mod} = ${amount}.`,
      `${target.name} takes ${amount} damage. ${target.name} HP: ${target.hp}/${target.maxHp}`,
    ];
    if (target.hp <= 0) {
      target.alive = false;
      log.push(`${target.name} has fallen.`);
    }
    return { log, result: { type: "damage", roll, amount, targetName: target.name, targetHp: target.hp, dead: !target.alive } };
  },
};

// ---------------------------------------------------------------------------
// ENCOUNTER DEFINITIONS — which map, which combatants, where they start.
// ---------------------------------------------------------------------------
export const ENCOUNTER_DEFS = {
  crypt: {
    id: "crypt",
    name: "Ruined Crypt",
    mapId: "crypt",
    players: [
      { defId: "fighter", instanceId: "fighter", x: 1, y: 3 },
      { defId: "wizard",  instanceId: "wizard",  x: 1, y: 2 },
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
// DEFINITION → RUNTIME INSTANCE
// A CombatantDefinition is a template. A runtime instance is one mutable
// occurrence of that template in a specific game state. Multiple instances
// of the same definition mutate completely independently.
// ---------------------------------------------------------------------------
export function createCombatantInstance(defId, instanceId, x, y, displayName) {
  const def = COMBATANT_DEFS[defId];
  if (!def) throw new Error(`Unknown combatant definition: "${defId}"`);
  const weapon = WEAPON_DEFS[def.weaponId];
  if (!weapon) throw new Error(`Unknown weapon "${def.weaponId}" referenced by "${defId}"`);
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

export function rollInitiative(combatants, rng) {
  const rolled = Object.values(combatants).map((c) => ({
    id: c.id,
    total: rollDie(20, rng) + c.dexMod,
  }));
  rolled.sort((a, b) => b.total - a.total);
  return rolled;
}

// The only place content definitions and runtime state meet. Everything
// downstream (validation, execution, turn cycling, intent parser, UI) only
// ever deals with runtime instances.
export function buildEncounter(encounterId, seed) {
  const encounterDef = ENCOUNTER_DEFS[encounterId];
  if (!encounterDef) throw new Error(`Unknown encounter: "${encounterId}"`);
  const map = MAP_DEFS[encounterDef.mapId];
  if (!map) throw new Error(`Unknown map: "${encounterDef.mapId}" (encounter "${encounterId}")`);

  const combatants = {};
  // Number display names when multiple instances share a definition
  // (e.g. three Goblins → "Goblin 1", "Goblin 2", "Goblin 3").
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
    combatants[entry.instanceId] = createCombatantInstance(
      entry.defId, entry.instanceId, entry.x, entry.y, displayName
    );
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
