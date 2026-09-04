import React, { useState } from "react";
import { toast } from "sonner";
import { UserPlus, Pencil, Trash2, Check, Armchair } from "lucide-react";
import { usePlatform } from "../platform/PlatformProvider";
import { SectionLabel, Button, Card, EmptyState, Avatar, AVATAR_PRESETS, cn } from "../ui/kit";
import { Modal } from "../ui/Modal";

const COLORS = ["#e5a93c", "#b83a3a", "#2d8a64", "#3b72b0", "#a568c9", "#d4af37"];

function PlayerForm({ initial, onSubmit, onCancel }) {
  const [name, setName] = useState(initial?.name || "");
  const [avatar, setAvatar] = useState(initial?.avatar || AVATAR_PRESETS[0].id);
  const [color, setColor] = useState(initial?.color || COLORS[0]);
  const preview = { name, avatar, color };

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-4">
        <Avatar player={preview} size={64} />
        <input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Player name"
          data-testid="player-name-input"
          className="flex-1 rounded-xl border border-subtle bg-black/30 px-4 py-3 font-ui text-maintext outline-none focus:border-strong"
        />
      </div>

      <div>
        <p className="mb-2 text-xs uppercase tracking-wider text-dim">Avatar</p>
        <div className="flex flex-wrap gap-2">
          {AVATAR_PRESETS.map((p) => (
            <button
              key={p.id}
              onClick={() => setAvatar(p.id)}
              data-testid={`avatar-${p.id}`}
              className={cn(
                "rounded-xl border p-1 transition-colors",
                avatar === p.id ? "border-strong" : "border-subtle hover:border-medium"
              )}
            >
              <Avatar player={{ avatar: p.id, color }} size={40} />
            </button>
          ))}
        </div>
      </div>

      <div>
        <p className="mb-2 text-xs uppercase tracking-wider text-dim">Color</p>
        <div className="flex flex-wrap gap-2">
          {COLORS.map((c) => (
            <button
              key={c}
              onClick={() => setColor(c)}
              data-testid={`color-${c}`}
              className={cn(
                "h-9 w-9 rounded-full border-2 transition-transform hover:scale-110",
                color === c ? "border-white" : "border-transparent"
              )}
              style={{ background: c }}
            />
          ))}
        </div>
      </div>

      <div className="flex justify-end gap-3 pt-2">
        <Button variant="subtle" onClick={onCancel} data-testid="player-cancel-button">
          Cancel
        </Button>
        <Button
          data-testid="player-save-button"
          disabled={!name.trim()}
          onClick={() => onSubmit({ name: name.trim(), avatar, color })}
        >
          <Check className="h-4 w-4" /> Save Player
        </Button>
      </div>
    </div>
  );
}

export default function PlayersView() {
  const { players, activeSeats, createPlayer, updatePlayer, removePlayer, toggleSeat } =
    usePlatform();
  const [modal, setModal] = useState(null); // {mode:'create'|'edit', player}

  const submit = async (data) => {
    if (modal.mode === "edit") {
      await updatePlayer(modal.player.id, data);
      toast.success("Player updated");
    } else {
      await createPlayer(data);
      toast.success("Player added to the roster");
    }
    setModal(null);
  };

  return (
    <div className="space-y-8">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <SectionLabel>Local Roster</SectionLabel>
          <h1 className="mt-2 font-display text-3xl font-bold tracking-tight text-maintext sm:text-4xl">
            Players
          </h1>
          <p className="mt-2 max-w-xl text-muted">
            Local pass-and-play profiles. Seat players to bring them to the table
            — no login required.
          </p>
        </div>
        <Button data-testid="add-player-button" onClick={() => setModal({ mode: "create" })}>
          <UserPlus className="h-4 w-4" /> Add Player
        </Button>
      </div>

      {players.length === 0 ? (
        <EmptyState
          icon={UserPlus}
          title="No players yet"
          description="Create your first local profile to start seating a table."
          action={
            <Button onClick={() => setModal({ mode: "create" })}>
              <UserPlus className="h-4 w-4" /> Add Player
            </Button>
          }
        />
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {players.map((p) => {
            const seated = activeSeats.includes(p.id);
            return (
              <Card key={p.id} className="p-5" data-testid={`player-card-${p.id}`}>
                <div className="flex items-center gap-4">
                  <Avatar player={p} size={52} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-display text-lg text-maintext">{p.name}</p>
                    <p className="font-mono text-xs text-dim">
                      {Object.keys(p.stats || {}).length} stats tracked
                    </p>
                  </div>
                </div>
                <div className="mt-5 flex items-center gap-2">
                  <Button
                    variant={seated ? "primary" : "subtle"}
                    className="flex-1"
                    data-testid={`seat-toggle-${p.id}`}
                    onClick={() => toggleSeat(p.id)}
                  >
                    <Armchair className="h-4 w-4" /> {seated ? "Seated" : "Seat"}
                  </Button>
                  <button
                    onClick={() => setModal({ mode: "edit", player: p })}
                    data-testid={`edit-player-${p.id}`}
                    className="flex h-10 w-10 items-center justify-center rounded-full border border-subtle text-muted transition-colors hover:border-medium hover:text-maintext"
                  >
                    <Pencil className="h-4 w-4" />
                  </button>
                  <button
                    onClick={() => {
                      removePlayer(p.id);
                      toast("Player removed");
                    }}
                    data-testid={`delete-player-${p.id}`}
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

      <Modal
        open={!!modal}
        onClose={() => setModal(null)}
        title={modal?.mode === "edit" ? "Edit Player" : "New Player"}
        testId="player-modal"
      >
        {modal && (
          <PlayerForm initial={modal.player} onSubmit={submit} onCancel={() => setModal(null)} />
        )}
      </Modal>
    </div>
  );
}
