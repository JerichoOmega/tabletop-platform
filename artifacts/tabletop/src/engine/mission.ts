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
  readonly locations: {
    readonly watchtower: { readonly wx: number; readonly wy: number };
  };
}

export interface MissionState {
  readonly currentMission: MissionDefinition;
  readonly phase: MissionPhase;
  readonly approach: MissionApproach | null;
  readonly primaryObjectiveProgress: ObjectiveProgress;
  readonly optionalObjectiveProgress: ObjectiveProgress;
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
    id: "take-ridge-approach",
    title: "Take the safer ridge approach",
    description: "Choose the ridge route before entering the watchtower approach.",
  },
  startingState: {
    phase: "MISSION_BRIEFING",
    escalationState: "briefing",
  },
  successCondition: {
    primaryObjectiveId: "recover-signal-beacon",
    optionalObjectiveId: "take-ridge-approach",
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
  ],
  completionOutcomeMapping: {
    optional_complete: "SUCCESS",
    optional_incomplete: "SUCCESS_AT_COST",
  },
  approachChoices: [
    {
      id: "direct",
      title: "Take the direct road",
      description: "Reach the tower quickly, accepting that the approach is exposed.",
    },
    {
      id: "ridge",
      title: "Take the safer ridge",
      description: "Circle along the ridge before closing on the tower.",
    },
  ],
  locations: {
    watchtower: { wx: 20, wy: 8 },
  },
};

const VALID_PHASES: readonly MissionPhase[] = [
  "MISSION_BRIEFING", "EXPLORATION", "ESCALATION", "CLIMAX", "RESOLUTION", "RETURN",
];
const VALID_APPROACHES: readonly MissionApproach[] = ["direct", "ridge"];
const VALID_OUTCOMES: readonly MissionOutcome[] = [
  "SUCCESS", "SUCCESS_AT_COST", "PARTIAL_SUCCESS", "FAILURE", "RETREAT",
];

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
  for (const outcome of Object.values(definition.completionOutcomeMapping)) {
    if (!VALID_OUTCOMES.includes(outcome)) errors.push(`invalid completion outcome: ${outcome}`);
  }
  if (!Number.isInteger(definition.locations.watchtower.wx) || !Number.isInteger(definition.locations.watchtower.wy)) {
    errors.push("watchtower location must use integer coordinates");
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
    primaryObjectiveProgress: "not_started",
    optionalObjectiveProgress: "not_started",
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

/** A route choice starts the finite mission and records its optional result. */
export function chooseMissionApproach(state: MissionState, approach: MissionApproach): MissionState {
  if (state.phase !== "MISSION_BRIEFING") return state;
  const optionalObjectiveProgress = approach === "ridge" ? "complete" : "in_progress";
  return withFlag({
    ...state,
    phase: "EXPLORATION",
    approach,
    primaryObjectiveProgress: "in_progress",
    optionalObjectiveProgress,
    escalationState: "briefing",
  }, approach === "ridge" ? "ridge-approach" : "direct-approach");
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
  return {
    ...state,
    phase: "CLIMAX",
    escalationState: "beacon-guarded",
  };
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