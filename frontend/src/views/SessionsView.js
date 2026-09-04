import React from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { Play, Trash2, Copy, Clock, Plus } from "lucide-react";
import { usePlatform } from "../platform/PlatformProvider";
import { registry } from "../platform/registry";
import { GameStatus } from "../platform/contract";
import { SectionLabel, Card, Button, EmptyState, Avatar, StatusPill, cn } from "../ui/kit";

function relTime(iso) {
  const d = (Date.now() - new Date(iso).getTime()) / 1000;
  if (d < 60) return "just now";
  if (d < 3600) return `${Math.floor(d / 60)}m ago`;
  if (d < 86400) return `${Math.floor(d / 3600)}h ago`;
  return `${Math.floor(d / 86400)}d ago`;
}

export default function SessionsView() {
  const { sessions, players, removeSession, createSession, games } = usePlatform();
  const navigate = useNavigate();
  const firstAvailable = games.find((g) => g.status === GameStatus.AVAILABLE);

  const startDemo = async () => {
    if (!firstAvailable) return;
    const s = await createSession({
      game_id: firstAvailable.id,
      title: `${firstAvailable.name} table`,
      players: [],
      config: {},
      state: {},
      status: "active",
    });
    toast.success("Session created");
    navigate(`/play/${s.game_id}`);
  };

  return (
    <div className="space-y-8">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <SectionLabel>Table Sessions</SectionLabel>
          <h1 className="mt-2 font-display text-3xl font-bold tracking-tight text-maintext sm:text-4xl">
            Sessions
          </h1>
          <p className="mt-2 max-w-xl text-muted">
            Active and saved tables. Sessions store an opaque game-state blob so
            any game can save and resume through the same platform interface.
          </p>
        </div>
        {firstAvailable && (
          <Button variant="subtle" data-testid="new-session-button" onClick={startDemo}>
            <Plus className="h-4 w-4" /> New {firstAvailable.name} table
          </Button>
        )}
      </div>

      {sessions.length === 0 ? (
        <EmptyState
          icon={Clock}
          title="No sessions yet"
          description="Launch a game from the library to create a table. It will appear here to resume later."
          action={<Button onClick={() => navigate("/library")}>Browse Library</Button>}
        />
      ) : (
        <div className="space-y-4">
          {sessions.map((s) => {
            const g = registry.get(s.game_id);
            const seated = players.filter((p) => s.players?.includes(p.id));
            return (
              <Card
                key={s.id}
                className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center"
                data-testid={`session-row-${s.id}`}
              >
                <span
                  className="h-14 w-14 flex-shrink-0 rounded-xl border border-subtle"
                  style={{ background: g?.meta.glow || "var(--primary-amber-glow)" }}
                />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-3">
                    <p className="font-display text-lg text-maintext">
                      {s.title || g?.name || s.game_id}
                    </p>
                    <StatusPill status={g?.status || GameStatus.AVAILABLE} />
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 font-mono text-xs text-dim">
                    <span>turn {s.turn}</span>
                    <span>updated {relTime(s.updated_at)}</span>
                    <span className={cn("uppercase", s.status === "active" && "text-emerald")}>
                      {s.status}
                    </span>
                  </div>
                </div>
                <div className="flex items-center -space-x-2">
                  {seated.map((p) => (
                    <Avatar key={p.id} player={p} size={30} className="ring-2 ring-[var(--bg-base)]" />
                  ))}
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    data-testid={`resume-session-${s.id}`}
                    onClick={() => navigate(`/play/${s.game_id}`)}
                  >
                    <Play className="h-4 w-4" /> Resume
                  </Button>
                  <button
                    data-testid={`copy-session-${s.id}`}
                    onClick={() => {
                      navigator.clipboard?.writeText(s.id);
                      toast.success("Session ID copied");
                    }}
                    className="flex h-10 w-10 items-center justify-center rounded-full border border-subtle text-muted transition-colors hover:border-medium hover:text-maintext"
                  >
                    <Copy className="h-4 w-4" />
                  </button>
                  <button
                    data-testid={`delete-session-${s.id}`}
                    onClick={() => {
                      removeSession(s.id);
                      toast("Session deleted");
                    }}
                    className="flex h-10 w-10 items-center justify-center rounded-full border border-crimson/40 text-crimson transition-colors hover:bg-crimson/10"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
