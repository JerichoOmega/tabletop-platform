// ---------------------------------------------------------------------------
// Ages of Empire — types + centralized balance configuration.
//
// This domain is fully separate from the tactical combat engine. It models a
// Risk-style territory-conquest game with a light civilization layer. All
// state transitions are pure: every rules function takes a GameState and
// returns a new one (or a typed error). All randomness flows through the
// shared seeded mulberry32 Rng; the RNG position is stored in state so games
// are reproducible from (seed, action list).
// ---------------------------------------------------------------------------

export type AoEAge = "ancient" | "medieval" | "industrial" | "modern";
export const AOE_AGES: readonly AoEAge[] = ["ancient", "medieval", "industrial", "modern"];

export type AoEPhase = "reinforce" | "develop" | "attack" | "fortify";
export const AOE_PHASES: readonly AoEPhase[] = ["reinforce", "develop", "attack", "fortify"];

export type AoEUnitTypeId =
  | "infantry"
  | "cavalry"
  | "spearman"
  | "knight"
  | "rifleman"
  | "artillery"
  | "tank"
  | "mechInfantry"
  | "modernArmor";

export type AoEResource = "food" | "iron" | "gold" | "oil";

export type AoERegionSize = "small" | "medium" | "large";

export type AoEFactionId = "romans" | "mongols" | "british" | "germans" | "americans";

export type AoECardType =
  | "reinforcement"
  | "forcedMarch"
  | "defensiveMobilization"
  | "rapidDeployment"
  | "artillerySupport"
  | "emergencyDefense";

export type AoEAirSupportEffect = "attackBonus" | "defenseBonus" | "strike" | "redeploy";

export type AoEDevelopmentKind = "city" | "fort" | "road" | "railway" | "factory";

/** Army composition on a territory: unit type -> count. Absent key = 0. */
export type ArmyStack = Partial<Record<AoEUnitTypeId, number>>;

// --- content definition shapes (static, data-driven) -----------------------

export interface AoEUnitDef {
  id: AoEUnitTypeId;
  name: string;
  age: AoEAge;
  /** Recruitment cost in Reinforcements. */
  cost: number;
  movement: number;
  /** +1 to the highest attack die. */
  highestAttackBonus?: boolean;
  /** Modified die also wins ties (Modern Armor). */
  winsTies?: boolean;
  /** One attack die may be rerolled once per battle. */
  reroll?: boolean;
  /** +1 defensive die against mounted attackers (Spearmen). */
  antiCavalryDefense?: boolean;
  /** +1 to highest attack die when attacking a Fort (Artillery). */
  fortBreaker?: boolean;
  /** Mounted flag (triggers Spearman defense, Mongol passive, ...). */
  mounted?: boolean;
}

export interface AoETerritoryDef {
  id: string;
  name: string;
  region: string;
  adjacent: readonly string[];
  resource?: AoEResource;
}

export interface AoERegionDef {
  id: string;
  name: string;
  size: AoERegionSize;
  territories: readonly string[];
}

export interface AoEFactionDef {
  id: AoEFactionId;
  name: string;
  /** One modest passive, expressed as data. */
  passive:
    | { kind: "fortDiscount"; amount: number }
    | { kind: "mountedMovementBonus"; amount: number }
    | { kind: "cityProductionBonus"; amount: number }
    | { kind: "factoryProductionBonus"; amount: number }
    | { kind: "modernUnitDiscount"; amount: number };
}

export type AoEObjectiveDef =
  | { id: string; description: string; kind: "controlRegions"; count: number }
  | { id: string; description: string; kind: "controlCities"; count: number }
  | { id: string; description: string; kind: "controlSpecificRegion"; regionId: string }
  | { id: string; description: string; kind: "holdCapitalToEnd" }
  | { id: string; description: string; kind: "controlResourceTerritories"; count: number }
  | { id: string; description: string; kind: "railwayNetwork"; size: number };

// --- runtime state ----------------------------------------------------------

export interface AoEDevelopmentState {
  city: boolean;
  fort: boolean;
  road: boolean;
  railway: boolean;
  factory: boolean;
}

export interface AoETerritoryState {
  defId: string;
  /** Player id, or null for neutral. */
  owner: string | null;
  units: ArmyStack;
  development: AoEDevelopmentState;
  isCapital: boolean;
}

export interface AoECard {
  id: string;
  type: AoECardType;
}

export interface AoETreaty {
  players: [string, string];
  /** Treaty blocks direct attacks through the end of this round. */
  throughRound: number;
}

export interface AoEPlayerState {
  id: string;
  name: string;
  color: string;
  faction?: AoEFactionId;
  capitalTerritoryId: string | null;
  /** Round after which a lost capital may be re-established (develop phase). */
  capitalRebuildAvailableAfterRound: number | null;
  /** Unspent reinforcements for the current turn. */
  reinforcements: number;
  /** Banked production (capped at BALANCE.productionCap). */
  production: number;
  cards: AoECard[];
  objectiveIds: string[];
  completedObjectiveIds: string[];
  /** Event VP (capital captures, age-transition bonuses). Positional VP is derived. */
  bonusVp: number;
  eliminated: boolean;
  airSupportCharges: number;
  /** Iron passive: first qualifying recruit each turn is discounted. */
  ironDiscountUsedThisTurn: boolean;
  factoriesBuilt: number;
}

export interface AoEBattleState {
  attackerId: string;
  fromTerritoryId: string;
  toTerritoryId: string;
  /** Units committed to this battle (still located in `from` until capture). */
  committed: ArmyStack;
  rerollUsed: boolean;
  /** One-battle card/air-support modifiers. */
  attackDieBonus: number;
  defenseDieBonus: number;
  rounds: AoECombatRoundResult[];
}

export interface AoECombatRoundResult {
  attackerDice: number[];
  defenderDice: number[];
  /** Dice after sorting + modifiers, as compared. */
  modifiedAttackerDice: number[];
  modifiedDefenderDice: number[];
  attackerLosses: number;
  defenderLosses: number;
  rerolled: boolean;
  captured: boolean;
}

export interface AoELogEntry {
  round: number;
  age: AoEAge;
  playerId: string | null;
  message: string;
}

export interface AoEGameState {
  /** Static content keyed for lookup convenience; never mutated. */
  mapId: string;
  players: AoEPlayerState[];
  territories: Record<string, AoETerritoryState>;
  /** Player ids in the base seating order (round 1 order). */
  seatingOrder: string[];
  round: number;
  /** Index into the current round's initiative order. */
  turnIndex: number;
  age: AoEAge;
  phase: AoEPhase;
  /** Set externally when the real-time Age timer expires; the Age advances
   *  only after the current round completes. */
  ageTimerExpired: boolean;
  /** Remaining fortify move actions for the current player. */
  fortifyActionsRemaining: number;
  /** +movement applied to the next fortify action (Forced March). */
  nextMoveBonus: number;
  /** Territories that attacked-and-withdrew this Attack phase (cannot re-attack). */
  withdrawnTerritories: string[];
  battle: AoEBattleState | null;
  /** Whether the current player captured at least one player-owned territory this turn. */
  capturedPlayerTerritoryThisTurn: boolean;
  capturedAnyTerritoryThisTurn: boolean;
  treaties: AoETreaty[];
  /** One-territory / one-combat-round defensive card effect. */
  defensiveMobilization: { territoryId: string } | null;
  cardDeck: AoECardType[];
  nextCardId: number;
  rngState: number;
  gameOver: boolean;
  winnerIds: string[] | null;
  log: AoELogEntry[];
}

// --- errors -----------------------------------------------------------------

export type AoEErrorCode =
  | "WRONG_PHASE"
  | "WRONG_PLAYER"
  | "GAME_OVER"
  | "INVALID_TERRITORY"
  | "NOT_OWNER"
  | "NOT_ADJACENT"
  | "INSUFFICIENT_UNITS"
  | "INSUFFICIENT_REINFORCEMENTS"
  | "INSUFFICIENT_PRODUCTION"
  | "UNIT_NOT_AVAILABLE"
  | "INVALID_UPGRADE"
  | "ALREADY_BUILT"
  | "BUILD_NOT_AVAILABLE"
  | "FACTORY_LIMIT"
  | "NO_BATTLE"
  | "BATTLE_IN_PROGRESS"
  | "CAPITAL_PROTECTED"
  | "TREATY_ACTIVE"
  | "NO_MOVES_REMAINING"
  | "INVALID_PATH"
  | "INVALID_CARD"
  | "HAND_LIMIT"
  | "INVALID_CARD_SET"
  | "NO_AIR_SUPPORT"
  | "CAPITAL_EXISTS"
  | "CAPITAL_REBUILD_NOT_READY"
  | "TERRITORY_WITHDRAWN"
  | "UNREINFORCED"
  | "INVALID_ARGUMENT";

export interface AoEError {
  ok: false;
  code: AoEErrorCode;
  message: string;
}

export interface AoEOk<T = undefined> {
  ok: true;
  state: AoEGameState;
  result: T;
}

export type AoEOutcome<T = undefined> = AoEOk<T> | AoEError;

// --- balance configuration ---------------------------------------------------
// Every numeric balance value lives here so Balance Pass 2.0 can tune the game
// without touching rules logic.

export const AOE_BALANCE = {
  players: { min: 2, max: 6 },
  ageDurationMs: 15 * 60 * 1000,

  reinforcements: {
    territoryDivisor: 3,
    minimum: 3,
    regionBonus: { small: 2, medium: 3, large: 5 } as Record<AoERegionSize, number>,
    capitalBonus: 1,
    foodBonus: 1,
  },

  production: {
    cap: 10,
    normalTerritory: 1,
    developedTerritory: 2, // territory with road/railway/fort, no city
    cityTerritory: 3,
    factoryBonus: 2,
    goldBonus: 2,
  },

  development: {
    cityCost: 6,
    fortCost: 4,
    roadCost: 2,
    railwayUpgradeCost: 3,
    factoryCost: 8,
    factoryLimitPerPlayer: 3,
    newCapitalCost: 4,
  },

  combat: {
    maxAttackDice: 3,
    maxDefenseDice: 2,
    maxCasualtiesPerRound: 2,
    dieFaces: 6,
    maxDieValue: 6,
    fortDefenseBonus: 1,
    cityDefenseBonus: 1,
    combinedArmsBonus: 1,
    combinedArmsUnitTypes: 3,
    /** +1 from units with the highestAttackBonus flag. */
    unitHighestAttackBonus: 1,
    /** Artillery bonus when attacking a Fort. */
    fortBreakerBonus: 1,
    /** Spearmen defensive bonus against mounted attackers. */
    antiCavalryDefenseBonus: 1,
    /** One-battle card / air-support die modifier. */
    battleEffectBonus: 1,
  },

  /** Unit recruitment costs (reinforcements) and base movement. Content
   *  definitions in content.ts read from here. */
  units: {
    costs: {
      infantry: 1, cavalry: 2, spearman: 1, knight: 3, rifleman: 2,
      artillery: 3, tank: 4, mechInfantry: 3, modernArmor: 5,
    } as Record<AoEUnitTypeId, number>,
    movement: {
      infantry: 1, cavalry: 2, spearman: 1, knight: 2, rifleman: 1,
      artillery: 1, tank: 2, mechInfantry: 3, modernArmor: 4,
    } as Record<AoEUnitTypeId, number>,
  },

  /** Faction passive magnitudes. Content definitions read from here. */
  factions: {
    fortDiscount: 1,
    mountedMovementBonus: 1,
    cityProductionBonus: 1,
    factoryProductionBonus: 1,
    modernUnitDiscount: 1,
  },

  resources: { oilMovementBonus: 1 },

  cards: {
    deckCycles: 8,
    handLimit: 5,
    matchingSetReinforcements: 4,
    mixedSetReinforcements: 6,
    reinforcementCardValue: 3,
    forcedMarchBonus: 2,
    emergencyDefenseMaxArmies: 3,
  },

  vp: {
    territory: 1,
    region: 5,
    city: 2,
    capital: 3,
    resourceTerritory: 1,
    objective: 4,
    capitalCapture: 2,
    ageTransitionBonus: 2,
  },

  objectives: { perPlayer: 3 },

  setup: {
    startingInfantry: 15,
    startingCavalry: 2,
    startingProduction: 5,
    neutralInfantryMin: 2,
    neutralInfantryMax: 4,
  },

  airSupport: { chargesOnModernAge: 2, redeployMaxUnits: 3, strikeMaxUnits: 1 },

  upgrades: { productionSurcharge: 1 },

  movement: {
    baseHops: 1,
    roadHops: 2,
  },
} as const;

export type AoEBalance = typeof AOE_BALANCE;
