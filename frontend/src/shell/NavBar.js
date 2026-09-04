import React, { useState } from "react";
import { NavLink, Link } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import {
  Dices,
  Compass,
  Library,
  Clock,
  Users,
  Settings,
  Menu,
  X,
} from "lucide-react";
import { usePlatform } from "../platform/PlatformProvider";
import { Avatar, cn } from "../ui/kit";

const LINKS = [
  { to: "/", label: "Lounge", icon: Compass, end: true },
  { to: "/library", label: "Game Library", icon: Library },
  { to: "/sessions", label: "Sessions", icon: Clock },
  { to: "/players", label: "Players", icon: Users },
  { to: "/settings", label: "Settings", icon: Settings },
];

function NavItem({ to, label, icon: Icon, end, onClick }) {
  return (
    <NavLink
      to={to}
      end={end}
      onClick={onClick}
      data-testid={`nav-${label.toLowerCase().replace(/\s+/g, "-")}-link`}
      className={({ isActive }) =>
        cn(
          "flex items-center gap-2 rounded-full px-4 py-2 font-ui text-sm font-medium transition-colors duration-200",
          isActive
            ? "bg-[var(--primary-amber-glow)] text-amber"
            : "text-muted hover:text-maintext hover:bg-white/5"
        )
      }
    >
      <Icon className="h-4 w-4" />
      {label}
    </NavLink>
  );
}

export default function NavBar() {
  const { players, activeSeats, sessions } = usePlatform();
  const [open, setOpen] = useState(false);
  const activePlayers = players.filter((p) => activeSeats.includes(p.id));
  const liveSessions = sessions.filter((s) => s.status !== "completed");

  return (
    <header
      className="sticky top-0 z-50 border-b border-subtle backdrop-blur-md"
      style={{ background: "var(--shell-chrome-bg)" }}
    >
      <div className="mx-auto flex h-[72px] max-w-7xl items-center justify-between px-4 sm:px-8">
        <Link
          to="/"
          data-testid="brand-logo"
          className="flex items-center gap-3"
        >
          <span className="flex h-10 w-10 items-center justify-center rounded-xl border border-medium bg-[var(--primary-amber-glow)]">
            <Dices className="h-6 w-6 text-amber" />
          </span>
          <span className="hidden font-display text-xl font-bold tracking-tight text-maintext sm:block">
            Tabletop<span className="text-amber">Lounge</span>
          </span>
        </Link>

        <nav className="hidden items-center gap-1 lg:flex">
          {LINKS.map((l) => (
            <NavItem key={l.to} {...l} />
          ))}
        </nav>

        <div className="flex items-center gap-3">
          {liveSessions.length > 0 && (
            <Link
              to="/sessions"
              data-testid="active-session-indicator"
              className="hidden items-center gap-2 rounded-full border border-subtle bg-black/30 px-3 py-1.5 text-xs font-ui text-muted transition-colors hover:text-maintext sm:flex"
            >
              <span className="h-2 w-2 animate-pulse rounded-full bg-emerald" />
              {liveSessions.length} active
            </Link>
          )}
          <Link
            to="/players"
            data-testid="player-party-badge"
            className="flex items-center -space-x-2"
          >
            {activePlayers.slice(0, 3).map((p) => (
              <Avatar key={p.id} player={p} size={34} className="ring-2 ring-[var(--bg-base)]" />
            ))}
            {activePlayers.length === 0 && (
              <span className="rounded-full border border-dashed border-medium px-3 py-1.5 text-xs font-ui text-muted">
                Seat players
              </span>
            )}
          </Link>
          <button
            className="flex h-10 w-10 items-center justify-center rounded-full text-maintext lg:hidden"
            onClick={() => setOpen((v) => !v)}
            data-testid="mobile-menu-toggle"
          >
            {open ? <X className="h-6 w-6" /> : <Menu className="h-6 w-6" />}
          </button>
        </div>
      </div>

      <AnimatePresence>
        {open && (
          <motion.nav
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden border-t border-subtle px-4 lg:hidden"
          >
            <div className="flex flex-col gap-1 py-3">
              {LINKS.map((l) => (
                <NavItem key={l.to} {...l} onClick={() => setOpen(false)} />
              ))}
            </div>
          </motion.nav>
        )}
      </AnimatePresence>
    </header>
  );
}
