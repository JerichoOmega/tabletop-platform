import React from "react";
import { Swords, Grid3x3, Cpu } from "lucide-react";

/**
 * Valora Surface (STUB).
 *
 * Platform-foundation placeholder for where Game #1's engine, board, turn
 * system and 3D tactical UI will mount inside the GameHostFrame. No game rules
 * live here yet - this only proves the host frame renders a game's own surface.
 */
export default function ValoraSurface({ session }) {
  return (
    <div className="flex h-full flex-col items-center justify-center p-8">
      <div
        className="relative grid grid-cols-8 gap-1 rounded-xl border border-crimson/30 bg-black/40 p-3"
        style={{ width: "min(90vw, 460px)", aspectRatio: "1" }}
      >
        {Array.from({ length: 64 }).map((_, i) => (
          <div
            key={i}
            className="rounded-sm"
            style={{
              background:
                (Math.floor(i / 8) + i) % 2
                  ? "rgba(184,58,58,0.10)"
                  : "rgba(255,255,255,0.03)",
            }}
          />
        ))}
        <div className="absolute inset-0 flex items-center justify-center">
          <Swords className="h-12 w-12 text-crimson/70" />
        </div>
      </div>

      <div className="mt-8 max-w-md text-center">
        <div className="mb-2 inline-flex items-center gap-2 rounded-full border border-crimson/40 bg-crimson/10 px-3 py-1 text-xs font-ui font-semibold uppercase tracking-[0.16em] text-crimson">
          <Cpu className="h-3.5 w-3.5" /> Engine mount point
        </div>
        <h3 className="font-display text-2xl text-maintext">Valora: Tactical Front</h3>
        <p className="mt-2 text-sm text-muted">
          The platform host frame is live. Valora&apos;s rules engine, grid
          board, turn system and AI will mount here as a self-contained game
          module &mdash; no changes to the platform core required.
        </p>
        {session && (
          <p className="mt-4 flex items-center justify-center gap-2 font-mono text-xs text-dim">
            <Grid3x3 className="h-3.5 w-3.5" /> session {session.id.slice(0, 8)}
          </p>
        )}
      </div>
    </div>
  );
}
