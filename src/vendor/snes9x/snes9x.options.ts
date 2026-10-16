import type { JSONSchema } from '@wasm-gaming/engine-specs';

/**
 * Video standard. `auto` trusts the region byte in the cartridge header,
 * which is right for virtually every commercial release; the forced modes
 * exist for hacks and homebrew with a wrong or missing header.
 */
export type Snes9xRegion = 'auto' | 'ntsc' | 'pal';

/** DSP sample interpolation (DSP_INTERPOLATION_* in apu/apu.h). */
export type Snes9xInterpolation = 'none' | 'linear' | 'gaussian' | 'cubic' | 'sinc';

export type Snes9xLogLevel = 'off' | 'error' | 'debug';

export interface Snes9xOptions {
  /** Video standard: auto (from the ROM header), or forced NTSC/PAL. */
  region?: Snes9xRegion;
  /**
   * DSP interpolation. `gaussian` is what the real SNES DSP does and the
   * upstream default; the others trade accuracy for sharpness.
   */
  interpolation?: Snes9xInterpolation;
  /** Canvas scaling filter: `pixelated` for crisp pixels, `smooth` for linear. */
  renderFilter?: 'pixelated' | 'smooth';
  /**
   * Crop the overscan area. The SNES outputs 224 (or 239) lines; many games
   * leave garbage in the extra rows, so cropping to 224 is the common choice.
   */
  cropOverscan?: boolean;
  /**
   * Aspect ratio to present. `4:3` matches a CRT; `1:1` shows square pixels
   * (8:7 for the 256-wide modes), which some players prefer for pixel art.
   */
  aspect?: '4:3' | '1:1';
  /**
   * Emulate the 5-player Multitap in controller port 2, giving pads 2-5.
   * Only a handful of games support it (Bomberman, Micro Machines...).
   */
  multitap?: boolean;
  /**
   * Sprites drawn per scanline. Real hardware drops sprites past 34 tiles;
   * raising it removes flicker at the cost of accuracy.
   */
  maxSpriteTilesPerLine?: number;
  /**
   * Super FX clock as a percentage of stock. Above 100 speeds up the games
   * that use it (Star Fox, Yoshi's Island); it is a hack, not accuracy.
   */
  superFXClockMultiplier?: number;
  /** Master audio volume, 0.0–1.0. */
  volume?: number;
  /** Poll connected gamepads (standard mapping) each frame. */
  gamepads?: boolean;
  /**
   * Core messages printed to the console. `error` shows the core's own
   * error/warning messages; `debug` adds its informational ones.
   */
  logLevel?: Snes9xLogLevel;
  /** Show the built-in in-game settings menu on ESC. Defaults to `true`. */
  escMenu?: boolean;
}

export const DEFAULT_SNES9X_OPTIONS: Required<Snes9xOptions> = {
  region: 'auto',
  interpolation: 'gaussian',
  renderFilter: 'pixelated',
  cropOverscan: true,
  aspect: '4:3',
  multitap: false,
  maxSpriteTilesPerLine: 34,
  superFXClockMultiplier: 100,
  volume: 1.0,
  gamepads: true,
  logLevel: 'error',
  escMenu: true,
};

/** Numeric ids consumed by s9xwasm_setup() in scripts/shim/s9x_shim.cpp. */
export const SNES9X_REGION_IDS: Record<Snes9xRegion, number> = {
  auto: 0,
  ntsc: 1,
  pal: 2,
};

/** Numeric ids matching DSP_INTERPOLATION_* in apu/apu.h. */
export const SNES9X_INTERPOLATION_IDS: Record<Snes9xInterpolation, number> = {
  none: 0,
  linear: 1,
  gaussian: 2,
  cubic: 3,
  sinc: 4,
};

export const SNES9X_LOG_LEVEL_IDS: Record<Snes9xLogLevel, number> = {
  off: 0,
  error: 1,
  debug: 2,
};

// --------------------------------------------------------------- catalog

/**
 * Settings the SDK can change on a running game, described once here.
 *
 * Snes9x keeps its configuration in the core's global `Settings` struct, which
 * the emulation re-reads as it runs — the DSP consults the interpolation mode
 * per sample, the PPU the sprite limit per scanline — so a plain setter is
 * enough to retune a game mid-frame. The rest (canvas filtering, aspect,
 * overscan, volume) never reaches the core at all and is applied by the SDK.
 *
 * The in-game ESC menu, `DEFAULT_SNES9X_OPTIONS` and the manifest's options
 * schema are all derived from this catalog, so adding a row here is enough to
 * expose a new setting.
 */
export type Snes9xOptionKey = Exclude<keyof Snes9xOptions, 'escMenu'>;

export type Snes9xOptionValue = boolean | string | number;

interface OptionSpecBase {
  /** Option key, as used in `EngineConfig.options` and the manifest schema. */
  key: Snes9xOptionKey;
  label: string;
  description: string;
  /**
   * Takes effect on the next power-on rather than immediately — the menu tags
   * these, and the SDK applies them from `reset()`.
   */
  requiresReset?: boolean;
}

/** One selectable value, as offered by the menu. */
export interface Snes9xChoice<T> {
  value: T;
  label: string;
}

export type Snes9xOptionSpec = OptionSpecBase &
  (
    | { type: 'boolean'; default: boolean }
    | { type: 'enum'; default: string; values: Snes9xChoice<string>[] }
    | {
        type: 'number';
        default: number;
        /** Values the menu cycles through; the schema may still take a range. */
        values: Snes9xChoice<number>[];
        integer?: boolean;
        /**
         * When set, the schema advertises this range instead of the menu's
         * choices, so hosts can pass values the menu does not offer.
         */
        range?: { minimum: number; maximum: number };
      }
  );

export interface Snes9xOptionGroup {
  id: string;
  label: string;
  options: Snes9xOptionSpec[];
}

export const SNES9X_OPTION_GROUPS: Snes9xOptionGroup[] = [
  {
    id: 'video',
    label: 'Video',
    options: [
      {
        key: 'renderFilter',
        label: 'Image filtering',
        description:
          'Scaling filter applied when the picture is stretched to the canvas. Pixelated keeps pixel art crisp; smooth softens it.',
        type: 'enum',
        default: DEFAULT_SNES9X_OPTIONS.renderFilter,
        values: [
          { value: 'pixelated', label: 'Pixelated' },
          { value: 'smooth', label: 'Smooth' },
        ],
      },
      {
        key: 'aspect',
        label: 'Aspect ratio',
        description:
          'Presented aspect ratio: 4:3 is the picture as it looked on a CRT; 1:1 shows square pixels.',
        type: 'enum',
        default: DEFAULT_SNES9X_OPTIONS.aspect,
        values: [
          { value: '4:3', label: '4:3' },
          { value: '1:1', label: '1:1' },
        ],
      },
      {
        key: 'cropOverscan',
        label: 'Crop overscan',
        description:
          'Crop the picture to 224 lines. Off shows the full 239-line output, including the rows many games leave as garbage.',
        type: 'boolean',
        default: DEFAULT_SNES9X_OPTIONS.cropOverscan,
      },
    ],
  },
  {
    id: 'audio',
    label: 'Audio',
    options: [
      {
        key: 'volume',
        label: 'Volume',
        description: 'Master audio volume.',
        type: 'number',
        default: DEFAULT_SNES9X_OPTIONS.volume,
        values: [
          { value: 0, label: 'Mute' },
          { value: 0.25, label: '25%' },
          { value: 0.5, label: '50%' },
          { value: 0.75, label: '75%' },
          { value: 1, label: '100%' },
        ],
        range: { minimum: 0, maximum: 1 },
      },
      {
        key: 'interpolation',
        label: 'DSP interpolation',
        description:
          'How the DSP resamples its 8-bit samples. Gaussian is what the real hardware does; the others trade accuracy for sharpness.',
        type: 'enum',
        default: DEFAULT_SNES9X_OPTIONS.interpolation,
        values: [
          { value: 'none', label: 'None' },
          { value: 'linear', label: 'Linear' },
          { value: 'gaussian', label: 'Gaussian' },
          { value: 'cubic', label: 'Cubic' },
          { value: 'sinc', label: 'Sinc' },
        ],
      },
    ],
  },
  {
    id: 'emulation',
    label: 'Emulation',
    options: [
      {
        key: 'region',
        label: 'Region',
        description:
          'Video standard: auto follows the cartridge header, or force NTSC (60.098Hz) / PAL (50.007Hz). The core reads it while mapping the cartridge, so the game restarts to apply it.',
        type: 'enum',
        default: DEFAULT_SNES9X_OPTIONS.region,
        requiresReset: true,
        values: [
          { value: 'auto', label: 'Auto' },
          { value: 'ntsc', label: 'NTSC' },
          { value: 'pal', label: 'PAL' },
        ],
      },
      {
        key: 'maxSpriteTilesPerLine',
        label: 'Sprite limit',
        description:
          'Sprite tiles drawn per scanline. 34 matches hardware, flicker included; 128 removes sprite dropout.',
        type: 'number',
        default: DEFAULT_SNES9X_OPTIONS.maxSpriteTilesPerLine,
        integer: true,
        values: [
          { value: 34, label: 'Hardware' },
          { value: 128, label: 'No limit' },
        ],
      },
      {
        key: 'superFXClockMultiplier',
        label: 'Super FX clock',
        description:
          'Super FX clock as a percentage of stock. Above 100 speeds up Star Fox / Yoshi’s Island; it is a hack, not accuracy.',
        type: 'number',
        default: DEFAULT_SNES9X_OPTIONS.superFXClockMultiplier,
        integer: true,
        values: [
          { value: 50, label: '50%' },
          { value: 100, label: '100%' },
          { value: 200, label: '200%' },
          { value: 400, label: '400%' },
        ],
        range: { minimum: 50, maximum: 400 },
      },
    ],
  },
  {
    id: 'controllers',
    label: 'Controllers',
    options: [
      {
        key: 'multitap',
        label: 'Multitap',
        description:
          'Emulate the 5-player Multitap in controller port 2, giving pads 2-5. Only a handful of games support it.',
        type: 'boolean',
        default: DEFAULT_SNES9X_OPTIONS.multitap,
      },
      {
        key: 'gamepads',
        label: 'Gamepads',
        description: 'Poll connected gamepads (standard mapping) each frame.',
        type: 'boolean',
        default: DEFAULT_SNES9X_OPTIONS.gamepads,
      },
    ],
  },
  {
    id: 'debug',
    label: 'Debug',
    options: [
      {
        key: 'logLevel',
        label: 'Core logging',
        description:
          'Core messages printed to the browser console: errors and warnings, or also its informational ones.',
        type: 'enum',
        default: DEFAULT_SNES9X_OPTIONS.logLevel,
        values: [
          { value: 'off', label: 'Off' },
          { value: 'error', label: 'Errors' },
          { value: 'debug', label: 'Debug' },
        ],
      },
    ],
  },
];

/** Flat view of every runtime-tweakable option across all groups. */
export const SNES9X_ENGINE_OPTIONS: Snes9xOptionSpec[] = SNES9X_OPTION_GROUPS.flatMap(
  (group) => group.options,
);

const OPTION_BY_KEY = new Map<string, Snes9xOptionSpec>(
  SNES9X_ENGINE_OPTIONS.map((option) => [option.key, option]),
);

export function snes9xOption(key: string): Snes9xOptionSpec | undefined {
  return OPTION_BY_KEY.get(key);
}

/**
 * Coerces a host- or storage-supplied value to what the option accepts,
 * returning `undefined` when it is not a value the option can take. Numbers
 * outside a `range` are clamped rather than rejected, matching how the core
 * treats them; enums are exact.
 */
export function coerceOptionValue(
  option: Snes9xOptionSpec,
  value: unknown,
): Snes9xOptionValue | undefined {
  if (option.type === 'boolean') {
    return typeof value === 'boolean' ? value : undefined;
  }

  if (option.type === 'enum') {
    const next = String(value);
    return option.values.some((choice) => choice.value === next) ? next : undefined;
  }

  const next = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(next)) return undefined;
  if (option.range) {
    return Math.min(option.range.maximum, Math.max(option.range.minimum, next));
  }
  return option.values.some((choice) => choice.value === next) ? next : undefined;
}

function schemaForOption(option: Snes9xOptionSpec): JSONSchema {
  if (option.type === 'boolean') {
    return { type: 'boolean', default: option.default, description: option.description };
  }
  if (option.type === 'enum') {
    return {
      type: 'string',
      enum: option.values.map((choice) => choice.value),
      default: option.default,
      description: option.description,
    };
  }
  return {
    type: option.integer ? 'integer' : 'number',
    default: option.default,
    ...(option.range
      ? { minimum: option.range.minimum, maximum: option.range.maximum }
      : { enum: option.values.map((choice) => choice.value) }),
    description: option.description,
  };
}

export const SNES9X_OPTIONS_SCHEMA: JSONSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    ...Object.fromEntries(
      SNES9X_ENGINE_OPTIONS.map((option) => [option.key, schemaForOption(option)]),
    ),
    escMenu: {
      type: 'boolean',
      default: true,
      description: 'Show the built-in in-game settings menu when the player presses Escape.',
    },
  },
};
