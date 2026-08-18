// ─────────────────────────────────────────────────────────────────────────
// Platform shell state (M5) — pure, DOM-free, unit-testable.
//
// Two SEPARATE concepts (per the M5 directive §11):
//   • platform destination — which platform surface is selected
//     (play / browse / library / create / profile / settings)
//   • active Experience — which registered Experience, if any, the player
//     is currently inside.
//
// URL contract (query params, so unrelated params like ?e2e are preserved):
//   ?dest=<destination>        platform surface (default "play")
//   ?experience=<id>           active Experience (validated against registry)
// An invalid/unknown experience id degrades safely to the PLAY surface.
// ─────────────────────────────────────────────────────────────────────────

import type { ExperienceRegistry } from "./experiences/registry";

export const PLATFORM_DESTINATIONS = [
  "play",
  "browse",
  "library",
  "create",
  "profile",
  "settings",
] as const;

export type PlatformDestination = (typeof PLATFORM_DESTINATIONS)[number];

/** Destinations that are navigation intent only — no functionality yet. */
export const FUTURE_DESTINATIONS: readonly PlatformDestination[] = [
  "browse",
  "library",
  "create",
  "profile",
  "settings",
];

export interface ShellState {
  readonly destination: PlatformDestination;
  /** ID of the Experience the player is inside, or null on platform surfaces. */
  readonly activeExperienceId: string | null;
}

export const INITIAL_SHELL_STATE: ShellState = {
  destination: "play",
  activeExperienceId: null,
};

export type ShellAction =
  | { type: "navigate"; destination: PlatformDestination }
  | { type: "enterExperience"; id: string }
  | { type: "exitExperience" };

export function isPlatformDestination(value: string): value is PlatformDestination {
  return (PLATFORM_DESTINATIONS as readonly string[]).includes(value);
}

/**
 * Pure reducer. `enterExperience` requires a registered Experience — unknown
 * IDs are rejected (state unchanged) so the shell can never mount nothing.
 */
export function shellReducer(
  state: ShellState,
  action: ShellAction,
  registry: ExperienceRegistry,
): ShellState {
  switch (action.type) {
    case "navigate":
      // Navigating a platform surface leaves any active Experience — the
      // destinations are platform-level chrome, not in-game overlays (M5).
      return { destination: action.destination, activeExperienceId: null };
    case "enterExperience": {
      if (!registry.has(action.id)) return state;
      // Entering always happens FROM the play surface conceptually; keep the
      // destination so exiting returns where the player left.
      return { ...state, activeExperienceId: action.id };
    }
    case "exitExperience":
      return { ...state, activeExperienceId: null };
    default:
      return state;
  }
}

/** Parse shell state from a location search string (e.g. "?experience=rpg&e2e"). */
export function parseShellState(search: string, registry: ExperienceRegistry): ShellState {
  const params = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  const expParam = params.get("experience");
  if (expParam !== null && !registry.has(expParam)) {
    // Unknown Experience ID: the whole shell-state portion of the URL is
    // untrusted — degrade to the initial Play surface (ignoring dest too).
    return INITIAL_SHELL_STATE;
  }
  const destParam = params.get("dest") ?? "";
  const destination: PlatformDestination = isPlatformDestination(destParam) ? destParam : "play";
  return { destination, activeExperienceId: expParam };
}

/**
 * Write shell state back into an existing search string, PRESERVING all
 * unrelated params (?e2e etc.). Returns the new search string ("" or "?…").
 */
export function applyShellStateToSearch(search: string, state: ShellState): string {
  const params = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  if (state.destination === "play") params.delete("dest");
  else params.set("dest", state.destination);
  if (state.activeExperienceId === null) params.delete("experience");
  else params.set("experience", state.activeExperienceId);
  const out = params.toString();
  // URLSearchParams serializes bare flags ("e2e") as "e2e=" — normalize back.
  const normalized = out.replace(/=(?=&|$)/g, "");
  return normalized.length > 0 ? `?${normalized}` : "";
}
