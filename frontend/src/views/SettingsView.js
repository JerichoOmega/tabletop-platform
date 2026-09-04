import React from "react";
import { toast } from "sonner";
import { Palette, Volume2, Music, Gauge, Eye, Accessibility } from "lucide-react";
import { usePlatform } from "../platform/PlatformProvider";
import { SectionLabel, Card, cn } from "../ui/kit";

const THEMES = [
  { id: "mahogany", label: "Mahogany Dark", swatch: "#e5a93c" },
  { id: "emerald", label: "Emerald Velvet", swatch: "#57c99a" },
  { id: "onyx", label: "Onyx Slate", swatch: "#8ea3c4" },
];

function Toggle({ on, onChange, testId }) {
  return (
    <button
      onClick={() => onChange(!on)}
      data-testid={testId}
      className={cn(
        "relative h-7 w-12 rounded-full transition-colors duration-200",
        on ? "bg-amber" : "bg-white/10"
      )}
    >
      <span
        className={cn(
          "absolute top-1 h-5 w-5 rounded-full bg-[var(--bg-base)] transition-[left] duration-200",
          on ? "left-6" : "left-1"
        )}
      />
    </button>
  );
}

function Row({ icon: Icon, title, desc, children }) {
  return (
    <div className="flex items-center justify-between gap-6 border-b border-subtle py-5 last:border-0">
      <div className="flex items-start gap-3">
        <Icon className="mt-0.5 h-5 w-5 text-amber" />
        <div>
          <p className="font-ui text-sm text-maintext">{title}</p>
          {desc && <p className="text-xs text-dim">{desc}</p>}
        </div>
      </div>
      <div className="flex-shrink-0">{children}</div>
    </div>
  );
}

export default function SettingsView() {
  const { settings, saveSettings } = usePlatform();

  const set = (partial) => saveSettings(partial);

  return (
    <div className="space-y-8">
      <div>
        <SectionLabel>Preferences</SectionLabel>
        <h1 className="mt-2 font-display text-3xl font-bold tracking-tight text-maintext sm:text-4xl">
          Settings
        </h1>
        <p className="mt-2 max-w-xl text-muted">
          Platform-wide preferences. These persist across the lounge and every game.
        </p>
      </div>

      <Card className="p-6">
        <SectionLabel>Appearance</SectionLabel>
        <Row icon={Palette} title="Theme" desc="Warm lounge color scheme">
          <div className="flex gap-2">
            {THEMES.map((t) => (
              <button
                key={t.id}
                onClick={() => {
                  set({ theme: t.id });
                  toast.success(`${t.label} applied`);
                }}
                data-testid={`theme-${t.id}`}
                className={cn(
                  "flex items-center gap-2 rounded-full border px-3 py-2 font-ui text-xs transition-colors",
                  settings.theme === t.id
                    ? "border-strong bg-white/5 text-maintext"
                    : "border-subtle text-muted hover:border-medium"
                )}
              >
                <span className="h-3 w-3 rounded-full" style={{ background: t.swatch }} />
                {t.label}
              </button>
            ))}
          </div>
        </Row>
      </Card>

      <Card className="p-6">
        <SectionLabel>Audio</SectionLabel>
        <Row icon={Volume2} title="Sound effects" desc={`${Math.round(settings.sfx_volume * 100)}%`}>
          <input
            type="range" min="0" max="1" step="0.05"
            value={settings.sfx_volume}
            onChange={(e) => set({ sfx_volume: parseFloat(e.target.value) })}
            data-testid="sfx-volume-slider"
            className="w-40 accent-[var(--primary-amber)]"
          />
        </Row>
        <Row icon={Music} title="Ambient music" desc={`${Math.round(settings.music_volume * 100)}%`}>
          <input
            type="range" min="0" max="1" step="0.05"
            value={settings.music_volume}
            onChange={(e) => set({ music_volume: parseFloat(e.target.value) })}
            data-testid="music-volume-slider"
            className="w-40 accent-[var(--primary-amber)]"
          />
        </Row>
      </Card>

      <Card className="p-6">
        <SectionLabel>Motion & Accessibility</SectionLabel>
        <Row icon={Gauge} title="Animation speed">
          <div className="flex gap-2">
            {["slow", "normal", "fast"].map((sp) => (
              <button
                key={sp}
                onClick={() => set({ animation_speed: sp })}
                data-testid={`anim-${sp}`}
                className={cn(
                  "rounded-full border px-3 py-1.5 font-ui text-xs capitalize transition-colors",
                  settings.animation_speed === sp
                    ? "border-strong bg-white/5 text-maintext"
                    : "border-subtle text-muted hover:border-medium"
                )}
              >
                {sp}
              </button>
            ))}
          </div>
        </Row>
        <Row icon={Accessibility} title="Reduced motion" desc="Minimize animations">
          <Toggle
            on={settings.reduced_motion}
            onChange={(v) => set({ reduced_motion: v })}
            testId="reduced-motion-toggle"
          />
        </Row>
        <Row icon={Eye} title="High contrast text" desc="Boost text legibility">
          <Toggle
            on={settings.high_contrast}
            onChange={(v) => set({ high_contrast: v })}
            testId="high-contrast-toggle"
          />
        </Row>
      </Card>
    </div>
  );
}
