import {
  coerceOptionValue,
  snes9xOption,
  SNES9X_ENGINE_OPTIONS,
  type Snes9xOptionKey,
  type Snes9xOptionValue,
} from './snes9x.options.js';

/**
 * Pushes a value into the running emulator: a `Settings` write through the
 * shim, a canvas style change, a gain node — whatever that option means.
 * Called after the value has been validated and recorded.
 */
export type Snes9xApplier = (value: Snes9xOptionValue) => void;

/**
 * The appliers the SDK installs for the build it actually loaded. An option
 * with no applier is reported as unsupported and disappears from the menu,
 * which is what keeps this package usable against a `snes9x.wasm` built before
 * a given shim setter existed.
 */
export type Snes9xAppliers = Partial<Record<Snes9xOptionKey, Snes9xApplier>>;

/**
 * Typed façade over the emulator's live settings.
 *
 * Snes9x has no configuration object to hand out — the core reads a global
 * `Settings` struct and the SDK keeps the rest (canvas, audio graph) on the JS
 * side — so `state` is the record both this façade and the running SDK read
 * from, and every write goes through the matching applier.
 */
export interface Snes9xConfig {
  supports(key: string): boolean;
  read(key: string): Snes9xOptionValue | undefined;
  /** Returns `false` when the key is unknown, unsupported, or the value invalid. */
  write(key: string, value: Snes9xOptionValue): boolean;
  /** Current value of every supported option. */
  values(): Record<string, Snes9xOptionValue>;
  /** Restores this package's declared defaults. */
  restoreDefaults(): void;
}

export function bindConfig(
  state: Record<string, Snes9xOptionValue>,
  appliers: Snes9xAppliers,
): Snes9xConfig {
  const applierFor = (key: string): Snes9xApplier | undefined =>
    appliers[key as Snes9xOptionKey];

  const supports = (key: string): boolean =>
    Boolean(snes9xOption(key)) && applierFor(key) !== undefined;

  const read = (key: string): Snes9xOptionValue | undefined =>
    snes9xOption(key) ? state[key] : undefined;

  const write = (key: string, value: Snes9xOptionValue): boolean => {
    const option = snes9xOption(key);
    const apply = applierFor(key);
    if (!option || !apply) return false;

    const next = coerceOptionValue(option, value);
    if (next === undefined) return false;

    state[key] = next;
    apply(next);
    return true;
  };

  return {
    supports,
    read,
    write,
    values() {
      const snapshot: Record<string, Snes9xOptionValue> = {};
      for (const option of SNES9X_ENGINE_OPTIONS) {
        if (supports(option.key)) snapshot[option.key] = state[option.key];
      }
      return snapshot;
    },
    restoreDefaults() {
      for (const option of SNES9X_ENGINE_OPTIONS) {
        write(option.key, option.default);
      }
    },
  };
}

/** Per-namespace persistence for menu tweaks, so they survive a page reload. */
export interface Snes9xSettingsStore {
  load(): Record<string, Snes9xOptionValue>;
  save(values: Record<string, Snes9xOptionValue>): void;
  clear(): void;
}

export function createSettingsStore(namespace: string): Snes9xSettingsStore {
  const storageKey = `snes9x:options:${namespace}`;

  // Storage access throws outright in some privacy modes, so every call is
  // guarded — losing persistence must never take the emulator down with it.
  const storage = (): Storage | null => {
    try {
      return typeof localStorage === 'undefined' ? null : localStorage;
    } catch {
      return null;
    }
  };

  return {
    load() {
      try {
        const raw = storage()?.getItem(storageKey);
        if (!raw) return {};
        const parsed: unknown = JSON.parse(raw);
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};

        // Anything the catalog no longer recognizes is dropped rather than fed
        // back into the core: this is user-writable storage.
        const values: Record<string, Snes9xOptionValue> = {};
        for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
          const option = snes9xOption(key);
          if (!option) continue;
          const coerced = coerceOptionValue(option, value);
          if (coerced !== undefined) values[key] = coerced;
        }
        return values;
      } catch {
        return {};
      }
    },
    save(values) {
      try {
        storage()?.setItem(storageKey, JSON.stringify(values));
      } catch {
        // persistence is best-effort
      }
    },
    clear() {
      try {
        storage()?.removeItem(storageKey);
      } catch {
        // persistence is best-effort
      }
    },
  };
}
