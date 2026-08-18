// ---------------------------------------------------------------------------
// Ages of Empire — Risk-style combat and Fortify movement.
//
// Combat structure: attacker rolls min(3, committed) dice, defender rolls
// min(2, defenders); dice are sorted high-to-low, top pairs compared, loser
// of each comparison loses one unit (defender wins ties, with the Modern
// Armor exception). All dice come from the seeded RNG stored in state, so
// battles replay identically from the same seed.
// ---------------------------------------------------------------------------

import { mulberry32 } from "../content";
import { AOE_TERRITORY_BY_ID, AOE_UNIT_DEFS, unitAvailableInAge } from "./content";
import { AOE_FACTION_DEFS } from "./content";
import {
  addUnits,
  cloneState,
  currentPlayerId,
  err,
  getPlayer,
  handleCapture,
  isValidArmyStack,
  pushLog,
  requirePhase,
  treatyActive,
  unitCount,
} from "./rules";
import type {
  AoECombatRoundResult,
  AoEGameState,
  AoEOutcome,
  AoEUnitTypeId,
  ArmyStack,
} from "./types";
import { AOE_BALANCE } from "./types";

const B = AOE_BALANCE;

// --- helpers -----------------------------------------------------------------

function stackTypes(units: ArmyStack): AoEUnitTypeId[] {
  return (Object.keys(units) as AoEUnitTypeId[]).filter((u) => (units[u] ?? 0) > 0);
}

/** Remove `n` casualties from a stack, cheapest units first (deterministic).
 *  Returns the unit types actually removed, in order. */
function removeCasualties(units: ArmyStack, n: number): AoEUnitTypeId[] {
  const removed: AoEUnitTypeId[] = [];
  let remaining = n;
  while (remaining > 0) {
    const present = stackTypes(units).sort((a, b) => AOE_UNIT_DEFS[a].cost - AOE_UNIT_DEFS[b].cost);
    if (present.length === 0) break;
    addUnits(units, present[0], -1);
    removed.push(present[0]);
    remaining--;
  }
  return removed;
}

function rollDie(rng: () => number): number {
  return 1 + Math.floor(rng() * B.combat.dieFaces);
}

const cap = (v: number) => Math.min(B.combat.maxDieValue, v);

// --- valid actions (for the UI/view layer) -------------------------------------

export function listValidAttacks(s: AoEGameState): Array<{ from: string; to: string }> {
  if (s.gameOver || s.phase !== "attack" || s.battle) return [];
  const pid = currentPlayerId(s);
  const out: Array<{ from: string; to: string }> = [];
  for (const [tid, t] of Object.entries(s.territories)) {
    if (t.owner !== pid || unitCount(t.units) < 2 || s.withdrawnTerritories.includes(tid)) continue;
    for (const adj of AOE_TERRITORY_BY_ID[tid].adjacent) {
      const target = s.territories[adj];
      if (target.owner === pid) continue;
      if (target.owner !== null && treatyActive(s, pid, target.owner)) continue;
      if (s.round === 1 && target.isCapital) continue;
      out.push({ from: tid, to: adj });
    }
  }
  return out;
}

export function listValidMoves(s: AoEGameState): Array<{ from: string; to: string }> {
  if (s.gameOver || s.phase !== "fortify" || s.fortifyActionsRemaining < 1) return [];
  const pid = currentPlayerId(s);
  const out: Array<{ from: string; to: string }> = [];
  for (const [tid, t] of Object.entries(s.territories)) {
    if (t.owner !== pid || unitCount(t.units) < 2) continue;
    for (const [otherId, other] of Object.entries(s.territories)) {
      if (otherId === tid || other.owner !== pid) continue;
      // Feasibility check with the most mobile unit present.
      const best = Math.max(...stackTypes(t.units).map((u) => effectiveMovement(s, pid, u)));
      if (movePathAllowed(s, pid, tid, otherId, best)) out.push({ from: tid, to: otherId });
    }
  }
  return out;
}

// --- movement -------------------------------------------------------------------

export function effectiveMovement(s: AoEGameState, playerId: string, unit: AoEUnitTypeId): number {
  const def = AOE_UNIT_DEFS[unit];
  let m = def.movement;
  const p = getPlayer(s, playerId);
  const faction = p.faction ? AOE_FACTION_DEFS[p.faction] : undefined;
  if (faction?.passive.kind === "mountedMovementBonus" && def.mounted) m += faction.passive.amount;
  if ((unit === "tank" || unit === "modernArmor")
    && Object.keys(s.territories).some((tid) => s.territories[tid].owner === playerId && AOE_TERRITORY_BY_ID[tid].resource === "oil")) {
    m += B.resources.oilMovementBonus; // Oil resource passive.
  }
  return m;
}

/** Shortest path length between two territories through friendly territory
 *  only (BFS); returns Infinity if unreachable. */
function friendlyDistance(s: AoEGameState, playerId: string, from: string, to: string): number {
  if (from === to) return 0;
  const dist: Record<string, number> = { [from]: 0 };
  const queue = [from];
  while (queue.length) {
    const cur = queue.shift()!;
    for (const adj of AOE_TERRITORY_BY_ID[cur].adjacent) {
      if (adj in dist) continue;
      if (adj === to) return dist[cur] + 1; // destination must be friendly too (checked by caller)
      if (s.territories[adj].owner !== playerId) continue;
      dist[adj] = dist[cur] + 1;
      queue.push(adj);
    }
  }
  return Infinity;
}

/** Whether every territory on some shortest friendly path (including both
 *  endpoints) has a road or railway, for the Medieval road allowance. */
function roadPathExists(s: AoEGameState, playerId: string, from: string, to: string, maxHops: number): boolean {
  const hasRoad = (tid: string) => s.territories[tid].development.road || s.territories[tid].development.railway;
  if (!hasRoad(from) || !hasRoad(to)) return false;
  const dist: Record<string, number> = { [from]: 0 };
  const queue = [from];
  while (queue.length) {
    const cur = queue.shift()!;
    if (dist[cur] >= maxHops) continue;
    for (const adj of AOE_TERRITORY_BY_ID[cur].adjacent) {
      if (adj in dist) continue;
      if (s.territories[adj].owner !== playerId || !hasRoad(adj)) continue;
      dist[adj] = dist[cur] + 1;
      if (adj === to) return true;
      queue.push(adj);
    }
  }
  return to in dist;
}

/** Whether from/to belong to the same friendly connected railway network. */
function railwayConnected(s: AoEGameState, playerId: string, from: string, to: string): boolean {
  const isRail = (tid: string) => s.territories[tid].owner === playerId && s.territories[tid].development.railway;
  if (!isRail(from) || !isRail(to)) return false;
  const visited = new Set([from]);
  const queue = [from];
  while (queue.length) {
    const cur = queue.shift()!;
    if (cur === to) return true;
    for (const adj of AOE_TERRITORY_BY_ID[cur].adjacent) {
      if (!visited.has(adj) && isRail(adj)) {
        visited.add(adj);
        queue.push(adj);
      }
    }
  }
  return false;
}

/** Age-aware movement legality for a group whose slowest allowance is `hops`. */
function movePathAllowed(s: AoEGameState, playerId: string, from: string, to: string, groupMovement: number): boolean {
  const d = friendlyDistance(s, playerId, from, to);
  if (d === Infinity) return false;
  // Industrial+: connected railway networks allow long-distance movement.
  if ((s.age === "industrial" || s.age === "modern") && railwayConnected(s, playerId, from, to)) return true;
  let allowance: number = B.movement.baseHops;
  // Medieval+: roads permit up to 2 hops along road territories.
  if (s.age !== "ancient" && roadPathExists(s, playerId, from, to, B.movement.roadHops)) {
    allowance = Math.max(allowance, B.movement.roadHops);
  }
  // Modern: unit-specific movement values apply.
  if (s.age === "modern") allowance = Math.max(allowance, groupMovement);
  allowance += s.nextMoveBonus; // Forced March
  return d <= allowance;
}

export function fortifyMove(
  s: AoEGameState,
  playerId: string,
  from: string,
  to: string,
  units: ArmyStack,
): AoEOutcome {
  const phaseErr = requirePhase(s, "fortify");
  if (phaseErr) return phaseErr;
  if (currentPlayerId(s) !== playerId) return err("WRONG_PLAYER", "Not this player's turn.");
  if (s.fortifyActionsRemaining < 1) return err("NO_MOVES_REMAINING", "No fortify moves remaining this turn.");
  const ft = s.territories[from];
  const tt = s.territories[to];
  if (!ft || !tt) return err("INVALID_TERRITORY", "Unknown territory.");
  if (ft.owner !== playerId || tt.owner !== playerId) return err("NOT_OWNER", "Fortify moves stay within your own territories.");
  if (!isValidArmyStack(units)) return err("INVALID_ARGUMENT", "Invalid unit stack.");
  const moving = unitCount(units);
  if (moving < 1) return err("INVALID_ARGUMENT", "Move at least one unit.");
  for (const [ut, n] of Object.entries(units) as [AoEUnitTypeId, number][]) {
    if ((ft.units[ut] ?? 0) < n) return err("INSUFFICIENT_UNITS", `Not enough ${ut} in ${from}.`);
  }
  if (unitCount(ft.units) - moving < 1) return err("INSUFFICIENT_UNITS", "At least 1 unit must stay behind.");
  // Group movement = slowest moved unit's effective movement.
  const groupMovement = Math.min(
    ...stackTypes(units).map((u) => effectiveMovement(s, playerId, u)),
  );
  if (!movePathAllowed(s, playerId, from, to, groupMovement)) {
    return err("INVALID_PATH", "No legal friendly path within movement allowance.");
  }
  const next = cloneState(s);
  for (const [ut, n] of Object.entries(units) as [AoEUnitTypeId, number][]) {
    addUnits(next.territories[from].units, ut, -n);
    addUnits(next.territories[to].units, ut, n);
  }
  next.fortifyActionsRemaining -= 1;
  next.nextMoveBonus = 0;
  pushLog(next, playerId, `Fortified: ${moving} units ${AOE_TERRITORY_BY_ID[from].name} -> ${AOE_TERRITORY_BY_ID[to].name}.`);
  return { ok: true, state: next, result: undefined };
}

// --- combat ---------------------------------------------------------------------

export function declareAttack(
  s: AoEGameState,
  playerId: string,
  from: string,
  to: string,
  committed: ArmyStack,
): AoEOutcome {
  const phaseErr = requirePhase(s, "attack");
  if (phaseErr) return phaseErr;
  if (currentPlayerId(s) !== playerId) return err("WRONG_PLAYER", "Not this player's turn.");
  if (s.battle) return err("BATTLE_IN_PROGRESS", "Resolve the current battle first.");
  const ft = s.territories[from];
  const tt = s.territories[to];
  if (!ft || !tt) return err("INVALID_TERRITORY", "Unknown territory.");
  if (ft.owner !== playerId) return err("NOT_OWNER", "Attack from your own territory.");
  if (tt.owner === playerId) return err("INVALID_ARGUMENT", "Cannot attack your own territory.");
  if (!AOE_TERRITORY_BY_ID[from].adjacent.includes(to)) return err("NOT_ADJACENT", "Territories are not adjacent.");
  if (s.withdrawnTerritories.includes(from)) {
    return err("TERRITORY_WITHDRAWN", "This territory withdrew and cannot attack again this phase.");
  }
  if (tt.owner !== null && treatyActive(s, playerId, tt.owner)) {
    return err("TREATY_ACTIVE", "An active treaty forbids this attack.");
  }
  if (s.round === 1 && tt.isCapital) {
    return err("CAPITAL_PROTECTED", "Capitals cannot be attacked during the first round.");
  }
  if (!isValidArmyStack(committed)) return err("INVALID_ARGUMENT", "Invalid unit stack.");
  const committing = unitCount(committed);
  if (committing < 1) return err("INSUFFICIENT_UNITS", "Commit at least one unit.");
  for (const [ut, n] of Object.entries(committed) as [AoEUnitTypeId, number][]) {
    if ((ft.units[ut] ?? 0) < n) return err("INSUFFICIENT_UNITS", `Not enough ${ut} in ${from}.`);
    if (n > 0 && !unitAvailableInAge(ut, s.age)) return err("UNIT_NOT_AVAILABLE", `${ut} not available.`);
  }
  if (unitCount(ft.units) - committing < 1) {
    return err("INSUFFICIENT_UNITS", "At least 1 unit must stay behind — a territory may never be emptied by attacking.");
  }
  const next = cloneState(s);
  next.battle = {
    attackerId: playerId,
    fromTerritoryId: from,
    toTerritoryId: to,
    committed: { ...committed },
    rerollUsed: false,
    attackDieBonus: 0,
    defenseDieBonus: 0,
    rounds: [],
  };
  pushLog(next, playerId, `Attack declared: ${AOE_TERRITORY_BY_ID[from].name} -> ${AOE_TERRITORY_BY_ID[to].name} (${committing} committed).`);
  return { ok: true, state: next, result: undefined };
}

/** Resolve one round of combat dice. The attacker then chooses to continue
 *  (call again) or withdraw. Capture happens automatically when defenders
 *  reach zero. */
export function resolveCombatRound(s: AoEGameState, playerId: string): AoEOutcome<AoECombatRoundResult> {
  if (s.gameOver) return err("GAME_OVER", "The game has ended.");
  if (!s.battle) return err("NO_BATTLE", "No battle in progress.");
  if (s.battle.attackerId !== playerId) return err("WRONG_PLAYER", "Only the attacker resolves combat.");

  const next = cloneState(s);
  const battle = next.battle!;
  const defender = next.territories[battle.toTerritoryId];
  const defenderOwner = defender.owner;
  const attackerUnits = battle.committed;
  const defenderUnits = defender.units;

  const rng = mulberry32(0);
  rng.restore(next.rngState);

  const attackerCount = unitCount(attackerUnits);
  const defenderCount = unitCount(defenderUnits);
  const nAttackDice = Math.min(B.combat.maxAttackDice, attackerCount);
  const nDefenseDice = Math.min(B.combat.maxDefenseDice, defenderCount);

  const attackerDice = Array.from({ length: nAttackDice }, () => rollDie(rng)).sort((a, b) => b - a);
  const defenderDice = Array.from({ length: nDefenseDice }, () => rollDie(rng)).sort((a, b) => b - a);

  // --- attacker modifiers (each source contributes at most +1) --------------
  const aTypes = stackTypes(attackerUnits);
  const modA = [...attackerDice];
  let tieWinnerIndex = -1;
  const hasHighestBonus = aTypes.some((u) => AOE_UNIT_DEFS[u].highestAttackBonus);
  if (hasHighestBonus) {
    modA[0] = cap(modA[0] + B.combat.unitHighestAttackBonus);
    if (aTypes.some((u) => AOE_UNIT_DEFS[u].winsTies)) tieWinnerIndex = 0; // Modern Armor: modified die wins ties
  }
  if (defender.development.fort && aTypes.some((u) => AOE_UNIT_DEFS[u].fortBreaker)) {
    modA[0] = cap(modA[0] + B.combat.fortBreakerBonus);
  }
  if (aTypes.length >= B.combat.combinedArmsUnitTypes) {
    modA[0] = cap(modA[0] + B.combat.combinedArmsBonus); // Combined Arms: +1 to one die, non-stacking
  }
  if (battle.attackDieBonus > 0) modA[0] = cap(modA[0] + B.combat.battleEffectBonus); // card/air support: one battle-level bonus

  // --- defender modifiers ------------------------------------------------------
  const dTypes = stackTypes(defenderUnits);
  const modD = [...defenderDice];
  if (defender.development.fort) modD[0] = cap(modD[0] + B.combat.fortDefenseBonus);
  if (defender.development.city) modD[0] = cap(modD[0] + B.combat.cityDefenseBonus);
  const attackerMounted = aTypes.some((u) => AOE_UNIT_DEFS[u].mounted);
  if (attackerMounted && dTypes.some((u) => AOE_UNIT_DEFS[u].antiCavalryDefense)) {
    modD[0] = cap(modD[0] + B.combat.antiCavalryDefenseBonus); // Spearmen vs mounted
  }
  if (next.defensiveMobilization?.territoryId === battle.toTerritoryId) {
    modD[0] = cap(modD[0] + B.combat.battleEffectBonus);
    next.defensiveMobilization = null; // one combat round only
  }
  if (battle.defenseDieBonus > 0) modD[0] = cap(modD[0] + B.combat.battleEffectBonus);

  // --- compare ---------------------------------------------------------------
  const comparisons = Math.min(modA.length, modD.length); // at most 2 => max 2 casualties
  let attackerLosses = 0;
  let defenderLosses = 0;
  let rerolled = false;
  const canReroll = !battle.rerollUsed && aTypes.some((u) => AOE_UNIT_DEFS[u].reroll);
  for (let i = 0; i < comparisons; i++) {
    let attackerWins = tieWinnerIndex === i ? modA[i] >= modD[i] : modA[i] > modD[i];
    if (!attackerWins && canReroll && !rerolled) {
      // Rifleman/Mech Infantry: auto-reroll the losing attack die once per battle.
      const newRaw = rollDie(rng);
      const wasModified = i === 0 ? modA[0] - attackerDice[0] : 0;
      modA[i] = cap(newRaw + wasModified);
      rerolled = true;
      battle.rerollUsed = true;
      attackerWins = tieWinnerIndex === i ? modA[i] >= modD[i] : modA[i] > modD[i];
    }
    if (attackerWins) defenderLosses++;
    else attackerLosses++;
  }

  // Committed units still physically sit in the source territory, so remove
  // the exact same unit types from both the battle group and the source stack
  // (never from the stay-behind garrison).
  const removedTypes = removeCasualties(attackerUnits, attackerLosses);
  const src = next.territories[battle.fromTerritoryId].units;
  for (const ut of removedTypes) addUnits(src, ut, -1);
  removeCasualties(defenderUnits, defenderLosses);

  next.rngState = rng.save();

  let captured = false;
  if (unitCount(defenderUnits) === 0) {
    // Capture: surviving committed attackers advance into the territory.
    captured = true;
    const src = next.territories[battle.fromTerritoryId].units;
    for (const [ut, n] of Object.entries(attackerUnits) as [AoEUnitTypeId, number][]) {
      if (!n) continue;
      const movable = Math.min(n, src[ut] ?? 0);
      addUnits(src, ut, -movable);
      addUnits(defender.units, ut, movable);
    }
    defender.owner = battle.attackerId;
    pushLog(next, playerId, `${AOE_TERRITORY_BY_ID[battle.toTerritoryId].name} captured!`);
    handleCapture(next, battle.attackerId, battle.toTerritoryId, defenderOwner);
    next.battle = null;
  } else if (unitCount(attackerUnits) === 0) {
    pushLog(next, playerId, "Attack repelled — all committed attackers lost.");
    next.battle = null;
  }

  const result: AoECombatRoundResult = {
    attackerDice,
    defenderDice,
    modifiedAttackerDice: modA,
    modifiedDefenderDice: modD,
    attackerLosses,
    defenderLosses,
    rerolled,
    captured,
  };
  if (next.battle) next.battle.rounds.push(result);
  return { ok: true, state: next, result };
}

export function withdraw(s: AoEGameState, playerId: string): AoEOutcome {
  if (s.gameOver) return err("GAME_OVER", "The game has ended.");
  if (!s.battle) return err("NO_BATTLE", "No battle in progress.");
  if (s.battle.attackerId !== playerId) return err("WRONG_PLAYER", "Only the attacker may withdraw.");
  const next = cloneState(s);
  const from = next.battle!.fromTerritoryId;
  next.withdrawnTerritories.push(from);
  next.battle = null;
  pushLog(next, playerId, `Withdrew from the battle; ${AOE_TERRITORY_BY_ID[from].name} cannot attack again this phase.`);
  return { ok: true, state: next, result: undefined };
}
