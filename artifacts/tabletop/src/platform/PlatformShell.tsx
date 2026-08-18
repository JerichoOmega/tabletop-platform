// ─────────────────────────────────────────────────────────────────────────
// Platform shell (M5) — the game-agnostic entry surface.
//
// Owns: global navigation, Experience discovery entry points, current
// Experience selection, platform-level layout.
// Does NOT own: rules, gameplay state, game-specific UI (those live inside
// the mounted Experience component).
//
// M5 scope: PLAY lists registered Experiences; all other destinations are
// explicit future-functionality placeholders. No fake content of any kind.
// Visual language: dark oak / parchment / aged gold per
// docs/PLATFORM_EXPERIENCE_PHILOSOPHY.md — intentionally restrained; the
// full Discover design is a later milestone.
// ─────────────────────────────────────────────────────────────────────────

import { useCallback, useEffect, useMemo, useReducer } from "react";

import { ErrorBoundary, type ErrorFallbackProps } from "@/components/error-boundary";
import { ExperiencePlatformProvider } from "./experiences/platformContext";
import { experienceRegistry } from "./experiences/registry";
import {
  applyShellStateToSearch,
  FUTURE_DESTINATIONS,
  INITIAL_SHELL_STATE,
  parseShellState,
  PLATFORM_DESTINATIONS,
  shellReducer,
  type PlatformDestination,
  type ShellAction,
  type ShellState,
} from "./shellState";

const DESTINATION_LABELS: Record<PlatformDestination, string> = {
  play: "Play",
  browse: "Browse",
  library: "Library",
  create: "Create",
  profile: "Profile",
  settings: "Settings",
};

const SHELL_STYLES = `
  .pf-shell { min-height: 100vh; display: flex; flex-direction: column;
    background: linear-gradient(180deg, #211711 0%, #17100b 100%); color: #e8dcc3;
    font-family: Georgia, 'Times New Roman', serif; }
  .pf-header { display: flex; align-items: center; gap: 24px; flex-wrap: wrap;
    padding: 14px 22px; border-bottom: 1px solid #4a3521;
    background: rgba(24, 16, 10, 0.85); }
  .pf-brand { font-size: 18px; letter-spacing: 0.14em; color: #d9b661;
    text-transform: uppercase; margin: 0; }
  .pf-nav { display: flex; gap: 6px; flex-wrap: wrap; }
  .pf-nav button { background: none; border: 1px solid transparent; color: #cbbb98;
    font: inherit; font-size: 14px; letter-spacing: 0.08em; text-transform: uppercase;
    padding: 6px 14px; border-radius: 4px; cursor: pointer; }
  .pf-nav button:hover { color: #e8dcc3; border-color: #4a3521; }
  .pf-nav button[aria-current="page"] { color: #17100b; background: #d9b661;
    border-color: #d9b661; }
  .pf-nav button:focus-visible { outline: 2px solid #d9b661; outline-offset: 2px; }
  .pf-main { flex: 1; padding: 32px 22px; max-width: 1080px; width: 100%;
    margin: 0 auto; box-sizing: border-box; }
  .pf-main h2 { color: #d9b661; font-weight: normal; letter-spacing: 0.04em; }
  .pf-future { border: 1px dashed #4a3521; border-radius: 6px; padding: 28px;
    color: #a5916c; max-width: 560px; }
  .pf-exp-list { list-style: none; padding: 0; display: flex; flex-wrap: wrap; gap: 18px; }
  .pf-exp-card { border: 1px solid #4a3521; border-radius: 8px; padding: 20px;
    width: 300px; background: rgba(35, 24, 15, 0.75); display: flex;
    flex-direction: column; gap: 10px; }
  .pf-exp-card h3 { margin: 0; color: #e8dcc3; font-weight: normal; font-size: 20px; }
  .pf-exp-type { font-size: 12px; letter-spacing: 0.12em; text-transform: uppercase;
    color: #a5916c; }
  .pf-exp-card p { margin: 0; font-size: 14px; line-height: 1.5; color: #cbbb98; }
  .pf-exp-card button { align-self: flex-start; margin-top: 6px; font: inherit;
    font-size: 14px; letter-spacing: 0.08em; text-transform: uppercase;
    background: #d9b661; color: #17100b; border: none; border-radius: 4px;
    padding: 8px 20px; cursor: pointer; }
  .pf-exp-card button:hover { background: #e8c97e; }
  .pf-exp-card button:focus-visible { outline: 2px solid #e8dcc3; outline-offset: 2px; }
  .pf-exit-bar { display: flex; align-items: center; gap: 12px; padding: 4px 10px;
    background: #17100b; border-bottom: 1px solid #4a3521; }
  .pf-exit-bar span { font-size: 12px; letter-spacing: 0.12em; text-transform: uppercase;
    color: #a5916c; font-family: Georgia, serif; }
  .pf-exit-bar button { font-size: 12px; letter-spacing: 0.08em; text-transform: uppercase;
    background: none; border: 1px solid #4a3521; color: #cbbb98; border-radius: 4px;
    padding: 3px 10px; cursor: pointer; font-family: Georgia, serif; }
  .pf-exit-bar button:hover { color: #e8dcc3; border-color: #d9b661; }
`;

function useShell(): [ShellState, (action: ShellAction) => void] {
  const [state, rawDispatch] = useReducer(
    (s: ShellState, a: ShellAction) => shellReducer(s, a, experienceRegistry),
    INITIAL_SHELL_STATE,
    () => parseShellState(window.location.search, experienceRegistry),
  );

  // Keep the URL in sync (replaceState — platform navigation is not intended
  // to build deep history stacks in M5), preserving unrelated params (?e2e).
  useEffect(() => {
    const next = applyShellStateToSearch(window.location.search, state);
    if (next !== window.location.search) {
      window.history.replaceState(null, "", `${window.location.pathname}${next}`);
    }
  }, [state]);

  return [state, rawDispatch];
}

function ExperienceFailureFallback({
  resetError,
  onReturn,
}: ErrorFallbackProps & { onReturn: () => void }) {
  return (
    <div className="pf-main" data-testid="experience-launch-failure">
      <h2>This experience could not be started</h2>
      <div className="pf-future">
        Something went wrong inside the game. The Intelligent Tabletop platform
        is still running.
      </div>
      <p>
        <button
          type="button"
          data-testid="experience-failure-return"
          onClick={() => {
            resetError();
            onReturn();
          }}
          style={{ font: "inherit", padding: "8px 20px", cursor: "pointer" }}
        >
          Return to platform
        </button>
      </p>
    </div>
  );
}

export default function PlatformShell() {
  const [state, dispatch] = useShell();
  const experiences = useMemo(() => experienceRegistry.list(), []);
  const exitExperience = useCallback(() => dispatch({ type: "exitExperience" }), [dispatch]);
  const fallback = useCallback(
    (props: ErrorFallbackProps) => (
      <ExperienceFailureFallback {...props} onReturn={exitExperience} />
    ),
    [exitExperience],
  );
  const active =
    state.activeExperienceId !== null
      ? experienceRegistry.get(state.activeExperienceId)
      : undefined;

  if (active) {
    const ActiveComponent = active.Component;
    return (
      <div data-testid="platform-experience-frame">
        <style>{SHELL_STYLES}</style>
        <div className="pf-exit-bar">
          <button
            type="button"
            data-testid="platform-exit"
            onClick={() => dispatch({ type: "exitExperience" })}
          >
            ◂ Intelligent Tabletop
          </button>
          <span data-testid="platform-active-experience">{active.title}</span>
        </div>
        {/* Launch/runtime failure boundary (M6): an Experience crash must
            never take down the platform shell — the fallback returns the
            player to the platform. resetKey clears the error on exit. */}
        <ErrorBoundary resetKey={active.id} FallbackComponent={fallback}>
          <ExperiencePlatformProvider
            value={{
              experienceId: active.id,
              experienceVersion: active.version,
              requestExit: exitExperience,
            }}
          >
            <ActiveComponent />
          </ExperiencePlatformProvider>
        </ErrorBoundary>
      </div>
    );
  }

  return (
    <div className="pf-shell" data-testid="platform-shell">
      <style>{SHELL_STYLES}</style>
      <header className="pf-header">
        <h1 className="pf-brand">Intelligent Tabletop</h1>
        <nav className="pf-nav" aria-label="Platform">
          {PLATFORM_DESTINATIONS.map((dest) => (
            <button
              key={dest}
              type="button"
              data-testid={`platform-nav-${dest}`}
              aria-current={state.destination === dest ? "page" : undefined}
              onClick={() => dispatch({ type: "navigate", destination: dest })}
            >
              {DESTINATION_LABELS[dest]}
            </button>
          ))}
        </nav>
      </header>
      <main className="pf-main" data-testid={`platform-view-${state.destination}`}>
        {state.destination === "play" ? (
          <>
            <h2>Play</h2>
            <ul className="pf-exp-list">
              {experiences.map((exp) => (
                <li key={exp.id} className="pf-exp-card" data-testid={`experience-card-${exp.id}`}>
                  <span className="pf-exp-type">{exp.gameType}</span>
                  <h3>{exp.title}</h3>
                  {exp.description ? <p>{exp.description}</p> : null}
                  <button
                    type="button"
                    data-testid={`experience-enter-${exp.id}`}
                    onClick={() => dispatch({ type: "enterExperience", id: exp.id })}
                  >
                    Play
                  </button>
                </li>
              ))}
            </ul>
          </>
        ) : (
          <>
            <h2>{DESTINATION_LABELS[state.destination]}</h2>
            <div className="pf-future" data-testid="platform-future-notice">
              {FUTURE_DESTINATIONS.includes(state.destination)
                ? `${DESTINATION_LABELS[state.destination]} is part of the Intelligent Tabletop platform design and will arrive in a future milestone.`
                : null}
            </div>
          </>
        )}
      </main>
    </div>
  );
}
