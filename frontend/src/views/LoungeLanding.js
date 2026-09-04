import React from "react";
import { Link, useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { Play, ArrowRight, Sparkles, Dices, Users } from "lucide-react";
import { usePlatform } from "../platform/PlatformProvider";
import { GameStatus } from "../platform/contract";
import { Button, SectionLabel, Card, StatusPill, Avatar } from "../ui/kit";
import GameCard from "./components/GameCard";

export default function LoungeLanding() {
  const { games, players, activeSeats, sessions } = usePlatform();
  const navigate = useNavigate();
  const featured = games.find((g) => g.status === GameStatus.AVAILABLE) || games[0];
  const rest = games.filter((g) => g.id !== featured?.id);
  const seated = players.filter((p) => activeSeats.includes(p.id));
  const recent = sessions.slice(0, 3);

  if (!featured) return null;

  return (
    <div className="space-y-14">
      {/* Hero */}
      <section className="grid grid-cols-1 gap-6 md:grid-cols-12">
        <motion.div
          className="relative col-span-1 overflow-hidden rounded-3xl border border-subtle md:col-span-8"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
        >
          <img
            src={featured.meta.hero}
            alt={featured.name}
            className="absolute inset-0 h-full w-full object-cover"
          />
          <div
            className="absolute inset-0"
            style={{
              background:
                "linear-gradient(90deg, var(--bg-base) 8%, rgba(18,14,12,0.5) 55%, transparent 100%)",
            }}
          />
          <div className="relative flex min-h-[380px] flex-col justify-end p-8 sm:p-10">
            <SectionLabel>
              <Sparkles className="mr-1 inline h-3.5 w-3.5" /> Featured at the table
            </SectionLabel>
            <h1 className="mt-3 max-w-lg font-display text-4xl font-bold tracking-tight text-maintext text-glow sm:text-5xl">
              {featured.name}
            </h1>
            <p className="mt-3 max-w-md text-base text-muted">{featured.meta.tagline}</p>
            <div className="mt-7 flex flex-wrap gap-3">
              <Button
                data-testid="hero-launch-button"
                onClick={() => navigate(`/play/${featured.id}`)}
              >
                <Play className="h-4 w-4" /> Launch Game
              </Button>
              <Button
                variant="ghost"
                as={Link}
                to={`/library/${featured.id}`}
                data-testid="hero-details-button"
              >
                Details <ArrowRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </motion.div>

        {/* Second game teaser */}
        <div className="col-span-1 md:col-span-4">
          {rest[0] && <GameCard game={rest[0]} index={1} />}
        </div>
      </section>

      {/* Activity + party bento */}
      <section className="grid grid-cols-1 gap-6 md:grid-cols-12">
        <Card className="col-span-1 p-6 md:col-span-4">
          <div className="mb-4 flex items-center justify-between">
            <SectionLabel>Recent Sessions</SectionLabel>
            <Link to="/sessions" className="text-xs text-amber hover:underline">
              View all
            </Link>
          </div>
          {recent.length === 0 ? (
            <p className="py-6 text-sm text-dim">
              No sessions yet. Launch a game to start a table.
            </p>
          ) : (
            <ul className="space-y-3">
              {recent.map((s) => {
                const g = games.find((x) => x.id === s.game_id);
                return (
                  <li
                    key={s.id}
                    className="flex items-center gap-3 rounded-xl border border-subtle bg-black/20 p-3"
                  >
                    <span
                      className="h-8 w-8 flex-shrink-0 rounded-lg"
                      style={{ background: g?.meta.glow || "var(--primary-amber-glow)" }}
                    />
                    <div className="min-w-0">
                      <p className="truncate font-ui text-sm text-maintext">
                        {g?.name || s.game_id}
                      </p>
                      <p className="font-mono text-xs text-dim">turn {s.turn}</p>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>

        <Card className="col-span-1 p-6 md:col-span-8">
          <div className="mb-4 flex items-center justify-between">
            <SectionLabel>
              <Users className="mr-1 inline h-3.5 w-3.5" /> Seated Party
            </SectionLabel>
            <Link to="/players" className="text-xs text-amber hover:underline">
              Manage players
            </Link>
          </div>
          {seated.length === 0 ? (
            <div className="flex items-center gap-4 py-6">
              <Dices className="h-8 w-8 text-dim" />
              <p className="text-sm text-dim">
                No players seated. Add local profiles and seat them at the table.
              </p>
            </div>
          ) : (
            <div className="flex flex-wrap gap-4">
              {seated.map((p) => (
                <div key={p.id} className="flex items-center gap-3 rounded-full border border-subtle bg-black/20 py-2 pl-2 pr-5">
                  <Avatar player={p} size={40} />
                  <span className="font-ui text-sm text-maintext">{p.name}</span>
                </div>
              ))}
            </div>
          )}
        </Card>
      </section>

      {/* Library preview */}
      <section>
        <div className="mb-6 flex items-end justify-between">
          <div>
            <SectionLabel>The Collection</SectionLabel>
            <h2 className="mt-2 font-display text-2xl font-semibold text-maintext sm:text-3xl">
              Games in the lounge
            </h2>
          </div>
          <Button variant="subtle" as={Link} to="/library" data-testid="browse-library-button">
            Browse all <ArrowRight className="h-4 w-4" />
          </Button>
        </div>
        <div className="grid grid-cols-1 gap-8 sm:grid-cols-2 lg:grid-cols-3">
          {games.map((g, i) => (
            <GameCard key={g.id} game={g} index={i} />
          ))}
        </div>
      </section>
    </div>
  );
}
