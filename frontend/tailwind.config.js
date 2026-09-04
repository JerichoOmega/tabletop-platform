/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./src/**/*.{js,jsx}", "./public/index.html"],
  theme: {
    extend: {
      colors: {
        base: "var(--bg-base)",
        surface1: "var(--bg-surface-1)",
        surface2: "var(--bg-surface-2)",
        card: "var(--bg-surface-card)",
        amber: {
          DEFAULT: "var(--primary-amber)",
          hover: "var(--primary-amber-hover)",
        },
        gold: "var(--accent-gold)",
        emerald: "var(--secondary-emerald)",
        crimson: "var(--secondary-crimson)",
        sapphire: "var(--secondary-sapphire)",
        maintext: "var(--text-main)",
        muted: "var(--text-muted)",
        dim: "var(--text-dim)",
      },
      fontFamily: {
        display: ["Cinzel", "Playfair Display", "serif"],
        ui: ["Outfit", "sans-serif"],
        body: ["'DM Sans'", "sans-serif"],
        mono: ["'JetBrains Mono'", "monospace"],
      },
      borderColor: {
        subtle: "var(--border-subtle)",
        medium: "var(--border-medium)",
        strong: "var(--border-strong)",
      },
      boxShadow: {
        lounge: "0 20px 60px -20px rgba(0,0,0,0.7)",
        glow: "0 0 40px -8px var(--primary-amber-glow)",
      },
      keyframes: {
        "fade-up": {
          "0%": { opacity: "0", transform: "translateY(16px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        shimmer: {
          "0%": { backgroundPosition: "-200% 0" },
          "100%": { backgroundPosition: "200% 0" },
        },
      },
      animation: {
        "fade-up": "fade-up 0.5s cubic-bezier(0.22,1,0.36,1) both",
        shimmer: "shimmer 3s linear infinite",
      },
    },
  },
  plugins: [],
};
