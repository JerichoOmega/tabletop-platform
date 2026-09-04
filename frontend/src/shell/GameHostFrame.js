import React from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, Volume2, VolumeX, Settings } from "lucide-react";
import { motion } from "framer-motion";
import { registry } from "../platform/registry";
import { usePlatform } from "../platform/PlatformProvider";
import { Avatar } from "../ui/kit";
import { EmptyState, Button } from "../ui/kit";

/**
 * GameHostFrame - the universal wrapper that hosts an individual game's
 * Surface. It provides platform chrome (leave table, title, seats, audio,
 * settings) while isolating the game's own visual identity underneath.
 *
 * The frame renders a game's Surface if available, otherwise its Placeholder.
 * It has zero knowledge of any specific game's rules.
 */
export default function GameHostFrame() {
  const { gameId } = useParams();
  const navigate = useNavigate();
  const { players, activeSeats, settings, saveSettings } = usePlatform();
  const game = registry.get(gameId);

  if (!game) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-20">
        <EmptyState
          title="Game not found"
          description="This game is not registered in the platform."
          action={<Button onClick={() => navigate("/library")}>Back to Library</Button>}
        />
      </div>
    );
  }

  const accent = game.meta.accentColor;
  const seated = players.filter((p) => activeSeats.includes(p.id));
  const muted = settings.sfx_volume === 0;
  const GameBody = game.Surface || game.Placeholder;

  return (
    <div className="fixed inset-0 z-[60] flex flex-col bg-base">
      {/* Platform bar */}
      <div
        className="flex h-16 items-center justify-between border-b border-subtle px-4 backdrop-blur-md sm:px-6"
        style={{ background: "var(--shell-chrome-bg)" }}
      >
        <button
          onClick={() => navigate("/library")}
          data-testid="leave-table-button"
          className="flex items-center gap-2 rounded-full border border-subtle px-4 py-2 font-ui text-sm text-maintext transition-colors hover:border-medium hover:bg-white/5"
        >
          <ArrowLeft className="h-4 w-4" /> Leave Table
        </button>

        <div className="flex items-center gap-2">
          <span
            className="h-2.5 w-2.5 rounded-full"
            style={{ background: accent, boxShadow: `0 0 10px ${accent}` }}
          />
          <span className="font-display text-lg text-maintext">{game.name}</span>
        </div>

        <div className="flex items-center gap-3">
          <div className="hidden items-center -space-x-2 sm:flex">
            {seated.map((p) => (
              <Avatar key={p.id} player={p} size={30} className="ring-2 ring-[var(--bg-base)]" />
            ))}
          </div>
          <button
            data-testid="host-mute-button"
            onClick={() => saveSettings({ sfx_volume: muted ? 0.7 : 0 })}
            className="flex h-9 w-9 items-center justify-center rounded-full text-muted transition-colors hover:bg-white/10 hover:text-maintext"
          >
            {muted ? <VolumeX className="h-5 w-5" /> : <Volume2 className="h-5 w-5" />}
          </button>
          <button
            data-testid="host-settings-button"
            onClick={() => navigate("/settings")}
            className="flex h-9 w-9 items-center justify-center rounded-full text-muted transition-colors hover:bg-white/10 hover:text-maintext"
          >
            <Settings className="h-5 w-5" />
          </button>
        </div>
      </div>

      {/* Game surface with per-game identity glow */}
      <motion.div
        className="relative flex-1 overflow-auto felt-texture"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        style={{
          backgroundImage: `radial-gradient(900px 500px at 50% -10%, ${game.meta.glow}, transparent 60%)`,
        }}
        data-testid="game-host-surface"
      >
        <div className="min-h-full">
          <GameBody game={game} session={null} />
        </div>
      </motion.div>
    </div>
  );
}
