// ─────────────────────────────────────────────────────────────────────────
// M5 — Platform shell & Experience registry unit tests (pure, DOM-free).
// ─────────────────────────────────────────────────────────────────────────

import { describe, expect, it } from "vitest";

import { createExperienceRegistry } from "@/platform/experiences/registry";
import type { ExperienceDefinition } from "@/platform/experiences/types";
import {
  applyShellStateToSearch,
  FUTURE_DESTINATIONS,
  INITIAL_SHELL_STATE,
  isPlatformDestination,
  parseShellState,
  PLATFORM_DESTINATIONS,
  shellReducer,
  type ShellState,
} from "@/platform/shellState";

const Noop = () => null;

function def(id: string, extra: Partial<ExperienceDefinition> = {}): ExperienceDefinition {
  return {
    id,
    title: `Title ${id}`,
    gameType: "rpg",
    version: "1.0.0",
    capabilities: ["local", "synchronous"],
    players: { min: 1, max: 4 },
    Component: Noop,
    ...extra,
  };
}

describe("Experience registry", () => {
  it("registers and resolves an Experience by ID", () => {
    const reg = createExperienceRegistry();
    reg.register(def("rpg"));
    expect(reg.has("rpg")).toBe(true);
    expect(reg.get("rpg")?.title).toBe("Title rpg");
  });

  it("lists Experiences in registration order as a defensive copy", () => {
    const reg = createExperienceRegistry();
    reg.register(def("alpha"));
    reg.register(def("beta", { gameType: "card" }));
    const list = reg.list();
    expect(list.map((e) => e.id)).toEqual(["alpha", "beta"]);
    expect(reg.list()).not.toBe(list); // defensive copy
  });

  it("supports multiple game types through one generic mechanism", () => {
    const reg = createExperienceRegistry();
    for (const [id, gameType] of [
      ["rpg", "rpg"],
      ["cards", "card"],
      ["empire", "strategy"],
      ["estates", "economic"],
    ] as const) {
      reg.register(def(id, { gameType }));
    }
    expect(reg.list()).toHaveLength(4);
    expect(reg.get("empire")?.gameType).toBe("strategy");
  });

  it("rejects duplicate IDs", () => {
    const reg = createExperienceRegistry();
    reg.register(def("rpg"));
    expect(() => reg.register(def("rpg"))).toThrow(/already registered/);
  });

  it("rejects invalid IDs, empty titles, missing gameType/Component", () => {
    const reg = createExperienceRegistry();
    expect(() => reg.register(def("Bad ID"))).toThrow(/invalid/);
    expect(() => reg.register(def(""))).toThrow(/invalid/);
    expect(() => reg.register(def("x", { title: "  " }))).toThrow(/title/);
    expect(() => reg.register({ ...def("y"), gameType: "" as never })).toThrow(/gameType/);
    expect(() => reg.register({ ...def("z"), Component: undefined as never })).toThrow(
      /Component/,
    );
  });

  it("requires a major.minor.patch version (M6 contract)", () => {
    const reg = createExperienceRegistry();
    expect(() => reg.register(def("a", { version: "1.0" }))).toThrow(/version/);
    expect(() => reg.register(def("b", { version: "" }))).toThrow(/version/);
    expect(() => reg.register(def("c", { version: "v1.0.0" }))).toThrow(/version/);
    reg.register(def("d", { version: "2.13.0" })); // valid
    expect(reg.get("d")?.version).toBe("2.13.0");
  });

  it("validates capabilities: known values only, no duplicates, game concepts rejected", () => {
    const reg = createExperienceRegistry();
    expect(() =>
      reg.register(def("a", { capabilities: ["supportsDungeons" as never] })),
    ).toThrow(/unknown capability/);
    expect(() =>
      reg.register(def("b", { capabilities: ["local", "local"] })),
    ).toThrow(/duplicate capabilities/);
    expect(() => reg.register(def("c", { capabilities: undefined as never }))).toThrow(
      /capabilities/,
    );
    // A hidden-information card game and a shared-board strategy game are both
    // expressible with generic hosting capabilities alone.
    reg.register(def("card-like", { capabilities: ["local", "synchronous", "hidden-information"] }));
    reg.register(
      def("strategy-like", {
        gameType: "strategy",
        capabilities: ["shared-board", "synchronous", "host-authoritative"],
        players: { min: 2, max: 4 },
      }),
    );
    expect(reg.list()).toHaveLength(2);
  });

  it("validates the players range", () => {
    const reg = createExperienceRegistry();
    expect(() => reg.register(def("a", { players: { min: 0, max: 2 } }))).toThrow(/players/);
    expect(() => reg.register(def("b", { players: { min: 3, max: 2 } }))).toThrow(/players/);
    expect(() =>
      reg.register(def("c", { players: undefined as never })),
    ).toThrow(/players/);
    reg.register(def("d", { players: { min: 2, max: 6 } }));
    expect(reg.get("d")?.players).toEqual({ min: 2, max: 6 });
  });

  it("returns undefined / false for unknown IDs", () => {
    const reg = createExperienceRegistry();
    expect(reg.get("nope")).toBeUndefined();
    expect(reg.has("nope")).toBe(false);
  });
});

describe("Built-in registration", () => {
  it("registers the RPG Experience and is idempotent", async () => {
    const { registerBuiltInExperiences } = await import(
      "@/platform/experiences/registerBuiltIn"
    );
    const { experienceRegistry } = await import("@/platform/experiences/registry");
    registerBuiltInExperiences();
    registerBuiltInExperiences(); // second call must not throw (duplicate reg)
    const rpg = experienceRegistry.get("rpg");
    expect(rpg?.title).toBe("Tabletop RPG");
    expect(rpg?.gameType).toBe("rpg");
    expect(rpg?.version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(rpg?.capabilities).toEqual(["local", "synchronous", "shared-board"]);
    expect(rpg?.players).toEqual({ min: 1, max: 1 });
    expect(typeof rpg?.Component).toBe("function");
    expect(experienceRegistry.list().some((e) => e.id === "rpg")).toBe(true);
  });
});

describe("Shell state — navigation", () => {
  const reg = createExperienceRegistry();
  reg.register(def("rpg"));

  it("starts on the play surface with no active Experience", () => {
    expect(INITIAL_SHELL_STATE).toEqual({ destination: "play", activeExperienceId: null });
  });

  it("navigates between all platform destinations", () => {
    let state: ShellState = INITIAL_SHELL_STATE;
    for (const destination of PLATFORM_DESTINATIONS) {
      state = shellReducer(state, { type: "navigate", destination }, reg);
      expect(state.destination).toBe(destination);
    }
  });

  it("keeps platform destination and active Experience as separate concepts", () => {
    let state = shellReducer(INITIAL_SHELL_STATE, { type: "enterExperience", id: "rpg" }, reg);
    expect(state).toEqual({ destination: "play", activeExperienceId: "rpg" });
    // Exiting the Experience restores the platform surface, unchanged.
    state = shellReducer(state, { type: "exitExperience" }, reg);
    expect(state).toEqual({ destination: "play", activeExperienceId: null });
  });

  it("entering an Experience requires registration — unknown IDs are rejected", () => {
    const state = shellReducer(
      INITIAL_SHELL_STATE,
      { type: "enterExperience", id: "not-a-game" },
      reg,
    );
    expect(state).toBe(INITIAL_SHELL_STATE);
  });

  it("navigating a platform surface leaves the active Experience", () => {
    const inGame = shellReducer(INITIAL_SHELL_STATE, { type: "enterExperience", id: "rpg" }, reg);
    const state = shellReducer(inGame, { type: "navigate", destination: "library" }, reg);
    expect(state).toEqual({ destination: "library", activeExperienceId: null });
  });

  it("declares every non-play destination as future functionality in M5", () => {
    expect(FUTURE_DESTINATIONS).toEqual(["browse", "library", "create", "profile", "settings"]);
  });

  it("validates destination names", () => {
    expect(isPlatformDestination("play")).toBe(true);
    expect(isPlatformDestination("dungeon")).toBe(false);
  });
});

describe("Shell state — URL codec", () => {
  const reg = createExperienceRegistry();
  reg.register(def("rpg"));

  it("parses an empty search to the initial state", () => {
    expect(parseShellState("", reg)).toEqual(INITIAL_SHELL_STATE);
    expect(parseShellState("?", reg)).toEqual(INITIAL_SHELL_STATE);
  });

  it("parses destination and experience params", () => {
    expect(parseShellState("?dest=library", reg)).toEqual({
      destination: "library",
      activeExperienceId: null,
    });
    expect(parseShellState("?experience=rpg", reg)).toEqual({
      destination: "play",
      activeExperienceId: "rpg",
    });
  });

  it("degrades an unknown experience ID safely to the play surface", () => {
    expect(parseShellState("?experience=ghost", reg)).toEqual(INITIAL_SHELL_STATE);
    expect(parseShellState("?dest=nonsense", reg).destination).toBe("play");
  });

  it("an unknown experience ID dominates: dest is ignored too", () => {
    expect(parseShellState("?dest=library&experience=not-a-game", reg)).toEqual(
      INITIAL_SHELL_STATE,
    );
    // A VALID experience still coexists with a dest param.
    expect(parseShellState("?dest=library&experience=rpg", reg)).toEqual({
      destination: "library",
      activeExperienceId: "rpg",
    });
  });

  it("round-trips state through the search string", () => {
    const state: ShellState = { destination: "play", activeExperienceId: "rpg" };
    const search = applyShellStateToSearch("", state);
    expect(parseShellState(search, reg)).toEqual(state);
  });

  it("preserves unrelated params such as the e2e flag", () => {
    const search = applyShellStateToSearch("?e2e", {
      destination: "play",
      activeExperienceId: "rpg",
    });
    expect(search).toContain("e2e");
    expect(search).toContain("experience=rpg");
    // And removal keeps the flag too.
    const cleared = applyShellStateToSearch(search, INITIAL_SHELL_STATE);
    expect(cleared).toBe("?e2e");
  });
});
