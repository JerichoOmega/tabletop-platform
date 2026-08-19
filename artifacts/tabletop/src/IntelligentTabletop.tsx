// ---------------------------------------------------------------------------
// INTELLIGENT TABLETOP — main React component.
//
// This file owns ONLY the React layer: state, event handlers, and JSX.
// All game rules live in src/engine/. All intent parsing lives in src/intent/.
// All small UI pieces live in src/ui/primitives.tsx.
//
// Bug fixes applied on top of the v4 prototype:
//   1. turnKey useEffect — auto-selects the current PC at every turn handover
//      (and on each new encounter) so action buttons appear without a manual
//      card click. Keyed on `${seed}-${currentActorId}` so it fires both when
//      the actor changes AND when the encounter resets.
//   2. Layout — action controls + End Turn rendered ABOVE the ENEMIES section
//      so they are visible without scrolling at normal viewport heights.
//   3. newEncounter button — `onClick={() => newEncounter()}` instead of
//      `onClick={newEncounter}` to prevent the SyntheticEvent from being
//      passed as the encounterId argument.
//   4. flexWrap on action button row so buttons don't overflow on narrow panels.
// ---------------------------------------------------------------------------

import React, { useState, useMemo, useCallback, useRef, useEffect } from "react";
import {
  Footprints, Sword, Sparkles, ScrollText, Dice5, ChevronRight, X, Check, Info,
  Skull, Swords, DoorOpen,
} from "lucide-react";

import type { GameState, HealResult, DamageResult } from "@/engine/content";
import { ENCOUNTER_DEFS, ABILITY_DEFS, buildEncounter, mulberry32, getProductionEncounters } from "@/engine/content";
import type { Rng } from "@/engine/content";
import type { AttackResult, ValidationResult, ValidationCode } from "@/engine/rules";
import {
  resolveLeadingEnemyTurns, endTurn,
  executeMove, executeAttack, executeAbility,
  validateAttack, validateAbility,
  checkEncounterStatus,
  reachableTiles, occupiedSet,
  key,
} from "@/engine/rules";
import type { ViewportState, VisibleTile } from "@/engine/viewport";
import { getVisibleTiles, initViewport, updateViewportForActor } from "@/engine/viewport";
// Phase F: viewport streaming — chunk prefetch + loading presentation.
// WorldState is imported for type-only use; the ref is null for all current
// MapDef-backed encounters. The streaming infrastructure activates automatically
// when a world-backed encounter populates worldStateRef.current.
import type { WorldState, PreparedEncounter, WorldEntity } from "@/engine/world";
import { worldEntityToCombatant, buildEncounterFromEntities } from "@/engine/world";
import { getChunksForViewport, prefetchViewportChunks, PREFETCH_MARGIN } from "@/engine/viewportStreaming";
import { evictDistantChunks } from "@/engine/evictionPolicy";
// Phase 3 M1: exploration session — party moves through the streaming world.
import type { ExplorationSession, ExploreLocation } from "@/engine/exploration";
import {
  createExplorationSession, explorationTileInfo, movePartyStep,
  detectAdjacentHostiles, adjacentStepTargets, getParty, respawnPartyAtSpawn,
  EXPLORE_WORLD_W, EXPLORE_WORLD_H, EXPLORE_LOCATIONS, nearbyLocation,
} from "@/engine/exploration";
import { CHUNK_W, CHUNK_H } from "@/engine/chunk";
import type { Step, RevalidationCheck, ProposedAction } from "@/intent/parser";
import { parseIntent, revalidateProposal, executeProposalSteps, exampleTargetPhrase } from "@/intent/parser";
import { FONT_IMPORT, ClassIcon, CharacterPanel, actionBtnStyle } from "@/ui/primitives";
import { resolveAsset } from "@/assets/registry";

// ---------------------------------------------------------------------------
// LOCAL TYPES — owned by the React layer; engine types are imported above.
// ---------------------------------------------------------------------------

type AttackRoll  = { kind: "attack";  actor: string; targetName: string }  & AttackResult;
type AbilityRoll =
  | ({ kind: "ability"; actor: string; abilityName: string } & HealResult)
  | ({ kind: "ability"; actor: string; abilityName: string } & DamageResult);
type LastRoll = AttackRoll | AbilityRoll | null;

interface ProposalState {
  steps:   Step[];
  summary: string;
  checks:  RevalidationCheck[];
  actorId: string;
  text:    string;
  stale:   boolean;
}

/** Transient UI-only hover state during targeting mode.
 *  Never written into GameState. Cleared whenever pendingAction changes. */
type TargetPreview = {
  targetId: string;
  valid: boolean;
  code: ValidationCode;
  reason?: string;
  distance?: number;
  cover?: boolean;
} | null;

// ---------------------------------------------------------------------------
// RESPONSIVE CSS — injected as a <style> tag alongside FONT_IMPORT.
//
// Breakpoints:
//   ≥ 1100px  — wide desktop: 3-col (220px | 1fr | 260px)
//   768-1099px — tablet landscape / narrow desktop: 3-col (160px | 1fr | 200px)
//   < 768px   — tablet portrait: single column, board first
//
// All grid/layout behaviour lives here so that CSS media queries win over
// fixed values without needing any JS resize logic for layout.  cellPx is
// still computed in JS (it affects the React grid template), but visual
// structure is CSS-only.
// ---------------------------------------------------------------------------
const RESPONSIVE_CSS = `
  .it-root {
    -webkit-tap-highlight-color: transparent;
    touch-action: pan-y;
    user-select: none;
    -webkit-user-select: none;
  }
  /* Ensure comfortable touch targets across all buttons */
  .it-root button {
    min-height: 38px;
    touch-action: manipulation;
  }
  /* Encounter switcher pills — compact on small screens */
  .it-encounter-switcher {
    display: flex;
    gap: 6px;
    flex-wrap: wrap;
    margin-bottom: 14px;
  }
  /* ---- Main three-column layout ---- */
  .it-main-grid {
    display: grid;
    grid-template-columns: 220px 1fr 260px;
    gap: 16px;
    align-items: start;
  }
  /* Tablet landscape / narrow desktop */
  @media (max-width: 1099px) {
    .it-main-grid {
      grid-template-columns: 160px 1fr 200px;
      gap: 10px;
    }
  }
  /* Tablet portrait / phone — stack columns, board first */
  @media (max-width: 767px) {
    .it-main-grid {
      grid-template-columns: 1fr;
      gap: 12px;
    }
    .it-board-col  { order: 1; }
    .it-left-panel { order: 2; }
    .it-right-panel { order: 3; }
    /* On portrait the session log can be shorter — saves scroll distance */
    .it-session-log { height: 200px !important; }
  }
  /* ---- Focus visibility — gold ring matching the tabletop aesthetic ----
     Applied via :focus-visible so mouse users are unaffected.              */
  .it-root button:focus-visible,
  .it-root [role="button"]:focus-visible,
  .it-root input:focus-visible,
  .it-root [tabindex="0"]:focus-visible {
    outline: 2px solid #c9a227;
    outline-offset: 2px;
    border-radius: 4px;
  }
  /* ---- Visually-hidden utility — sr-only pattern for screen-reader text ---- */
  .sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    margin: -1px;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
    white-space: nowrap;
    border: 0;
  }
  /* ---- Reduced motion — suppress non-essential transitions for users who
     prefer it. Gameplay timing is unaffected; only visual transitions change. ---- */
  @media (prefers-reduced-motion: reduce) {
    .it-root *, .it-root *::before, .it-root *::after {
      transition-duration: 0.01ms !important;
      animation-duration: 0.01ms !important;
      animation-iteration-count: 1 !important;
    }
  }

  /* =====================================================================
     ANIMATION KEYFRAMES — restrained tactile feedback.
     All animations are one-shot (iteration-count: 1) and self-cleaning.
     The reduced-motion rule above suppresses them to 0.01ms for users
     who prefer it — no duplicate or conflicting overrides needed here.
  ===================================================================== */

  /* Movement entrance — token pops into its new cell from a slight scale */
  @keyframes it-move-in {
    from { transform: scale(0.72); opacity: 0.55; }
    to   { transform: scale(1);    opacity: 1;    }
  }
  .it-anim-move {
    animation: it-move-in 0.28s cubic-bezier(0.22, 1, 0.36, 1);
    animation-fill-mode: both;
  }

  /* Attacker lunge — brief scale pop on the striking token */
  @keyframes it-strike {
    0%   { transform: scale(1);    }
    35%  { transform: scale(1.18); }
    100% { transform: scale(1);    }
  }
  .it-anim-strike {
    animation: it-strike 0.32s ease-out;
    animation-fill-mode: both;
  }

  /* Hit reaction — lateral shake on the damaged token */
  @keyframes it-hit {
    0%   { transform: translate(0,    0) scale(1);    }
    18%  { transform: translate(-4px, 0) scale(0.94); }
    36%  { transform: translate( 4px, 0) scale(1.03); }
    54%  { transform: translate(-2px, 0) scale(0.97); }
    72%  { transform: translate( 1px, 0) scale(1.01); }
    100% { transform: translate(0,    0) scale(1);    }
  }
  .it-anim-hit {
    animation: it-hit 0.42s ease-out;
    animation-fill-mode: both;
  }

  /* Miss — faint amber flicker on the evading token */
  @keyframes it-miss {
    0%   { opacity: 1;   }
    25%  { opacity: 0.4; }
    65%  { opacity: 0.85;}
    100% { opacity: 1;   }
  }
  .it-anim-miss {
    animation: it-miss 0.35s ease-out;
    animation-fill-mode: both;
  }

  /* Heal — expanding green glow ring */
  @keyframes it-heal {
    0%   { box-shadow: 0 0 0 0   rgba(90, 190, 70, 0),   0 2px 5px rgba(0,0,0,0.5); }
    40%  { box-shadow: 0 0 0 7px rgba(90, 190, 70, 0.7), 0 2px 5px rgba(0,0,0,0.5); }
    100% { box-shadow: 0 0 0 0   rgba(90, 190, 70, 0),   0 2px 5px rgba(0,0,0,0.5); }
  }
  .it-anim-heal {
    animation: it-heal 0.65s ease-out;
    animation-fill-mode: both;
  }

  /* Turn transition — gold pulse ring on newly active actor */
  @keyframes it-acting-pulse {
    0%   { box-shadow: 0 0 0 0   rgba(201, 162, 39, 0.7), 0 2px 5px rgba(0,0,0,0.5); }
    45%  { box-shadow: 0 0 0 9px rgba(201, 162, 39, 0.3), 0 2px 5px rgba(0,0,0,0.5); }
    100% { box-shadow: 0 0 0 4px rgba(201, 162, 39, 0),   0 2px 5px rgba(0,0,0,0.5); }
  }
  .it-anim-acting {
    animation: it-acting-pulse 0.65s ease-out;
    animation-fill-mode: both;
  }

  /* Intent card entrance — proposal / query / inspect */
  @keyframes it-card-in {
    from { opacity: 0; transform: translateY(-7px); }
    to   { opacity: 1; transform: translateY(0);    }
  }
  .it-anim-card-in {
    animation: it-card-in 0.22s ease-out;
    animation-fill-mode: both;
  }

  /* Victory / defeat banner entrance */
  @keyframes it-banner-in {
    from { opacity: 0; transform: scaleY(0.8); transform-origin: top; }
    to   { opacity: 1; transform: scaleY(1);   transform-origin: top; }
  }
  .it-anim-banner-in {
    animation: it-banner-in 0.28s cubic-bezier(0.22, 1, 0.36, 1);
    animation-fill-mode: both;
  }
  /* World-location marker attention pulse — draws the eye to a discoverable
     place the party is beside. Suppressed under prefers-reduced-motion by the
     rule below (animation-duration collapses to 0.01ms). */
  @keyframes it-loc-pulse {
    0%   { box-shadow: 0 0 0 2px rgba(232,194,74,0.55), 0 2px 6px rgba(0,0,0,0.5); }
    50%  { box-shadow: 0 0 0 6px rgba(232,194,74,0.12), 0 2px 6px rgba(0,0,0,0.5); }
    100% { box-shadow: 0 0 0 2px rgba(232,194,74,0.55), 0 2px 6px rgba(0,0,0,0.5); }
  }
  .it-loc-pulse {
    animation: it-loc-pulse 1.8s ease-in-out infinite;
  }
`;

// True when running under Playwright or any other harness that appends ?e2e to
// the URL.  Test-only encounters are hidden from the picker in normal usage.
const isE2E = typeof window !== "undefined" && new URLSearchParams(window.location.search).has("e2e");

// M7 entry model: EXPLORATION IS THE PRIMARY GAME STATE. A normal session
// launches straight into the streaming world; the MapDef encounter surface
// (picker + practice battles) remains available as developer/test tooling,
// reachable via "Return to Encounter" or directly with ?practice (used by
// the combat-focused E2E suites). ?e2e implies practice entry so the large
// existing combat test surface keeps its deterministic encounter-first entry.
const isPracticeEntry =
  isE2E ||
  (typeof window !== "undefined" && new URLSearchParams(window.location.search).has("practice"));

// ---------------------------------------------------------------------------
// VIEWPORT SIZE — presentation constants (Phase D).
// The tabletop is a fixed-size surface.  These values cap the viewport so it
// never exceeds the physical table, regardless of world size.
//
// For small maps (8×6): initViewport clamps to min(12,8)=8 × min(10,6)=6
//   → exactly as before — no visual change on existing encounters.
// For large maps (40×40): clamps to 12×10 → world > viewport ✓
//
// DEAD_ZONE_MARGIN=3, tileW=12, tileH=10:
//   X dead zone: [3, 8] — 5 valid tiles — non-degenerate ✓
//   Y dead zone: [3, 6] — 3 valid tiles — non-degenerate ✓ (was degenerate on 8×6)
// ---------------------------------------------------------------------------
const VIEWPORT_TILE_W = 12;
const VIEWPORT_TILE_H = 10;

export default function IntelligentTabletop() {
  const seedRef        = useRef(1337);
  const encounterIdRef = useRef("crypt");
  const rngRef         = useRef<Rng | null>(null);
  // Phase F: WorldState reference for chunk-backed encounters.
  // This is a ref (not state) so mutations — chunk loads, evictions — never
  // trigger React re-renders. All current encounters are MapDef-backed;
  // this ref is always null until a world-backed encounter is introduced.
  //
  // ISOLATION INVARIANT: worldStateRef.current must NEVER be written into
  // GameState. It is owned exclusively by the presentation layer.
  const worldStateRef  = useRef<WorldState | null>(null);

  // Phase 3 M1: EXPLORATION SESSION.
  // sessionMode selects which surface the table shows:
  //   "encounter"   — the existing MapDef-backed combat encounter (default).
  //   "exploration" — the streaming world; party position is authoritative
  //                   in the WorldEntityRegistry, chunks stream via the
  //                   existing viewport prefetch path.
  // explorationRef is a ref (mutable class instances live inside); the
  // exploreVersion counter triggers re-renders after authoritative entity
  // mutations (party movement) — mirroring the chunkVersion pattern.
  const [sessionMode, setSessionMode] = useState<"encounter" | "exploration">("encounter");
  const explorationRef = useRef<ExplorationSession | null>(null);
  const [exploreVersion, setExploreVersion] = useState(0);

  // M7: exploration-first launch. A normal (non-practice) session enters the
  // world immediately — the encounter picker is never the player's entry
  // surface. Ref-guarded so StrictMode's double-invoked mount effect cannot
  // create two exploration sessions.
  const autoExploredRef = useRef(false);
  useEffect(() => {
    if (isPracticeEntry || autoExploredRef.current) return;
    autoExploredRef.current = true;
    startExploration();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Phase 3 M5: WORLD-BACKED ENCOUNTER lifecycle state.
  // When the party bumps into a hostile during exploration, the session
  // transitions to a world-backed combat encounter:
  //   beginEncounter() → buildEncounterFromEntities() → combat →
  //   endEncounter() commit → back to exploration.
  //
  //   worldEncounter — true while the current gameState was built from world
  //                    entities (the exploration session stays alive behind it).
  //   preparedRef    — the PreparedEncounter (pin set) for the active world
  //                    encounter. Cleared exactly once when endEncounter()
  //                    commits — this is the "committed" guard.
  //   startingEncounterRef — re-entrancy guard while beginEncounter() streams
  //                    and pins chunks (async).
  const [worldEncounter, setWorldEncounter] = useState(false);
  const preparedRef = useRef<PreparedEncounter | null>(null);
  const startingEncounterRef = useRef(false);

  // LOCATION DELVE: the party entered a discoverable world location (e.g. the
  // Ruined Crypt) from exploration. The exploration session stays alive behind
  // a MapDef-backed encounter; resolving it returns the party to exploration at
  // its world position. `locationDelve` holds the active location's name for
  // presentation (banner + return control); null when not delving.
  const [locationDelve, setLocationDelve] = useState<string | null>(null);
  const locationDelveRef = useRef<ExploreLocation | null>(null);

  const [gameState, setGameState] = useState(() => {
    const fresh = buildEncounter(encounterIdRef.current, seedRef.current);
    const rng   = mulberry32(seedRef.current + 9999); // separate stream for combat rolls
    rngRef.current = rng;
    return resolveLeadingEnemyTurns(fresh, rng);
  });
  // ---------------------------------------------------------------------------
  // VIEWPORT STATE — presentation only; NEVER placed in GameState.
  // Describes which portion of the world is currently shown on the table.
  // The viewport is capped at VIEWPORT_TILE_W × VIEWPORT_TILE_H so large
  // worlds only render the visible window (world ≠ viewport, Phase D).
  // For 8×6 small maps the cap clamps to 8×6 — no visual change.
  // ---------------------------------------------------------------------------
  const [viewport, setViewport] = useState<ViewportState>(
    () => initViewport(gameState.map, VIEWPORT_TILE_W, VIEWPORT_TILE_H)
  );
  // Phase F: presentation-only chunk version counter.
  // Incremented when viewport chunks finish loading, causing loadingChunkSet to
  // re-derive and update the loading placeholder display. Never in GameState.
  const [chunkVersion, setChunkVersion] = useState(0);

  const [mode, setMode]               = useState<"traditional" | "assisted" | "adventure">("traditional");
  const [selectedId, setSelectedId]   = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<string | null>(null); // 'move' | 'attack' | 'ability:<id>' | null
  const [lastRoll, setLastRoll]       = useState<LastRoll>(null);
  const [textInput, setTextInput]     = useState("");
  const [proposal, setProposal]       = useState<ProposalState | null>(null);
  const [infoResult, setInfoResult]   = useState<ProposedAction | null>(null);
  const [banner, setBanner]           = useState<string | null>(null);
  const [targetPreview, setTargetPreview] = useState<TargetPreview>(null);

  // ---------------------------------------------------------------------------
  // ANIMATION STATE — purely transient presentation state; never in GameState.
  // Maps combatant id → CSS class name. Each entry self-removes after its
  // animation duration via setTimeout. Reduced-motion is handled globally in
  // RESPONSIVE_CSS (all animation-duration collapsed to 0.01ms there).
  // ---------------------------------------------------------------------------
  const [animClasses, setAnimClasses] = useState<Record<string, string>>({});
  const triggerAnim = useCallback((id: string, cls: string, durationMs: number) => {
    setAnimClasses(prev => ({ ...prev, [id]: cls }));
    setTimeout(() => {
      setAnimClasses(prev => {
        if (prev[id] !== cls) return prev; // another animation took over — leave it
        const next = { ...prev };
        delete next[id];
        return next;
      });
    }, durationMs);
  }, []); // setAnimClasses is a stable setter

  // cellPx drives the board grid. Starts at 52 (desktop), drops to 46 on
  // narrower viewports (<1100 px) so the board stays visible alongside panels.
  // This is purely presentational — GameState never sees viewport dimensions.
  const [cellPx, setCellPx] = useState(52);
  useEffect(() => {
    function updateCellPx() {
      setCellPx(window.innerWidth < 1100 ? 46 : 52);
    }
    updateCellPx();
    window.addEventListener("resize", updateCellPx, { passive: true });
    return () => window.removeEventListener("resize", updateCellPx);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Phase F: Non-blocking viewport chunk prefetch.
  // Fires whenever the viewport changes (actor dead-zone follow or future
  // user-driven panning). Immediately returns — chunk loads proceed in the
  // background via ChunkStore.ensureResident() (fire-and-forget).
  //
  // ISOLATION INVARIANTS (Task Instruction §4, §13, §14):
  //   • Does NOT modify gameState, viewport, or GameState.tileQuery.
  //   • Does NOT pin chunks (only encounter setup pins via ensureResidentAndPin).
  //   • setChunkVersion only triggers a re-render for the loading indicator —
  //     it never writes viewport state, preventing stale-completion corruption.
  //   • The `cancelled` flag prevents state updates after unmount.
  //
  // Currently a no-op for all MapDef encounters (worldStateRef.current === null).
  useEffect(() => {
    const ws = worldStateRef.current;
    if (!ws) return;
    let cancelled = false;
    // M4: ws.bounds filters chunks entirely outside the playable world —
    // the prefetch margin near a world edge never generates out-of-world chunks.
    const chunks = getChunksForViewport(viewport, PREFETCH_MARGIN, ws.bounds);
    const promises = chunks.map(({ cx, cy }) =>
      ws.chunkStore.ensureResident(cx, cy, ws.seed).catch(() => {
        // Presentation load failure — chunk stays UNLOADED.
        // Rules engine uses the immutable snapshot; this only affects display.
      })
    );
    void Promise.allSettled(promises).then(() => {
      if (cancelled) return;
      // Phase 3 M2: eviction runs AFTER prefetch settles (never on a timer).
      // Removes RESIDENT chunks beyond the hysteresis threshold; PINNED and
      // LOADING chunks are immune. Geometry only — WorldEntityRegistry and
      // all authoritative state are untouched by design (Decision 25).
      evictDistantChunks(ws.chunkStore, viewport);
      setChunkVersion(v => v + 1);
    });
    return () => { cancelled = true; };
  }, [viewport]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---------------------------------------------------------------------------
  // Phase 3 M2 — E2E diagnostics hook (test builds only, ?e2e query param).
  //
  // Read-only inspection of the live WorldState so the completion-gate E2E can
  // verify chunk residency, deterministic geometry, and entity survival. It
  // returns plain serializable snapshots and NEVER mutates anything. It is not
  // installed in production sessions (isE2E is false without the query param).
  // ---------------------------------------------------------------------------
  useEffect(() => {
    if (!isE2E) return;
    type WorldDebug = (cx: number, cy: number) => {
      residency: string;
      geometryHash: string | null;
      heldChunks: { cx: number; cy: number; residency: string }[];
      entities: { worldId: string; defId: string; wx: number; wy: number; hp: number; maxHp: number; alive: boolean }[];
    } | null;
    const hook: WorldDebug = (cx, cy) => {
      const ws = worldStateRef.current;
      if (!ws) return null;
      const geometry = ws.chunkStore.getGeometry(cx, cy);
      const geometryHash = geometry
        ? [...geometry.tiles.entries()]
            .map(([k, t]) => `${k}:${t.type}`)
            .sort()
            .join("|")
        : null;
      return {
        residency: ws.chunkStore.residency(cx, cy),
        geometryHash,
        heldChunks: ws.chunkStore.listChunks(),
        entities: ws.entities.getAll().map((e) => ({
          worldId: e.worldId, defId: e.defId, wx: e.wx, wy: e.wy,
          hp: e.hp, maxHp: e.maxHp, alive: e.alive,
        })),
      };
    };
    (window as unknown as { __worldDebug?: WorldDebug }).__worldDebug = hook;
    return () => {
      delete (window as unknown as { __worldDebug?: WorldDebug }).__worldDebug;
    };
  }, []);

  const currentActorId = gameState.turnOrder[gameState.turnIndex];
  const currentActor   = gameState.combatants[currentActorId];
  // A "player turn" only exists while the encounter is ongoing — after
  // victory/defeat the turn cycle is terminal (engine endTurn guard), so no
  // turn-scoped controls (Attack / End Turn / intent bar) may render.
  const isPlayerTurn =
    currentActor && currentActor.type === "pc" && checkEncounterStatus(gameState) === "ongoing";
  const selected       = selectedId ? gameState.combatants[selectedId] : null;

  // ---------------------------------------------------------------------------
  // FIX 1 — Auto-select the current PC at every turn handover.
  // `turnKey` encodes both the encounter seed (changes on newEncounter()) and
  // the current actor id (changes on endTurn()). This means the effect fires:
  //   • once per turn, when the actor changes
  //   • on every newEncounter() call, even if the same PC wins initiative again
  // It does NOT fire on mid-turn state mutations (executeMove, executeAttack,
  // etc.) because only the combatants object changes, not the key.
  // ---------------------------------------------------------------------------
  const turnKey = `${gameState.seed}-${currentActorId}`;
  useEffect(() => {
    // Gold pulse ring on whichever combatant just became the active actor.
    // Fires for both PC and enemy turns; reduced-motion collapses it to 0.01ms.
    if (currentActorId) triggerAnim(currentActorId, "it-anim-acting", 750);
    if (isPlayerTurn && currentActorId) {
      setSelectedId(currentActorId);
      setPendingAction(null);
    }
  }, [turnKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // Clear hover preview whenever targeting mode changes (covers End Turn, mode
  // button clicks, action execution, and encounter resets — all call setPendingAction).
  useEffect(() => { setTargetPreview(null); }, [pendingAction]); // eslint-disable-line react-hooks/exhaustive-deps

  // Derived straight from gameState so it is correct regardless of which code
  // path produced that state — including the lazy useState initializer and
  // newEncounter(), where calling a setter isn't an option.
  const encounterStatus = useMemo(() => checkEncounterStatus(gameState), [gameState]);
  const encounterBanner =
    encounterStatus === "victory"
      ? `Victory! The ${gameState.encounterName} encounter is cleared.`
      : encounterStatus === "defeat"
      ? `Defeat. The party has fallen in the ${gameState.encounterName}.`
      : null;

  // ---------------------------------------------------------------------------
  // VISIBLE TILES — derived from viewport + tileQuery.
  // A 2-D array (rows × cols) of VisibleTile, each carrying its authoritative
  // world coordinate (wx, wy). The renderer iterates this array; it MUST use
  // tile.wx/tile.wy for all world-coordinate operations (token lookup, reach
  // set, move destination) rather than the viewport-relative vx/vy indices.
  // ---------------------------------------------------------------------------
  const visibleTiles = useMemo(() => {
    // Phase 3 M1: exploration renders from the LIVE chunk store (presentation
    // only — there is no GameState in exploration). Encounter mode keeps the
    // immutable GameState.tileQuery snapshot, as always.
    const session = explorationRef.current;
    if (sessionMode === "exploration" && session) {
      return getVisibleTiles(viewport, (wx, wy) => explorationTileInfo(session, wx, wy));
    }
    return getVisibleTiles(viewport, gameState.tileQuery);
    // chunkVersion/exploreVersion are re-render triggers for streamed-in
    // chunks and party movement; explorationRef is a ref (untracked).
  }, [viewport, gameState.tileQuery, sessionMode, chunkVersion, exploreVersion]); // eslint-disable-line react-hooks/exhaustive-deps

  // Phase F: Presentation loading state — which visible chunks are LOADING.
  //
  // ISOLATION INVARIANT: this memo is PURELY presentational.
  //   It does NOT flow into GameState, tileQuery, or any rules engine function.
  //   The rules engine always reads gameState.tileQuery (the immutable snapshot),
  //   never the live ChunkStore residency checked here.
  //
  // Recalculates when:
  //   • The viewport changes (new visible chunks → check their residency).
  //   • chunkVersion increments (a prefetch completed → loading state changed).
  //
  // Always returns an empty Set for MapDef encounters (worldStateRef.current === null).
  // Becomes meaningful only when a WorldState-backed encounter is active.
  //
  // Note: worldStateRef is a ref, not state, so this memo reads it without
  // listing it as a dependency — React will not track it. The chunkVersion
  // dependency is what causes re-evaluation when chunks finish loading.
  const loadingChunkSet = useMemo(() => {
    const ws = worldStateRef.current;
    if (!ws) return new Set<string>();
    const result = new Set<string>();
    for (const { cx, cy } of getChunksForViewport(viewport, 0, ws.bounds)) {
      if (ws.chunkStore.residency(cx, cy) === "LOADING") {
        result.add(`${cx},${cy}`);
      }
    }
    return result;
  }, [viewport, chunkVersion]); // eslint-disable-line react-hooks/exhaustive-deps

  const reachable = useMemo(() => {
    if (!isPlayerTurn || pendingAction !== "move" || !selected || selected.id !== currentActorId) return [];
    const occ = occupiedSet(gameState.combatants, selected.id);
    return reachableTiles(gameState.tileQuery, { wx: selected.wx, wy: selected.wy }, selected.moveRemaining, occ);
  }, [gameState, pendingAction, selected, currentActorId, isPlayerTurn]);

  const attackPreview = useMemo(() => {
    if (!isPlayerTurn || pendingAction !== "attack" || !selected || selected.id !== currentActorId) return {} as Record<string, ValidationResult>;
    const map: Record<string, ValidationResult> = {};
    Object.values(gameState.combatants).forEach((c) => {
      if (c.type === "enemy" && c.alive) map[c.id] = validateAttack(gameState, selected.id, c.id);
    });
    return map;
  }, [gameState, pendingAction, selected, currentActorId, isPlayerTurn]);

  const pendingAbilityId = typeof pendingAction === "string" && pendingAction.startsWith("ability:")
    ? pendingAction.slice(8) : null;
  const pendingAbility   = pendingAbilityId ? ABILITY_DEFS[pendingAbilityId] : null;
  // Harmful abilities (enemy-targeting) use the same red ring as attacks.
  // Beneficial abilities (ally/self-targeting) use a distinct blue ring.
  const abilityIsHarmful = pendingAbility?.targeting === "enemy";

  const abilityPreview = useMemo(() => {
    if (!isPlayerTurn || !pendingAbilityId || !selected || selected.id !== currentActorId) return {} as Record<string, ValidationResult>;
    const map: Record<string, ValidationResult> = {};
    Object.values(gameState.combatants).forEach((c) => {
      if (c.alive) map[c.id] = validateAbility(gameState, selected.id, pendingAbilityId, c.id);
    });
    return map;
  }, [gameState, pendingAbilityId, selected, currentActorId, isPlayerTurn]);

  // ---------------------------------------------------------------------------
  // EVENT HANDLERS
  // ---------------------------------------------------------------------------

  /**
   * Central state-update handler for every game action (PC move, attack,
   * ability, end turn, enemy AI resolution, proposal execution).
   *
   * Phase C: after applying the new GameState, evaluates the viewport
   * dead-zone policy against the current active actor's authoritative
   * world position and calls setViewport only if the origin actually
   * changes. For current 8×6 small maps, updateViewportForActor always
   * returns the same reference (clamped to 0,0), so no extra re-render
   * is triggered — the mechanism is present but visually dormant until
   * Phase E introduces larger maps.
   *
   * Concurrency hardening: setViewport uses the functional-update form so
   * the calculation always operates on the latest committed viewport state
   * rather than the value captured in the render closure. Under React
   * concurrent rendering, multiple state transitions can be batched before
   * a render commits; the functional form eliminates any stale-state window.
   * updateViewportForActor returns the same reference when the actor is
   * inside the dead zone, so React's Object.is bail-out still suppresses
   * unnecessary re-renders.
   *
   * Architectural invariant: viewport state is computed FROM authoritative
   * GameState; it never flows back into GameState or the rules engine.
   */
  function afterPlayerAction(next: GameState) {
    setGameState(next);
    const actor = next.combatants[next.turnOrder[next.turnIndex]];
    if (actor && actor.alive) {
      const { wx, wy } = actor;
      // World-backed encounters use a synthetic 0×0 MapDef (the snapshot
      // tileQuery is authoritative) — viewport clamping must use the
      // exploration world's extent instead.
      const worldW = worldEncounter ? EXPLORE_WORLD_W : next.map.width;
      const worldH = worldEncounter ? EXPLORE_WORLD_H : next.map.height;
      setViewport(prev => updateViewportForActor(prev, wx, wy, worldW, worldH));
    }
  }

  function doEndTurnAndMaybeAI(state: GameState) {
    // Lifecycle guard (mirrors the engine's own endTurn terminal guard):
    // after victory/defeat no path may cycle turns or run enemy AI. The
    // engine guard is authoritative; this early-return just avoids useless
    // state churn from stale UI events.
    if (checkEncounterStatus(state) !== "ongoing") return state;
    const next = endTurn(state);
    return resolveLeadingEnemyTurns(next, rngRef.current!);
  }

  const handleSelectToken = useCallback((id: string) => {
    setSelectedId(id);
    setPendingAction(null);
    setProposal(null);
  }, []);

  // Phase B: receives a VisibleTile whose authoritative world coordinate (wx, wy)
  // is passed directly to the rules engine. The viewport-relative (vx, vy) is
  // never forwarded — this eliminates the "vx === wx" assumption flagged in the
  // Phase A audit and correctly resolves any future non-zero viewport origin.
  function handleTileClick(tile: VisibleTile) {
    // Phase 3 M1: exploration movement — single adjacent step per click.
    // Authoritative position lives in the WorldEntityRegistry; the viewport
    // follows via the existing dead-zone contract with the M1 world bounds.
    if (sessionMode === "exploration") {
      const session = explorationRef.current;
      if (!session) return;
      const res = movePartyStep(session, tile.wx, tile.wy);
      if (res.ok) {
        const party = getParty(session);
        setExploreVersion(v => v + 1);
        setViewport(prev => updateViewportForActor(prev, party.wx, party.wy, EXPLORE_WORLD_W, EXPLORE_WORLD_H));
        triggerAnim(session.partyWorldId, "it-anim-move", 380);
        const hostiles = detectAdjacentHostiles(session);
        if (hostiles.length > 0) {
          // M5: adjacent hostiles start a world-backed encounter.
          void startWorldEncounter(session, hostiles);
        }
      } else {
        setBanner(res.reason ?? "You cannot move there.");
        setTimeout(() => setBanner(null), 2200);
      }
      return;
    }
    if (mode !== "traditional" || pendingAction !== "move" || !selected) return;
    const res = executeMove(gameState, selected.id, { wx: tile.wx, wy: tile.wy });
    if (res.ok) {
      setPendingAction(null);
      afterPlayerAction(res.state);
      // Token now renders in its new cell — play entrance animation there.
      triggerAnim(selected.id, "it-anim-move", 380);
    } else {
      setBanner(res.events[0]);
      setTimeout(() => setBanner(null), 2200);
    }
  }

  function handleAttackTarget(targetId: string) {
    if (mode !== "traditional" || pendingAction !== "attack" || !selected) return;
    const v = attackPreview[targetId];
    if (!v || !v.valid) {
      // Surface the real rules-engine reason. Do NOT mutate state, do NOT
      // consume the action, and stay in Attack mode so the player can pick
      // a different target.
      const targetName = gameState.combatants[targetId] ? gameState.combatants[targetId].name : "That target";
      setBanner(`${targetName} cannot be attacked: ${v ? v.reason : "Unknown target."}`);
      setTimeout(() => setBanner(null), 2800);
      return;
    }
    const res = executeAttack(gameState, selected.id, targetId, rngRef.current!);
    setPendingAction(null);
    if (res.ok) {
      const atkResult = res.result as AttackResult;
      setLastRoll({ kind: "attack", actor: selected.name, ...atkResult, targetName: gameState.combatants[targetId].name });
      // Attacker lunges; target shakes on hit or flickers on miss.
      triggerAnim(selected.id, "it-anim-strike", 380);
      triggerAnim(targetId, atkResult.hit ? "it-anim-hit" : "it-anim-miss", atkResult.hit ? 500 : 400);
    }
    afterPlayerAction(res.state);
  }

  // FIX: ability targeting — token clicks during `ability:<id>` mode route
  // here, NOT through handleSelectToken. The early-return guard checks the
  // exact pendingAction string so enemy clicks during "move" mode don't
  // accidentally trigger an ability.
  function handleAbilityTarget(abilityId: string, targetId: string) {
    if (mode !== "traditional" || pendingAction !== "ability:" + abilityId || !selected) return;
    const v = validateAbility(gameState, selected.id, abilityId, targetId);
    if (!v.valid) {
      // Real reason, no mutation, no consumed action, stay in ability-targeting mode.
      const targetName = gameState.combatants[targetId] ? gameState.combatants[targetId].name : "That target";
      setBanner(`${ABILITY_DEFS[abilityId].name} cannot target ${targetName}: ${v.reason}`);
      setTimeout(() => setBanner(null), 2800);
      return;
    }
    const res = executeAbility(gameState, selected.id, abilityId, targetId, rngRef.current!);
    setPendingAction(null);
    if (res.ok) {
      const r = res.result as HealResult | DamageResult;
      setLastRoll({ kind: "ability", actor: selected.name, abilityName: ABILITY_DEFS[abilityId].name, ...r });
      // Green glow for heals; shake for damage abilities.
      triggerAnim(targetId, r.type === "heal" ? "it-anim-heal" : "it-anim-hit", r.type === "heal" ? 750 : 500);
    }
    afterPlayerAction(res.state);
  }

  function handleEndTurn() {
    const next = doEndTurnAndMaybeAI(gameState);
    setPendingAction(null);
    afterPlayerAction(next);
  }

  /** Short human phrase for a ValidationCode, shown in the hover preview strip. */
  function previewReasonText(code: ValidationCode, reason?: string): string {
    switch (code) {
      case "OUT_OF_RANGE":          return "out of range";
      case "BLOCKED_LINE_OF_SIGHT": return "line of sight blocked";
      case "INVALID_TARGET_TYPE":   return "wrong target type";
      case "TARGET_DEAD":           return "already dead";
      case "ACTION_USED":           return "action already used";
      case "NOT_YOUR_TURN":         return "not your turn";
      default:                      return reason ?? code.toLowerCase().replace(/_/g, " ");
    }
  }

  function handleTokenPointerEnter(targetId: string) {
    if (!isPlayerTurn || !pendingAction || pendingAction === "move") return;
    if (pendingAction === "attack") {
      const v = attackPreview[targetId];
      if (v) {
        setTargetPreview({ targetId, valid: v.valid, code: v.code, reason: v.reason, distance: v.distance, cover: v.cover });
      } else {
        // Hovered token is a PC or dead enemy — not present in attackPreview.
        const c = gameState.combatants[targetId];
        const reason = c?.type === "pc" ? "Cannot attack an ally." : "Not a valid attack target.";
        setTargetPreview({ targetId, valid: false, code: "INVALID_TARGET_TYPE", reason });
      }
    } else if (pendingAbilityId) {
      const v = abilityPreview[targetId];
      if (v) {
        setTargetPreview({ targetId, valid: v.valid, code: v.code, reason: v.reason, distance: v.distance, cover: v.cover });
      } else {
        setTargetPreview({ targetId, valid: false, code: "TARGET_UNKNOWN", reason: "Not a valid target." });
      }
    }
  }

  function handleTokenPointerLeave() {
    setTargetPreview(null);
  }

  // Both Assisted and Adventure modes funnel through the same interpreter
  // and the same validation/execution engine — there is no separate combat
  // logic per mode. `mode` only changes placeholder copy in the UI.
  function runIntent() {
    if (!isPlayerTurn) return;
    setInfoResult(null);
    const parsed = parseIntent(textInput, gameState, currentActorId);
    if (parsed.type === "error") {
      setBanner(parsed.message);
      setTimeout(() => setBanner(null), 2800);
      return;
    }
    if (parsed.type === "query" || parsed.type === "inspect") {
      setProposal(null);
      setInfoResult(parsed);
      return;
    }
    // type === "proposal"
    const checks = revalidateProposal(gameState, currentActorId, parsed.steps);
    setProposal({ steps: parsed.steps, summary: parsed.summary, checks, actorId: currentActorId, text: textInput, stale: false });
  }

  function approveProposal() {
    if (!proposal) return;
    // End Turn proposals route through the same turn-cycling + AI flow as
    // the Traditional Mode "End Turn" button — no duplicate logic.
    if (proposal.steps.length === 1 && proposal.steps[0].kind === "endTurn") {
      const next = doEndTurnAndMaybeAI(gameState);
      setProposal(null);
      setTextInput("");
      afterPlayerAction(next);
      return;
    }
    // Revalidate against the CURRENT state right before execution. A proposal
    // is a snapshot of intent, not permission to skip the rules engine.
    const freshChecks = revalidateProposal(gameState, proposal.actorId, proposal.steps);
    if (!freshChecks.every((c) => c.valid)) {
      setProposal({ ...proposal, checks: freshChecks, stale: true });
      setBanner("The situation has changed since this was proposed.");
      setTimeout(() => setBanner(null), 2800);
      return;
    }
    // Atomic: either every step applies, or none do.
    const exec = executeProposalSteps(gameState, proposal.actorId, proposal.steps, rngRef.current!);
    if (!exec.ok) {
      setBanner(exec.events[0] || "That action could not be resolved.");
      setTimeout(() => setBanner(null), 2800);
      setProposal(null);
      return;
    }
    if (exec.lastAttackResult) {
      const atkStep = proposal.steps.find((s): s is Extract<Step, { kind: "attack" }> => s.kind === "attack");
      if (atkStep) {
        setLastRoll({ kind: "attack", actor: exec.state.combatants[proposal.actorId].name, targetName: exec.state.combatants[atkStep.targetId]?.name ?? "Unknown", ...exec.lastAttackResult });
        triggerAnim(proposal.actorId, "it-anim-strike", 380);
        triggerAnim(atkStep.targetId, exec.lastAttackResult.hit ? "it-anim-hit" : "it-anim-miss", exec.lastAttackResult.hit ? 500 : 400);
      }
    } else if (exec.lastAbilityResult) {
      const abilityStep = proposal.steps.find((s): s is Extract<Step, { kind: "ability" }> => s.kind === "ability");
      if (abilityStep) {
        const r = exec.lastAbilityResult as HealResult | DamageResult;
        setLastRoll({ kind: "ability", actor: exec.state.combatants[proposal.actorId].name, abilityName: ABILITY_DEFS[abilityStep.abilityId].name, ...r });
        triggerAnim(abilityStep.targetId, r.type === "heal" ? "it-anim-heal" : "it-anim-hit", r.type === "heal" ? 750 : 500);
      }
    }
    setProposal(null);
    setTextInput("");
    afterPlayerAction(exec.state);
  }

  function recalculateProposal() {
    if (!proposal) return;
    const parsed = parseIntent(proposal.text, gameState, proposal.actorId);
    if (parsed.type !== "proposal") {
      setProposal(null);
      setBanner(parsed.type === "error" ? parsed.message : "That is no longer possible.");
      setTimeout(() => setBanner(null), 2800);
      return;
    }
    const checks = revalidateProposal(gameState, proposal.actorId, parsed.steps);
    setProposal({ steps: parsed.steps, summary: parsed.summary, checks, actorId: proposal.actorId, text: proposal.text, stale: false });
  }

  function cancelProposal() { setProposal(null); }
  function cancelInfo()     { setInfoResult(null); }

  // Phase 3 M1: enter the exploration session. Constructs the WorldState
  // (activating the previously dormant worldStateRef prefetch path), centers
  // the viewport on the party, and switches the table surface.
  function startExploration() {
    const session = createExplorationSession();
    explorationRef.current = session;
    worldStateRef.current = session.worldState;
    const party = getParty(session);
    const baseVp = initViewport(
      { width: EXPLORE_WORLD_W, height: EXPLORE_WORLD_H } as GameState["map"],
      VIEWPORT_TILE_W, VIEWPORT_TILE_H,
    );
    // Always a fresh viewport object → the prefetch useEffect fires and
    // begins streaming the chunks around the party.
    setViewport(updateViewportForActor(baseVp, party.wx, party.wy, EXPLORE_WORLD_W, EXPLORE_WORLD_H));
    setSessionMode("exploration");
    setExploreVersion(v => v + 1);
    setSelectedId(null);
    setPendingAction(null);
    setProposal(null);
    setInfoResult(null);
    setLastRoll(null);
    setBanner(null);
    setMode("traditional");
  }

  // Phase 3 M1: leave exploration and return to the current encounter.
  // Releases the WorldState (prefetch path goes dormant again) and restores
  // the encounter viewport from the authoritative GameState.
  function exitExploration() {
    explorationRef.current = null;
    worldStateRef.current = null;
    setSessionMode("encounter");
    const baseVp = initViewport(gameState.map, VIEWPORT_TILE_W, VIEWPORT_TILE_H);
    const actor = gameState.combatants[gameState.turnOrder[gameState.turnIndex]];
    setViewport(
      actor && actor.alive
        ? updateViewportForActor(baseVp, actor.wx, actor.wy, gameState.map.width, gameState.map.height)
        : baseVp
    );
    // Re-select the acting PC. The turnKey auto-select effect will not fire
    // here (seed and actor are unchanged), so restore the selection directly —
    // otherwise the action bar stays hidden until a manual token click.
    setSelectedId(actor && actor.alive && actor.type === "pc" ? actor.id : null);
    setPendingAction(null);
    setBanner(null);
  }

  // ---------------------------------------------------------------------------
  // Phase 3 M5 — exploration ↔ encounter transitions.
  //
  // startWorldEncounter: the party met adjacent hostiles during exploration.
  // Pins the encounter chunks (beginEncounter), builds a GameState from the
  // world entities, and switches the table to combat. The exploration session
  // and WorldState stay alive behind the encounter — combat reads ONLY the
  // immutable snapshot (never the live ChunkStore), per Decision 27.
  // ---------------------------------------------------------------------------
  async function startWorldEncounter(session: ExplorationSession, hostiles: WorldEntity[]) {
    if (startingEncounterRef.current || preparedRef.current) return; // re-entrancy guard
    startingEncounterRef.current = true;
    try {
      const ws = session.worldState;
      const party = getParty(session);
      seedRef.current += 1;
      const prepared = await ws.beginEncounter([party, ...hostiles]);
      // The session may have been torn down while chunks loaded (user clicked
      // an encounter pill). Abandon silently — nothing has been committed.
      if (explorationRef.current !== session) {
        ws.endEncounter({ ...gameState, combatants: {} }, prepared.pinnedChunks);
        return;
      }
      const fresh = buildEncounterFromEntities(
        prepared, ws.worldId, seedRef.current, "wilderness", "Wilderness Battle",
      );
      const rng = mulberry32(seedRef.current + 9999);
      rngRef.current = rng;
      const next = resolveLeadingEnemyTurns(fresh, rng);
      preparedRef.current = prepared;
      setWorldEncounter(true);
      setGameState(next);
      setSessionMode("encounter");
      // Viewport stays in world coordinates — center on the first actor.
      const baseVp = initViewport(
        { width: EXPLORE_WORLD_W, height: EXPLORE_WORLD_H } as GameState["map"],
        VIEWPORT_TILE_W, VIEWPORT_TILE_H,
      );
      const firstActor = next.combatants[next.turnOrder[next.turnIndex]];
      setViewport(
        firstActor && firstActor.alive
          ? updateViewportForActor(baseVp, firstActor.wx, firstActor.wy, EXPLORE_WORLD_W, EXPLORE_WORLD_H)
          : baseVp,
      );
      setSelectedId(null);
      setPendingAction(null);
      setProposal(null);
      setInfoResult(null);
      setLastRoll(null);
      // Keep the player's chosen interaction mode (Traditional/Assisted/
      // Adventure) — it is a persistent preference, not a per-encounter reset.
      setBanner("A wilderness battle begins!");
      setTimeout(() => setBanner(null), 2600);
    } finally {
      startingEncounterRef.current = false;
    }
  }

  // Commits the active world-backed encounter's results to the WorldState via
  // endEncounter() — the ONLY combat→world write path (Decision 20). Runs
  // exactly once per encounter: preparedRef is cleared on commit.
  const commitWorldEncounter = useCallback((finalState: GameState) => {
    const prepared = preparedRef.current;
    const session = explorationRef.current;
    if (!prepared || !session) return;
    preparedRef.current = null;
    session.worldState.endEncounter(finalState, prepared.pinnedChunks);
  }, []);

  // Record the result the moment combat resolves — victory OR defeat — so the
  // world reflects the outcome even before the player clicks "Continue".
  useEffect(() => {
    if (!worldEncounter || encounterStatus === "ongoing") return;
    commitWorldEncounter(gameState);
  }, [worldEncounter, encounterStatus, gameState, commitWorldEncounter]);

  // M7: VICTORY AUTOMATICALLY RETURNS TO EXPLORATION. The banner shows just
  // long enough to read, then the table transitions back to the world — no
  // click required. The "Continue Exploring" button remains as an immediate
  // skip. Defeat stays click-through ("Awaken at Camp"): waking at camp is a
  // deliberate player acknowledgement, documented as the M7 defeat decision.
  useEffect(() => {
    if (!(worldEncounter && sessionMode === "encounter" && encounterStatus === "victory")) return;
    const t = window.setTimeout(() => returnToExplorationAfterBattle(), 1400);
    return () => window.clearTimeout(t);
    // returnToExplorationAfterBattle is stable within a render pass; the
    // effect keys are the lifecycle facts that define "victory is showing".
  }, [worldEncounter, sessionMode, encounterStatus]); // eslint-disable-line react-hooks/exhaustive-deps

  // Returns the table to the exploration surface after a world-backed
  // encounter has ended. Defeat recovery: the party respawns at the
  // exploration spawn with full HP (all other world consequences persist).
  function returnToExplorationAfterBattle() {
    const session = explorationRef.current;
    if (!session) return;
    commitWorldEncounter(gameState); // no-op if the effect already committed
    const party = getParty(session);
    if (!party.alive) respawnPartyAtSpawn(session);
    setWorldEncounter(false);
    setSessionMode("exploration");
    setExploreVersion(v => v + 1);
    const fresh = getParty(session);
    const baseVp = initViewport(
      { width: EXPLORE_WORLD_W, height: EXPLORE_WORLD_H } as GameState["map"],
      VIEWPORT_TILE_W, VIEWPORT_TILE_H,
    );
    setViewport(updateViewportForActor(baseVp, fresh.wx, fresh.wy, EXPLORE_WORLD_W, EXPLORE_WORLD_H));
    setSelectedId(null);
    setPendingAction(null);
    setProposal(null);
    setInfoResult(null);
    setLastRoll(null);
    setBanner(null);
  }

  // ---------------------------------------------------------------------------
  // LOCATION DELVE — entering a discoverable world location from exploration.
  //
  // A location is world CONTENT, not navigation: the party discovers it by
  // moving through the world and enters via a contextual prompt. Entering opens
  // the location's MapDef encounter as a focused in-world delve. The exploration
  // session is preserved (explorationRef stays set); only the streaming
  // WorldState ref is parked so the overworld does not stream behind the MapDef
  // battlefield. Resolving the delve returns the party to exploration at its
  // unchanged world position — mirroring the wilderness victory-return feel.
  // No world entity is touched, so a delve never mutates authoritative world
  // state (it reuses the existing MapDef combat pipeline verbatim).
  // ---------------------------------------------------------------------------
  function enterLocation(loc: ExploreLocation) {
    const session = explorationRef.current;
    if (!session || sessionMode !== "exploration") return;
    seedRef.current += 1;
    encounterIdRef.current = loc.encounterId;
    const fresh = buildEncounter(loc.encounterId, seedRef.current);
    const rng = mulberry32(seedRef.current + 9999);
    rngRef.current = rng;
    const next = resolveLeadingEnemyTurns(fresh, rng);
    locationDelveRef.current = loc;
    setLocationDelve(loc.name);
    // Park the overworld stream; the delve renders a MapDef battlefield.
    worldStateRef.current = null;
    setWorldEncounter(false);
    setGameState(next);
    setSessionMode("encounter");
    const baseVp = initViewport(next.map, VIEWPORT_TILE_W, VIEWPORT_TILE_H);
    const firstActor = next.combatants[next.turnOrder[next.turnIndex]];
    setViewport(
      firstActor && firstActor.alive
        ? updateViewportForActor(baseVp, firstActor.wx, firstActor.wy, next.map.width, next.map.height)
        : baseVp,
    );
    setSelectedId(null);
    setPendingAction(null);
    setProposal(null);
    setInfoResult(null);
    setLastRoll(null);
    setBanner(`You enter the ${loc.name}.`);
    setTimeout(() => setBanner(null), 2400);
  }

  // Returns the table to exploration after a location delve ends. The party's
  // world position is authoritative in the still-live session and is unchanged
  // by the delve, so the world simply resumes where it left off.
  function returnFromLocation() {
    const session = explorationRef.current;
    if (!session) return;
    locationDelveRef.current = null;
    setLocationDelve(null);
    // Re-arm the overworld stream.
    worldStateRef.current = session.worldState;
    setSessionMode("exploration");
    setWorldEncounter(false);
    setExploreVersion(v => v + 1);
    const party = getParty(session);
    const baseVp = initViewport(
      { width: EXPLORE_WORLD_W, height: EXPLORE_WORLD_H } as GameState["map"],
      VIEWPORT_TILE_W, VIEWPORT_TILE_H,
    );
    setViewport(updateViewportForActor(baseVp, party.wx, party.wy, EXPLORE_WORLD_W, EXPLORE_WORLD_H));
    setSelectedId(null);
    setPendingAction(null);
    setProposal(null);
    setInfoResult(null);
    setLastRoll(null);
    setBanner(null);
  }

  // A location-delve victory returns to exploration automatically, matching the
  // wilderness-battle feel. Defeat stays click-through ("Leave …") so the loss
  // is acknowledged. Keyed on the lifecycle facts of an active delve.
  useEffect(() => {
    if (!(locationDelve && sessionMode === "encounter" && !worldEncounter && encounterStatus === "victory")) return;
    const t = window.setTimeout(() => returnFromLocation(), 1400);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [locationDelve, sessionMode, worldEncounter, encounterStatus]);

  // FIX 3: arrow wrapper prevents SyntheticEvent from being passed as encounterId.
  function newEncounter(encounterId?: string) {
    if (encounterId) encounterIdRef.current = encounterId;
    seedRef.current += 1;
    const fresh = buildEncounter(encounterIdRef.current, seedRef.current);
    const rng   = mulberry32(seedRef.current + 9999);
    rngRef.current = rng;
    const next = resolveLeadingEnemyTurns(fresh, rng);
    setGameState(next);
    // Phase D: cap the viewport to VIEWPORT_TILE_W × VIEWPORT_TILE_H so the
    // tabletop surface remains fixed-size. For small maps (8×6) initViewport
    // clamps to 8×6 unchanged; for grandHall (40×40) it becomes 12×10.
    // Then apply dead-zone follow to position within the new world.
    const baseVp = initViewport(next.map, VIEWPORT_TILE_W, VIEWPORT_TILE_H);
    const firstActor = next.combatants[next.turnOrder[next.turnIndex]];
    setViewport(
      firstActor && firstActor.alive
        ? updateViewportForActor(baseVp, firstActor.wx, firstActor.wy, next.map.width, next.map.height)
        : baseVp
    );
    setSelectedId(null);
    setPendingAction(null);
    setProposal(null);
    setInfoResult(null);
    setLastRoll(null);
    setBanner(null);
    setMode("traditional");
    // Phase F: release any active WorldState. MapDef encounters never own one;
    // if an exploration session was active, this releases it and cancels any
    // in-flight prefetch (the useEffect cleanup runs on next render).
    worldStateRef.current = null;
    // Phase 3 M1: starting an encounter always exits exploration.
    explorationRef.current = null;
    // Phase 3 M5: abandon any world-backed encounter with its session.
    preparedRef.current = null;
    setWorldEncounter(false);
    // A practice-picker encounter is never a world location delve.
    locationDelveRef.current = null;
    setLocationDelve(null);
    setSessionMode("encounter");
  }

  // Builds a rich accessible name for a board token.
  // Communicates: name, acting/selected state, targeting validity, and HP.
  // Purely presentational — no game logic, no GameState mutation.
  function buildTokenAriaLabel(tok: GameState["combatants"][string]): string {
    if (!tok.alive) return `${tok.name}, defeated`;
    const parts: string[] = [tok.name];
    if (tok.id === currentActorId) parts.push("acting");
    else if (tok.id === selectedId) parts.push("selected");
    if (targetPreview?.targetId === tok.id) {
      parts.push(targetPreview.valid
        ? "valid target"
        : `invalid target: ${previewReasonText(targetPreview.code, targetPreview.reason)}`);
    } else if (pendingAction === "attack" && tok.type === "enemy") {
      const v = attackPreview[tok.id];
      // Phrase avoids the word "attack" so it does not collide with Playwright's
      // substring matching against the "Attack" button in existing E2E tests.
      if (v?.valid) parts.push("can be hit");
    } else if (pendingAbilityId) {
      const v = abilityPreview[tok.id];
      if (v) parts.push(v.valid ? "can be targeted" : "out of range");
    }
    parts.push(`HP ${tok.hp} of ${tok.maxHp}`);
    return parts.join(", ");
  }

  // ---------------------------------------------------------------------------
  // GRID RENDERING HELPERS
  // ---------------------------------------------------------------------------
  const reachSet    = useMemo(() => {
    // Phase 3 M1: in exploration, highlight the adjacent step targets instead
    // of combat reachable tiles (there is no action economy in exploration).
    const session = explorationRef.current;
    if (sessionMode === "exploration" && session) {
      return new Set(adjacentStepTargets(session).map((t) => key(t.wx, t.wy)));
    }
    return new Set(reachable.map((t) => key(t.wx, t.wy)));
  }, [reachable, sessionMode, exploreVersion, chunkVersion]); // eslint-disable-line react-hooks/exhaustive-deps
  const tokensByTile = useMemo(() => {
    const m: Record<string, typeof gameState.combatants[string]> = {};
    // Phase 3 M1: in exploration, tokens come from the WorldEntityRegistry
    // (authoritative world entities), adapted through the same Combatant
    // shape used by the token renderer. Display-only — no GameState involved.
    const session = explorationRef.current;
    if (sessionMode === "exploration" && session) {
      session.worldState.entities.getAlive().forEach((e) => {
        m[key(e.wx, e.wy)] = worldEntityToCombatant(e);
      });
      return m;
    }
    Object.values(gameState.combatants).forEach((c) => { if (c.alive) m[key(c.wx, c.wy)] = c; });
    return m;
  }, [gameState, sessionMode, exploreVersion]); // eslint-disable-line react-hooks/exhaustive-deps

  // World locations keyed by tile — presentation only. Populated exclusively in
  // exploration so the delve battlefield never renders overworld markers.
  const locByTile = useMemo(() => {
    const m: Record<string, ExploreLocation> = {};
    if (sessionMode !== "exploration") return m;
    for (const loc of EXPLORE_LOCATIONS) m[key(loc.wx, loc.wy)] = loc;
    return m;
  }, [sessionMode]);

  // The location the party can currently act on (Chebyshev-adjacent). Drives
  // the contextual "Enter …" prompt. null unless the party is beside a place.
  const nearbyLoc = useMemo(() => {
    const session = explorationRef.current;
    if (sessionMode !== "exploration" || !session) return null;
    return nearbyLocation(session);
  }, [sessionMode, exploreVersion]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---------------------------------------------------------------------------
  // RENDER
  // ---------------------------------------------------------------------------
  return (
    <div
      className="it-root"
      style={{
        fontFamily: "'EB Garamond', serif",
        minHeight: "100vh",
        background: "radial-gradient(1200px 600px at 20% -10%, #2c2013 0%, #1a130c 55%, #100c07 100%)",
        color: "#e8dcc0",
        padding: 18,
      }}
    >
      <style>{FONT_IMPORT}</style>
      <style>{RESPONSIVE_CSS}</style>

      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14, flexWrap: "wrap", gap: 10 }}>
        <div>
          <div role="heading" aria-level={1} style={{ fontFamily: "Cinzel, serif", fontSize: 22, letterSpacing: 1, color: "#e8dcc0" }}>
            {sessionMode === "exploration" ? "Wilderness Exploration" : gameState.encounterName}
          </div>
          <div aria-live="polite" aria-atomic="true" style={{ fontSize: 12.5, color: "#a89468" }}>
            {sessionMode === "exploration" && explorationRef.current ? (
              <span data-testid="exploration-location">
                Exploring · Party at ({getParty(explorationRef.current).wx}, {getParty(explorationRef.current).wy})
              </span>
            ) : (
              <>Round {gameState.round} · {currentActor ? `${currentActor.name}'s turn` : ""}</>
            )}
          </div>
        </div>
        {/* INTERACTION MODE — a low-weight gameplay preference, never a
            destination. Traditional / Assisted / Adventure stay available and
            discoverable during exploration and combat, but they never compete
            with the world for attention. */}
        <div
          data-testid="interaction-mode"
          role="group"
          aria-label="How you want to play"
          style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}
        >
          <span aria-hidden="true" style={{ fontFamily: "'EB Garamond', serif", fontStyle: "italic", fontSize: 11, letterSpacing: 0.3, color: "#7d6b47" }}>
            How you play
          </span>
          <div style={{ display: "flex", gap: 2, background: "rgba(28,20,12,0.6)", border: "1px solid #3f3120", borderRadius: 8, padding: 3 }}>
            {[
              { id: "traditional" as const, label: "Traditional" },
              { id: "assisted"    as const, label: "Assisted"    },
              { id: "adventure"   as const, label: "Adventure"   },
            ].map((m) => (
              <button
                key={m.id}
                aria-pressed={mode === m.id}
                onClick={() => { setMode(m.id); setPendingAction(null); setProposal(null); setInfoResult(null); }}
                style={{
                  fontFamily: "'EB Garamond', serif",
                  fontSize: 11,
                  letterSpacing: 0.3,
                  padding: "5px 11px",
                  borderRadius: 6,
                  border: "none",
                  cursor: "pointer",
                  background: mode === m.id ? "#3a2c19" : "transparent",
                  color: mode === m.id ? "#e0cb93" : "#8a795a",
                  boxShadow: mode === m.id ? "inset 0 0 0 1px #6b5a34" : "none",
                  transition: "background-color .15s ease, color .15s ease",
                }}
              >
                {m.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* DEVELOPER / TEST ENCOUNTER SWITCHER.
          Locations and encounters are world content, not player navigation, so
          this direct-selection row is NOT part of the normal adventure. It is
          gated behind the practice/dev pathway (?practice, or ?e2e for the
          combat E2E suites) and never rendered for normal players. Test-only
          encounters additionally require ?e2e. */}
      {isPracticeEntry && (
      <div className="it-encounter-switcher" data-testid="dev-encounter-switcher">
        <span aria-hidden="true" style={{ fontFamily: "'EB Garamond', serif", fontStyle: "italic", fontSize: 10.5, letterSpacing: 0.4, color: "#6b5a3a", alignSelf: "center", marginRight: 2 }}>
          Practice ·
        </span>
        {/* Phase 3 M1: exploration session toggle.
            Hidden during a world-backed encounter (M5): the battle must resolve
            through the victory/defeat banner so results commit via endEncounter. */}
        {!worldEncounter && (
        <button
          aria-pressed={sessionMode === "exploration"}
          onClick={() => (sessionMode === "exploration" ? exitExploration() : startExploration())}
          style={{
            fontFamily: "'EB Garamond', serif",
            fontSize: 11.5,
            padding: "5px 12px",
            borderRadius: 6,
            border: "1px solid #4c6b3f",
            cursor: "pointer",
            background: sessionMode === "exploration" ? "#2c3d20" : "transparent",
            color: sessionMode === "exploration" ? "#cfe0b8" : "#8fa06e",
          }}
        >
          {sessionMode === "exploration" ? "Return to Encounter" : "Explore World"}
        </button>
        )}
        {!worldEncounter && Object.values(isE2E ? ENCOUNTER_DEFS : getProductionEncounters()).map((enc) => (
          <button
            key={enc.id}
            aria-pressed={gameState.encounterId === enc.id}
            onClick={() => newEncounter(enc.id)}
            style={{
              fontFamily: "'EB Garamond', serif",
              fontSize: 11.5,
              padding: "5px 12px",
              borderRadius: 6,
              border: "1px solid #5a4326",
              cursor: "pointer",
              background: gameState.encounterId === enc.id ? "#4a3620" : "transparent",
              color: gameState.encounterId === enc.id ? "#e8dcc0" : "#8a795a",
            }}
          >
            {enc.name}
          </button>
        ))}
      </div>
      )}

      {/* Transient banner — role="alert" causes screen readers to announce immediately */}
      {banner && (
        <div role="alert" style={{ marginBottom: 10, padding: "8px 12px", background: "#3b2418", border: "1px solid #8b2e2e", borderRadius: 8, fontSize: 13, color: "#e8b8a8" }}>
          {banner}
        </div>
      )}

      {/* Victory / Defeat banner — role="alert" announces outcome to screen readers */}
      {sessionMode === "encounter" && encounterStatus !== "ongoing" && (
        <div role="alert" className="it-anim-banner-in" style={{ marginBottom: 10, padding: "12px 16px", background: encounterStatus === "victory" ? "#243b1e" : "#3b1e1e", border: `1px solid ${encounterStatus === "victory" ? "#4c6b3f" : "#8b2e2e"}`, borderRadius: 8, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span style={{ fontFamily: "Cinzel, serif", fontSize: 15 }}>{encounterBanner}</span>
          {worldEncounter ? (
            /* M5: world-backed battle — results are already committed via
               endEncounter(); the way forward is back into the world. */
            <button onClick={() => returnToExplorationAfterBattle()} style={{ fontFamily: "Cinzel, serif", fontSize: 12, background: "#c9a227", color: "#241a12", border: "none", borderRadius: 6, padding: "6px 12px", cursor: "pointer" }}>
              {encounterStatus === "victory" ? "Continue Exploring" : "Awaken at Camp"}
            </button>
          ) : locationDelve ? (
            /* Location delve — a place discovered in the world. Victory returns
               to exploration automatically; the button is the immediate skip /
               the acknowledgement on defeat. */
            <button data-testid="leave-location" onClick={() => returnFromLocation()} style={{ fontFamily: "Cinzel, serif", fontSize: 12, background: "#c9a227", color: "#241a12", border: "none", borderRadius: 6, padding: "6px 12px", cursor: "pointer" }}>
              {encounterStatus === "victory" ? "Return to Wilderness" : `Leave ${locationDelve}`}
            </button>
          ) : (
          /* FIX 3: arrow wrapper — prevents SyntheticEvent from becoming encounterId */
          <button onClick={() => newEncounter()} style={{ fontFamily: "Cinzel, serif", fontSize: 12, background: "#c9a227", color: "#241a12", border: "none", borderRadius: 6, padding: "6px 12px", cursor: "pointer" }}>
            New Encounter
          </button>
          )}
        </div>
      )}

      <div className="it-main-grid">
        {/* LEFT: character panels */}
        <div className="it-left-panel">
          {sessionMode === "exploration" ? (
            /* Phase 3 M1: exploration panel — combat controls are hidden;
               world position is authoritative in the WorldEntityRegistry. */
            <div data-testid="exploration-panel">
              <div role="heading" aria-level={2} style={{ fontFamily: "Cinzel, serif", fontSize: 12, color: "#a89468", marginBottom: 8, letterSpacing: 1 }}>THE WORLD</div>

              {/* Contextual location prompt — the discovery interaction. Appears
                  only when the party is beside a place, turning locations into
                  world content rather than a permanent navigation tab. */}
              {nearbyLoc && (
                <button
                  data-testid="enter-location"
                  onClick={() => enterLocation(nearbyLoc)}
                  className="it-anim-card-in"
                  style={{
                    width: "100%",
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    marginBottom: 10,
                    padding: "11px 13px",
                    borderRadius: 9,
                    border: "1px solid #c9a227",
                    background: "linear-gradient(180deg, #3a2c18, #2a1f12)",
                    color: "#e8dcc0",
                    cursor: "pointer",
                    textAlign: "left",
                  }}
                >
                  <span style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 30, height: 30, borderRadius: "50%", background: "rgba(201,162,39,0.16)", border: "1px solid #6b5a34", flexShrink: 0 }}>
                    {nearbyLoc.icon === "crypt" ? <Skull size={16} color="#c9a227" /> : <Swords size={16} color="#c9a227" />}
                  </span>
                  <span style={{ display: "flex", flexDirection: "column", lineHeight: 1.25 }}>
                    <span style={{ fontFamily: "'EB Garamond', serif", fontStyle: "italic", fontSize: 10.5, color: "#a68a50", letterSpacing: 0.3 }}>You stand before the {nearbyLoc.name}</span>
                    <span style={{ display: "flex", alignItems: "center", gap: 5, fontFamily: "Cinzel, serif", fontSize: 13.5, color: "#f0e4c6" }}>
                      <DoorOpen size={14} color="#c9a227" /> {nearbyLoc.prompt}
                    </span>
                  </span>
                </button>
              )}

              <div style={{ background: "#241a12", border: "1px solid #5a4326", borderRadius: 8, padding: 12, fontSize: 13, lineHeight: 1.6 }}>
                <div style={{ color: "#c9bd9e" }}>
                  The party travels the open world. Tap a highlighted tile beside the party to take a step; the table follows as you move.
                </div>
                <div style={{ marginTop: 8, color: "#8a795a", fontSize: 12 }}>
                  Unmapped land stays dark until it is charted. Approach a place to discover it, or wander into a hostile creature to begin a battle.
                </div>
              </div>
            </div>
          ) : (
          <>
          {/* PARTY */}
          <div role="heading" aria-level={2} style={{ fontFamily: "Cinzel, serif", fontSize: 12, color: "#a89468", marginBottom: 8, letterSpacing: 1 }}>PARTY</div>
          {Object.values(gameState.combatants)
            .filter((c) => c.type === "pc")
            .map((c) => (
              <CharacterPanel key={c.id} c={c} isCurrent={c.id === currentActorId} isSelected={c.id === selectedId} onSelect={handleSelectToken} />
            ))}

          {/* Action bar — Two-tier layout per UX blueprint §5.
              Tier 1: Move + Attack + End Turn, always visible on the PC's turn.
              Tier 2: data-driven abilities in a separate wrapping row.
              Disabled buttons stay visible with a tooltip so the player always
              knows where Attack went. Both tiers only render for the current actor. */}
          {mode === "traditional" && isPlayerTurn && selected && selected.id === currentActorId && (
            <div style={{ marginTop: 10 }}>
              {/* Tier 1 — universal actions: Move · Attack · End Turn */}
              <div style={{ display: "flex", gap: 6 }}>
                <button
                  onClick={() => setPendingAction(pendingAction === "move" ? null : "move")}
                  aria-pressed={pendingAction === "move"}
                  style={actionBtnStyle(pendingAction === "move")}
                >
                  <Footprints size={13} /> Move
                </button>
                <button
                  onClick={() => setPendingAction(pendingAction === "attack" ? null : "attack")}
                  disabled={selected.actionUsed}
                  aria-pressed={pendingAction === "attack"}
                  aria-label={selected.actionUsed ? "Attack, action already used this turn" : "Attack"}
                  title={selected.actionUsed ? "Action already used this turn" : "Select an enemy to attack"}
                  style={{ ...actionBtnStyle(pendingAction === "attack"), opacity: selected.actionUsed ? 0.38 : 1 }}
                >
                  <Sword size={13} /> Attack
                </button>
                <button
                  onClick={handleEndTurn}
                  style={{
                    flex: 1,
                    fontFamily: "Cinzel, serif",
                    fontSize: 11,
                    padding: "8px 0",
                    borderRadius: 7,
                    border: "1px solid #c9a227",
                    background: "transparent",
                    color: "#c9a227",
                    cursor: "pointer",
                  }}
                >
                  End Turn
                </button>
              </div>
              {/* Tier 2 — data-driven abilities (wrapping, up to ~2 rows) */}
              {(selected.abilities || []).length > 0 && (
                <div style={{ marginTop: 6, display: "flex", flexWrap: "wrap", gap: 6 }}>
                  {(selected.abilities || []).map((abilityId) => {
                    const ab = ABILITY_DEFS[abilityId];
                    const effectLine = ab?.effect
                      ? `, d${ab.effect.die}+${ab.effect.mod} ${ab.effect.type}`
                      : "";
                    const tipText = ab
                      ? `${ab.name} — Range ${ab.range}${ab.requiresLineOfSight ? ", requires LOS" : ""}${effectLine}`
                      : abilityId;
                    return (
                      <button
                        key={abilityId}
                        onClick={() => setPendingAction(pendingAction === "ability:" + abilityId ? null : "ability:" + abilityId)}
                        disabled={selected.actionUsed}
                        aria-pressed={pendingAction === "ability:" + abilityId}
                        aria-label={selected.actionUsed ? `${ab?.name || abilityId}, action already used this turn` : (ab?.name || abilityId)}
                        title={selected.actionUsed ? "Action already used this turn" : tipText}
                        style={{ ...actionBtnStyle(pendingAction === "ability:" + abilityId), opacity: selected.actionUsed ? 0.38 : 1 }}
                      >
                        <Sparkles size={13} /> {ab?.name || abilityId}
                      </button>
                    );
                  })}
                </div>
              )}
              {/* Targeting status strip — color-coded and paired with text (blueprint §15) */}
              {pendingAction && (
                <div style={{
                  marginTop: 7,
                  fontSize: 11,
                  fontFamily: "'EB Garamond', serif",
                  fontStyle: "italic",
                  letterSpacing: 0.2,
                  color: pendingAction === "move"
                    ? "#7aaa5a"
                    : (pendingAction === "attack" || abilityIsHarmful)
                    ? "#c87070"
                    : "#5a8fc7",
                }}>
                  {pendingAction === "move" && "↳ Click a highlighted tile to move"}
                  {pendingAction === "attack" && "↳ Click an enemy token to attack"}
                  {pendingAbilityId && abilityIsHarmful  && `↳ Click an enemy for ${pendingAbility?.name}`}
                  {pendingAbilityId && !abilityIsHarmful && `↳ Click a target for ${pendingAbility?.name}`}
                  {/* Hover preview detail — visible only while pointer rests on a token */}
                  {targetPreview && pendingAction !== "move" && (() => {
                    const tName = gameState.combatants[targetPreview.targetId]?.name ?? "Target";
                    if (targetPreview.valid) {
                      const parts: string[] = [tName];
                      if (targetPreview.distance !== undefined)
                        parts.push(`${targetPreview.distance} ${targetPreview.distance === 1 ? "tile" : "tiles"}`);
                      if (targetPreview.cover) parts.push("cover");
                      return (
                        <div
                          data-testid="target-preview"
                          aria-live="polite"
                          style={{ marginTop: 3, color: (pendingAction === "attack" || abilityIsHarmful) ? "#e07070" : "#7aacdf" }}
                        >
                          ⊕ {parts.join(" · ")}
                        </div>
                      );
                    }
                    return (
                      <div
                        data-testid="target-preview"
                        aria-live="polite"
                        style={{ marginTop: 3, color: "#c8925a" }}
                      >
                        ⊘ {tName}: {previewReasonText(targetPreview.code, targetPreview.reason)}
                      </div>
                    );
                  })()}
                </div>
              )}
              {/* Persistent sr-only live region — announces targeting-mode changes to
                  screen readers without any visible UI change.  Always rendered while
                  the action bar is active so the live region persists across updates. */}
              <div role="status" className="sr-only">
                {pendingAction === "move"
                  ? "Move mode: click a highlighted tile to move"
                  : pendingAction === "attack"
                  ? "Attack mode: click an enemy token to attack"
                  : pendingAbilityId && abilityIsHarmful
                  ? `${pendingAbility?.name}: click an enemy to cast`
                  : pendingAbilityId
                  ? `${pendingAbility?.name}: click a target`
                  : ""}
              </div>
            </div>
          )}
          {/* End Turn shown alone when another character's panel is selected */}
          {mode === "traditional" && isPlayerTurn && !(selected && selected.id === currentActorId) && (
            <button
              onClick={handleEndTurn}
              style={{ marginTop: 10, width: "100%", fontFamily: "Cinzel, serif", fontSize: 12, background: "transparent", color: "#c9a227", border: "1px solid #5a4326", borderRadius: 7, padding: "8px 0", cursor: "pointer" }}
            >
              End Turn
            </button>
          )}

          {/* ENEMIES */}
          <div role="heading" aria-level={2} style={{ fontFamily: "Cinzel, serif", fontSize: 12, color: "#a89468", margin: "14px 0 8px", letterSpacing: 1 }}>ENEMIES</div>
          {Object.values(gameState.combatants)
            .filter((c) => c.type === "enemy")
            .map((c) => (
              <CharacterPanel key={c.id} c={c} isCurrent={c.id === currentActorId} isSelected={c.id === selectedId} onSelect={handleSelectToken} />
            ))}
          </>
          )}
        </div>

        {/* CENTER: tabletop grid */}
        <div className="it-board-col" style={{ display: "flex", flexDirection: "column", alignItems: "center", overflowX: "auto" }}>
          <div
            style={{
              background: "linear-gradient(160deg, #4a3320, #2c1e12)",
              border: "10px solid #2c1e12",
              borderRadius: 12,
              padding: 16,
              boxShadow: "0 12px 34px rgba(0,0,0,0.55), inset 0 0 40px rgba(0,0,0,0.4)",
              position: "relative",
            }}
          >
            {/* Corner decorations */}
            <div style={{ position: "absolute", top: 8, left: 8, width: 18, height: 18, border: "2px solid #c9a227", borderRight: "none", borderBottom: "none", opacity: 0.7 }} />
            <div style={{ position: "absolute", top: 8, right: 8, width: 18, height: 18, border: "2px solid #c9a227", borderLeft: "none", borderBottom: "none", opacity: 0.7 }} />
            <div style={{ position: "absolute", bottom: 8, left: 8, width: 18, height: 18, border: "2px solid #c9a227", borderRight: "none", borderTop: "none", opacity: 0.7 }} />
            <div style={{ position: "absolute", bottom: 8, right: 8, width: 18, height: 18, border: "2px solid #c9a227", borderLeft: "none", borderTop: "none", opacity: 0.7 }} />

            {/* Phase B: grid dimensions driven by viewport (not map) so a future
                non-zero viewport origin simply changes tileW/tileH without
                touching any other rendering code. */}
            <div
              style={{
                display: "grid",
                gridTemplateColumns: `repeat(${viewport.tileW}, ${cellPx}px)`,
                gridTemplateRows:    `repeat(${viewport.tileH}, ${cellPx}px)`,
                gap: 2,
              }}
            >
              {/* Phase B: iterate visibleTiles[vy][vx] instead of raw map indices.
                  Each VisibleTile carries its authoritative world coordinate (wx, wy).
                  token/reach lookups use tile.wx/tile.wy so they are correct even when
                  viewport.originWx/originWy are non-zero (Phase C+). */}
              {visibleTiles.map((row) =>
                row.map((tile) => {
                  const wall    = tile.tileInfo.type === "wall" || tile.tileInfo.type === "void";
                  const pillar  = tile.tileInfo.type === "pillar";
                  // Use world coords for all lookups — never viewport-relative vx/vy.
                  const tok     = tokensByTile[key(tile.wx, tile.wy)];
                  const loc     = locByTile[key(tile.wx, tile.wy)];
                  const isNearbyLoc = !!(loc && nearbyLoc && nearbyLoc.id === loc.id);
                  const isReach = reachSet.has(key(tile.wx, tile.wy));
                  // Phase F: loading placeholder — purely presentational.
                  // True when the tile's chunk is LOADING in the live ChunkStore.
                  // NEVER affects GameState.tileQuery or rules engine geometry.
                  // Always false for MapDef encounters (worldStateRef.current === null).
                  const chunkIsLoading = loadingChunkSet.has(
                    `${Math.floor(tile.wx / CHUNK_W)},${Math.floor(tile.wy / CHUNK_H)}`
                  );
                  let bg = "#c9bd9e";
                  if (chunkIsLoading) bg = "#14100a"; // loading: very dark neutral, no game content
                  else if (wall) bg = "#1c140c";
                  else bg = ((tile.wx + tile.wy) % 2 === 0) ? "#d8cba6" : "#ccbe97";
                  return (
                    <div
                      key={key(tile.wx, tile.wy)}
                      data-testid="board-tile"
                      data-world-wx={tile.wx}
                      data-world-wy={tile.wy}
                      onClick={() => handleTileClick(tile)}
                      style={{
                        width: cellPx, height: cellPx,
                        background: bg,
                        border: wall ? "1px solid #0d0906" : "1px solid rgba(90,67,38,0.35)",
                        borderRadius: 3,
                        position: "relative",
                        cursor: isReach ? "pointer" : "default",
                        boxShadow: isReach ? "inset 0 0 0 2px #6b8f4e" : "none",
                        backgroundImage: !wall && !pillar ? "repeating-linear-gradient(90deg, rgba(0,0,0,0.03) 0 2px, transparent 2px 8px)" : "none",
                      }}
                    >
                      {pillar && (
                        <div style={{ position: "absolute", inset: 5, borderRadius: "50%", background: "radial-gradient(circle at 35% 30%, #7a6a52, #382c1c)", boxShadow: "0 3px 6px rgba(0,0,0,0.5)" }} />
                      )}
                      {/* WORLD LOCATION MARKER — a place drawn on the table, not a
                          navigation control. Decorative (role="img"); the
                          accessible, keyboard-operable action is the "Enter …"
                          button in the exploration panel. Mouse users may also
                          click the marker directly when the party is adjacent. */}
                      {loc && !tok && (
                        <div
                          data-testid="location-marker"
                          data-location-id={loc.id}
                          role="img"
                          aria-label={`${loc.name}, a location in the world${isNearbyLoc ? " — the party is beside it" : ""}`}
                          title={loc.name}
                          onClick={isNearbyLoc ? (e) => { e.stopPropagation(); enterLocation(loc); } : undefined}
                          className={isNearbyLoc ? "it-loc-pulse" : ""}
                          style={{
                            position: "absolute",
                            inset: 6,
                            borderRadius: 6,
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            background: "radial-gradient(circle at 35% 28%, #4a3a22, #241a10)",
                            border: `2px solid ${isNearbyLoc ? "#e8c24a" : "#7a6236"}`,
                            boxShadow: isNearbyLoc
                              ? "0 0 0 3px rgba(232,194,74,0.35), 0 2px 6px rgba(0,0,0,0.5)"
                              : "0 2px 5px rgba(0,0,0,0.5)",
                            cursor: isNearbyLoc ? "pointer" : "default",
                          }}
                        >
                          {loc.icon === "crypt"
                            ? <Skull size={Math.round(cellPx * 0.42)} color={isNearbyLoc ? "#f0d873" : "#b79a58"} />
                            : <Swords size={Math.round(cellPx * 0.42)} color={isNearbyLoc ? "#f0d873" : "#b79a58"} />}
                        </div>
                      )}
                      {tok && (
                        <div
                          onPointerEnter={() => handleTokenPointerEnter(tok.id)}
                          onPointerLeave={handleTokenPointerLeave}
                          onClick={(e) => {
                            e.stopPropagation();
                            if (mode === "traditional" && pendingAction === "attack" && tok.type === "enemy") {
                              handleAttackTarget(tok.id);
                            } else if (mode === "traditional" && pendingAbilityId) {
                              // Route ALL token clicks to ability handler during ability-targeting mode.
                              // This means clicking an ally during Healing Touch targets the ally,
                              // and clicking an enemy during Fire Bolt targets the enemy.
                              handleAbilityTarget(pendingAbilityId, tok.id);
                            } else {
                              handleSelectToken(tok.id);
                            }
                          }}
                          onKeyDown={(e) => {
                            if (e.key !== "Enter" && e.key !== " ") return;
                            e.preventDefault();
                            if (mode === "traditional" && pendingAction === "attack" && tok.type === "enemy") {
                              handleAttackTarget(tok.id);
                            } else if (mode === "traditional" && pendingAbilityId) {
                              handleAbilityTarget(pendingAbilityId, tok.id);
                            } else {
                              handleSelectToken(tok.id);
                            }
                          }}
                          role="button"
                          tabIndex={tok.alive ? 0 : -1}
                          title={tok.name}
                          aria-label={buildTokenAriaLabel(tok)}
                          className={animClasses[tok.id] || ""}
                          style={{
                            position: "absolute",
                            inset: 4,
                            borderRadius: "50%",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            background: tok.type === "pc"
                              ? "radial-gradient(circle at 35% 30%, #3d5a86, #1c2c40)"
                              : "radial-gradient(circle at 35% 30%, #5a7a3d, #263c1c)",
                            border: tok.id === selectedId ? "2px solid #c9a227" : "2px solid rgba(0,0,0,0.4)",
                            boxShadow:
                              // Hover preview states — hovered token overrides the baseline ring.
                              targetPreview?.targetId === tok.id && !targetPreview.valid
                                ? "0 0 0 3px rgba(200,130,40,0.95)"                                    // amber — invalid hover
                              : targetPreview?.targetId === tok.id && (pendingAction === "attack" || abilityIsHarmful)
                                ? "0 0 0 4px rgba(220,55,55,1), 0 0 8px rgba(220,55,55,0.4)"           // bright red — hovered valid attack/harmful
                              : targetPreview?.targetId === tok.id
                                ? "0 0 0 4px rgba(70,145,220,1), 0 0 8px rgba(70,145,220,0.4)"         // bright blue — hovered valid beneficial
                              // Baseline valid-target rings (not currently hovered).
                              : mode === "traditional" && pendingAction === "attack" && tok.type === "enemy" && attackPreview[tok.id]?.valid
                                ? "0 0 0 3px rgba(180,50,50,0.8)"                                      // red — valid attack target
                              : mode === "traditional" && pendingAbilityId && abilityPreview[tok.id]?.valid
                                ? (abilityIsHarmful
                                    ? "0 0 0 3px rgba(180,50,50,0.8)"                                  // red — valid harmful ability
                                    : "0 0 0 3px rgba(59,130,200,0.9)")                                // blue — valid beneficial ability
                              : tok.id === currentActorId
                                ? "0 0 0 2px rgba(255,240,170,0.3), 0 2px 5px rgba(0,0,0,0.5)"        // warm ring = active turn
                              : "0 2px 5px rgba(0,0,0,0.5)",
                            cursor: "pointer",
                          }}
                        >
                          {/* Validity badge — small ✓/✗ marker while pointer rests on token */}
                          {targetPreview?.targetId === tok.id && (
                            <div
                              aria-hidden="true"
                              style={{
                                position: "absolute",
                                top: 0, right: 0,
                                transform: "translate(35%, -35%)",
                                width: 11, height: 11,
                                borderRadius: "50%",
                                background: targetPreview.valid ? "#4caf50" : "#d9600a",
                                display: "flex", alignItems: "center", justifyContent: "center",
                                fontSize: 7, color: "white", fontWeight: "bold",
                                boxShadow: "0 1px 4px rgba(0,0,0,0.6)",
                                pointerEvents: "none",
                                zIndex: 1,
                              }}
                            >
                              {targetPreview.valid ? "✓" : "✗"}
                            </div>
                          )}
                          {/* Resolve visual asset if registered; fall back to icon placeholder. */}
                          {(() => {
                            const asset = resolveAsset(`character.${tok.defId}`);
                            return asset
                              ? <img src={asset.src} alt={tok.name} style={{ width: 18, height: 18, objectFit: "cover", borderRadius: "50%", pointerEvents: "none" }} />
                              : <ClassIcon icon={tok.icon} size={18} className="" />;
                          })()}
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          </div>

          {/* Last roll readout — attack */}
          {lastRoll && lastRoll.kind === "attack" && (
            <div style={{ marginTop: 14, background: "#2e2216", border: "1px solid #c9a227", borderRadius: 10, padding: "10px 16px", display: "flex", alignItems: "center", gap: 10 }}>
              <Dice5 size={20} color="#c9a227" />
              <div style={{ fontSize: 13 }}>
                <b style={{ fontFamily: "Cinzel, serif", fontWeight: 500 }}>{lastRoll.actor}</b> vs {lastRoll.targetName}: d20 {lastRoll.d20} + mod ={" "}
                <b>{lastRoll.atkTotal}</b> vs AC {lastRoll.effectiveAc} — {lastRoll.hit ? (lastRoll.crit ? "CRITICAL HIT" : "HIT") : "MISS"}
                {lastRoll.hit ? `, ${lastRoll.dmgTotal} dmg` : ""}
              </div>
            </div>
          )}
          {/* Last roll readout — healing ability */}
          {lastRoll && lastRoll.kind === "ability" && lastRoll.type === "heal" && (
            <div style={{ marginTop: 14, background: "#1e2e1a", border: "1px solid #4c6b3f", borderRadius: 10, padding: "10px 16px", display: "flex", alignItems: "center", gap: 10 }}>
              <Sparkles size={20} color="#8fb56f" />
              <div style={{ fontSize: 13 }}>
                <b style={{ fontFamily: "Cinzel, serif", fontWeight: 500 }}>{lastRoll.actor}</b> uses {lastRoll.abilityName} on {lastRoll.targetName}: roll {lastRoll.roll}
                {" "}→ <b>+{lastRoll.healed}</b> HP{lastRoll.healed < lastRoll.amount ? " (capped at max)" : ""}
              </div>
            </div>
          )}
          {/* Last roll readout — damage ability */}
          {lastRoll && lastRoll.kind === "ability" && lastRoll.type === "damage" && (
            <div style={{ marginTop: 14, background: "#2e1a1a", border: "1px solid #8b2e2e", borderRadius: 10, padding: "10px 16px", display: "flex", alignItems: "center", gap: 10 }}>
              <Sparkles size={20} color="#d97a5a" />
              <div style={{ fontSize: 13 }}>
                <b style={{ fontFamily: "Cinzel, serif", fontWeight: 500 }}>{lastRoll.actor}</b> casts {lastRoll.abilityName} at {lastRoll.targetName}: roll {lastRoll.roll}
                {" "}→ <b>{lastRoll.amount}</b> dmg{lastRoll.dead ? ` — ${lastRoll.targetName} has fallen` : ` (HP ${lastRoll.targetHp})`}
              </div>
            </div>
          )}
        </div>

        {/* RIGHT: initiative tracker + session log (encounter only) */}
        <div className="it-right-panel">
          {sessionMode === "exploration" ? (
            <div style={{ fontSize: 12.5, color: "#8a795a", fontStyle: "italic" }}>
              No initiative while exploring — combat begins when an encounter starts.
            </div>
          ) : (
          <>
          <div role="heading" aria-level={2} style={{ fontFamily: "Cinzel, serif", fontSize: 12, color: "#a89468", marginBottom: 8, letterSpacing: 1 }}>INITIATIVE</div>
          <div aria-label="Initiative order" style={{ background: "#241a12", border: "1px solid #5a4326", borderRadius: 8, padding: 8, marginBottom: 14 }}>
            {gameState.turnOrder.map((id, i) => {
              const c = gameState.combatants[id];
              return (
                <div
                  key={id}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                    padding: "4px 6px",
                    borderRadius: 5,
                    background: i === gameState.turnIndex ? "#4a3620" : "transparent",
                    opacity: c.alive ? 1 : 0.4,
                    textDecoration: c.alive ? "none" : "line-through",
                  }}
                >
                  {i === gameState.turnIndex && <ChevronRight size={12} color="#c9a227" />}
                  <ClassIcon icon={c.icon} size={12} className="" />
                  <span style={{ fontSize: 12 }}>{c.name}</span>
                </div>
              );
            })}
          </div>

          <div role="heading" aria-level={2} style={{ fontFamily: "Cinzel, serif", fontSize: 12, color: "#a89468", marginBottom: 8, letterSpacing: 1, display: "flex", alignItems: "center", gap: 5 }}>
            <ScrollText size={13} /> SESSION LOG
          </div>
          <div className="it-session-log" role="log" aria-label="Session log" aria-live="polite" aria-atomic="false" style={{ background: "#241a12", border: "1px solid #5a4326", borderRadius: 8, padding: 10, height: 320, overflowY: "auto", fontSize: 12, lineHeight: 1.5 }}>
            {gameState.log.map((line, i) => (
              <div key={i} style={{ color: line.startsWith("—") ? "#c9a227" : "#c9bd9e", fontStyle: line.startsWith("—") ? "italic" : "normal", marginBottom: 3 }}>
                {line}
              </div>
            ))}
          </div>
          </>
          )}
        </div>
      </div>

      {/* ------------------------------------------------------------------ */}
      {/* Assisted / Adventure input bar                                       */}
      {/* ------------------------------------------------------------------ */}
      {mode !== "traditional" && (
        <div style={{ marginTop: 16, maxWidth: 720, marginLeft: "auto", marginRight: "auto" }}>
          <div style={{ display: "flex", gap: 8 }}>
            <Sparkles size={16} color="#c9a227" style={{ marginTop: 10 }} />
            <input
              aria-label="Describe your action in plain language"
              value={textInput}
              onChange={(e) => setTextInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") runIntent(); }}
              placeholder={
                !isPlayerTurn
                  ? "Waiting for enemy turn..."
                  : mode === "assisted"
                  ? `${currentActor.name}: "move next to ${exampleTargetPhrase(gameState)} and attack"`
                  : `${currentActor.name}: "I duck behind the pillar and attack ${exampleTargetPhrase(gameState)}"`
              }
              disabled={!isPlayerTurn}
              style={{
                flex: 1,
                background: "#2e2216",
                border: "1px solid #5a4326",
                borderRadius: 8,
                padding: "10px 12px",
                color: "#e8dcc0",
                fontFamily: "'EB Garamond', serif",
                fontSize: 14,
              }}
            />
            <button
              onClick={runIntent}
              disabled={!isPlayerTurn}
              style={{ fontFamily: "Cinzel, serif", fontSize: 12, background: "#c9a227", color: "#241a12", border: "none", borderRadius: 8, padding: "0 16px", cursor: "pointer" }}
            >
              Interpret
            </button>
          </div>
          <div style={{ fontSize: 10.5, color: "#8a795a", marginTop: 5, paddingLeft: 24 }}>
            Try: "attack {exampleTargetPhrase(gameState)}" · "move next to {exampleTargetPhrase(gameState)} and attack" · "can I attack {exampleTargetPhrase(gameState)}?" · "end my turn"
          </div>

          {/* Proposal card */}
          {proposal && (
            <div
              role="region"
              aria-label="Proposed action"
              className="it-anim-card-in"
              style={{
                marginTop: 12,
                background: "linear-gradient(180deg, #ece0bd, #ddcf9f)",
                color: "#2b2016",
                borderRadius: 10,
                padding: 16,
                boxShadow: "0 10px 30px rgba(0,0,0,0.5)",
                border: proposal.stale ? "1px solid #8b2e2e" : "1px solid #a8925a",
              }}
            >
              {/* Proposal card header — amber/action treatment, distinct from query cards */}
              <div style={{
                display: "flex",
                alignItems: "center",
                gap: 7,
                paddingBottom: 10,
                marginBottom: 10,
                borderBottom: "1px solid rgba(180,130,40,0.4)",
              }}>
                <Sword size={13} color="#7a5a28" />
                <span style={{ fontFamily: "Cinzel, serif", fontSize: 11.5, letterSpacing: 1.2, color: "#6b4f24" }}>
                  PROPOSED ACTION
                </span>
              </div>
              <div style={{ fontSize: 12.5, fontStyle: "italic", color: "#5a4a2e", marginBottom: 10 }}>"{proposal.text}"</div>

              {proposal.stale && (
                <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 10, fontSize: 12.5, color: "#8b2e2e" }}>
                  <X size={13} /> The situation has changed since this was proposed.
                </div>
              )}

              {proposal.checks.map((c, i) => (
                <div key={i} style={{ display: "flex", alignItems: "flex-start", gap: 8, marginBottom: 6, fontSize: 13.5 }}>
                  <span style={{ fontFamily: "Cinzel, serif", fontSize: 11, color: "#6b4f24", minWidth: 14 }}>{i + 1}.</span>
                  {c.valid ? <Check size={14} color="#4c6b3f" style={{ marginTop: 1 }} /> : <X size={14} color="#8b2e2e" style={{ marginTop: 1 }} />}
                  <span>
                    {c.step.kind === "move"
                      ? c.step.description || `Move to (${c.step.dest.wx}, ${c.step.dest.wy})`
                      : c.step.kind === "attack"
                      ? `${c.step.description || `Attack ${gameState.combatants[c.step.targetId].name}`}${c.cover ? " (target has cover)" : ""}`
                      : c.step.kind === "ability"
                      ? c.step.description
                      : "End Turn"}
                    {!c.valid && <span style={{ color: "#8b2e2e", fontSize: 12 }}> — {c.reason}</span>}
                  </span>
                </div>
              ))}

              <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
                {proposal.stale ? (
                  <button
                    onClick={recalculateProposal}
                    style={{ fontFamily: "Cinzel, serif", fontSize: 12, background: "#c9a227", color: "#241a12", border: "none", borderRadius: 6, padding: "8px 16px", cursor: "pointer" }}
                  >
                    Recalculate
                  </button>
                ) : (
                  <button
                    onClick={approveProposal}
                    disabled={proposal.checks.some((c) => !c.valid)}
                    style={{
                      fontFamily: "Cinzel, serif", fontSize: 12,
                      background: proposal.checks.some((c) => !c.valid) ? "#a8a190" : "#4c6b3f",
                      color: "#f4f1e8", border: "none", borderRadius: 6, padding: "8px 16px",
                      cursor: proposal.checks.some((c) => !c.valid) ? "not-allowed" : "pointer",
                    }}
                  >
                    Approve
                  </button>
                )}
                <button onClick={cancelProposal} style={{ fontFamily: "Cinzel, serif", fontSize: 12, background: "transparent", color: "#6b4f24", border: "1px solid #a8925a", borderRadius: 6, padding: "8px 16px", cursor: "pointer" }}>
                  Cancel
                </button>
              </div>
            </div>
          )}

          {/* Query result card */}
          {infoResult && infoResult.type === "query" && (
            <div
              role="region"
              aria-label="Information query result"
              className="it-anim-card-in"
              style={{
                marginTop: 12,
                background: "linear-gradient(180deg, #ece0bd, #ddcf9f)",
                color: "#2b2016",
                borderRadius: 10,
                padding: 16,
                boxShadow: "0 10px 30px rgba(0,0,0,0.5)",
                border: "1px solid #a8925a",
              }}
            >
              {/* Query card header — blue/information treatment, impossible to confuse with proposal */}
              <div style={{
                display: "flex",
                alignItems: "center",
                gap: 7,
                paddingBottom: 10,
                marginBottom: 10,
                borderBottom: "1px solid rgba(80,120,170,0.4)",
              }}>
                <Info size={13} color="#3a6080" />
                <span style={{ fontFamily: "Cinzel, serif", fontSize: 11.5, letterSpacing: 1.2, color: "#3a6080" }}>
                  {infoResult.headline}
                </span>
              </div>
              {infoResult.items.map((it, i) => (
                <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6, fontSize: 13.5 }}>
                  {it.ok ? <Check size={14} color="#4c6b3f" /> : <X size={14} color="#8b2e2e" />}
                  <span>{it.label}</span>
                </div>
              ))}
              <div style={{ marginTop: 8, fontFamily: "Cinzel, serif", fontSize: 13, color: infoResult.overall ? "#2f5223" : "#7a2323" }}>
                {infoResult.overall ? "Yes — this is currently valid." : "No — this is not currently valid."}
              </div>
              <button onClick={cancelInfo} style={{ marginTop: 10, fontFamily: "Cinzel, serif", fontSize: 12, background: "transparent", color: "#6b4f24", border: "1px solid #a8925a", borderRadius: 6, padding: "6px 14px", cursor: "pointer" }}>
                Dismiss
              </button>
            </div>
          )}

          {/* Inspect result card */}
          {infoResult && infoResult.type === "inspect" && (
            <div
              role="region"
              aria-label="Inspect result"
              className="it-anim-card-in"
              style={{
                marginTop: 12,
                background: "linear-gradient(180deg, #ece0bd, #ddcf9f)",
                color: "#2b2016",
                borderRadius: 10,
                padding: 16,
                boxShadow: "0 10px 30px rgba(0,0,0,0.5)",
                border: "1px solid #a8925a",
              }}
            >
              {/* Inspect card header — neutral/descriptive treatment */}
              <div style={{
                display: "flex",
                alignItems: "center",
                gap: 7,
                paddingBottom: 10,
                marginBottom: 10,
                borderBottom: "1px solid rgba(120,100,60,0.4)",
              }}>
                <ScrollText size={13} color="#7a6a3c" />
                <span style={{ fontFamily: "Cinzel, serif", fontSize: 11.5, letterSpacing: 1.2, color: "#7a6a3c" }}>
                  OPTIONS FROM HERE
                </span>
              </div>
              {infoResult.lines.map((line, i) => (
                <div key={i} style={{ fontSize: 13, marginBottom: 4 }}>{line}</div>
              ))}
              <button onClick={cancelInfo} style={{ marginTop: 10, fontFamily: "Cinzel, serif", fontSize: 12, background: "transparent", color: "#6b4f24", border: "1px solid #a8925a", borderRadius: 6, padding: "6px 14px", cursor: "pointer" }}>
                Dismiss
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
