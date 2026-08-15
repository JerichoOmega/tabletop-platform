// ---------------------------------------------------------------------------
// RULES ENGINE — the authoritative game rules.
//
// Validation functions are pure and read-only (never mutate state).
// Execution functions are the ONLY code permitted to produce new state.
// Turn management and enemy AI use the same validate/execute functions as
// the player — there is no separate fast path.
//
// Dependency: content.ts (ABILITY_DEFS, EFFECT_HANDLERS, rollDie).
// ---------------------------------------------------------------------------

import { ABILITY_DEFS, EFFECT_HANDLERS, rollDie } from "./content";
import type { Combatant, GameState, MapDef } from "./content";

// ---------------------------------------------------------------------------
// VALIDATION RESULT — returned by all validate* functions.
// `valid: false` always includes `reason`; `valid: true` may include metadata.
// `code` is stable/machine-readable; `reason` is human-readable.
// ---------------------------------------------------------------------------
export interface ValidationResult {
  valid: boolean;
  code: string;
  reason?: string;
  /** Distance in movement steps (validateMove success). */
  cost?: number;
  /** Whether the target has cover (validateAttack / validateAbility success). */
  cover?: boolean;
  /** Chebyshev distance to target (validateAttack / validateAbility success). */
  distance?: number;
}

// ---------------------------------------------------------------------------
// EXECUTION RESULT — returned by all execute* functions.
// ---------------------------------------------------------------------------
export interface ExecutionResult {
  state: GameState;
  events: string[];
  ok: boolean;
  code?: string;
  result?: unknown;
}

// ---------------------------------------------------------------------------
// MAP UTILITIES — operate on the `map` field of game state. The functions
// accept any map object, so new maps need no changes here.
// ---------------------------------------------------------------------------
export function isWall(map: MapDef, x: number, y: number): boolean {
  if (x < 0 || y < 0 || x >= map.width || y >= map.height) return true;
  const border = x === 0 || x === map.width - 1 || y === 0 || y === map.height - 1;
  if (border && !(x === map.entrance.x && y === map.entrance.y)) return true;
  return false;
}
export function isPillar(map: MapDef, x: number, y: number): boolean {
  return map.pillars.some((p) => p.x === x && p.y === y);
}
export function isBlocked(map: MapDef, x: number, y: number): boolean {
  return isWall(map, x, y) || isPillar(map, x, y);
}
export function key(x: number, y: number): string {
  return x + "," + y;
}

// ---------------------------------------------------------------------------
// PATHFINDING / LINE OF SIGHT
// ---------------------------------------------------------------------------
export function reachableTiles(
  map: MapDef,
  start: { x: number; y: number },
  maxRange: number,
  occupiedSet: Set<string>,
): { x: number; y: number; dist: number }[] {
  const dist = new Map<string, number>();
  dist.set(key(start.x, start.y), 0);
  const queue: { x: number; y: number }[] = [start];
  const result: { x: number; y: number; dist: number }[] = [];
  while (queue.length) {
    const cur = queue.shift()!;
    const d = dist.get(key(cur.x, cur.y))!;
    if (d > 0) result.push({ x: cur.x, y: cur.y, dist: d });
    if (d >= maxRange) continue;
    for (const [dx, dy] of [[1,0],[-1,0],[0,1],[0,-1]] as [number, number][]) {
      const nx = cur.x + dx, ny = cur.y + dy;
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

export function lineTiles(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
): { x: number; y: number }[] {
  const pts: { x: number; y: number }[] = [];
  const dx = Math.abs(x1 - x0), dy = Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
  let err = dx - dy, x = x0, y = y0;
  while (!(x === x1 && y === y1)) {
    pts.push({ x, y });
    const e2 = 2 * err;
    if (e2 > -dy) { err -= dy; x += sx; }
    if (e2 < dx)  { err += dx; y += sy; }
  }
  pts.push({ x: x1, y: y1 });
  return pts;
}

export function lineOfSight(
  map: MapDef,
  a: { x: number; y: number },
  b: { x: number; y: number },
): { blocked: boolean; cover: boolean } {
  const tiles = lineTiles(a.x, a.y, b.x, b.y).slice(1, -1);
  let blocked = false, cover = false;
  for (const t of tiles) {
    if (isWall(map, t.x, t.y))   blocked = true;
    if (isPillar(map, t.x, t.y)) cover   = true;
  }
  return { blocked, cover };
}

export function chebyshev(
  a: { x: number; y: number },
  b: { x: number; y: number },
): number {
  return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
}

// ---------------------------------------------------------------------------
// VALIDATION — pure read-only. ValidationResult: { valid, code, reason, …metadata }
// `code` is stable/machine-readable; `reason` is human-readable.
// ---------------------------------------------------------------------------
export function occupiedSet(combatants: Record<string, Combatant>, excludeId: string): Set<string> {
  const s = new Set<string>();
  for (const c of Object.values(combatants)) {
    if (c.alive && c.id !== excludeId) s.add(key(c.x, c.y));
  }
  return s;
}

export function validateMove(
  state: GameState,
  actorId: string,
  dest: { x: number; y: number },
): ValidationResult {
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

export function validateAttack(
  state: GameState,
  actorId: string,
  targetId: string,
): ValidationResult {
  const actor  = state.combatants[actorId];
  const target = state.combatants[targetId];
  if (!actor || !target) return { valid: false, code: "TARGET_UNKNOWN", reason: "Unknown combatant." };
  if (!actor.alive)  return { valid: false, code: "ACTOR_DEAD",   reason: `${actor.name} is down.` };
  if (!target.alive) return { valid: false, code: "TARGET_DEAD",  reason: `${target.name} is already defeated.` };
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

export function isValidAbilityTarget(
  targeting: string,
  actor: Combatant,
  target: Combatant,
): boolean {
  if (targeting === "self")  return target.id === actor.id;
  if (targeting === "ally")  return target.type === actor.type;
  if (targeting === "enemy") return target.type !== actor.type;
  if (targeting === "any")   return true;
  return false;
}

export function validateAbility(
  state: GameState,
  actorId: string,
  abilityId: string,
  targetId: string,
): ValidationResult {
  const actor   = state.combatants[actorId];
  const target  = state.combatants[targetId];
  const ability = ABILITY_DEFS[abilityId];
  if (!actor || !target) return { valid: false, code: "TARGET_UNKNOWN", reason: "Unknown combatant." };
  if (!ability) return { valid: false, code: "ABILITY_UNKNOWN", reason: `Unknown ability: "${abilityId}".` };
  if (!actor.alive) return { valid: false, code: "ACTOR_DEAD", reason: `${actor.name} is down.` };
  if (!(actor.abilities ?? []).includes(abilityId))
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
// EXECUTION — the ONLY functions permitted to produce new game state.
// ---------------------------------------------------------------------------
export function cloneState(state: GameState): GameState {
  return { ...state, combatants: JSON.parse(JSON.stringify(state.combatants)) as Record<string, Combatant>, log: [...state.log] };
}

export function executeMove(
  state: GameState,
  actorId: string,
  dest: { x: number; y: number },
): ExecutionResult {
  const v = validateMove(state, actorId, dest);
  if (!v.valid) return { state, events: [v.reason ?? v.code], ok: false, code: v.code };
  const next  = cloneState(state);
  const actor = next.combatants[actorId];
  actor.x = dest.x;
  actor.y = dest.y;
  actor.moveRemaining -= v.cost ?? 0;
  const line = `${actor.name} moved to (${dest.x}, ${dest.y}).`;
  next.log.push(line);
  return { state: next, events: [line], ok: true };
}

export function executeAttack(
  state: GameState,
  actorId: string,
  targetId: string,
  rng: () => number,
): ExecutionResult {
  const v = validateAttack(state, actorId, targetId);
  if (!v.valid) return { state, events: [v.reason ?? v.code], ok: false, code: v.code };
  const next   = cloneState(state);
  const actor  = next.combatants[actorId];
  const target = next.combatants[targetId];
  actor.actionUsed = true;

  const d20 = rollDie(20, rng);
  const atkTotal    = d20 + actor.atkMod;
  const effectiveAc = target.ac + (v.cover ? 2 : 0);
  const coverNote   = v.cover ? ` (target has cover, AC ${target.ac}+2=${effectiveAc})` : "";
  const events: string[] = [
    `${actor.name} attacks ${target.name} with ${actor.weapon.name}. Attack Roll: ${d20} + ${actor.atkMod} = ${atkTotal} vs AC ${effectiveAc}${coverNote}.`,
  ];

  let dmgRoll: number | null = null, dmgTotal = 0, hit = false;
  const crit = d20 === 20;
  if (crit || atkTotal >= effectiveAc) {
    hit     = true;
    dmgRoll = rollDie(actor.weapon.dmgDie, rng);
    dmgTotal = dmgRoll + actor.weapon.dmgMod;
    if (crit) {
      const bonus = rollDie(actor.weapon.dmgDie, rng);
      dmgTotal += bonus;
      events.push(`Critical hit! Damage: ${dmgTotal} (d${actor.weapon.dmgDie}:${dmgRoll}+${bonus} crit +${actor.weapon.dmgMod}).`);
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
    events.push("Miss.");
  }

  next.log.push(...events);
  return { state: next, events, ok: true, result: { hit, crit, d20, atkTotal, effectiveAc, dmgTotal } };
}

// Resolves ANY ability — dispatches on effect.type via EFFECT_HANDLERS.
// Healing Touch works because "heal" has a handler, not because this
// function knows Healing Touch exists.
export function executeAbility(
  state: GameState,
  actorId: string,
  abilityId: string,
  targetId: string,
  rng: () => number,
): ExecutionResult {
  const v = validateAbility(state, actorId, abilityId, targetId);
  if (!v.valid) return { state, events: [v.reason ?? v.code], ok: false, code: v.code };
  const ability = ABILITY_DEFS[abilityId];
  const handler = EFFECT_HANDLERS[ability.effect.type];
  if (!handler) return { state, events: [`No handler for effect type "${ability.effect.type}".`], ok: false, code: "NO_EFFECT_HANDLER" };

  const next   = cloneState(state);
  const actor  = next.combatants[actorId];
  const target = next.combatants[targetId];
  actor.actionUsed = true;

  const { log, result } = handler(actor.name, ability.name, target, ability.effect, rng);
  next.log.push(...log);
  return { state: next, events: log, ok: true, result };
}

// ---------------------------------------------------------------------------
// TURN MANAGEMENT + ENCOUNTER STATUS
// ---------------------------------------------------------------------------
export function endTurn(state: GameState): GameState {
  const next      = cloneState(state);
  const currentId = next.turnOrder[next.turnIndex];
  const actor     = next.combatants[currentId];
  if (actor) next.log.push(`${actor.name} ends their turn.`);

  let idx = next.turnIndex, loops = 0;
  do {
    idx = (idx + 1) % next.turnOrder.length;
    loops++;
    if (idx === 0) next.round += 1;
    if (loops > next.turnOrder.length * 2) break;
  } while (!next.combatants[next.turnOrder[idx]].alive);

  const wrapped = idx === 0 && next.turnIndex !== 0;
  next.turnIndex = idx;
  const nextActor = next.combatants[next.turnOrder[idx]];
  nextActor.moveRemaining = nextActor.moveMax;
  nextActor.actionUsed   = false;
  if (wrapped) next.log.push(`— Round ${next.round} —`);
  next.log.push(`${nextActor.name}'s turn.`);
  return next;
}

export function checkEncounterStatus(state: GameState): "victory" | "defeat" | "ongoing" {
  const pcs    = Object.values(state.combatants).filter((c) => c.type === "pc");
  const enemies = Object.values(state.combatants).filter((c) => c.type === "enemy");
  if (enemies.every((e) => !e.alive)) return "victory";
  if (pcs.every((p) => !p.alive))     return "defeat";
  return "ongoing";
}

// ---------------------------------------------------------------------------
// ENEMY AI — reads only generic combatant/weapon fields; nothing here is
// specific to Goblins or Orcs. Uses the same validate/execute as the player.
// ---------------------------------------------------------------------------
export function runEnemyAI(
  state: GameState,
  actorId: string,
  rng: () => number,
): { state: GameState; events: string[] } {
  let cur = state;
  const events: string[] = [];
  const actor = cur.combatants[actorId];
  const pcs   = Object.values(cur.combatants).filter((c) => c.type === "pc" && c.alive);
  if (!actor.alive || pcs.length === 0) return { state: cur, events };

  pcs.sort((a, b) => chebyshev(actor, a) - chebyshev(actor, b));
  const target = pcs[0];

  let v = validateAttack(cur, actorId, target.id);
  if (!v.valid && chebyshev(actor, target) > actor.weapon.range) {
    // move toward nearest PC
    const occ   = occupiedSet(cur.combatants, actorId);
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

// Resolves any enemy turns that precede the first PC in initiative order.
// Uses the same runEnemyAI/endTurn as mid-encounter — no special-casing.
export function resolveLeadingEnemyTurns(state: GameState, rng: () => number): GameState {
  let next = state, guard = 0;
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
