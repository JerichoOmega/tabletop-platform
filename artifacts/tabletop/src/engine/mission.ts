// ---------------------------------------------------------------------------
// RPG MISSION CONTRACT — the smallest data-driven mission slice.
//
// This is intentionally not a quest database. It defines one finite episode
// and pure transitions over its state. WorldState remains the authority for
// positions/entities; this module only owns mission intent and progression.
// ---------------------------------------------------------------------------

export type MissionPhase =
  | "MISSION_BRIEFING"
  | "EXPLORATION"
  | "ESCALATION"
  | "CLIMAX"
  | "RESOLUTION"
  | "RETURN";

export type MissionOutcome =
  | "SUCCESS"
  | "SUCCESS_AT_COST"
  | "PARTIAL_SUCCESS"
  | "FAILURE"
  | "RETREAT";

export type MissionApproach = "direct" | "ridge";
export type ObjectiveProgress = "not_started" | "in_progress" | "complete";
export type MissionRouteLength = "short" | "long";
export type MissionExposure = "exposed" | "covered";

export interface MissionRouteProfile {
  readonly routeLength: MissionRouteLength;
  readonly exposure: MissionExposure;
  readonly partySpawn: { readonly wx: number; readonly wy: number };
  readonly hostileSpawn: { readonly wx: number; readonly wy: number };
}

/** The one authored optional interaction on the safer route. */
export const RIDGE_CACHE_LOCATION = Object.freeze({
  id: "ridge-supply-cache",
  name: "Abandoned Ranger Cache",
  kind: "discovery" as const,
  prompt: "Open Ranger Cache",
  icon: "camp" as const,
  wx: 12,
  wy: 6,
});

export interface MissionObjective {
  readonly id: string;
  readonly title: string;
  readonly description: string;
}

export interface MissionApproachChoice {
  readonly id: MissionApproach;
  readonly title: string;
  readonly description: string;
}

export interface MissionEscalationState {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly phase: MissionPhase;
}

export interface MissionDefinition {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly primaryObjective: MissionObjective;
  readonly optionalObjective: MissionObjective;
  readonly startingState: {
    readonly phase: "MISSION_BRIEFING";
    readonly escalationState: string;
  };
  readonly successCondition: {
    readonly primaryObjectiveId: string;
    readonly optionalObjectiveId: string;
  };
  readonly failureCondition: {
    readonly trigger: "climax_defeat";
    readonly recoveryPhase: "EXPLORATION";
  };
  readonly retreatCondition: {
    readonly allowedFrom: readonly MissionPhase[];
    readonly outcome: "RETREAT";
  };
  readonly escalationStates: readonly MissionEscalationState[];
  readonly completionOutcomeMapping: Readonly<Record<"optional_complete" | "optional_incomplete", MissionOutcome>>;
  readonly approachChoices: readonly MissionApproachChoice[];
  readonly routeProfiles: Readonly<Record<MissionApproach, MissionRouteProfile>>;
  readonly locations: {
    readonly watchtower: { readonly wx: number; readonly wy: number };
    readonly ridgeCache: { readonly wx: number; readonly wy: number };
  };
}

export interface MissionState {
  readonly currentMission: MissionDefinition;
  readonly phase: MissionPhase;
  readonly approach: MissionApproach | null;
  readonly routeLength: MissionRouteLength | null;
  readonly exposure: MissionExposure | null;
  readonly primaryObjectiveProgress: ObjectiveProgress;
  readonly optionalObjectiveProgress: ObjectiveProgress;
  readonly tacticalAdvantage: boolean;
  readonly escalationState: string;
  readonly outcome: MissionOutcome | null;
  readonly completed: boolean;
  readonly consequenceFlags: readonly string[];
}

export const WATCHTOWER_MISSION: MissionDefinition = {
  id: "ruined-watchtower",
  title: "The Ruined Watchtower",
  description:
    "A weathered signal beacon has gone dark at the edge of the wilderness. " +
    "Reach the ruined watchtower, recover its beacon, and learn what silenced it.",
  primaryObjective: {
    id: "recover-signal-beacon",
    title: "Recover the signal beacon",
    description: "Reach the ruined watchtower and recover its signal beacon.",
  },
  optionalObjective: {
    id: "ridge-supply-cache",
    title: "Open the ranger supply cache",
    description: "Find the abandoned cache on the ridge and secure its tactical supplies.",
  },
  startingState: {
    phase: "MISSION_BRIEFING",
    escalationState: "briefing",
  },
  successCondition: {
    primaryObjectiveId: "recover-signal-beacon",
    optionalObjectiveId: "ridge-supply-cache",
  },
  failureCondition: {
    trigger: "climax_defeat",
    recoveryPhase: "EXPLORATION",
  },
  retreatCondition: {
    allowedFrom: ["EXPLORATION", "ESCALATION", "CLIMAX"],
    outcome: "RETREAT",
  },
  escalationStates: [
    {
      id: "briefing",
      title: "Briefing",
      description: "Choose how the party will approach the watchtower.",
      phase: "MISSION_BRIEFING",
    },
    {
      id: "watchtower-approach",
      title: "The beacon stirs",
      description: "The watchtower beacon flares. Something inside is waiting.",
      phase: "ESCALATION",
    },
    {
      id: "beacon-guarded",
      title: "The beacon is guarded",
      description: "The old signal cannot be recovered until its guardian falls.",
      phase: "CLIMAX",
    },
    {
      id: "beacon-guarded-exposed",
      title: "The beacon is guarded — exposed",
      description: "The direct road leaves the party exposed as the guardian closes in.",
      phase: "CLIMAX",
    },
    {
      id: "beacon-guarded-with-advantage",
      title: "The beacon is guarded — tactical opening",
      description: "The ridge cache reveals a safer angle and gives the party a tactical opening.",
      phase: "CLIMAX",
    },
  ],
  completionOutcomeMapping: {
    optional_complete: "SUCCESS",
    optional_incomplete: "SUCCESS_AT_COST",
  },
  approachChoices: [
    {
      id: "direct",
      title: "Take the direct road",
      description: "Reach the tower quickly on a short, exposed road. Hostile pressure will find you sooner.",
    },
    {
      id: "ridge",
      title: "Take the safer ridge",
      description: "Take the longer ridge path. An abandoned ranger cache may offer an advantage before the tower.",
    },
  ],
  routeProfiles: {
    direct: {
      routeLength: "short",
      exposure: "exposed",
      partySpawn: { wx: 17, wy: 8 },
      hostileSpawn: { wx: 20, wy: 8 },
    },
    ridge: {
      routeLength: "long",
      exposure: "covered",
      partySpawn: { wx: 8, wy: 8 },
      hostileSpawn: { wx: 20, wy: 8 },
    },
  },
  locations: {
    watchtower: { wx: 20, wy: 8 },
    ridgeCache: { wx: RIDGE_CACHE_LOCATION.wx, wy: RIDGE_CACHE_LOCATION.wy },
  },
};

const VALID_PHASES: readonly MissionPhase[] = [
  "MISSION_BRIEFING", "EXPLORATION", "ESCALATION", "CLIMAX", "RESOLUTION", "RETURN",
];
const VALID_APPROACHES: readonly MissionApproach[] = ["direct", "ridge"];
const VALID_OUTCOMES: readonly MissionOutcome[] = [
  "SUCCESS", "SUCCESS_AT_COST", "PARTIAL_SUCCESS", "FAILURE", "RETREAT",
];
const VALID_ROUTE_LENGTHS: readonly MissionRouteLength[] = ["short", "long"];
const VALID_EXPOSURES: readonly MissionExposure[] = ["exposed", "covered"];

/** Returns all contract violations; an empty list means the contract is valid. */
export function validateMissionDefinition(definition: MissionDefinition): string[] {
  const errors: string[] = [];
  if (!definition.id.trim()) errors.push("mission id is required");
  if (!definition.title.trim()) errors.push("mission title is required");
  if (!definition.description.trim()) errors.push("mission description is required");
  if (definition.startingState.phase !== "MISSION_BRIEFING") {
    errors.push("missions must start in MISSION_BRIEFING");
  }
  if (!VALID_PHASES.includes(definition.failureCondition.recoveryPhase)) {
    errors.push("failure recovery phase is invalid");
  }
  if (definition.successCondition.primaryObjectiveId !== definition.primaryObjective.id) {
    errors.push("success condition references the wrong primary objective");
  }
  if (definition.successCondition.optionalObjectiveId !== definition.optionalObjective.id) {
    errors.push("success condition references the wrong optional objective");
  }
  const escalationIds = new Set<string>();
  for (const escalation of definition.escalationStates) {
    if (escalationIds.has(escalation.id)) errors.push(`duplicate escalation state: ${escalation.id}`);
    escalationIds.add(escalation.id);
    if (!VALID_PHASES.includes(escalation.phase)) errors.push(`invalid escalation phase: ${escalation.id}`);
  }
  if (!escalationIds.has(definition.startingState.escalationState)) {
    errors.push("starting escalation state is missing");
  }
  if (!VALID_APPROACHES.every((id) => definition.approachChoices.some((choice) => choice.id === id))) {
    errors.push("both direct and ridge approaches are required");
  }
  for (const approach of VALID_APPROACHES) {
    const profile = definition.routeProfiles[approach];
    if (!profile) {
      errors.push(`route profile is missing: ${approach}`);
      continue;
    }
    if (!VALID_ROUTE_LENGTHS.includes(profile.routeLength)) {
      errors.push(`invalid route length: ${approach}`);
    }
    if (!VALID_EXPOSURES.includes(profile.exposure)) {
      errors.push(`invalid route exposure: ${approach}`);
    }
    for (const point of [profile.partySpawn, profile.hostileSpawn]) {
      if (!Number.isInteger(point.wx) || !Number.isInteger(point.wy)) {
        errors.push(`route profile coordinates must be integers: ${approach}`);
      }
    }
  }
  for (const outcome of Object.values(definition.completionOutcomeMapping)) {
    if (!VALID_OUTCOMES.includes(outcome)) errors.push(`invalid completion outcome: ${outcome}`);
  }
  if (!Number.isInteger(definition.locations.watchtower.wx) || !Number.isInteger(definition.locations.watchtower.wy)) {
    errors.push("watchtower location must use integer coordinates");
  }
  if (!Number.isInteger(definition.locations.ridgeCache.wx) || !Number.isInteger(definition.locations.ridgeCache.wy)) {
    errors.push("ridge cache location must use integer coordinates");
  }
  return errors;
}

export function assertValidMissionDefinition(definition: MissionDefinition): void {
  const errors = validateMissionDefinition(definition);
  if (errors.length > 0) throw new Error(`Invalid mission "${definition.id}": ${errors.join("; ")}`);
}

export function createMissionState(definition: MissionDefinition = WATCHTOWER_MISSION): MissionState {
  assertValidMissionDefinition(definition);
  return {
    currentMission: definition,
    phase: definition.startingState.phase,
    approach: null,
    routeLength: null,
    exposure: null,
    primaryObjectiveProgress: "not_started",
    optionalObjectiveProgress: "not_started",
    tacticalAdvantage: false,
    escalationState: definition.startingState.escalationState,
    outcome: null,
    completed: false,
    consequenceFlags: [],
  };
}

function withFlag(state: MissionState, flag: string): MissionState {
  return state.consequenceFlags.includes(flag)
    ? state
    : { ...state, consequenceFlags: [...state.consequenceFlags, flag] };
}

/** A route choice starts the finite mission and records its route consequences. */
export function chooseMissionApproach(state: MissionState, approach: MissionApproach): MissionState {
  if (state.phase !== "MISSION_BRIEFING") return state;
  const profile = state.currentMission.routeProfiles[approach];
  const next = withFlag({
    ...state,
    phase: "EXPLORATION",
    approach,
    routeLength: profile.routeLength,
    exposure: profile.exposure,
    primaryObjectiveProgress: "in_progress",
    optionalObjectiveProgress: approach === "ridge" ? "in_progress" : "not_started",
    tacticalAdvantage: false,
    escalationState: "briefing",
  }, `${approach}-approach`);
  return profile.exposure === "exposed" ? withFlag(next, "exposed-approach") : next;
}

/** The ridge reward is a one-time authored opportunity, not a generic quest. */
export function completeRidgeOpportunity(state: MissionState): MissionState {
  if (
    state.phase !== "EXPLORATION" ||
    state.approach !== "ridge" ||
    state.optionalObjectiveProgress !== "in_progress"
  ) return state;
  return withFlag({
    ...state,
    optionalObjectiveProgress: "complete",
    tacticalAdvantage: true,
  }, "ridge-cache-advantage");
}

/** Reaching the authored watchtower location advances the escalation graph. */
export function advanceMissionAtWatchtower(state: MissionState, wx: number, wy: number): MissionState {
  const tower = state.currentMission.locations.watchtower;
  if (state.phase !== "EXPLORATION" || wx !== tower.wx - 1 || wy !== tower.wy) return state;
  return {
    ...state,
    phase: "ESCALATION",
    primaryObjectiveProgress: "in_progress",
    escalationState: "watchtower-approach",
  };
}

/** The existing world-backed encounter is the mission's one climax. */
export function beginMissionClimax(state: MissionState): MissionState {
  if (state.phase !== "ESCALATION") return state;
  const escalationState = state.tacticalAdvantage
    ? "beacon-guarded-with-advantage"
    : state.exposure === "exposed"
      ? "beacon-guarded-exposed"
      : "beacon-guarded";
  const next: MissionState = {
    ...state,
    phase: "CLIMAX",
    escalationState,
  };
  return state.tacticalAdvantage
    ? withFlag(next, "tactical-climax")
    : state.exposure === "exposed"
      ? withFlag(next, "exposed-climax")
      : next;
}

/** Victory resolves the primary objective and records the concrete outcome. */
export function resolveMissionVictory(state: MissionState): MissionState {
  if (state.phase !== "CLIMAX") return state;
  const optionalComplete = state.optionalObjectiveProgress === "complete";
  return withFlag({
    ...state,
    phase: "RESOLUTION",
    primaryObjectiveProgress: "complete",
    outcome: state.currentMission.completionOutcomeMapping[
      optionalComplete ? "optional_complete" : "optional_incomplete"
    ],
    completed: true,
    escalationState: "beacon-guarded",
  }, optionalComplete ? "beacon-recovered" : "beacon-recovered-at-cost");
}

/** Defeat recovers to exploration so a player can make another attempt. */
export function recoverFromMissionDefeat(state: MissionState): MissionState {
  if (state.phase !== "CLIMAX") return state;
  return withFlag({
    ...state,
    phase: "EXPLORATION",
    outcome: null,
    completed: false,
    escalationState: "watchtower-approach",
  }, "watchtower-defeat");
}

/** Retreat is an explicit terminal outcome, never an ambiguous dead state. */
export function retreatFromMission(state: MissionState): MissionState {
  if (!state.currentMission.retreatCondition.allowedFrom.includes(state.phase)) return state;
  return withFlag({
    ...state,
    phase: "RESOLUTION",
    outcome: state.currentMission.retreatCondition.outcome,
    completed: true,
  }, "party-retreated");
}

export function returnFromMission(state: MissionState): MissionState {
  if (state.phase !== "RESOLUTION") return state;
  return { ...state, phase: "RETURN" };
}

export function resetMission(state: MissionState): MissionState {
  return createMissionState(state.currentMission);
}