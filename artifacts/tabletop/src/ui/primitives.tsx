// @ts-nocheck
// ---------------------------------------------------------------------------
// UI PRIMITIVES — small, purely presentational components used by the main
// IntelligentTabletop component. No game logic lives here.
// ---------------------------------------------------------------------------

import React from "react";
import { Sword, Wand2, Shield, Footprints } from "lucide-react";
import { resolveAsset } from "@/assets/registry";
import { getEffectiveArmorClass, getEffectiveMoveMax, getEquipmentDefinition } from "@/engine/equipment";

export const FONT_IMPORT = `@import url('https://fonts.googleapis.com/css2?family=Cinzel:wght@500;700&family=EB+Garamond:ital,wght@0,400;0,600;1,400&display=swap');`;

export function ClassIcon({ icon, size = 16, className = "" }) {
  if (icon === "sword") return <Sword  size={size} className={className} />;
  if (icon === "wand")  return <Wand2  size={size} className={className} />;
  return                       <Shield size={size} className={className} />;
}

export function HpBar({ hp, maxHp }) {
  const pct   = Math.max(0, Math.min(100, (hp / maxHp) * 100));
  const color = pct > 50 ? "#6b8f4e" : pct > 20 ? "#c9962c" : "#8b2e2e";
  return (
    <div style={{ background: "#241a12", borderRadius: 4, height: 8, overflow: "hidden", border: "1px solid #5a4326" }}>
      <div style={{ width: pct + "%", height: "100%", background: color, transition: "width .4s ease" }} />
    </div>
  );
}

export function CharacterPanel({ c, isCurrent, isSelected, onSelect }) {
  return (
    <button
      onClick={() => onSelect(c.id)}
      disabled={!c.alive}
      style={{
        textAlign: "left",
        width: "100%",
        background: isSelected ? "#4a3620" : "#2e2216",
        border: isCurrent ? "1.5px solid #c9a227" : "1px solid #5a4326",
        borderRadius: 8,
        padding: "8px 10px",
        marginBottom: 8,
        cursor: c.alive ? "pointer" : "default",
        opacity: c.alive ? 1 : 0.45,
        boxShadow: isCurrent ? "0 0 10px rgba(201,162,39,0.35)" : "none",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          {/* Resolve visual asset if registered; fall back to icon placeholder. */}
          {resolveAsset(`character.${c.defId}`)
            ? <img src={resolveAsset(`character.${c.defId}`).src} alt={resolveAsset(`character.${c.defId}`).alt ?? c.name} width={14} height={14} style={{ objectFit: "cover", borderRadius: 2, flexShrink: 0 }} />
            : <ClassIcon icon={c.icon} size={14} className="" />
          }
          <span style={{ fontFamily: "Cinzel, serif", fontSize: 13, color: "#e8dcc0", letterSpacing: 0.3 }}>
            {c.name}
          </span>
          {isCurrent && (
            <span style={{
              fontFamily: "Cinzel, serif",
              fontSize: 8,
              letterSpacing: 0.8,
              background: "#c9a227",
              color: "#241a12",
              padding: "1px 5px",
              borderRadius: 2,
              lineHeight: 1.5,
              verticalAlign: "middle",
            }}>ACTING</span>
          )}
        </div>
        <span style={{ fontFamily: "'EB Garamond', serif", fontSize: 11, color: "#a89468" }}>{c.cls}</span>
      </div>
      <div style={{ marginTop: 6, fontFamily: "'EB Garamond', serif", fontSize: 11, color: "#c9bd9e" }}>
        HP {c.hp}/{c.maxHp}
      </div>
      <HpBar hp={c.hp} maxHp={c.maxHp} />
      <div style={{ marginTop: 4, fontFamily: "'EB Garamond', serif", fontSize: 10.5, color: "#8a795a", display: "flex", justifyContent: "space-between" }}>
        <span>
          <Footprints size={10} style={{ verticalAlign: -1, marginRight: 3 }} />
          {c.moveRemaining}/{c.moveMax}
        </span>
        <span>AC {getEffectiveArmorClass(c.ac, c.equipment, c.hp, c.maxHp)}</span>
        <span>{c.actionUsed ? "Action used" : "Action ready"}</span>
      </div>
      <div aria-hidden="true" style={{ marginTop: 5, fontSize: 10.5, color: "#9f8d68", lineHeight: 1.35 }}>
        <div>Weapon: {getEquipmentDefinition(c.equipment.weaponId)?.name ?? c.weapon.name}</div>
        <div>
          Armor: {c.equipment.armorId ? getEquipmentDefinition(c.equipment.armorId)?.name : "None"}
          {" · "}Accessory: {c.equipment.accessoryId ? getEquipmentDefinition(c.equipment.accessoryId)?.name : "None"}
        </div>
        <div>
          Consumables: Healing Potion ×{c.equipment.consumables.healingPotion ?? 0}
          {" · "}Move {c.moveRemaining}/{getEffectiveMoveMax(c.moveMax, c.equipment)}
        </div>
      </div>
    </button>
  );
}

// Shared style factory for action buttons in the left panel.
export function actionBtnStyle(active) {
  return {
    flex: 1,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 5,
    fontFamily: "Cinzel, serif",
    fontSize: 11.5,
    padding: "8px 0",
    borderRadius: 7,
    border: "1px solid #5a4326",
    background: active ? "#c9a227" : "transparent",
    color: active ? "#241a12" : "#c9bd9e",
    cursor: "pointer",
  };
}
