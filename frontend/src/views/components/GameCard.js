import React from "react";
import { Link } from "react-router-dom";
import { Users, Clock } from "lucide-react";
import { StatusPill } from "../../ui/kit";

export default function GameCard({ game, index = 0 }) {
  const { meta } = game;
  return (
    <Link
      to={`/library/${game.id}`}
      data-testid={`game-card-${game.id}`}
      className="group relative block overflow-hidden rounded-2xl border border-subtle bg-card shadow-lounge transition-[transform,border-color] duration-300 hover:-translate-y-1.5 hover:border-medium"
      style={{ animation: `fade-up 0.5s ${index * 0.08}s both` }}
    >
      <div className="relative aspect-[16/10] overflow-hidden">
        <img
          src={meta.cover}
          alt={game.name}
          loading="lazy"
          className="h-full w-full object-cover transition-transform duration-[600ms] group-hover:scale-105"
        />
        <div
          className="absolute inset-0"
          style={{
            background: `linear-gradient(180deg, transparent 30%, var(--bg-surface-card) 96%), radial-gradient(120% 80% at 50% 120%, ${meta.glow}, transparent 60%)`,
          }}
        />
        <div className="absolute left-4 top-4">
          <StatusPill status={game.status} />
        </div>
      </div>

      <div className="p-5">
        <h3 className="font-display text-xl font-bold text-maintext">{game.name}</h3>
        <p className="mt-1 line-clamp-2 text-sm text-muted">{meta.tagline}</p>
        <div className="mt-4 flex flex-wrap items-center gap-3 text-xs text-dim">
          <span className="flex items-center gap-1.5 font-mono">
            <Users className="h-3.5 w-3.5" /> {meta.players.min}-{meta.players.max}
          </span>
          <span className="flex items-center gap-1.5 font-mono">
            <Clock className="h-3.5 w-3.5" /> {meta.playtime}
          </span>
          <span
            className="rounded-full px-2 py-0.5 font-ui"
            style={{ background: `${meta.accentColor}22`, color: meta.accentColor }}
          >
            {meta.complexity}
          </span>
        </div>
      </div>
    </Link>
  );
}
