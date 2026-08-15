// @ts-nocheck
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
} from "lucide-react";

import { ENCOUNTER_DEFS, ABILITY_DEFS, buildEncounter, mulberry32 } from "@/engine/content";
import {
  resolveLeadingEnemyTurns, endTurn,
  executeMove, executeAttack, executeAbility,
  validateAttack, validateAbility,
  checkEncounterStatus,
  reachableTiles, occupiedSet,
  key, isWall, isPillar,
} from "@/engine/rules";
import { parseIntent, revalidateProposal, executeProposalSteps, exampleTargetPhrase } from "@/intent/parser";
import { FONT_IMPORT, ClassIcon, CharacterPanel, actionBtnStyle } from "@/ui/primitives";
import { resolveAsset } from "@/assets/registry";

// True when running under Playwright or any other harness that appends ?e2e to
// the URL.  Test-only encounters are hidden from the picker in normal usage.
const isE2E = typeof window !== "undefined" && new URLSearchParams(window.location.search).has("e2e");

export default function IntelligentTabletop() {
  const seedRef        = useRef(1337);
  const encounterIdRef = useRef("crypt");
  const rngRef         = useRef(null);

  const [gameState, setGameState] = useState(() => {
    const fresh = buildEncounter(encounterIdRef.current, seedRef.current);
    const rng   = mulberry32(seedRef.current + 9999); // separate stream for combat rolls
    rngRef.current = rng;
    return resolveLeadingEnemyTurns(fresh, rng);
  });
  const [mode, setMode]               = useState("traditional"); // traditional | assisted | adventure
  const [selectedId, setSelectedId]   = useState(null);
  const [pendingAction, setPendingAction] = useState(null);       // 'move' | 'attack' | 'ability:<id>' | null
  const [lastRoll, setLastRoll]       = useState(null);
  const [textInput, setTextInput]     = useState("");
  const [proposal, setProposal]       = useState(null);           // {steps, summary, checks, actorId, text, stale}
  const [infoResult, setInfoResult]   = useState(null);           // {type:'query'|'inspect', ...}
  const [banner, setBanner]           = useState(null);           // transient error/warning messages

  const currentActorId = gameState.turnOrder[gameState.turnIndex];
  const currentActor   = gameState.combatants[currentActorId];
  const isPlayerTurn   = currentActor && currentActor.type === "pc";
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
    if (isPlayerTurn && currentActorId) {
      setSelectedId(currentActorId);
      setPendingAction(null);
    }
  }, [turnKey]); // eslint-disable-line react-hooks/exhaustive-deps

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

  const reachable = useMemo(() => {
    if (!isPlayerTurn || pendingAction !== "move" || !selected || selected.id !== currentActorId) return [];
    const occ = occupiedSet(gameState.combatants, selected.id);
    return reachableTiles(gameState.map, { x: selected.x, y: selected.y }, selected.moveRemaining, occ);
  }, [gameState, pendingAction, selected, currentActorId, isPlayerTurn]);

  const attackPreview = useMemo(() => {
    if (!isPlayerTurn || pendingAction !== "attack" || !selected || selected.id !== currentActorId) return {};
    const map = {};
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
    if (!isPlayerTurn || !pendingAbilityId || !selected || selected.id !== currentActorId) return {};
    const map = {};
    Object.values(gameState.combatants).forEach((c) => {
      if (c.alive) map[c.id] = validateAbility(gameState, selected.id, pendingAbilityId, c.id);
    });
    return map;
  }, [gameState, pendingAbilityId, selected, currentActorId, isPlayerTurn]);

  // ---------------------------------------------------------------------------
  // EVENT HANDLERS
  // ---------------------------------------------------------------------------
  function pushLogAndSet(next) { setGameState(next); }
  function afterPlayerAction(next) { pushLogAndSet(next); }
  function doEndTurnAndMaybeAI(state) {
    const next = endTurn(state);
    return resolveLeadingEnemyTurns(next, rngRef.current);
  }

  const handleSelectToken = useCallback((id) => {
    setSelectedId(id);
    setPendingAction(null);
    setProposal(null);
  }, []);

  function handleTileClick(x, y) {
    if (mode !== "traditional" || pendingAction !== "move" || !selected) return;
    const res = executeMove(gameState, selected.id, { x, y });
    if (res.ok) {
      setPendingAction(null);
      afterPlayerAction(res.state);
    } else {
      setBanner(res.events[0]);
      setTimeout(() => setBanner(null), 2200);
    }
  }

  function handleAttackTarget(targetId) {
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
    const res = executeAttack(gameState, selected.id, targetId, rngRef.current);
    setPendingAction(null);
    if (res.ok) {
      setLastRoll({ kind: "attack", actor: selected.name, ...res.result, targetName: gameState.combatants[targetId].name });
    }
    afterPlayerAction(res.state);
  }

  // FIX: ability targeting — token clicks during `ability:<id>` mode route
  // here, NOT through handleSelectToken. The early-return guard checks the
  // exact pendingAction string so enemy clicks during "move" mode don't
  // accidentally trigger an ability.
  function handleAbilityTarget(abilityId, targetId) {
    if (mode !== "traditional" || pendingAction !== "ability:" + abilityId || !selected) return;
    const v = validateAbility(gameState, selected.id, abilityId, targetId);
    if (!v.valid) {
      // Real reason, no mutation, no consumed action, stay in ability-targeting mode.
      const targetName = gameState.combatants[targetId] ? gameState.combatants[targetId].name : "That target";
      setBanner(`${ABILITY_DEFS[abilityId].name} cannot target ${targetName}: ${v.reason}`);
      setTimeout(() => setBanner(null), 2800);
      return;
    }
    const res = executeAbility(gameState, selected.id, abilityId, targetId, rngRef.current);
    setPendingAction(null);
    if (res.ok) {
      setLastRoll({ kind: "ability", actor: selected.name, abilityName: ABILITY_DEFS[abilityId].name, ...res.result });
    }
    afterPlayerAction(res.state);
  }

  function handleEndTurn() {
    const next = doEndTurnAndMaybeAI(gameState);
    setPendingAction(null);
    afterPlayerAction(next);
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
    const exec = executeProposalSteps(gameState, proposal.actorId, proposal.steps, rngRef.current);
    if (!exec.ok) {
      setBanner(exec.events[0] || "That action could not be resolved.");
      setTimeout(() => setBanner(null), 2800);
      setProposal(null);
      return;
    }
    if (exec.lastAttackResult) {
      const atkStep = proposal.steps.find((s) => s.kind === "attack");
      setLastRoll({ kind: "attack", actor: exec.state.combatants[proposal.actorId].name, targetName: exec.state.combatants[atkStep.targetId].name, ...exec.lastAttackResult });
    } else if (exec.lastAbilityResult) {
      const abilityStep = proposal.steps.find((s) => s.kind === "ability");
      setLastRoll({ kind: "ability", actor: exec.state.combatants[proposal.actorId].name, abilityName: ABILITY_DEFS[abilityStep.abilityId].name, ...exec.lastAbilityResult });
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
      setBanner(parsed.message || "That is no longer possible.");
      setTimeout(() => setBanner(null), 2800);
      return;
    }
    const checks = revalidateProposal(gameState, proposal.actorId, parsed.steps);
    setProposal({ steps: parsed.steps, summary: parsed.summary, checks, actorId: proposal.actorId, text: proposal.text, stale: false });
  }

  function cancelProposal() { setProposal(null); }
  function cancelInfo()     { setInfoResult(null); }

  // FIX 3: arrow wrapper prevents SyntheticEvent from being passed as encounterId.
  function newEncounter(encounterId) {
    if (encounterId) encounterIdRef.current = encounterId;
    seedRef.current += 1;
    const fresh = buildEncounter(encounterIdRef.current, seedRef.current);
    const rng   = mulberry32(seedRef.current + 9999);
    rngRef.current = rng;
    setGameState(resolveLeadingEnemyTurns(fresh, rng));
    setSelectedId(null);
    setPendingAction(null);
    setProposal(null);
    setInfoResult(null);
    setLastRoll(null);
    setBanner(null);
    setMode("traditional");
  }

  // ---------------------------------------------------------------------------
  // GRID RENDERING HELPERS
  // ---------------------------------------------------------------------------
  const reachSet    = useMemo(() => new Set(reachable.map((t) => key(t.x, t.y))), [reachable]);
  const tokensByTile = useMemo(() => {
    const m = {};
    Object.values(gameState.combatants).forEach((c) => { if (c.alive) m[key(c.x, c.y)] = c; });
    return m;
  }, [gameState]);

  const cellPx = 52;

  // ---------------------------------------------------------------------------
  // RENDER
  // ---------------------------------------------------------------------------
  return (
    <div
      style={{
        fontFamily: "'EB Garamond', serif",
        minHeight: "100vh",
        background: "radial-gradient(1200px 600px at 20% -10%, #2c2013 0%, #1a130c 55%, #100c07 100%)",
        color: "#e8dcc0",
        padding: 18,
      }}
    >
      <style>{FONT_IMPORT}</style>

      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14, flexWrap: "wrap", gap: 10 }}>
        <div>
          <div style={{ fontFamily: "Cinzel, serif", fontSize: 22, letterSpacing: 1, color: "#e8dcc0" }}>
            {gameState.encounterName}
          </div>
          <div style={{ fontSize: 12.5, color: "#a89468" }}>
            Round {gameState.round} · {currentActor ? `${currentActor.name}'s turn` : ""}
          </div>
        </div>
        <div style={{ display: "flex", gap: 6, background: "#241a12", border: "1px solid #5a4326", borderRadius: 10, padding: 4 }}>
          {[
            { id: "traditional", label: "Traditional" },
            { id: "assisted",    label: "Assisted"    },
            { id: "adventure",   label: "Adventure"   },
          ].map((m) => (
            <button
              key={m.id}
              onClick={() => { setMode(m.id); setPendingAction(null); setProposal(null); setInfoResult(null); }}
              style={{
                fontFamily: "Cinzel, serif",
                fontSize: 11.5,
                letterSpacing: 0.5,
                padding: "7px 14px",
                borderRadius: 7,
                border: "none",
                cursor: "pointer",
                background: mode === m.id ? "#c9a227" : "transparent",
                color: mode === m.id ? "#241a12" : "#c9bd9e",
                transition: "all .15s ease",
              }}
            >
              {m.label}
            </button>
          ))}
        </div>
      </div>

      {/* Encounter switcher — test-only encounters are hidden unless ?e2e is in the URL */}
      <div style={{ display: "flex", gap: 6, marginBottom: 14 }}>
        {Object.values(ENCOUNTER_DEFS).filter((enc) => !enc.testOnly || isE2E).map((enc) => (
          <button
            key={enc.id}
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

      {/* Transient banner */}
      {banner && (
        <div style={{ marginBottom: 10, padding: "8px 12px", background: "#3b2418", border: "1px solid #8b2e2e", borderRadius: 8, fontSize: 13, color: "#e8b8a8" }}>
          {banner}
        </div>
      )}

      {/* Victory / Defeat banner */}
      {encounterStatus !== "ongoing" && (
        <div style={{ marginBottom: 10, padding: "12px 16px", background: encounterStatus === "victory" ? "#243b1e" : "#3b1e1e", border: `1px solid ${encounterStatus === "victory" ? "#4c6b3f" : "#8b2e2e"}`, borderRadius: 8, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span style={{ fontFamily: "Cinzel, serif", fontSize: 15 }}>{encounterBanner}</span>
          {/* FIX 3: arrow wrapper — prevents SyntheticEvent from becoming encounterId */}
          <button onClick={() => newEncounter()} style={{ fontFamily: "Cinzel, serif", fontSize: 12, background: "#c9a227", color: "#241a12", border: "none", borderRadius: 6, padding: "6px 12px", cursor: "pointer" }}>
            New Encounter
          </button>
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "220px 1fr 260px", gap: 16, alignItems: "start" }}>
        {/* LEFT: character panels */}
        <div>
          {/* PARTY */}
          <div style={{ fontFamily: "Cinzel, serif", fontSize: 12, color: "#a89468", marginBottom: 8, letterSpacing: 1 }}>PARTY</div>
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
                  style={actionBtnStyle(pendingAction === "move")}
                >
                  <Footprints size={13} /> Move
                </button>
                <button
                  onClick={() => setPendingAction(pendingAction === "attack" ? null : "attack")}
                  disabled={selected.actionUsed}
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
                </div>
              )}
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
          <div style={{ fontFamily: "Cinzel, serif", fontSize: 12, color: "#a89468", margin: "14px 0 8px", letterSpacing: 1 }}>ENEMIES</div>
          {Object.values(gameState.combatants)
            .filter((c) => c.type === "enemy")
            .map((c) => (
              <CharacterPanel key={c.id} c={c} isCurrent={c.id === currentActorId} isSelected={c.id === selectedId} onSelect={handleSelectToken} />
            ))}
        </div>

        {/* CENTER: tabletop grid */}
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
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

            <div
              style={{
                display: "grid",
                gridTemplateColumns: `repeat(${gameState.map.width}, ${cellPx}px)`,
                gridTemplateRows:    `repeat(${gameState.map.height}, ${cellPx}px)`,
                gap: 2,
              }}
            >
              {Array.from({ length: gameState.map.height }).map((_, y) =>
                Array.from({ length: gameState.map.width }).map((__, x) => {
                  const wall   = isWall(gameState.map, x, y);
                  const pillar = isPillar(gameState.map, x, y);
                  const tok    = tokensByTile[key(x, y)];
                  const isReach = reachSet.has(key(x, y));
                  let bg = "#c9bd9e";
                  if (wall) bg = "#1c140c";
                  else bg = ((x + y) % 2 === 0) ? "#d8cba6" : "#ccbe97";
                  return (
                    <div
                      key={key(x, y)}
                      onClick={() => handleTileClick(x, y)}
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
                      {tok && (
                        <div
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
                              mode === "traditional" && pendingAction === "attack" && tok.type === "enemy" && attackPreview[tok.id]?.valid
                                ? "0 0 0 3px rgba(180,50,50,0.8)"          // red — hostile attack
                                : mode === "traditional" && pendingAbilityId && abilityPreview[tok.id]?.valid
                                ? (abilityIsHarmful
                                    ? "0 0 0 3px rgba(180,50,50,0.8)"      // red — harmful ability (e.g. Fire Bolt)
                                    : "0 0 0 3px rgba(59,130,200,0.9)")    // blue — beneficial ability (e.g. Healing Touch)
                                : tok.id === currentActorId
                                ? "0 0 0 2px rgba(255,240,170,0.3), 0 2px 5px rgba(0,0,0,0.5)"  // warm ring = active turn
                                : "0 2px 5px rgba(0,0,0,0.5)",
                            cursor: "pointer",
                          }}
                          title={tok.name}
                        >
                          {/* Resolve visual asset if registered; fall back to icon placeholder. */}
                          {resolveAsset(`character.${tok.defId}`)
                            ? <img src={resolveAsset(`character.${tok.defId}`).src} alt={tok.name} style={{ width: 18, height: 18, objectFit: "cover", borderRadius: "50%", pointerEvents: "none" }} />
                            : <ClassIcon icon={tok.icon} size={18} className="" />
                          }
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

        {/* RIGHT: initiative tracker + session log */}
        <div>
          <div style={{ fontFamily: "Cinzel, serif", fontSize: 12, color: "#a89468", marginBottom: 8, letterSpacing: 1 }}>INITIATIVE</div>
          <div style={{ background: "#241a12", border: "1px solid #5a4326", borderRadius: 8, padding: 8, marginBottom: 14 }}>
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

          <div style={{ fontFamily: "Cinzel, serif", fontSize: 12, color: "#a89468", marginBottom: 8, letterSpacing: 1, display: "flex", alignItems: "center", gap: 5 }}>
            <ScrollText size={13} /> SESSION LOG
          </div>
          <div style={{ background: "#241a12", border: "1px solid #5a4326", borderRadius: 8, padding: 10, height: 320, overflowY: "auto", fontSize: 12, lineHeight: 1.5 }}>
            {gameState.log.map((line, i) => (
              <div key={i} style={{ color: line.startsWith("—") ? "#c9a227" : "#c9bd9e", fontStyle: line.startsWith("—") ? "italic" : "normal", marginBottom: 3 }}>
                {line}
              </div>
            ))}
          </div>
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
                      ? c.step.description || `Move to (${c.step.dest.x}, ${c.step.dest.y})`
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
