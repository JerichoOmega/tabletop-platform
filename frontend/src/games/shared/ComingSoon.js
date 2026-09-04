import React from "react";
import { toast } from "sonner";
import { BellRing, Lock } from "lucide-react";
import { Button } from "../../ui/kit";

/**
 * Shared "Coming Soon" placeholder used by games whose engine isn't installed
 * yet. Each game passes its own identity (name, accent, tiles) so the platform
 * shell stays game-agnostic while the game keeps its visual voice.
 */
export default function ComingSoon({ game }) {
  const accent = game?.meta?.accentColor || "var(--primary-amber)";
  const tiles = "LEXICON".split("");

  return (
    <div className="flex h-full flex-col items-center justify-center p-8 text-center">
      <div className="mb-8 flex flex-wrap justify-center gap-2">
        {tiles.map((ch, i) => (
          <span
            key={i}
            className="flex h-12 w-12 items-center justify-center rounded-lg font-display text-2xl font-bold shadow-lounge"
            style={{
              background: "linear-gradient(180deg,#f3e4c6,#d9c199)",
              color: "#3a2a18",
              transform: `rotate(${(i % 2 ? 1 : -1) * 3}deg)`,
            }}
          >
            {ch}
          </span>
        ))}
      </div>

      <div
        className="mb-3 inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-ui font-semibold uppercase tracking-[0.16em]"
        style={{ background: `${accent}22`, color: accent, border: `1px solid ${accent}55` }}
      >
        <Lock className="h-3.5 w-3.5" /> Coming Soon
      </div>

      <h3 className="font-display text-3xl text-maintext">{game?.name}</h3>
      <p className="mt-3 max-w-md text-sm text-muted">
        {game?.name}&apos;s rules, scoring, dictionary, board, tile distribution
        and AI are <strong className="text-maintext">frozen</strong> in a
        reference build. It will plug into this exact host frame as a
        self-contained game module in an upcoming milestone.
      </p>

      <Button
        className="mt-8"
        data-testid="wishlist-button"
        onClick={() => toast.success(`${game?.name} added to your wishlist`)}
      >
        <BellRing className="h-4 w-4" /> Notify me at launch
      </Button>
    </div>
  );
}
