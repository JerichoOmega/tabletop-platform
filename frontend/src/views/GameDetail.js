import React from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { motion } from "framer-motion";
import { toast } from "sonner";
import {
  Play,
  BellRing,
  ArrowLeft,
  Users,
  Clock,
  Gauge,
  Cpu,
  Save,
  Check,
} from "lucide-react";
import { registry } from "../platform/registry";
import { GameStatus } from "../platform/contract";
import { Button, StatusPill, SectionLabel, Card, EmptyState } from "../ui/kit";

function Spec({ icon: Icon, label, value }) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-subtle bg-black/20 p-4">
      <Icon className="h-5 w-5 text-amber" />
      <div>
        <p className="text-xs uppercase tracking-wider text-dim">{label}</p>
        <p className="font-ui text-sm text-maintext">{value}</p>
      </div>
    </div>
  );
}

export default function GameDetail() {
  const { gameId } = useParams();
  const navigate = useNavigate();
  const game = registry.get(gameId);

  if (!game)
    return (
      <EmptyState
        title="Game not found"
        description="This game is not registered."
        action={<Button as={Link} to="/library">Back to Library</Button>}
      />
    );

  const { meta, capabilities } = game;
  const available = game.status === GameStatus.AVAILABLE;

  return (
    <div className="space-y-8">
      <button
        onClick={() => navigate("/library")}
        className="flex items-center gap-2 font-ui text-sm text-muted transition-colors hover:text-maintext"
        data-testid="back-to-library-button"
      >
        <ArrowLeft className="h-4 w-4" /> Back to Library
      </button>

      <motion.div
        className="relative overflow-hidden rounded-3xl border border-subtle"
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
      >
        <img src={meta.hero} alt={game.name} className="absolute inset-0 h-full w-full object-cover" />
        <div
          className="absolute inset-0"
          style={{
            background: `linear-gradient(180deg, rgba(18,14,12,0.4), var(--bg-surface-card) 92%), radial-gradient(80% 60% at 20% 100%, ${meta.glow}, transparent)`,
          }}
        />
        <div className="relative flex min-h-[300px] flex-col justify-end p-8 sm:p-10">
          <div className="mb-3"><StatusPill status={game.status} /></div>
          <h1 className="font-display text-4xl font-bold tracking-tight text-maintext text-glow sm:text-5xl">
            {game.name}
          </h1>
          <p className="mt-3 max-w-xl text-muted">{meta.description}</p>
          <div className="mt-4 flex flex-wrap gap-2">
            {meta.tags.map((t) => (
              <span
                key={t}
                className="rounded-full px-3 py-1 font-ui text-xs"
                style={{ background: `${meta.accentColor}22`, color: meta.accentColor }}
              >
                {t}
              </span>
            ))}
          </div>
          <div className="mt-7">
            {available ? (
              <Button data-testid="launch-game-button" onClick={() => navigate(`/play/${game.id}`)}>
                <Play className="h-4 w-4" /> Launch Game
              </Button>
            ) : (
              <Button
                data-testid="wishlist-detail-button"
                onClick={() => toast.success(`${game.name} added to your wishlist`)}
              >
                <BellRing className="h-4 w-4" /> Notify me at launch
              </Button>
            )}
          </div>
        </div>
      </motion.div>

      <section className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Spec icon={Users} label="Players" value={`${meta.players.min}-${meta.players.max}`} />
        <Spec icon={Clock} label="Playtime" value={meta.playtime} />
        <Spec icon={Gauge} label="Complexity" value={meta.complexity} />
        <Spec icon={Cpu} label="AI Opponents" value={capabilities.ai ? "Yes" : "No"} />
      </section>

      <section className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <Card className="p-6 lg:col-span-2">
          <SectionLabel>How to play</SectionLabel>
          <ul className="mt-4 space-y-3">
            {meta.howToPlay.map((step, i) => (
              <li key={i} className="flex gap-3 text-sm text-muted">
                <span
                  className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full font-mono text-xs"
                  style={{ background: `${meta.accentColor}22`, color: meta.accentColor }}
                >
                  {i + 1}
                </span>
                {step}
              </li>
            ))}
          </ul>
        </Card>
        <Card className="p-6">
          <SectionLabel>Capabilities</SectionLabel>
          <ul className="mt-4 space-y-3 font-ui text-sm">
            {[
              ["Local multiplayer", capabilities.localMultiplayer],
              ["Single-player", capabilities.singlePlayer],
              ["AI opponents", capabilities.ai],
              ["Save & resume", capabilities.save],
              ["Statistics", capabilities.stats],
            ].map(([label, on]) => (
              <li key={label} className="flex items-center justify-between">
                <span className="text-muted">{label}</span>
                <span className={on ? "text-emerald" : "text-dim"}>
                  {on ? <Check className="h-4 w-4" /> : "—"}
                </span>
              </li>
            ))}
          </ul>
          {!game.engine && (
            <p className="mt-5 flex items-start gap-2 rounded-lg border border-subtle bg-black/20 p-3 text-xs text-dim">
              <Save className="mt-0.5 h-4 w-4 flex-shrink-0" />
              Engine module not installed yet — this game currently ships as a
              platform stub.
            </p>
          )}
        </Card>
      </section>
    </div>
  );
}
