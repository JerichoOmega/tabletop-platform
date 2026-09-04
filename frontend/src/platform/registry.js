/**
 * GameRegistry - the platform's game catalog.
 *
 * Games register themselves here. The platform core discovers and loads games
 * exclusively through this registry, never by importing a specific game.
 */
import { validateGameModule } from "./contract";

class GameRegistry {
  constructor() {
    this._games = new Map();
    this._warnings = [];
  }

  register(mod) {
    const warnings = validateGameModule(mod);
    if (this._games.has(mod.id))
      throw new Error(`Game already registered: ${mod.id}`);
    this._games.set(mod.id, mod);
    this._warnings.push(...warnings);
    return this;
  }

  registerAll(mods) {
    mods.forEach((m) => this.register(m));
    return this;
  }

  get(id) {
    return this._games.get(id) || null;
  }

  has(id) {
    return this._games.has(id);
  }

  all() {
    return Array.from(this._games.values());
  }

  byStatus(status) {
    return this.all().filter((g) => g.status === status);
  }

  get warnings() {
    return this._warnings;
  }
}

export const registry = new GameRegistry();
