/**
 * Game registration entry point.
 *
 * This is the ONLY place individual games are wired into the platform. Adding a
 * new tabletop game = author a module implementing the contract and register it
 * here. The platform core never imports a specific game directly.
 */
import { registry } from "../platform/registry";
import valora from "./valora";
import lexiconHall from "./lexicon-hall";

let initialized = false;

export function initGames() {
  if (initialized) return registry;
  registry.registerAll([valora, lexiconHall]);
  initialized = true;
  if (registry.warnings.length) {
    // eslint-disable-next-line no-console
    console.info("[GameRegistry] warnings:", registry.warnings);
  }
  return registry;
}
