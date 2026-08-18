// ─────────────────────────────────────────────────────────────────────────
// M6 — Platform context contract test (server-rendered, DOM-free).
//
// Verifies the provider/hook wiring an Experience relies on: identity and
// version arrive intact, requestExit is callable, and the hook degrades to
// null when no platform hosts the component (optional-by-design contract).
// ─────────────────────────────────────────────────────────────────────────

// Vitest transforms TSX with the classic runtime here — React must be in scope.
import React from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  ExperiencePlatformProvider,
  usePlatformContext,
  type ExperiencePlatformContext,
} from "@/platform/experiences/platformContext";

describe("Experience platform context", () => {
  it("delivers identity, version, and a callable requestExit to a hosted Experience", () => {
    let exitRequests = 0;
    const value: ExperiencePlatformContext = {
      experienceId: "strategy-demo",
      experienceVersion: "2.1.0",
      requestExit: () => {
        exitRequests += 1;
      },
    };

    function Probe() {
      const ctx = usePlatformContext();
      if (!ctx) throw new Error("expected platform context");
      // An Experience-driven exit request (e.g. from a menu button handler).
      ctx.requestExit();
      return (
        <span>
          {ctx.experienceId}@{ctx.experienceVersion}
        </span>
      );
    }

    const html = renderToString(
      <ExperiencePlatformProvider value={value}>
        <Probe />
      </ExperiencePlatformProvider>,
    );

    expect(html).toContain("strategy-demo");
    expect(html).toContain("2.1.0");
    expect(exitRequests).toBe(1);
  });

  it("returns null outside a platform host (context is optional by contract)", () => {
    let observed: unknown = "unset";
    function Probe() {
      observed = usePlatformContext();
      return null;
    }
    renderToString(<Probe />);
    expect(observed).toBeNull();
  });
});
