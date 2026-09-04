import React from "react";
import { clsx } from "clsx";
import {
  Shield,
  Swords,
  Crown,
  Puzzle,
  Dices,
  Gamepad2,
  Sparkles,
  Compass,
} from "lucide-react";

export const cn = (...a) => clsx(...a);

/* ------------------------------------------------------------------ Button */
const BTN_VARIANTS = {
  primary:
    "bg-[var(--primary-amber)] text-[#1a1411] hover:bg-[var(--primary-amber-hover)] shadow-glow font-semibold",
  ghost:
    "bg-transparent text-maintext border border-medium hover:border-strong hover:bg-white/5",
  subtle: "bg-white/5 text-maintext hover:bg-white/10 border border-subtle",
  danger:
    "bg-transparent text-crimson border border-crimson/40 hover:bg-crimson/10",
};

export function Button({
  variant = "primary",
  className,
  children,
  as: Tag = "button",
  ...props
}) {
  return (
    <Tag
      className={cn(
        "inline-flex items-center justify-center gap-2 rounded-full px-5 py-2.5 font-ui text-sm",
        "transition-[background-color,border-color,color,box-shadow,transform] duration-200",
        "active:scale-[0.97] disabled:opacity-40 disabled:pointer-events-none cursor-pointer select-none",
        BTN_VARIANTS[variant],
        className
      )}
      {...props}
    >
      {children}
    </Tag>
  );
}

/* -------------------------------------------------------------------- Card */
export function Card({ className, children, hover = false, ...props }) {
  return (
    <div
      className={cn(
        "rounded-2xl bg-card border border-subtle shadow-lounge",
        hover &&
          "transition-[transform,border-color,box-shadow] duration-300 hover:-translate-y-1 hover:border-medium",
        className
      )}
      {...props}
    >
      {children}
    </div>
  );
}

/* ------------------------------------------------------------------- Label */
export function SectionLabel({ children, className }) {
  return (
    <span
      className={cn(
        "text-xs font-ui font-semibold uppercase tracking-[0.18em] text-amber",
        className
      )}
    >
      {children}
    </span>
  );
}

/* ------------------------------------------------------------------- Badge */
export function Badge({ children, className, tone = "neutral" }) {
  const tones = {
    neutral: "bg-white/5 text-muted border-subtle",
    amber: "bg-[var(--primary-amber-glow)] text-amber border-medium",
  };
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-ui font-medium",
        tones[tone],
        className
      )}
    >
      {children}
    </span>
  );
}

/* -------------------------------------------------------------- StatusPill */
export function StatusPill({ status }) {
  const map = {
    available: { label: "Available", dot: "var(--secondary-emerald)" },
    beta: { label: "Beta", dot: "var(--primary-amber)" },
    coming_soon: { label: "Coming Soon", dot: "var(--secondary-sapphire)" },
  };
  const s = map[status] || map.coming_soon;
  return (
    <span className="inline-flex items-center gap-2 rounded-full border border-subtle bg-black/30 px-3 py-1 text-xs font-ui font-medium text-maintext">
      <span
        className="h-2 w-2 rounded-full"
        style={{ background: s.dot, boxShadow: `0 0 8px ${s.dot}` }}
      />
      {s.label}
    </span>
  );
}

/* ------------------------------------------------------------- EmptyState */
export function EmptyState({ icon: Icon = Sparkles, title, description, action }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-subtle bg-surface1/40 px-6 py-16 text-center">
      <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-[var(--primary-amber-glow)]">
        <Icon className="h-7 w-7 text-amber" />
      </div>
      <h3 className="font-display text-xl text-maintext">{title}</h3>
      {description && (
        <p className="mt-2 max-w-sm text-sm text-muted">{description}</p>
      )}
      {action && <div className="mt-6">{action}</div>}
    </div>
  );
}

/* ------------------------------------------------------------------ Avatar */
export const AVATAR_PRESETS = [
  { id: "seat-1", icon: Shield },
  { id: "seat-2", icon: Swords },
  { id: "seat-3", icon: Crown },
  { id: "seat-4", icon: Puzzle },
  { id: "seat-5", icon: Dices },
  { id: "seat-6", icon: Compass },
];

export function Avatar({ player, size = 44, className }) {
  const preset =
    AVATAR_PRESETS.find((p) => p.id === player?.avatar) || AVATAR_PRESETS[0];
  const Icon = preset.icon;
  const color = player?.color || "var(--primary-amber)";
  return (
    <span
      className={cn(
        "inline-flex items-center justify-center rounded-full border",
        className
      )}
      style={{
        width: size,
        height: size,
        background: `${color}22`,
        borderColor: `${color}66`,
      }}
      title={player?.name}
    >
      <Icon style={{ color, width: size * 0.5, height: size * 0.5 }} />
    </span>
  );
}

export const GAME_ICON = Gamepad2;
