// ---------------------------------------------------------------------------
// Ages of Empire — core rules engine (pure state transitions).
//
// Setup, turn/phase/round/age progression, reinforcements, production,
// development, cards, objectives, capitals, treaties, air support,
// elimination, scoring, and the UI view model. Combat and movement live in
// combat.ts (which imports the shared helpers exported here).
//
// Every mutation path: clone -> modify clone -> return { ok, state, result }.
// Errors return { ok: false, code, message } and never touch the input state.
// ---------------------------------------------------------------------------

import { mulberry32 } from "../content";
import {
  AOE_CARD_TYPES,
  AOE_DEVELOPMENT_UNLOCK_AGE,
  AOE_FACTION_DEFS,
  AOE_OBJECTIVE_DEFS,
  AOE_REGION_BY_ID,
  AOE_REGION_DEFS,
  AOE_TERRITORY_BY_ID,
  AOE_TERRITORY_DEFS,
  AOE_UNIT_DEFS,
  AOE_UPGRADE_PATHS,
  ageIndex,
  unitAvailableInAge,
} from "./content";
import type {
  AoEAge,
  AoEAirSupportEffect,
  AoECard,
  AoECardType,
  AoEDevelopmentKind,
  AoEErrorCode,
  AoEGameState,
  AoEObjectiveDef,
  AoEOutcome,
  AoEPlayerState,
  AoETerritoryState,
  AoEUnitTypeId,
  ArmyStack,
} from "./types";
import { AOE_AGES, AOE_BALANCE, AOE_PHASES } from "./types";

const B = AOE_BALANCE;

// --- shared helpers (also used by combat.ts) ---------------------------------

export function err(code: AoEErrorCode, message: string): { ok: false; code: AoEErrorCode; message: string } {
  return { ok: false, code, message };
}

export function cloneState(s: AoEGameState): AoEGameState {
  return {
    ...s,
    players: s.players.map((p) => ({
      ...p,
      cards: p.cards.map((c) => ({ ...c })),
      objectiveIds: [...p.objectiveIds],
      completedObjectiveIds: [...p.completedObjectiveIds],
    })),
    territories: Object.fromEntries(
      Object.entries(s.territories).map(([id, t]) => [
        id,
        { ...t, units: { ...t.units }, development: { ...t.development } },
      ]),
    ),
    seatingOrder: [...s.seatingOrder],
    withdrawnTerritories: [...s.withdrawnTerritories],
    battle: s.battle
      ? {
          ...s.battle,
          committed: { ...s.battle.committed },
          rounds: s.battle.rounds.map((r) => ({
            ...r,
            attackerDice: [...r.attackerDice],
            defenderDice: [...r.defenderDice],
            modifiedAttackerDice: [...r.modifiedAttackerDice],
            modifiedDefenderDice: [...r.modifiedDefenderDice],
          })),
        }
      : null,
    treaties: s.treaties.map((t) => ({ ...t, players: [...t.players] as [string, string] })),
    defensiveMobilization: s.defensiveMobilization ? { ...s.defensiveMobilization } : null,
    cardDeck: [...s.cardDeck],
    winnerIds: s.winnerIds ? [...s.winnerIds] : null,
    log: [...s.log],
  };
}

export function getPlayer(s: AoEGameState, id: string): AoEPlayerState {
  const p = s.players.find((pl) => pl.id === id);
  if (!p) throw new Error(`unknown player ${id}`);
  return p;
}

/** Initiative order for a given round: seating rotated by (round - 1),
 *  skipping eliminated players. */
export function initiativeOrder(s: AoEGameState, round = s.round): string[] {
  const n = s.seatingOrder.length;
  const shift = (round - 1) % n;
  const rotated = [...s.seatingOrder.slice(shift), ...s.seatingOrder.slice(0, shift)];
  return rotated.filter((id) => !getPlayer(s, id).eliminated);
}

export function currentPlayerId(s: AoEGameState): string {
  return initiativeOrder(s)[s.turnIndex];
}

export function unitCount(units: ArmyStack): number {
  return Object.values(units).reduce((a, b) => a + (b ?? 0), 0);
}

/** Validates an externally supplied army stack: only known unit ids with
 *  finite, non-negative integer counts. Rejects NaN/fractional/negative input
 *  before it can corrupt state. */
export function isValidArmyStack(units: ArmyStack): boolean {
  return Object.entries(units).every(
    ([ut, n]) =>
      ut in AOE_UNIT_DEFS && typeof n === "number" && Number.isSafeInteger(n) && n >= 0,
  );
}

/** Validates an externally supplied count: finite positive integer. */
export function isValidCount(n: number): boolean {
  return typeof n === "number" && Number.isSafeInteger(n) && n > 0;
}

export function addUnits(units: ArmyStack, type: AoEUnitTypeId, count: number): void {
  units[type] = (units[type] ?? 0) + count;
  if (units[type] === 0) delete units[type];
}

export function territoriesOwnedBy(s: AoEGameState, playerId: string): string[] {
  return Object.entries(s.territories)
    .filter(([, t]) => t.owner === playerId)
    .map(([id]) => id);
}

export function regionsOwnedBy(s: AoEGameState, playerId: string): string[] {
  return AOE_REGION_DEFS.filter((r) =>
    r.territories.every((tid) => s.territories[tid].owner === playerId),
  ).map((r) => r.id);
}

export function hasResource(s: AoEGameState, playerId: string, resource: string): boolean {
  return territoriesOwnedBy(s, playerId).some((tid) => AOE_TERRITORY_BY_ID[tid].resource === resource);
}

export function requirePhase(s: AoEGameState, phase: AoEGameState["phase"]): ReturnType<typeof err> | null {
  if (s.gameOver) return err("GAME_OVER", "The game has ended.");
  if (s.phase !== phase) return err("WRONG_PHASE", `Action requires the ${phase} phase (current: ${s.phase}).`);
  return null;
}

export function pushLog(s: AoEGameState, playerId: string | null, message: string): void {
  s.log.push({ round: s.round, age: s.age, playerId, message });
}

function treatyActive(s: AoEGameState, a: string, b: string): boolean {
  return s.treaties.some(
    (t) => t.throughRound >= s.round && t.players.includes(a) && t.players.includes(b),
  );
}
export { treatyActive };

/** Largest connected railway component owned by a player. */
export function largestRailwayNetwork(s: AoEGameState, playerId: string): number {
  const railTerritories = new Set(
    territoriesOwnedBy(s, playerId).filter((tid) => s.territories[tid].development.railway),
  );
  let best = 0;
  const visited = new Set<string>();
  for (const start of railTerritories) {
    if (visited.has(start)) continue;
    let size = 0;
    const stack = [start];
    visited.add(start);
    while (stack.length) {
      const cur = stack.pop()!;
      size++;
      for (const adj of AOE_TERRITORY_BY_ID[cur].adjacent) {
        if (railTerritories.has(adj) && !visited.has(adj)) {
          visited.add(adj);
          stack.push(adj);
        }
      }
    }
    best = Math.max(best, size);
  }
  return best;
}

// --- setup -------------------------------------------------------------------

export interface AoESetupPlayer {
  name: string;
  color: string;
  faction?: keyof typeof AOE_FACTION_DEFS;
}

export function setupGame(players: AoESetupPlayer[], seed: number): AoEGameState {
  if (players.length < B.players.min || players.length > B.players.max) {
    throw new Error(`Ages of Empire supports ${B.players.min}-${B.players.max} players.`);
  }
  const rng = mulberry32(seed);

  const playerStates: AoEPlayerState[] = players.map((p, i) => ({
    id: `p${i + 1}`,
    name: p.name,
    color: p.color,
    faction: p.faction as AoEPlayerState["faction"],
    capitalTerritoryId: null,
    capitalRebuildAvailableAfterRound: null,
    reinforcements: 0,
    production: B.setup.startingProduction,
    cards: [],
    objectiveIds: [],
    completedObjectiveIds: [],
    bonusVp: 0,
    eliminated: false,
    airSupportCharges: 0,
    ironDiscountUsedThisTurn: false,
    factoriesBuilt: 0,
  }));

  // Shuffle territories, deal round-robin. Players get floor-share; the
  // remainder stays neutral so no player gets an extra-territory head start.
  const shuffled = [...AOE_TERRITORY_DEFS.map((t) => t.id)];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  const perPlayer = Math.floor(shuffled.length / playerStates.length);
  const territories: Record<string, AoETerritoryState> = {};
  for (const def of AOE_TERRITORY_DEFS) {
    territories[def.id] = {
      defId: def.id,
      owner: null,
      units: {},
      development: { city: false, fort: false, road: false, railway: false, factory: false },
      isCapital: false,
    };
  }
  shuffled.forEach((tid, idx) => {
    const playerIdx = Math.floor(idx / perPlayer);
    if (playerIdx < playerStates.length) territories[tid].owner = playerStates[playerIdx].id;
  });

  // Capitals: first-dealt territory per player. Starting armies: capital gets
  // a garrison, the rest spread round-robin across the player's territories.
  for (let i = 0; i < playerStates.length; i++) {
    const owned = shuffled.slice(i * perPlayer, (i + 1) * perPlayer);
    const capital = owned[0];
    playerStates[i].capitalTerritoryId = capital;
    territories[capital].isCapital = true;
    // Place infantry: 3 on the capital, remainder spread evenly.
    let remaining = B.setup.startingInfantry;
    addUnits(territories[capital].units, "infantry", Math.min(3, remaining));
    remaining -= Math.min(3, remaining);
    let idx = 0;
    while (remaining > 0) {
      addUnits(territories[owned[idx % owned.length]].units, "infantry", 1);
      remaining--;
      idx++;
    }
    addUnits(territories[capital].units, "cavalry", B.setup.startingCavalry);
  }

  // Neutral garrisons: 2-4 infantry, seeded.
  for (const t of Object.values(territories)) {
    if (t.owner === null) {
      const span = B.setup.neutralInfantryMax - B.setup.neutralInfantryMin + 1;
      addUnits(t.units, "infantry", B.setup.neutralInfantryMin + Math.floor(rng() * span));
    }
  }

  // Objectives: deal each player 3 distinct objectives, seeded.
  const objectivePool = [...AOE_OBJECTIVE_DEFS.map((o) => o.id)];
  for (const p of playerStates) {
    const pool = [...objectivePool];
    for (let k = 0; k < B.objectives.perPlayer; k++) {
      const pick = Math.floor(rng() * pool.length);
      p.objectiveIds.push(pool[pick]);
      pool.splice(pick, 1);
    }
  }

  // Card deck: repeated cycles of the six card types, shuffled.
  const deck: AoECardType[] = [];
  for (let cycle = 0; cycle < B.cards.deckCycles; cycle++) deck.push(...AOE_CARD_TYPES);
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }

  const state: AoEGameState = {
    mapId: "aoe-classic",
    players: playerStates,
    territories,
    seatingOrder: playerStates.map((p) => p.id),
    round: 1,
    turnIndex: 0,
    age: "ancient",
    phase: "reinforce",
    ageTimerExpired: false,
    fortifyActionsRemaining: 1,
    nextMoveBonus: 0,
    withdrawnTerritories: [],
    battle: null,
    capturedPlayerTerritoryThisTurn: false,
    capturedAnyTerritoryThisTurn: false,
    treaties: [],
    defensiveMobilization: null,
    cardDeck: deck,
    nextCardId: 1,
    rngState: rng.save(),
    gameOver: false,
    winnerIds: null,
    log: [],
  };
  pushLog(state, null, `Game start: ${playerStates.length} players, Ancient Age.`);
  beginTurn(state);
  return state;
}

// --- reinforcements & production ---------------------------------------------

export function computeReinforcements(s: AoEGameState, playerId: string): number {
  const p = getPlayer(s, playerId);
  const owned = territoriesOwnedBy(s, playerId);
  let total = Math.max(
    B.reinforcements.minimum,
    Math.floor(owned.length / B.reinforcements.territoryDivisor),
  );
  for (const rid of regionsOwnedBy(s, playerId)) {
    total += B.reinforcements.regionBonus[AOE_REGION_BY_ID[rid].size];
  }
  if (p.capitalTerritoryId) total += B.reinforcements.capitalBonus;
  total += owned.filter((tid) => AOE_TERRITORY_BY_ID[tid].resource === "food").length
    * B.reinforcements.foodBonus;
  return total;
}

export function computeProductionIncome(s: AoEGameState, playerId: string): number {
  const p = getPlayer(s, playerId);
  const faction = p.faction ? AOE_FACTION_DEFS[p.faction] : undefined;
  let total = 0;
  for (const tid of territoriesOwnedBy(s, playerId)) {
    const t = s.territories[tid];
    if (t.development.city) {
      total += B.production.cityTerritory;
      if (faction?.passive.kind === "cityProductionBonus") total += faction.passive.amount;
    } else if (t.development.road || t.development.railway || t.development.fort) {
      total += B.production.developedTerritory;
    } else {
      total += B.production.normalTerritory;
    }
    if (t.development.factory) {
      total += B.production.factoryBonus;
      if (faction?.passive.kind === "factoryProductionBonus") total += faction.passive.amount;
    }
    if (AOE_TERRITORY_BY_ID[tid].resource === "gold") total += B.production.goldBonus;
  }
  return total;
}

/** Mutates: grants turn-start income to the current player. */
function beginTurn(s: AoEGameState): void {
  const pid = currentPlayerId(s);
  const p = getPlayer(s, pid);
  p.reinforcements = computeReinforcements(s, pid);
  p.production = Math.min(B.production.cap, p.production + computeProductionIncome(s, pid));
  p.ironDiscountUsedThisTurn = false;
  s.phase = "reinforce";
  s.fortifyActionsRemaining = 1;
  s.nextMoveBonus = 0;
  s.withdrawnTerritories = [];
  s.battle = null;
  s.capturedPlayerTerritoryThisTurn = false;
  s.capturedAnyTerritoryThisTurn = false;
  s.defensiveMobilization = null;
  pushLog(s, pid, `${p.name} begins turn: +${p.reinforcements} reinforcements.`);
}

// --- recruitment & upgrades ----------------------------------------------------

export function recruitUnit(
  s: AoEGameState,
  playerId: string,
  territoryId: string,
  unitType: AoEUnitTypeId,
  count: number,
): AoEOutcome {
  const phaseErr = requirePhase(s, "reinforce");
  if (phaseErr) return phaseErr;
  if (currentPlayerId(s) !== playerId) return err("WRONG_PLAYER", "Not this player's turn.");
  if (!isValidCount(count)) return err("INVALID_ARGUMENT", "Count must be a positive integer.");
  const t = s.territories[territoryId];
  if (!t) return err("INVALID_TERRITORY", `Unknown territory ${territoryId}.`);
  if (t.owner !== playerId) return err("NOT_OWNER", "You can only recruit in your own territories.");
  if (!unitAvailableInAge(unitType, s.age)) {
    return err("UNIT_NOT_AVAILABLE", `${AOE_UNIT_DEFS[unitType].name} unlocks in a later Age.`);
  }

  const next = cloneState(s);
  const p = getPlayer(next, playerId);
  const def = AOE_UNIT_DEFS[unitType];
  const faction = p.faction ? AOE_FACTION_DEFS[p.faction] : undefined;
  let totalCost = 0;
  for (let i = 0; i < count; i++) {
    let cost = def.cost;
    if (faction?.passive.kind === "modernUnitDiscount" && def.age === "modern") {
      cost = Math.max(1, cost - faction.passive.amount);
    }
    // Iron: the first recruit each turn costs 1 less (min 1).
    if (!p.ironDiscountUsedThisTurn && hasResource(next, playerId, "iron") && cost > 1) {
      cost -= 1;
      p.ironDiscountUsedThisTurn = true;
    }
    totalCost += cost;
  }
  if (totalCost > p.reinforcements) {
    return err("INSUFFICIENT_REINFORCEMENTS", `Need ${totalCost} reinforcements, have ${p.reinforcements}.`);
  }
  p.reinforcements -= totalCost;
  addUnits(next.territories[territoryId].units, unitType, count);
  pushLog(next, playerId, `Recruited ${count} ${def.name} in ${AOE_TERRITORY_BY_ID[territoryId].name}.`);
  return { ok: true, state: next, result: undefined };
}

export function upgradeUnits(
  s: AoEGameState,
  playerId: string,
  territoryId: string,
  from: AoEUnitTypeId,
  to: AoEUnitTypeId,
  count: number,
): AoEOutcome {
  const phaseErr = requirePhase(s, "reinforce");
  if (phaseErr) return phaseErr;
  if (currentPlayerId(s) !== playerId) return err("WRONG_PLAYER", "Not this player's turn.");
  if (!isValidCount(count)) return err("INVALID_ARGUMENT", "Count must be a positive integer.");
  const t = s.territories[territoryId];
  if (!t) return err("INVALID_TERRITORY", `Unknown territory ${territoryId}.`);
  if (t.owner !== playerId) return err("NOT_OWNER", "You can only upgrade units in your own territories.");
  if (!(AOE_UPGRADE_PATHS[from] ?? []).includes(to)) {
    return err("INVALID_UPGRADE", `${from} cannot upgrade to ${to}.`);
  }
  if (!unitAvailableInAge(to, s.age)) {
    return err("UNIT_NOT_AVAILABLE", `${AOE_UNIT_DEFS[to].name} unlocks in a later Age.`);
  }
  if ((t.units[from] ?? 0) < count) return err("INSUFFICIENT_UNITS", `Not enough ${from} to upgrade.`);

  const reinforcementCost = (AOE_UNIT_DEFS[to].cost - AOE_UNIT_DEFS[from].cost) * count;
  const productionCost = B.upgrades.productionSurcharge * count;
  const next = cloneState(s);
  const p = getPlayer(next, playerId);
  if (p.reinforcements < reinforcementCost) {
    return err("INSUFFICIENT_REINFORCEMENTS", `Upgrade needs ${reinforcementCost} reinforcements.`);
  }
  if (p.production < productionCost) {
    return err("INSUFFICIENT_PRODUCTION", `Upgrade needs ${productionCost} production.`);
  }
  p.reinforcements -= reinforcementCost;
  p.production -= productionCost;
  const units = next.territories[territoryId].units;
  addUnits(units, from, -count);
  addUnits(units, to, count);
  pushLog(next, playerId, `Upgraded ${count} ${from} to ${to} in ${AOE_TERRITORY_BY_ID[territoryId].name}.`);
  return { ok: true, state: next, result: undefined };
}

// --- development ----------------------------------------------------------------

export function build(
  s: AoEGameState,
  playerId: string,
  territoryId: string,
  kind: AoEDevelopmentKind,
): AoEOutcome {
  const phaseErr = requirePhase(s, "develop");
  if (phaseErr) return phaseErr;
  if (currentPlayerId(s) !== playerId) return err("WRONG_PLAYER", "Not this player's turn.");
  const t = s.territories[territoryId];
  if (!t) return err("INVALID_TERRITORY", `Unknown territory ${territoryId}.`);
  if (t.owner !== playerId) return err("NOT_OWNER", "You can only build in your own territories.");
  if (ageIndex(s.age) < ageIndex(AOE_DEVELOPMENT_UNLOCK_AGE[kind])) {
    return err("BUILD_NOT_AVAILABLE", `${kind} unlocks in the ${AOE_DEVELOPMENT_UNLOCK_AGE[kind]} Age.`);
  }

  const next = cloneState(s);
  const nt = next.territories[territoryId];
  const p = getPlayer(next, playerId);
  const faction = p.faction ? AOE_FACTION_DEFS[p.faction] : undefined;

  let cost: number;
  switch (kind) {
    case "city":
      if (nt.development.city) return err("ALREADY_BUILT", "One City per territory.");
      cost = B.development.cityCost;
      break;
    case "fort":
      if (nt.development.fort) return err("ALREADY_BUILT", "One Fort per territory.");
      cost = B.development.fortCost;
      if (faction?.passive.kind === "fortDiscount") cost = Math.max(1, cost - faction.passive.amount);
      break;
    case "road":
      if (nt.development.road || nt.development.railway) return err("ALREADY_BUILT", "Territory already has a road.");
      cost = B.development.roadCost;
      break;
    case "railway":
      if (!nt.development.road) return err("BUILD_NOT_AVAILABLE", "Railways upgrade an existing Road.");
      if (nt.development.railway) return err("ALREADY_BUILT", "Territory already has a railway.");
      cost = B.development.railwayUpgradeCost;
      break;
    case "factory":
      if (nt.development.factory) return err("ALREADY_BUILT", "One Factory per territory.");
      if (p.factoriesBuilt >= B.development.factoryLimitPerPlayer) {
        return err("FACTORY_LIMIT", `Maximum ${B.development.factoryLimitPerPlayer} factories per player.`);
      }
      cost = B.development.factoryCost;
      break;
  }
  if (p.production < cost) return err("INSUFFICIENT_PRODUCTION", `${kind} costs ${cost} production.`);
  p.production -= cost;
  nt.development[kind === "railway" ? "railway" : kind] = true;
  if (kind === "factory") p.factoriesBuilt++;
  pushLog(next, playerId, `Built ${kind} in ${AOE_TERRITORY_BY_ID[territoryId].name} (-${cost} production).`);
  return { ok: true, state: next, result: undefined };
}

export function establishNewCapital(s: AoEGameState, playerId: string, territoryId: string): AoEOutcome {
  const phaseErr = requirePhase(s, "develop");
  if (phaseErr) return phaseErr;
  if (currentPlayerId(s) !== playerId) return err("WRONG_PLAYER", "Not this player's turn.");
  const p0 = getPlayer(s, playerId);
  if (p0.capitalTerritoryId) return err("CAPITAL_EXISTS", "You already have a Capital.");
  if (p0.capitalRebuildAvailableAfterRound === null || s.round <= p0.capitalRebuildAvailableAfterRound) {
    return err("CAPITAL_REBUILD_NOT_READY", "A new Capital may be established only after your next turn.");
  }
  const t = s.territories[territoryId];
  if (!t) return err("INVALID_TERRITORY", `Unknown territory ${territoryId}.`);
  if (t.owner !== playerId) return err("NOT_OWNER", "The new Capital must be in your own territory.");
  const next = cloneState(s);
  const p = getPlayer(next, playerId);
  if (p.production < B.development.newCapitalCost) {
    return err("INSUFFICIENT_PRODUCTION", `A new Capital costs ${B.development.newCapitalCost} production.`);
  }
  p.production -= B.development.newCapitalCost;
  p.capitalTerritoryId = territoryId;
  p.capitalRebuildAvailableAfterRound = null;
  next.territories[territoryId].isCapital = true;
  pushLog(next, playerId, `Established a new Capital in ${AOE_TERRITORY_BY_ID[territoryId].name}.`);
  return { ok: true, state: next, result: undefined };
}

// --- cards ------------------------------------------------------------------------

/** Mutates: draw one card if hand limit allows. */
export function drawCard(s: AoEGameState, playerId: string): void {
  const p = getPlayer(s, playerId);
  if (p.cards.length >= B.cards.handLimit) {
    pushLog(s, playerId, "Hand limit reached; conquest card not drawn.");
    return;
  }
  if (s.cardDeck.length === 0) {
    // Reshuffle a fresh cycle deterministically.
    const rng = mulberry32(0);
    rng.restore(s.rngState);
    const deck: AoECardType[] = [];
    for (let cycle = 0; cycle < B.cards.deckCycles; cycle++) deck.push(...AOE_CARD_TYPES);
    for (let i = deck.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [deck[i], deck[j]] = [deck[j], deck[i]];
    }
    s.cardDeck = deck;
    s.rngState = rng.save();
  }
  const type = s.cardDeck.shift()!;
  p.cards.push({ id: `c${s.nextCardId++}`, type });
  pushLog(s, playerId, `Drew a conquest card (${type}).`);
}

export function tradeCardSet(s: AoEGameState, playerId: string, cardIds: string[]): AoEOutcome<number> {
  const phaseErr = requirePhase(s, "reinforce");
  if (phaseErr) return phaseErr;
  if (currentPlayerId(s) !== playerId) return err("WRONG_PLAYER", "Not this player's turn.");
  if (cardIds.length !== 3) return err("INVALID_CARD_SET", "A set is exactly 3 cards.");
  const p0 = getPlayer(s, playerId);
  const cards = cardIds.map((id) => p0.cards.find((c) => c.id === id));
  if (cards.some((c) => !c) || new Set(cardIds).size !== 3) {
    return err("INVALID_CARD", "Set contains cards you do not hold.");
  }
  const types = new Set(cards.map((c) => c!.type));
  let bonus: number;
  if (types.size === 1) bonus = B.cards.matchingSetReinforcements;
  else if (types.size === 3) bonus = B.cards.mixedSetReinforcements;
  else return err("INVALID_CARD_SET", "A set must be 3 matching or 3 different cards.");

  const next = cloneState(s);
  const p = getPlayer(next, playerId);
  p.cards = p.cards.filter((c) => !cardIds.includes(c.id));
  p.reinforcements += bonus;
  pushLog(next, playerId, `Traded a card set for +${bonus} reinforcements.`);
  return { ok: true, state: next, result: bonus };
}

export interface AoEPlayCardArgs {
  territoryId?: string;
  fromTerritoryId?: string;
  units?: ArmyStack;
}

export function playCard(s: AoEGameState, playerId: string, cardId: string, args: AoEPlayCardArgs = {}): AoEOutcome {
  if (s.gameOver) return err("GAME_OVER", "The game has ended.");
  if (currentPlayerId(s) !== playerId) {
    // Defensive cards may be played by the defender during someone else's battle.
    const card = getPlayer(s, playerId).cards.find((c) => c.id === cardId);
    if (!card || card.type !== "defensiveMobilization") {
      return err("WRONG_PLAYER", "Not this player's turn.");
    }
  }
  const p0 = getPlayer(s, playerId);
  const card = p0.cards.find((c) => c.id === cardId);
  if (!card) return err("INVALID_CARD", "You do not hold that card.");

  const next = cloneState(s);
  const p = getPlayer(next, playerId);
  const spend = () => {
    p.cards = p.cards.filter((c) => c.id !== cardId);
  };

  switch (card.type) {
    case "reinforcement": {
      const phaseErr = requirePhase(s, "reinforce");
      if (phaseErr) return phaseErr;
      spend();
      p.reinforcements += B.cards.reinforcementCardValue;
      pushLog(next, playerId, `Played Reinforcement card: +${B.cards.reinforcementCardValue}.`);
      break;
    }
    case "forcedMarch": {
      const phaseErr = requirePhase(s, "fortify");
      if (phaseErr) return phaseErr;
      spend();
      next.nextMoveBonus += B.cards.forcedMarchBonus;
      pushLog(next, playerId, "Played Forced March: +2 movement on the next move.");
      break;
    }
    case "rapidDeployment": {
      const phaseErr = requirePhase(s, "fortify");
      if (phaseErr) return phaseErr;
      spend();
      next.fortifyActionsRemaining += 1;
      pushLog(next, playerId, "Played Rapid Deployment: +1 fortify move.");
      break;
    }
    case "artillerySupport": {
      if (!next.battle || next.battle.attackerId !== playerId) {
        return err("NO_BATTLE", "Artillery Support applies to your active battle.");
      }
      spend();
      next.battle.attackDieBonus += 1;
      pushLog(next, playerId, "Played Artillery Support: +1 attack die modifier this battle.");
      break;
    }
    case "defensiveMobilization": {
      const tid = args.territoryId;
      if (!tid || !next.territories[tid]) return err("INVALID_TERRITORY", "Choose a territory to mobilize.");
      if (next.territories[tid].owner !== playerId) return err("NOT_OWNER", "Mobilize your own territory.");
      spend();
      next.defensiveMobilization = { territoryId: tid };
      pushLog(next, playerId, `Played Defensive Mobilization on ${AOE_TERRITORY_BY_ID[tid].name}.`);
      break;
    }
    case "emergencyDefense": {
      const { fromTerritoryId, territoryId, units } = args;
      if (!fromTerritoryId || !territoryId || !units) {
        return err("INVALID_ARGUMENT", "Emergency Defense needs from, to, and units.");
      }
      if (!isValidArmyStack(units)) return err("INVALID_ARGUMENT", "Invalid unit stack.");
      if (next.battle && (fromTerritoryId === next.battle.fromTerritoryId || fromTerritoryId === next.battle.toTerritoryId
        || territoryId === next.battle.fromTerritoryId || territoryId === next.battle.toTerritoryId)) {
        return err("BATTLE_IN_PROGRESS", "Cannot move units in or out of an active battle.");
      }
      const from = next.territories[fromTerritoryId];
      const to = next.territories[territoryId];
      if (!from || !to) return err("INVALID_TERRITORY", "Unknown territory.");
      if (from.owner !== playerId || to.owner !== playerId) return err("NOT_OWNER", "Both territories must be yours.");
      if (!AOE_TERRITORY_BY_ID[territoryId].adjacent.some((a) => next.territories[a].owner !== playerId && next.territories[a].owner !== null)) {
        return err("INVALID_ARGUMENT", "Target territory is not threatened by an enemy.");
      }
      const moving = unitCount(units);
      if (moving < 1 || moving > B.cards.emergencyDefenseMaxArmies) {
        return err("INVALID_ARGUMENT", `Move 1-${B.cards.emergencyDefenseMaxArmies} armies.`);
      }
      for (const [ut, n] of Object.entries(units) as [AoEUnitTypeId, number][]) {
        if ((from.units[ut] ?? 0) < n) return err("INSUFFICIENT_UNITS", `Not enough ${ut}.`);
      }
      if (unitCount(from.units) - moving < 1) return err("INSUFFICIENT_UNITS", "Must leave 1 unit behind.");
      spend();
      for (const [ut, n] of Object.entries(units) as [AoEUnitTypeId, number][]) {
        addUnits(from.units, ut, -n);
        addUnits(to.units, ut, n);
      }
      pushLog(next, playerId, `Played Emergency Defense: moved ${moving} armies to ${AOE_TERRITORY_BY_ID[territoryId].name}.`);
      break;
    }
  }
  return { ok: true, state: next, result: undefined };
}

// --- treaties -----------------------------------------------------------------

export function formTreaty(s: AoEGameState, a: string, b: string): AoEOutcome {
  if (s.gameOver) return err("GAME_OVER", "The game has ended.");
  if (a === b) return err("INVALID_ARGUMENT", "A treaty needs two players.");
  if (getPlayer(s, a).eliminated || getPlayer(s, b).eliminated) {
    return err("INVALID_ARGUMENT", "Eliminated players cannot form treaties.");
  }
  if (treatyActive(s, a, b)) return err("TREATY_ACTIVE", "These players already have an active treaty.");
  const next = cloneState(s);
  next.treaties.push({ players: [a, b], throughRound: next.round });
  pushLog(next, a, `Treaty formed between ${getPlayer(next, a).name} and ${getPlayer(next, b).name} for this round.`);
  return { ok: true, state: next, result: undefined };
}

// --- air support ----------------------------------------------------------------

export interface AoEAirSupportArgs {
  territoryId?: string;
  fromTerritoryId?: string;
  units?: ArmyStack;
}

export function useAirSupport(
  s: AoEGameState,
  playerId: string,
  effect: AoEAirSupportEffect,
  args: AoEAirSupportArgs = {},
): AoEOutcome {
  if (s.gameOver) return err("GAME_OVER", "The game has ended.");
  if (s.age !== "modern") return err("NO_AIR_SUPPORT", "Air Support is a Modern Age ability.");
  const p0 = getPlayer(s, playerId);
  if (p0.airSupportCharges < 1) return err("NO_AIR_SUPPORT", "No Air Support charges remaining.");
  // Offensive/logistic effects require it to be your turn; strikes and
  // redeployments are also barred while any battle is in progress so that
  // committed units and battle territories cannot be disturbed mid-combat.
  if (effect === "strike" || effect === "redeploy") {
    if (currentPlayerId(s) !== playerId) return err("WRONG_PLAYER", "Not this player's turn.");
    if (s.battle) return err("BATTLE_IN_PROGRESS", "Resolve the current battle first.");
  }
  if (effect === "attackBonus" && currentPlayerId(s) !== playerId) {
    return err("WRONG_PLAYER", "Not this player's turn.");
  }

  const next = cloneState(s);
  const p = getPlayer(next, playerId);

  switch (effect) {
    case "attackBonus": {
      if (!next.battle || next.battle.attackerId !== playerId) {
        return err("NO_BATTLE", "Air Support attack bonus applies to your active battle.");
      }
      next.battle.attackDieBonus += 1;
      break;
    }
    case "defenseBonus": {
      if (!next.battle || next.territories[next.battle.toTerritoryId].owner !== playerId) {
        return err("NO_BATTLE", "Air Support defense bonus applies while you are defending.");
      }
      next.battle.defenseDieBonus += 1;
      break;
    }
    case "strike": {
      // Limited distant strike: remove 1 unit from an enemy territory within 2
      // hops of any territory you own.
      const tid = args.territoryId;
      if (!tid || !next.territories[tid]) return err("INVALID_TERRITORY", "Choose a strike target.");
      const target = next.territories[tid];
      if (target.owner === playerId) return err("INVALID_ARGUMENT", "Cannot strike your own territory.");
      const owned = new Set(territoriesOwnedBy(next, playerId));
      const withinTwo = AOE_TERRITORY_BY_ID[tid].adjacent.some(
        (a) => owned.has(a) || AOE_TERRITORY_BY_ID[a].adjacent.some((b) => owned.has(b)),
      );
      if (!withinTwo) return err("INVALID_ARGUMENT", "Strike target must be within 2 territories of your borders.");
      if (unitCount(target.units) <= 1) return err("INVALID_ARGUMENT", "Air strikes cannot empty a territory.");
      // Remove the cheapest unit present (deterministic).
      const present = (Object.keys(target.units) as AoEUnitTypeId[])
        .filter((u) => (target.units[u] ?? 0) > 0)
        .sort((x, y) => AOE_UNIT_DEFS[x].cost - AOE_UNIT_DEFS[y].cost);
      addUnits(target.units, present[0], -1);
      pushLog(next, playerId, `Air strike on ${AOE_TERRITORY_BY_ID[tid].name}: 1 unit destroyed.`);
      break;
    }
    case "redeploy": {
      const { fromTerritoryId, territoryId, units } = args;
      if (!fromTerritoryId || !territoryId || !units) {
        return err("INVALID_ARGUMENT", "Redeploy needs from, to, and units.");
      }
      if (!isValidArmyStack(units)) return err("INVALID_ARGUMENT", "Invalid unit stack.");
      const from = next.territories[fromTerritoryId];
      const to = next.territories[territoryId];
      if (!from || !to) return err("INVALID_TERRITORY", "Unknown territory.");
      if (from.owner !== playerId || to.owner !== playerId) return err("NOT_OWNER", "Both territories must be yours.");
      const moving = unitCount(units);
      if (moving < 1 || moving > B.airSupport.redeployMaxUnits) {
        return err("INVALID_ARGUMENT", `Redeploy 1-${B.airSupport.redeployMaxUnits} units.`);
      }
      for (const [ut, n] of Object.entries(units) as [AoEUnitTypeId, number][]) {
        if ((from.units[ut] ?? 0) < n) return err("INSUFFICIENT_UNITS", `Not enough ${ut}.`);
      }
      if (unitCount(from.units) - moving < 1) return err("INSUFFICIENT_UNITS", "Must leave 1 unit behind.");
      for (const [ut, n] of Object.entries(units) as [AoEUnitTypeId, number][]) {
        addUnits(from.units, ut, -n);
        addUnits(to.units, ut, n);
      }
      pushLog(next, playerId, `Air redeployment: ${moving} units to ${AOE_TERRITORY_BY_ID[territoryId].name}.`);
      break;
    }
  }
  p.airSupportCharges -= 1;
  return { ok: true, state: next, result: undefined };
}

// --- objectives -----------------------------------------------------------------

export function objectiveMet(s: AoEGameState, playerId: string, def: AoEObjectiveDef, atGameEnd: boolean): boolean {
  switch (def.kind) {
    case "controlRegions":
      return regionsOwnedBy(s, playerId).length >= def.count;
    case "controlCities":
      return territoriesOwnedBy(s, playerId).filter((tid) => s.territories[tid].development.city).length >= def.count;
    case "controlSpecificRegion":
      return regionsOwnedBy(s, playerId).includes(def.regionId);
    case "holdCapitalToEnd": {
      if (!atGameEnd) return false;
      const p = getPlayer(s, playerId);
      // Must still hold the original, never-lost capital.
      return p.capitalTerritoryId !== null
        && p.capitalRebuildAvailableAfterRound === null
        && s.territories[p.capitalTerritoryId].owner === playerId;
    }
    case "controlResourceTerritories":
      return territoriesOwnedBy(s, playerId).filter((tid) => AOE_TERRITORY_BY_ID[tid].resource).length >= def.count;
    case "railwayNetwork":
      return largestRailwayNetwork(s, playerId) >= def.size;
  }
}

/** Mutates: marks newly completed objectives. Completion is permanent. */
export function checkObjectives(s: AoEGameState, playerId: string, atGameEnd = false): void {
  const p = getPlayer(s, playerId);
  for (const oid of p.objectiveIds) {
    if (p.completedObjectiveIds.includes(oid)) continue;
    const def = AOE_OBJECTIVE_DEFS.find((o) => o.id === oid)!;
    if (objectiveMet(s, playerId, def, atGameEnd)) {
      p.completedObjectiveIds.push(oid);
      pushLog(s, playerId, `Objective complete: ${def.description} (+${B.vp.objective} VP).`);
    }
  }
}

// --- scoring ---------------------------------------------------------------------

export interface AoEScore {
  playerId: string;
  territories: number;
  regions: number;
  cities: number;
  capital: number;
  resources: number;
  objectives: number;
  bonus: number;
  total: number;
}

export function computeScore(s: AoEGameState, playerId: string): AoEScore {
  const p = getPlayer(s, playerId);
  const owned = territoriesOwnedBy(s, playerId);
  const territories = owned.length * B.vp.territory;
  const regions = regionsOwnedBy(s, playerId).length * B.vp.region;
  const cities = owned.filter((tid) => s.territories[tid].development.city).length * B.vp.city;
  const capital = p.capitalTerritoryId && s.territories[p.capitalTerritoryId].owner === playerId ? B.vp.capital : 0;
  const resources = owned.filter((tid) => AOE_TERRITORY_BY_ID[tid].resource).length * B.vp.resourceTerritory;
  const objectives = p.completedObjectiveIds.length * B.vp.objective;
  const bonus = p.bonusVp;
  return {
    playerId, territories, regions, cities, capital, resources, objectives, bonus,
    total: territories + regions + cities + capital + resources + objectives + bonus,
  };
}

// --- turn / round / age progression ------------------------------------------------

export function advancePhase(s: AoEGameState, playerId: string): AoEOutcome {
  if (s.gameOver) return err("GAME_OVER", "The game has ended.");
  if (currentPlayerId(s) !== playerId) return err("WRONG_PLAYER", "Not this player's turn.");
  if (s.battle) return err("BATTLE_IN_PROGRESS", "Resolve or withdraw from the battle first.");
  const next = cloneState(s);
  const idx = AOE_PHASES.indexOf(next.phase);
  if (idx === AOE_PHASES.length - 1) return endTurn(next, playerId, true);
  next.phase = AOE_PHASES[idx + 1];
  pushLog(next, playerId, `Phase: ${next.phase}.`);
  return { ok: true, state: next, result: undefined };
}

/** External signal from the real-time table timer: the current Age's clock ran
 *  out. The Age does NOT change now — the current round finishes first. */
export function markAgeTimerExpired(s: AoEGameState): AoEGameState {
  if (s.ageTimerExpired || s.gameOver) return s;
  const next = cloneState(s);
  next.ageTimerExpired = true;
  pushLog(next, null, `${next.age} Age timer expired — the Age advances when this round completes.`);
  return next;
}

function awardAgeTransitionBonus(s: AoEGameState, endingAge: AoEAge): void {
  const alive = s.players.filter((p) => !p.eliminated);
  let metric: ((pid: string) => number) | null = null;
  let label = "";
  if (endingAge === "ancient") {
    metric = (pid) => territoriesOwnedBy(s, pid).length;
    label = "most territories";
  } else if (endingAge === "medieval") {
    metric = (pid) => territoriesOwnedBy(s, pid).filter((tid) => s.territories[tid].development.city).length;
    label = "most Cities";
  } else if (endingAge === "industrial") {
    metric = (pid) => largestRailwayNetwork(s, pid);
    label = "largest Railway network";
  }
  if (!metric) return;
  const values = alive.map((p) => ({ p, v: metric!(p.id) }));
  const max = Math.max(...values.map((x) => x.v));
  const leaders = values.filter((x) => x.v === max && max > 0);
  // Sole leader only — on a tie no bonus is awarded (keeps Age VP modest).
  if (leaders.length === 1) {
    leaders[0].p.bonusVp += B.vp.ageTransitionBonus;
    pushLog(s, leaders[0].p.id, `Age bonus: ${label} (+${B.vp.ageTransitionBonus} VP).`);
  } else {
    pushLog(s, null, `Age bonus for ${label}: tied — no award.`);
  }
}

function advanceAge(s: AoEGameState): void {
  const endingAge = s.age;
  awardAgeTransitionBonus(s, endingAge);
  const nextIdx = ageIndex(endingAge) + 1;
  if (nextIdx >= AOE_AGES.length) {
    finalizeGame(s);
    return;
  }
  s.age = AOE_AGES[nextIdx];
  s.ageTimerExpired = false;
  if (s.age === "modern") {
    for (const p of s.players) {
      if (!p.eliminated) p.airSupportCharges = B.airSupport.chargesOnModernAge;
    }
  }
  pushLog(s, null, `The ${s.age} Age begins.`);
}

/** Mutates: final scoring + winner determination (with tiebreakers). */
export function finalizeGame(s: AoEGameState): void {
  s.gameOver = true;
  const alive = s.players.filter((p) => !p.eliminated);
  for (const p of alive) checkObjectives(s, p.id, true);
  const scores = alive.map((p) => computeScore(s, p.id));
  const maxVp = Math.max(...scores.map((sc) => sc.total));
  let contenders = scores.filter((sc) => sc.total === maxVp).map((sc) => sc.playerId);
  const tiebreakers: ((pid: string) => number)[] = [
    (pid) => territoriesOwnedBy(s, pid).length,
    (pid) => territoriesOwnedBy(s, pid).filter((tid) => s.territories[tid].development.city).length,
    (pid) => territoriesOwnedBy(s, pid).reduce((sum, tid) => sum + unitCount(s.territories[tid].units), 0),
    (pid) => getPlayer(s, pid).completedObjectiveIds.length,
  ];
  for (const tb of tiebreakers) {
    if (contenders.length <= 1) break;
    const best = Math.max(...contenders.map(tb));
    contenders = contenders.filter((pid) => tb(pid) === best);
  }
  s.winnerIds = contenders; // >1 => shared victory
  pushLog(s, null, `Game over. Winner${contenders.length > 1 ? "s (shared)" : ""}: ${contenders.map((pid) => getPlayer(s, pid).name).join(", ")}.`);
}

/** Mutates + owns end-of-turn bookkeeping. Called via advancePhase from fortify. */
function endTurn(s: AoEGameState, playerId: string, alreadyCloned: boolean): AoEOutcome {
  const next = alreadyCloned ? s : cloneState(s);
  // Conquest card: capturing at least one PLAYER-owned territory this turn.
  if (next.capturedPlayerTerritoryThisTurn) drawCard(next, playerId);
  checkObjectives(next, playerId);

  const order = initiativeOrder(next);
  if (next.turnIndex < order.length - 1) {
    next.turnIndex += 1;
  } else {
    // Round complete.
    pushLog(next, null, `Round ${next.round} complete.`);
    if (next.ageTimerExpired) {
      advanceAge(next);
      if (next.gameOver) return { ok: true, state: next, result: undefined };
    }
    next.round += 1;
    next.turnIndex = 0;
    next.treaties = next.treaties.filter((t) => t.throughRound >= next.round);
  }
  beginTurn(next);
  return { ok: true, state: next, result: undefined };
}

// --- elimination / ownership change hooks (used by combat.ts) -----------------------

/** Mutates: handle everything that follows a territory changing owner. */
export function handleCapture(s: AoEGameState, capturerId: string, territoryId: string, previousOwner: string | null): void {
  const t = s.territories[territoryId];
  s.capturedAnyTerritoryThisTurn = true;
  if (previousOwner !== null) s.capturedPlayerTerritoryThisTurn = true;

  // Capital capture.
  if (t.isCapital && previousOwner !== null) {
    const loser = getPlayer(s, previousOwner);
    if (loser.capitalTerritoryId === territoryId) {
      loser.capitalTerritoryId = null;
      loser.capitalRebuildAvailableAfterRound = s.round;
      const capturer = getPlayer(s, capturerId);
      capturer.bonusVp += B.vp.capitalCapture;
      t.isCapital = false;
      pushLog(s, capturerId, `${capturer.name} captured ${loser.name}'s Capital (+${B.vp.capitalCapture} VP)!`);
    }
  }

  // Elimination: zero territories. If the eliminated player sits earlier in
  // this round's initiative order, shift turnIndex so the current player's
  // position in the (now shorter) order is preserved.
  if (previousOwner !== null && territoriesOwnedBy(s, previousOwner).length === 0) {
    const orderBefore = initiativeOrder(s);
    const loserIdx = orderBefore.indexOf(previousOwner);
    const loser = getPlayer(s, previousOwner);
    loser.eliminated = true;
    pushLog(s, previousOwner, `${loser.name} has been eliminated.`);
    if (loserIdx !== -1 && loserIdx < s.turnIndex) s.turnIndex -= 1;
  }
  checkObjectives(s, capturerId);
}

// --- view model ----------------------------------------------------------------------

export interface AoEGameView {
  currentPlayerId: string | null;
  age: AoEAge;
  ageDurationMs: number;
  ageTimerExpired: boolean;
  round: number;
  phase: AoEGameState["phase"];
  gameOver: boolean;
  winnerIds: string[] | null;
  players: Array<{
    id: string;
    name: string;
    color: string;
    faction?: string;
    eliminated: boolean;
    reinforcements: number;
    production: number;
    vp: number;
    cards: AoECard[];
    objectives: Array<{ id: string; description: string; completed: boolean }>;
    airSupportCharges: number;
    capitalTerritoryId: string | null;
  }>;
  territories: Array<{
    id: string;
    name: string;
    region: string;
    owner: string | null;
    units: ArmyStack;
    unitTotal: number;
    development: AoETerritoryState["development"];
    resource?: string;
    isCapital: boolean;
    adjacent: readonly string[];
  }>;
  validAttacks: Array<{ from: string; to: string }>;
  validMoves: Array<{ from: string; to: string }>;
  battle: AoEGameState["battle"];
  log: AoEGameState["log"];
}

export function getGameView(
  s: AoEGameState,
  validAttacks: Array<{ from: string; to: string }>,
  validMoves: Array<{ from: string; to: string }>,
): AoEGameView {
  return {
    currentPlayerId: s.gameOver ? null : currentPlayerId(s),
    age: s.age,
    ageDurationMs: B.ageDurationMs,
    ageTimerExpired: s.ageTimerExpired,
    round: s.round,
    phase: s.phase,
    gameOver: s.gameOver,
    winnerIds: s.winnerIds,
    players: s.players.map((p) => ({
      id: p.id,
      name: p.name,
      color: p.color,
      faction: p.faction,
      eliminated: p.eliminated,
      reinforcements: p.reinforcements,
      production: p.production,
      vp: computeScore(s, p.id).total,
      cards: p.cards.map((c) => ({ ...c })),
      objectives: p.objectiveIds.map((oid) => ({
        id: oid,
        description: AOE_OBJECTIVE_DEFS.find((o) => o.id === oid)!.description,
        completed: p.completedObjectiveIds.includes(oid),
      })),
      airSupportCharges: p.airSupportCharges,
      capitalTerritoryId: p.capitalTerritoryId,
    })),
    territories: Object.values(s.territories).map((t) => {
      const def = AOE_TERRITORY_BY_ID[t.defId];
      return {
        id: t.defId,
        name: def.name,
        region: def.region,
        owner: t.owner,
        units: { ...t.units },
        unitTotal: unitCount(t.units),
        development: { ...t.development },
        resource: def.resource,
        isCapital: t.isCapital,
        adjacent: def.adjacent,
      };
    }),
    validAttacks,
    validMoves,
    battle: s.battle
      ? {
          ...s.battle,
          committed: { ...s.battle.committed },
          rounds: s.battle.rounds.map((r) => ({
            ...r,
            attackerDice: [...r.attackerDice],
            defenderDice: [...r.defenderDice],
            modifiedAttackerDice: [...r.modifiedAttackerDice],
            modifiedDefenderDice: [...r.modifiedDefenderDice],
          })),
        }
      : null,
    log: [...s.log],
  };
}
