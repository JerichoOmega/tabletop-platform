// ─────────────────────────────────────────────────────────────────────────
// Platform context (M6) — the minimal contract surface the platform hands
// to a mounted Experience.
//
// Deliberately tiny: identity + one navigation callback. Future platform
// services (player identity, persistence, presence, titles…) will be added
// here as REAL fields when their milestones arrive — never as speculative
// placeholders, and never as RPG-specific concepts.
// ─────────────────────────────────────────────────────────────────────────

import { createContext, useContext } from "react";

export interface ExperiencePlatformContext {
  /** Registered ID of the Experience currently mounted. */
  readonly experienceId: string;
  /** Contract version of the mounted Experience (from its definition). */
  readonly experienceVersion: string;
  /**
   * Ask the platform to exit this Experience and return to the shell.
   * The Experience must do its own cleanup before/while unmounting — the
   * platform never reaches into Experience state.
   */
  readonly requestExit: () => void;
}

const Context = createContext<ExperiencePlatformContext | null>(null);

export const ExperiencePlatformProvider = Context.Provider;

/**
 * Read the platform context from inside an Experience. Optional by design:
 * an Experience that never calls this (like the current RPG) is fully
 * conformant — the platform provides its own exit affordance.
 */
export function usePlatformContext(): ExperiencePlatformContext | null {
  return useContext(Context);
}
