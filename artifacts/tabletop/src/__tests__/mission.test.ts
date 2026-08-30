import { describe, expect, it } from "vitest";
import {
  WATCHTOWER_MISSION,
  advanceMissionAtWatchtower,
  beginMissionClimax,
  chooseMissionApproach,
  createMissionState,
  recoverFromMissionDefeat,
  resetMission,
  resolveMissionVictory,
  retreatFromMission,
  validateMissionDefinition,
  type MissionDefinition,
} from "@/engine/mission";

describe("mission contract", () => {
  it("validates the authored watchtower contract", () => {
    expect(validateMissionDefinition(WATCHTOWER_MISSION)).toEqual([]);
  });

  it("rejects a contract whose objective references drift", () => {
    const invalid = {
      ...WATCHTOWER_MISSION,
      successCondition: {
        ...WATCHTOWER_MISSION.successCondition,
        primaryObjectiveId: "missing-objective",
      },
    } as MissionDefinition;
    expect(validateMissionDefinition(invalid)).toContain(
      "success condition references the wrong primary objective",
    );
  });
});

describe("watchtower mission transitions", () => {
  it("starts in a briefing with no progress or outcome", () => {
    const state = createMissionState();
    expect(state.phase).toBe("MISSION_BRIEFING");
    expect(state.primaryObjectiveProgress).toBe("not_started");
    expect(state.optionalObjectiveProgress).toBe("not_started");
    expect(state.outcome).toBeNull();
    expect(state.completed).toBe(false);
  });

  it("starts exploration and records the direct approach", () => {
    const state = chooseMissionApproach(createMissionState(), "direct");
    expect(state.phase).toBe("EXPLORATION");
    expect(state.approach).toBe("direct");
    expect(state.primaryObjectiveProgress).toBe("in_progress");
    expect(state.optionalObjectiveProgress).toBe("in_progress");
    expect(state.consequenceFlags).toContain("direct-approach");
  });

  it("completes the optional objective for the safer ridge approach", () => {
    const state = chooseMissionApproach(createMissionState(), "ridge");
    expect(state.approach).toBe("ridge");
    expect(state.optionalObjectiveProgress).toBe("complete");
    expect(state.consequenceFlags).toContain("ridge-approach");
  });

  it("does not allow a second route choice after the briefing", () => {
    const state = chooseMissionApproach(createMissionState(), "direct");
    expect(chooseMissionApproach(state, "ridge")).toBe(state);
  });

  it("advances only when the party reaches the authored watchtower approach", () => {
    const state = chooseMissionApproach(createMissionState(), "ridge");
    expect(advanceMissionAtWatchtower(state, 18, 8)).toBe(state);
    const escalated = advanceMissionAtWatchtower(state, 19, 8);
    expect(escalated.phase).toBe("ESCALATION");
    expect(escalated.escalationState).toBe("watchtower-approach");
  });

  it("moves escalation into the one existing world-backed climax", () => {
    const state = advanceMissionAtWatchtower(
      chooseMissionApproach(createMissionState(), "direct"),
      19,
      8,
    );
    const climax = beginMissionClimax(state);
    expect(climax.phase).toBe("CLIMAX");
    expect(climax.escalationState).toBe("beacon-guarded");
  });

  it("maps ridge victory to SUCCESS and completes the primary objective", () => {
    const state = beginMissionClimax(
      advanceMissionAtWatchtower(
        chooseMissionApproach(createMissionState(), "ridge"),
        19,
        8,
      ),
    );
    const resolved = resolveMissionVictory(state);
    expect(resolved.phase).toBe("RESOLUTION");
    expect(resolved.outcome).toBe("SUCCESS");
    expect(resolved.primaryObjectiveProgress).toBe("complete");
    expect(resolved.completed).toBe(true);
    expect(resolved.consequenceFlags).toContain("beacon-recovered");
  });

  it("maps direct-route victory to SUCCESS_AT_COST", () => {
    const state = beginMissionClimax(
      advanceMissionAtWatchtower(
        chooseMissionApproach(createMissionState(), "direct"),
        19,
        8,
      ),
    );
    expect(resolveMissionVictory(state).outcome).toBe("SUCCESS_AT_COST");
    expect(resolveMissionVictory(state).consequenceFlags).toContain("beacon-recovered-at-cost");
  });

  it("returns defeat to exploration with a valid retry state", () => {
    const state = beginMissionClimax(
      advanceMissionAtWatchtower(
        chooseMissionApproach(createMissionState(), "ridge"),
        19,
        8,
      ),
    );
    const recovered = recoverFromMissionDefeat(state);
    expect(recovered.phase).toBe("EXPLORATION");
    expect(recovered.outcome).toBeNull();
    expect(recovered.completed).toBe(false);
    expect(recovered.consequenceFlags).toContain("watchtower-defeat");
  });

  it("resolves retreat as a concrete terminal outcome", () => {
    const state = chooseMissionApproach(createMissionState(), "direct");
    const resolved = retreatFromMission(state);
    expect(resolved.phase).toBe("RESOLUTION");
    expect(resolved.outcome).toBe("RETREAT");
    expect(resolved.completed).toBe(true);
    expect(resolved.consequenceFlags).toContain("party-retreated");
  });

  it("resets a completed mission without carrying stale outcome state", () => {
    const state = retreatFromMission(chooseMissionApproach(createMissionState(), "ridge"));
    const reset = resetMission(state);
    expect(reset.phase).toBe("MISSION_BRIEFING");
    expect(reset.approach).toBeNull();
    expect(reset.outcome).toBeNull();
    expect(reset.completed).toBe(false);
  });
});