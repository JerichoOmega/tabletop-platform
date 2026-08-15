// @ts-nocheck
// ---------------------------------------------------------------------------
// INTENT ENGINE — text → ProposedAction.
//
// Everything in this module ONLY reads state and calls read-only validate*
// functions. It never calls execute* and never mutates state.
//
// A real LLM could replace parseIntent() wholesale — every function
// downstream of it (revalidateProposal, executeProposalSteps, and the UI)
// would not need to change.
//
// ProposedAction (the return shape of parseIntent) is one of:
//   { type: "proposal", steps: Step[], summary }
//   { type: "query",    question, items: CheckItem[], overall, headline }
//   { type: "inspect",  lines: string[] }
//   { type: "error",    message }
//
// Step is one of:
//   { kind: "move",    dest: {x,y}, description }
//   { kind: "attack",  targetId,    description }
//   { kind: "ability", abilityId, targetId, description }
//   { kind: "endTurn" }
//
// Dependency: content.ts (ABILITY_DEFS) + rules.ts (validation + pathfinding).
// ---------------------------------------------------------------------------

import { ABILITY_DEFS } from "@/engine/content";
import {
  chebyshev,
  lineOfSight,
  reachableTiles,
  occupiedSet,
  validateMove,
  validateAttack,
  validateAbility,
  isValidAbilityTarget,
  cloneState,
  executeMove,
  executeAttack,
  executeAbility,
} from "@/engine/rules";

// ---------------------------------------------------------------------------
// CONTEXTUAL VIEW — not yet used as the primary dispatch path, but kept here
// so it can be the shape handed to a real LLM in a future iteration.
// ---------------------------------------------------------------------------
function buildIntentContext(state, actorId) {
  const actor = state.combatants[actorId];
  if (!actor) return null;
  const enemies = Object.values(state.combatants)
    .filter((c) => c.type === "enemy" && c.alive)
    .map((e) => ({
      id: e.id,
      name: e.name,
      distance: chebyshev(actor, e),
      inRange: chebyshev(actor, e) <= actor.weapon.range,
      visible: !lineOfSight(state.map, actor, e).blocked,
    }));
  return {
    actorId,
    actorName: actor.name,
    position: { x: actor.x, y: actor.y },
    moveRemaining: actor.moveRemaining,
    weapon: actor.weapon,
    actionAvailable: !actor.actionUsed,
    hp: actor.hp,
    maxHp: actor.maxHp,
    isCurrentTurn: state.turnOrder[state.turnIndex] === actorId,
    enemies,
    pillars: state.map.pillars,
  };
}

// ---------------------------------------------------------------------------
// INTENT VOCABULARY
// ---------------------------------------------------------------------------
const MOVE_VERBS       = /\b(move|walk|run|go|dash|step|slip|duck|retreat|approach|advance|reposition)\b/;
const ATTACK_VERBS     = /\b(attack|hit|strike|shoot|fire|slash|stab|cast)\b/;
const END_TURN_PHRASE  = /\b(end (my )?turn|i'?m done|i pass|nothing else|that'?s (all|it))\b/;
const QUERY_PREFIX     = /^(can i|could i|is it possible|would i be able to|do i have|am i able to)\b/;
const INSPECT_PHRASE   = /\b(what can i do|what are my options|options\??$|inspect|look around|show me my options)\b/;
const COVER_PHRASE     = /\b(pillar|cover)\b/;
const NEXT_TO_PHRASE   = /\b(next to|beside|adjacent to|close to|up to)\b/;
const TOWARD_PHRASE    = /\b(toward|towards|closer)\b/;
const RETREAT_PHRASE   = /\b(retreat|back away|fall back|away from)\b/;
const STAY_PHRASE      = /\b(stay|remain|don'?t move|from here|where i am|without moving)\b/;
const GENERIC_TARGET_WORDS = /\benemy\b|\bit\b|\bhim\b|\bthat\b|closest|nearest/;

function classifyIntent(t) {
  return {
    isQuery:      QUERY_PREFIX.test(t),
    isInspect:    INSPECT_PHRASE.test(t),
    isEndTurn:    END_TURN_PHRASE.test(t),
    wantsMove:    MOVE_VERBS.test(t) || COVER_PHRASE.test(t) || NEXT_TO_PHRASE.test(t) || TOWARD_PHRASE.test(t),
    wantsAttack:  ATTACK_VERBS.test(t),
    wantsCover:   COVER_PHRASE.test(t),
    wantsNextTo:  NEXT_TO_PHRASE.test(t),
    wantsToward:  TOWARD_PHRASE.test(t),
    wantsRetreat: RETREAT_PHRASE.test(t),
    staysPut:     STAY_PHRASE.test(t),
  };
}

function normalizeForMatch(s) {
  return s.toLowerCase().replace(/[^a-z0-9]/g, "");
}

// Used only for example/hint copy (error messages, input placeholders) so
// that text doesn't hardcode "the goblin" — it names whatever enemy is
// actually present in the current encounter.
export function exampleTargetPhrase(state) {
  const enemies = Object.values(state.combatants).filter((c) => c.type === "enemy" && c.alive);
  if (!enemies.length) return "your target";
  return "the " + enemies[0].cls.toLowerCase();
}

// ---------------------------------------------------------------------------
// TARGET RESOLUTION
// Matches against whatever enemies actually exist in the CURRENT encounter —
// never hardcoded enemy type. "Attack the orc" works only because an Orc
// happens to be present. No per-species branching.
// ---------------------------------------------------------------------------
function findTargetByText(text, state, actorPos) {
  const enemies = Object.values(state.combatants).filter((c) => c.type === "enemy" && c.alive);
  if (!enemies.length) return null;
  const norm = normalizeForMatch(text);

  // Exact/partial instance-name match, e.g. "goblin 2", "goblin2", "orc".
  const named = enemies.find((e) => norm.includes(normalizeForMatch(e.name)));
  if (named) return named;

  // Class match, e.g. "the orc" when cls is "Orc".
  const byClass = enemies.filter((e) => norm.includes(normalizeForMatch(e.cls)));
  if (byClass.length === 1) return byClass[0];

  // Generic pronoun/"nearest"/"closest" fallback.
  const t = text.toLowerCase();
  if (byClass.length > 1 || GENERIC_TARGET_WORDS.test(t)) {
    const pool = byClass.length ? byClass : enemies;
    return [...pool].sort((a, b) => chebyshev(actorPos, a) - chebyshev(actorPos, b))[0];
  }
  return null;
}

// ---------------------------------------------------------------------------
// ABILITY RESOLUTION
// Matches against whatever abilities the actor actually has. Generic verbs
// are tied to an effect TYPE, not a specific ability's name — so "heal
// myself" works for any ability whose effect.type is "heal", the same way
// ATTACK_VERBS works for any weapon.
// ---------------------------------------------------------------------------
const EFFECT_TYPE_VERBS = {
  heal:   /\b(heal|healing|cure|mend)\b/,
  damage: /\b(fire|flame|burn|scorch|blast|bolt|spell)\b/,
};

function findAbilityByText(text, actor) {
  const abilities = actor.abilities || [];
  if (!abilities.length) return null;
  const norm = normalizeForMatch(text);
  const byName = abilities.find((id) => ABILITY_DEFS[id] && norm.includes(normalizeForMatch(ABILITY_DEFS[id].name)));
  if (byName) return byName;
  const t = text.toLowerCase();
  const byEffectVerb = abilities.find((id) => {
    const ability = ABILITY_DEFS[id];
    const verbPattern = ability && EFFECT_TYPE_VERBS[ability.effect.type];
    return verbPattern && verbPattern.test(t);
  });
  return byEffectVerb || null;
}

// Ally/self target resolution for abilities (as opposed to findTargetByText,
// which resolves enemies for attacks).
function findAllyTargetByText(text, state, actor) {
  const t = text.toLowerCase();
  if (/\b(myself|herself|himself|itself|on me|on herself|on himself|on myself)\b/.test(t)) return actor;
  const allies = Object.values(state.combatants).filter((c) => c.type === actor.type && c.alive);
  const norm = normalizeForMatch(text);
  const named = allies.find((a) => norm.includes(normalizeForMatch(a.name)));
  if (named) return named;
  return null;
}

// Generic target resolution for ANY ability, dispatched on the ability's
// own `targeting` rule — this is what lets Fire Bolt (targeting: "enemy")
// and Healing Touch (targeting: "ally") share one intent-parsing path.
function findAbilityTargetByText(text, state, actor, ability) {
  if (ability.targeting === "self")  return actor;
  if (ability.targeting === "enemy") return findTargetByText(text, state, actor);
  if (ability.targeting === "ally")  return findAllyTargetByText(text, state, actor) || actor;
  // "any": try enemy first, then ally/self
  return findTargetByText(text, state, actor) || findAllyTargetByText(text, state, actor);
}

// ---------------------------------------------------------------------------
// DESTINATION RESOLVERS
// Each finds a reachable tile satisfying an intent. Reads terrain from
// state.map (never a module-level map reference).
// ---------------------------------------------------------------------------
function findCoverTile(state, actor, target) {
  const occ   = occupiedSet(state.combatants, actor.id);
  const reach = reachableTiles(state.map, { x: actor.x, y: actor.y }, actor.moveRemaining, occ);
  let best = null;
  for (const tile of reach) {
    if (!state.map.pillars.some((p) => chebyshev(p, tile) === 1)) continue;
    if (target && lineOfSight(state.map, tile, target).blocked) continue;
    if (!best || tile.dist < best.dist) best = tile;
  }
  return best;
}
function findAttackPositionTile(state, actor, target) {
  const occ   = occupiedSet(state.combatants, actor.id);
  const reach = reachableTiles(state.map, { x: actor.x, y: actor.y }, actor.moveRemaining, occ);
  let best = null;
  for (const tile of reach) {
    if (chebyshev(tile, target) > actor.weapon.range) continue;
    if (lineOfSight(state.map, tile, target).blocked) continue;
    if (!best || tile.dist < best.dist) best = tile;
  }
  return best;
}
function findAdjacentTile(state, actor, target) {
  const occ   = occupiedSet(state.combatants, actor.id);
  const reach = reachableTiles(state.map, { x: actor.x, y: actor.y }, actor.moveRemaining, occ);
  let best = null;
  for (const tile of reach) {
    if (chebyshev(tile, target) !== 1) continue;
    if (!best || tile.dist < best.dist) best = tile;
  }
  return best;
}
function findCloserTile(state, actor, target) {
  const occ     = occupiedSet(state.combatants, actor.id);
  const reach   = reachableTiles(state.map, { x: actor.x, y: actor.y }, actor.moveRemaining, occ);
  const curDist = chebyshev(actor, target);
  let best = null;
  for (const tile of reach) {
    const d = chebyshev(tile, target);
    if (d >= curDist) continue;
    if (!best || d < best.dToTarget || (d === best.dToTarget && tile.dist < best.dist))
      best = { ...tile, dToTarget: d };
  }
  return best;
}
function findRetreatTile(state, actor) {
  const occ     = occupiedSet(state.combatants, actor.id);
  const reach   = reachableTiles(state.map, { x: actor.x, y: actor.y }, actor.moveRemaining, occ);
  const enemies = Object.values(state.combatants).filter((c) => c.type === "enemy" && c.alive);
  if (!enemies.length) return null;
  const minDistToEnemies = (tile) => Math.min(...enemies.map((e) => chebyshev(tile, e)));
  const curSafety = minDistToEnemies(actor);
  let best = null;
  for (const tile of reach) {
    const safety = minDistToEnemies(tile);
    if (safety <= curSafety) continue;
    if (!best || safety > best.safety) best = { ...tile, safety };
  }
  return best;
}

// ---------------------------------------------------------------------------
// "CAN I…?" EXPLAINABILITY
// Itemised check lists built ONLY from real validation — never invented.
// ---------------------------------------------------------------------------
function explainAttack(state, actorId, targetId) {
  const actor  = state.combatants[actorId];
  const target = state.combatants[targetId];
  if (!target) return { overall: false, items: [{ ok: false, label: "No such target." }] };
  const items = [];
  items.push({ ok: target.alive, label: target.alive ? `${target.name} is alive` : `${target.name} is already defeated` });
  const turnOk = state.turnOrder[state.turnIndex] === actorId;
  items.push({ ok: turnOk, label: turnOk ? `It is ${actor.name}'s turn` : `It is not ${actor.name}'s turn` });
  items.push({ ok: !actor.actionUsed, label: !actor.actionUsed ? "Attack action is available" : "Attack action already used this turn" });
  const dist   = chebyshev(actor, target);
  const inRange = dist <= actor.weapon.range;
  items.push({ ok: inRange, label: inRange ? `Target is within weapon range (${dist}/${actor.weapon.range})` : `Target is out of weapon range (${dist}/${actor.weapon.range})` });
  const los = lineOfSight(state.map, actor, target);
  items.push({ ok: !los.blocked, label: !los.blocked ? "Line of sight is clear" : "Line of sight is blocked by a wall" });
  if (!los.blocked && los.cover) items.push({ ok: true, label: "Target has pillar cover (+2 effective AC)" });
  return { overall: items.every((i) => i.ok), items };
}
function explainReachCover(state, actorId) {
  const actor = state.combatants[actorId];
  const tile  = findCoverTile(state, actor, null);
  const items = [
    { ok: !!tile, label: tile ? `A tile beside a pillar is reachable (${actor.moveRemaining} movement available)` : "No reachable tile is adjacent to a pillar" },
  ];
  return { overall: items.every((i) => i.ok), items, tile };
}
function explainAbility(state, actorId, abilityId, targetId) {
  const actor   = state.combatants[actorId];
  const target  = state.combatants[targetId];
  const ability = ABILITY_DEFS[abilityId];
  if (!target || !ability) return { overall: false, items: [{ ok: false, label: "No such ability or target." }] };
  const items = [];
  items.push({ ok: (actor.abilities || []).includes(abilityId), label: (actor.abilities || []).includes(abilityId) ? `${actor.name} knows ${ability.name}` : `${actor.name} does not know ${ability.name}` });
  const turnOk = state.turnOrder[state.turnIndex] === actorId;
  items.push({ ok: turnOk, label: turnOk ? `It is ${actor.name}'s turn` : `It is not ${actor.name}'s turn` });
  items.push({ ok: !actor.actionUsed, label: !actor.actionUsed ? "Action is available" : "Action already used this turn" });
  const validTargetType = isValidAbilityTarget(ability.targeting, actor, target);
  items.push({ ok: validTargetType, label: validTargetType ? `${target.name} is a valid target` : `${target.name} is not a valid target for ${ability.name}` });
  const dist    = chebyshev(actor, target);
  const inRange = dist <= ability.range;
  items.push({ ok: inRange, label: inRange ? `Target is within range (${dist}/${ability.range})` : `Target is out of range (${dist}/${ability.range})` });
  if (ability.requiresLineOfSight) {
    const los = lineOfSight(state.map, actor, target);
    items.push({ ok: !los.blocked, label: !los.blocked ? "Line of sight is clear" : "Line of sight is blocked by a wall" });
  }
  return { overall: items.every((i) => i.ok), items };
}

// ---------------------------------------------------------------------------
// THE INTERPRETER — text + state + actorId → ProposedAction
// ---------------------------------------------------------------------------
export function parseIntent(text, state, actorId) {
  const raw   = text.trim();
  const t     = raw.toLowerCase();
  const actor = state.combatants[actorId];
  if (!t) return { type: "error", message: `Type an instruction, e.g. "attack ${exampleTargetPhrase(state)}".` };

  // 1. "Can I...?" queries — answered with the real rules engine, never invented
  if (QUERY_PREFIX.test(t)) {
    const rest = t.replace(QUERY_PREFIX, "").trim();
    const queryAbilityId = findAbilityByText(rest, actor);
    if (queryAbilityId) {
      const ability = ABILITY_DEFS[queryAbilityId];
      const target  = findAbilityTargetByText(rest, state, actor, ability);
      if (!target) return { type: "error", message: `Could not identify a target for ${ability.name}.` };
      const verb = ability.targeting === "enemy" ? "CAST" : "USE";
      const prep = ability.targeting === "enemy" ? "AT"   : "ON";
      const ex   = explainAbility(state, actorId, queryAbilityId, target.id);
      return { type: "query", question: raw, items: ex.items, overall: ex.overall, headline: `CAN I ${verb} ${ability.name.toUpperCase()} ${prep} ${target.name.toUpperCase()}?` };
    }
    if (ATTACK_VERBS.test(rest) || GENERIC_TARGET_WORDS.test(rest)) {
      const target = findTargetByText(rest, state, actor);
      if (!target) return { type: "error", message: "No matching target found for that question." };
      const ex = explainAttack(state, actorId, target.id);
      return { type: "query", question: raw, items: ex.items, overall: ex.overall, headline: `CAN I ATTACK ${target.name.toUpperCase()}?` };
    }
    if (COVER_PHRASE.test(rest) || /reach|get behind/.test(rest)) {
      const ex = explainReachCover(state, actorId);
      return { type: "query", question: raw, items: ex.items, overall: ex.overall, headline: "CAN I REACH COVER?" };
    }
    return { type: "error", message: `Could not interpret the question "${raw}".` };
  }

  // 2. Inspect — informational only, never mutates or proposes
  if (INSPECT_PHRASE.test(t)) {
    const enemies = Object.values(state.combatants).filter((c) => c.type === "enemy" && c.alive);
    const lines   = enemies.map((e) => {
      const v = validateAttack(state, actorId, e.id);
      return `${e.name}: ${v.valid ? "attack available" : v.reason}`;
    });
    return {
      type: "inspect",
      lines: [`Movement remaining: ${actor.moveRemaining}/${actor.moveMax}`, `Action: ${actor.actionUsed ? "used" : "available"}`, ...lines],
    };
  }

  // 3. End Turn
  if (END_TURN_PHRASE.test(t)) {
    return { type: "proposal", steps: [{ kind: "endTurn", description: "End Turn" }], summary: `${actor.name} → End Turn` };
  }

  // 3.5. Ability use — checked BEFORE Move/Attack because an ability's own
  // vocabulary (e.g. "cast") can overlap with ATTACK_VERBS; abilities win.
  const abilityId = findAbilityByText(t, actor);
  if (abilityId) {
    const ability = ABILITY_DEFS[abilityId];
    const target  = findAbilityTargetByText(t, state, actor, ability);
    if (!target) return { type: "error", message: `Could not identify a target for ${ability.name} in "${raw}".` };
    const verb        = ability.targeting === "enemy" ? "Cast" : "Use";
    const prep        = ability.targeting === "enemy" ? "at"   : "on";
    const description = `${verb} ${ability.name} ${prep} ${target.name}`;
    return {
      type: "proposal",
      steps: [{ kind: "ability", abilityId, targetId: target.id, description }],
      summary: `${actor.name}\n→ ${description}`,
    };
  }

  // 4. Move / Attack / Move+Attack sequences
  const c          = classifyIntent(t);
  const needsTarget = c.wantsAttack || c.wantsNextTo || c.wantsToward;
  const target      = needsTarget ? findTargetByText(t, state, actor) : null;
  if (c.wantsAttack && !target)
    return { type: "error", message: `Could not identify a target in "${raw}".` };
  if ((c.wantsNextTo || c.wantsToward) && !target && !c.wantsAttack)
    return { type: "error", message: `Could not identify what to move toward in "${raw}".` };

  const steps = [];
  if (c.wantsMove && !c.staysPut) {
    let tile = null, moveDescription = null;
    // Propose a literal blocked tile so the rules engine rejects it with a
    // real explanation instead of quietly rerouting.
    if (/\b(through|into|onto)\b.*\bpillar\b/.test(t)) {
      if (!state.map.pillars.length)
        return { type: "error", message: `There is no pillar on ${state.map.name}.` };
      const nearestPillar = [...state.map.pillars].sort((a, b) => chebyshev(actor, a) - chebyshev(actor, b))[0];
      steps.push({ kind: "move", dest: { x: nearestPillar.x, y: nearestPillar.y }, description: "Move through the pillar" });
    } else if (c.wantsCover) {
      tile = findCoverTile(state, actor, target);
      moveDescription = "Move to Pillar Cover";
      if (!tile) return { type: "error", message: target ? "No reachable position near a pillar has line of sight to that target." : "No reachable tile is adjacent to a pillar." };
    } else if (c.wantsRetreat) {
      tile = findRetreatTile(state, actor);
      moveDescription = "Retreat to Safer Position";
      if (!tile) return { type: "error", message: "There is no reachable tile that increases distance from enemies." };
    } else if (c.wantsNextTo && target) {
      tile = findAdjacentTile(state, actor, target);
      moveDescription = `Move Adjacent to ${target.name}`;
      if (!tile) return { type: "error", message: `No reachable tile is adjacent to ${target.name}.` };
    } else if (c.wantsToward && target) {
      tile = findCloserTile(state, actor, target);
      moveDescription = `Move Toward ${target.name}`;
      if (!tile) return { type: "error", message: `${actor.name} cannot move any closer to ${target.name}.` };
    } else if (target) {
      tile = findAttackPositionTile(state, actor, target);
      moveDescription = "Move to Attack Position";
      if (!tile) return { type: "error", message: `No reachable position has line of sight to ${target.name} within weapon range.` };
    } else {
      return { type: "error", message: 'Move where? Try mentioning a landmark, e.g. "move behind the pillar".' };
    }
    if (tile && !(tile.x === actor.x && tile.y === actor.y)) {
      steps.push({ kind: "move", dest: { x: tile.x, y: tile.y }, description: moveDescription });
    }
  }

  if (c.wantsAttack && target) {
    steps.push({ kind: "attack", targetId: target.id, description: `Attack ${target.name}` });
  }

  if (steps.length === 0) {
    return { type: "error", message: `Could not interpret "${raw}". Try describing a move and/or an attack.` };
  }

  const summary = `${actor.name}\n` + steps.map((s) => `→ ${s.description}`).join("\n");
  return { type: "proposal", steps, summary };
}

// ---------------------------------------------------------------------------
// PROPOSAL LIFECYCLE — revalidate-then-execute, atomically
//
// A proposal is a snapshot of intent, never permission to skip the rules
// engine. Every step is re-checked against the CURRENT state right before
// execution; if anything has changed (target moved, died, action already
// used), nothing is applied.
// ---------------------------------------------------------------------------
export function revalidateProposal(state, actorId, steps) {
  let sim = cloneState(state);
  const checks = [];
  for (const step of steps) {
    if (step.kind === "move") {
      const v = validateMove(sim, actorId, step.dest);
      checks.push({ step, valid: v.valid, reason: v.reason, code: v.code });
      if (v.valid) {
        const a = sim.combatants[actorId];
        a.x = step.dest.x;
        a.y = step.dest.y;
        a.moveRemaining -= v.cost;
      }
    } else if (step.kind === "attack") {
      const v = validateAttack(sim, actorId, step.targetId);
      checks.push({ step, valid: v.valid, reason: v.reason, code: v.code, cover: v.cover });
    } else if (step.kind === "ability") {
      const v = validateAbility(sim, actorId, step.abilityId, step.targetId);
      checks.push({ step, valid: v.valid, reason: v.reason, code: v.code });
    } else if (step.kind === "endTurn") {
      checks.push({ step, valid: true, reason: null, code: "OK" });
    }
  }
  return checks;
}

// Executes a pre-validated sequence atomically. If any step turns out to be
// invalid when actually applied, the ORIGINAL input state is returned
// untouched — no partial mutation is possible.
export function executeProposalSteps(state, actorId, steps, rng) {
  let cur = state;
  const events = [];
  let lastAttackResult  = null;
  let lastAbilityResult = null;
  for (const step of steps) {
    if (step.kind === "move") {
      const res = executeMove(cur, actorId, step.dest);
      if (!res.ok) return { ok: false, state, events: res.events };
      cur = res.state;
      events.push(...res.events);
    } else if (step.kind === "attack") {
      const res = executeAttack(cur, actorId, step.targetId, rng);
      if (!res.ok) return { ok: false, state, events: res.events };
      cur = res.state;
      events.push(...res.events);
      lastAttackResult = res.result;
    } else if (step.kind === "ability") {
      const res = executeAbility(cur, actorId, step.abilityId, step.targetId, rng);
      if (!res.ok) return { ok: false, state, events: res.events };
      cur = res.state;
      events.push(...res.events);
      lastAbilityResult = res.result;
    }
    // 'endTurn' steps are handled by the caller (turn cycling + enemy AI
    // live outside this pure engine call) — see handleEndTurn / approveProposal.
  }
  return { ok: true, state: cur, events, lastAttackResult, lastAbilityResult };
}
