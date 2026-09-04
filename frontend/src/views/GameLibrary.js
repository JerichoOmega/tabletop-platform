import React, { useMemo, useState } from "react";
import { Search } from "lucide-react";
import { usePlatform } from "../platform/PlatformProvider";
import { GameStatus } from "../platform/contract";
import { SectionLabel, EmptyState, cn } from "../ui/kit";
import GameCard from "./components/GameCard";

const FILTERS = [
  { id: "all", label: "All Games", test: () => true },
  { id: "available", label: "Available", test: (g) => g.status === GameStatus.AVAILABLE },
  { id: "coming_soon", label: "Coming Soon", test: (g) => g.status === GameStatus.COMING_SOON },
  { id: "multi", label: "Multiplayer", test: (g) => g.capabilities.localMultiplayer },
  { id: "solo", label: "Single-Player", test: (g) => g.capabilities.singlePlayer },
];

export default function GameLibrary() {
  const { games } = usePlatform();
  const [filter, setFilter] = useState("all");
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const f = FILTERS.find((x) => x.id === filter);
    return games
      .filter(f.test)
      .filter((g) =>
        (g.name + g.meta.tagline + g.meta.tags.join(" "))
          .toLowerCase()
          .includes(query.toLowerCase())
      );
  }, [games, filter, query]);

  return (
    <div className="space-y-8">
      <div>
        <SectionLabel>Game Library</SectionLabel>
        <h1 className="mt-2 font-display text-3xl font-bold tracking-tight text-maintext sm:text-4xl">
          Choose your table
        </h1>
        <p className="mt-2 max-w-xl text-muted">
          Every game plugs into the platform as an independent module with its
          own rules, board and identity.
        </p>
      </div>

      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap gap-2">
          {FILTERS.map((f) => (
            <button
              key={f.id}
              onClick={() => setFilter(f.id)}
              data-testid={`filter-${f.id}`}
              className={cn(
                "rounded-full border px-4 py-2 font-ui text-sm transition-colors duration-200",
                filter === f.id
                  ? "border-strong bg-[var(--primary-amber-glow)] text-amber"
                  : "border-subtle text-muted hover:text-maintext hover:border-medium"
              )}
            >
              {f.label}
            </button>
          ))}
        </div>
        <div className="relative w-full sm:w-72">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-dim" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search games..."
            data-testid="library-search-input"
            className="w-full rounded-full border border-subtle bg-black/30 py-2.5 pl-10 pr-4 font-ui text-sm text-maintext outline-none transition-colors placeholder:text-dim focus:border-strong"
          />
        </div>
      </div>

      {filtered.length === 0 ? (
        <EmptyState title="No games match" description="Try a different filter or search term." />
      ) : (
        <div className="grid grid-cols-1 gap-8 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((g, i) => (
            <GameCard key={g.id} game={g} index={i} />
          ))}
        </div>
      )}
    </div>
  );
}
