import type {
  AssetData,
  EngineConfig,
  EngineEvent,
  EngineInstance,
  InputPreset,
  KeyMap,
} from '@wasm-gaming/engine-specs';
import { manifest } from './snes9x.manifest.js';
import {
  bindConfig,
  createSettingsStore,
  type Snes9xAppliers,
  type Snes9xConfig,
} from './snes9x.config.js';
import { createMenu, type Snes9xMenu } from './snes9x.menu.js';
import {
  coerceOptionValue,
  DEFAULT_SNES9X_OPTIONS,
  SNES9X_ENGINE_OPTIONS,
  SNES9X_INTERPOLATION_IDS,
  SNES9X_LOG_LEVEL_IDS,
  SNES9X_REGION_IDS,
  type Snes9xInterpolation,
  type Snes9xLogLevel,
  type Snes9xOptions,
  type Snes9xOptionValue,
  type Snes9xRegion,
} from './snes9x.options.js';

export { manifest };

/**
 * Shape of the Emscripten module produced by scripts/build-snes9x.sh
 * (`-sMODULARIZE -sEXPORT_NAME=createSnes9xModule`, heap views exported).
 * All engine entry points are flat C exports from scripts/shim/s9x_shim.cpp —
 * no SDL, no main loop, no ASYNCIFY: the SDK drives one `_s9xwasm_exec()`
 * per emulated frame.
 */
type Snes9xModule = {
  HEAPU8: Uint8Array;
  HEAP16: Int16Array;
  _malloc(size: number): number;
  _free(ptr: number): void;
  UTF8ToString(ptr: number): string;
  _s9xwasm_set_loglevel(level: number): void;
  _s9xwasm_setup(samplerate: number, region: number, interpolation: number): number;
  _s9xwasm_set_multitap(enabled: number): void;
  _s9xwasm_load_rom(ptr: number, size: number): number;
  _s9xwasm_reset(): void;
  _s9xwasm_soft_reset(): void;
  _s9xwasm_skip_render(skip: number): void;
  _s9xwasm_exec(): number;
  _s9xwasm_audio_ptr(): number;
  _s9xwasm_audio_len(): number;
  _s9xwasm_frame_rgba(): number;
  _s9xwasm_frame_width(): number;
  _s9xwasm_frame_height(): number;
  _s9xwasm_is_pal(): number;
  _s9xwasm_framerate_micro(): number;
  _s9xwasm_input(pad: number, mask: number): void;
  _s9xwasm_set_mute(muted: number): void;
  _s9xwasm_state_size(): number;
  _s9xwasm_state_save(): number;
  _s9xwasm_state_load(ptr: number, size: number): number;
  _s9xwasm_sram_ptr(): number;
  _s9xwasm_sram_size(): number;
  _s9xwasm_read_wram?(offset: number): number;
  _s9xwasm_rom_name(): number;
  _s9xwasm_rom_size(): number;
  // Live `Settings` writes, added to the shim after the first release. They
  // are optional so an older snes9x.wasm still loads — the settings they back
  // are then reported as unsupported and drop out of the menu.
  _s9xwasm_set_interpolation?(method: number): void;
  _s9xwasm_set_sprite_tiles_per_line?(tiles: number): void;
  _s9xwasm_set_superfx_multiplier?(percent: number): void;
  _s9xwasm_set_region?(region: number): void;
};

type Snes9xModuleFactory = (
  overrides: Record<string, unknown>,
) => Promise<Snes9xModule>;

// The SNES renders 224 or 239 lines (doubled when a game turns on interlace).
// Cropping to 224 drops the rows most games leave as garbage; the offsets
// match upstream's OVERSCAN_CROP_ON handling in the libretro port.
const SNES_HEIGHT = 224;
const SNES_HEIGHT_EXTENDED = 239;

/**
 * Bit index of each control within a pad's active-high mask. Must stay in
 * sync with the BTN_* enum in scripts/shim/s9x_shim.cpp.
 */
const PAD_BITS: Record<string, number> = {
  b: 0, y: 1, select: 2, start: 3,
  up: 4, down: 5, left: 6, right: 7,
  a: 8, x: 9, l: 10, r: 11,
};

/**
 * Default keyboard bindings (KeyboardEvent.code → control). The face-button
 * layout mirrors the pad's diamond on the keyboard: X/Z on the bottom row are
 * B/Y, S/A on the row above are A/X.
 */
const DEFAULT_KEYMAP: Record<string, string> = {
  'p1.up': 'ArrowUp',
  'p1.down': 'ArrowDown',
  'p1.left': 'ArrowLeft',
  'p1.right': 'ArrowRight',
  'p1.a': 'KeyS',
  'p1.b': 'KeyX',
  'p1.x': 'KeyA',
  'p1.y': 'KeyZ',
  'p1.l': 'KeyQ',
  'p1.r': 'KeyW',
  'p1.start': 'Enter',
  'p1.select': 'ShiftRight',
  'p2.up': 'KeyI',
  'p2.down': 'KeyK',
  'p2.left': 'KeyJ',
  'p2.right': 'KeyL',
  'p2.a': 'KeyH',
  'p2.b': 'KeyN',
  'p2.x': 'KeyG',
  'p2.y': 'KeyB',
  'p2.l': 'KeyT',
  'p2.r': 'KeyY',
  'p2.start': 'Digit2',
  'p2.select': 'Digit1',
};

/** AudioWorklet processor: a simple SPSC float ring fed int16 chunks. */
const WORKLET_SOURCE = `
class Snes9xSink extends AudioWorkletProcessor {
  constructor() {
    super();
    this.cap = 32768; // frames
    this.buf = new Float32Array(this.cap * 2);
    this.r = 0;
    this.w = 0;
    this.consumed = 0;
    this.lastPost = 0;
    this.port.onmessage = (e) => {
      const s = e.data; // Int16Array, interleaved stereo
      const frames = s.length >> 1;
      for (let i = 0; i < frames; i++) {
        if (this.w - this.r >= this.cap) break; // full: drop excess
        const idx = (this.w % this.cap) * 2;
        this.buf[idx] = s[i * 2] / 32768;
        this.buf[idx + 1] = s[i * 2 + 1] / 32768;
        this.w++;
      }
    };
  }
  process(inputs, outputs) {
    const out = outputs[0];
    const L = out[0];
    const R = out[1] || out[0];
    const n = L.length;
    for (let i = 0; i < n; i++) {
      if (this.r < this.w) {
        const idx = (this.r % this.cap) * 2;
        L[i] = this.buf[idx];
        R[i] = this.buf[idx + 1];
        this.r++;
      } else {
        L[i] = 0;
        R[i] = 0;
      }
    }
    this.consumed += n;
    if (this.consumed - this.lastPost >= 1024) {
      this.port.postMessage(this.consumed);
      this.lastPost = this.consumed;
    }
    return true;
  }
}
registerProcessor('snes9x-sink', Snes9xSink);
`;

const scriptLoadCache = new Map<string, Promise<void>>();

function loadClassicScriptOnce(src: string): Promise<void> {
  const cached = scriptLoadCache.get(src);
  if (cached) return cached;

  const p = new Promise<void>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = src;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error(`snes9x: failed to load script: ${src}`));
    document.head.appendChild(script);
  });

  scriptLoadCache.set(src, p);
  return p;
}

function toUint8(x: AssetData | undefined | unknown): Uint8Array | null {
  if (x == null) return null;
  if (typeof x === 'string') return new TextEncoder().encode(x);
  if (x instanceof Uint8Array) return x;
  if (x instanceof ArrayBuffer) return new Uint8Array(x);
  if (ArrayBuffer.isView(x)) return new Uint8Array(x.buffer, x.byteOffset, x.byteLength);
  throw new TypeError('snes9x: asset must be Uint8Array | ArrayBuffer | string');
}

function resolveCanvas(config: EngineConfig): HTMLCanvasElement {
  const canvasEl = (config as { canvasEl?: HTMLCanvasElement }).canvasEl;
  if (canvasEl) return canvasEl;
  const attachTo = (config as { attachTo?: HTMLElement }).attachTo;
  if (attachTo) {
    const existing = attachTo.querySelector('canvas');
    if (existing) return existing;
    const created = document.createElement('canvas');
    attachTo.appendChild(created);
    return created;
  }
  throw new Error('snes9x: config.canvasEl or config.attachTo is required');
}

async function opfsDir(
  namespace: string,
  create: boolean,
): Promise<FileSystemDirectoryHandle | null> {
  try {
    const root = await navigator.storage.getDirectory();
    const engineDir = await root.getDirectoryHandle('snes9x', { create });
    return await engineDir.getDirectoryHandle(namespace, { create });
  } catch {
    return null;
  }
}

/** Copy bytes into the WASM heap; returns the pointer (caller frees). */
function heapAlloc(mod: Snes9xModule, bytes: Uint8Array): number {
  const ptr = mod._malloc(bytes.length);
  mod.HEAPU8.set(bytes, ptr);
  return ptr;
}

export type Snes9xInstance = EngineInstance & {
  /** Run exactly one emulated frame while paused. */
  stepFrame(): void;
  /** Resume the audio clock without starting the emulator's normal render loop. */
  resumeAudioForCapture(): Promise<void>;
  /** MediaStream carrying the emulator's generated stereo audio. */
  audioCaptureStream(): MediaStream;
  /** Apply deterministic TAS inputs to controller 1. */
  setTasInput(buttons: string[]): void;
  /** Read one byte from SNES WRAM (banks 7E:0000-7F:FFFF). */
  readWram(offset: number): number | null;
  /** Live handle on the emulator settings; writes apply to the running game. */
  config: Snes9xConfig;
  /** The in-game settings overlay, or `null` when `options.escMenu` is false. */
  menu: Snes9xMenu | null;
};

export async function load(config: EngineConfig): Promise<Snes9xInstance> {
  const { assets, onEvent } = config;

  const emit = (e: EngineEvent): void => {
    try {
      onEvent?.(e);
    } catch {
      // host callback must not break the engine runtime
    }
  };

  const romBytes = toUint8(assets?.rom ?? assets?.data);
  if (!romBytes) {
    throw new Error('snes9x: no ROM provided — pass assets.rom (a .sfc/.smc cartridge image)');
  }

  const namespace = config.storageNamespace ?? 'default';
  const settingsStore = createSettingsStore(namespace);
  const requested = (config.options ?? {}) as Record<string, unknown>;

  // This package's defaults, then the player's persisted menu tweaks, then
  // whatever the host asked for explicitly — a caller-supplied option is a
  // deliberate choice and outranks the last session.
  const opts: Required<Snes9xOptions> = { ...DEFAULT_SNES9X_OPTIONS };
  // The same object seen by key, which is what the live config writes through:
  // the loop reads `opts` every frame, so a menu change is picked up with no
  // further plumbing.
  const state = opts as unknown as Record<string, Snes9xOptionValue>;

  const persisted = settingsStore.load();
  for (const option of SNES9X_ENGINE_OPTIONS) {
    const stored = persisted[option.key];
    if (stored !== undefined) state[option.key] = stored;

    const asked = requested[option.key];
    if (asked === undefined) continue;
    const value = coerceOptionValue(option, asked);
    if (value !== undefined) state[option.key] = value;
  }
  if (typeof requested.escMenu === 'boolean') opts.escMenu = requested.escMenu;

  const canvas = resolveCanvas(config);
  canvas.style.imageRendering = opts.renderFilter === 'pixelated' ? 'pixelated' : 'auto';
  const ctx2d = canvas.getContext('2d');
  if (!ctx2d) throw new Error('snes9x: could not acquire a 2d canvas context');

  // ---------------------------------------------------------------- audio
  const audioCtx = new AudioContext();
  const sampleRate = Math.round(audioCtx.sampleRate);

  const workletUrl = URL.createObjectURL(
    new Blob([WORKLET_SOURCE], { type: 'application/javascript' }),
  );
  await audioCtx.audioWorklet.addModule(workletUrl);
  URL.revokeObjectURL(workletUrl);

  const sink = new AudioWorkletNode(audioCtx, 'snes9x-sink', {
    numberOfInputs: 0,
    numberOfOutputs: 1,
    outputChannelCount: [2],
  });
  const gain = audioCtx.createGain();
  const audioCaptureDestination = audioCtx.createMediaStreamDestination();
  gain.gain.value = Math.max(0, Math.min(1, opts.volume));
  sink.connect(gain);
  gain.connect(audioCtx.destination);
  gain.connect(audioCaptureDestination);

  let enqueuedFrames = 0;
  let consumedFrames = 0;
  sink.port.onmessage = (e: MessageEvent<number>) => {
    consumedFrames = e.data;
  };

  // --------------------------------------------------------------- module
  const jsUrl = config.jsUrl ?? new URL('./snes9x.js', import.meta.url).href;
  const wasmUrl = config.wasmUrl ?? new URL('./snes9x.wasm', jsUrl).href;

  await loadClassicScriptOnce(jsUrl);

  const g = globalThis as { createSnes9xModule?: Snes9xModuleFactory };
  if (typeof g.createSnes9xModule !== 'function') {
    throw new Error('snes9x: unable to initialize runtime module from snes9x.js');
  }
  const mod = await g.createSnes9xModule({
    locateFile(path: string): string {
      if (path.endsWith('.wasm')) return wasmUrl;
      return new URL(path, jsUrl).href;
    },
  });

  // ----------------------------------------------------------------- boot
  mod._s9xwasm_set_loglevel(SNES9X_LOG_LEVEL_IDS[opts.logLevel]);

  // The APU resamples to whatever rate it is given, so handing it the
  // AudioContext's rate means no second resampling stage in JS.
  if (
    !mod._s9xwasm_setup(
      sampleRate,
      SNES9X_REGION_IDS[opts.region],
      SNES9X_INTERPOLATION_IDS[opts.interpolation],
    )
  ) {
    throw new Error('snes9x: core initialization failed');
  }
  mod._s9xwasm_set_multitap(opts.multitap ? 1 : 0);
  // s9xwasm_setup() installs the stock values for these two, so they are only
  // hacks once the SDK writes them.
  mod._s9xwasm_set_sprite_tiles_per_line?.(opts.maxSpriteTilesPerLine);
  mod._s9xwasm_set_superfx_multiplier?.(opts.superFXClockMultiplier);

  const romPtr = heapAlloc(mod, romBytes);
  const romOk = mod._s9xwasm_load_rom(romPtr, romBytes.length);
  mod._free(romPtr);
  if (!romOk) {
    throw new Error('snes9x: ROM load failed — is this a valid .sfc/.smc cartridge image?');
  }

  // Region comes from the cartridge header, so the framerate is only known
  // once the ROM is mapped — and changes if the region is later forced.
  let framerate = mod._s9xwasm_framerate_micro() / 1e6;
  let framesPerExec = sampleRate / framerate;

  // ---------------------------------------------------------- persistence
  const persistEnabled = config.persist !== null && typeof navigator !== 'undefined';
  const sramSize = mod._s9xwasm_sram_size();

  const restoreSram = async (): Promise<void> => {
    if (!persistEnabled || !sramSize) return;
    const dir = await opfsDir(namespace, false);
    if (!dir) return;
    try {
      const handle = await dir.getFileHandle('sram.bin');
      const bytes = new Uint8Array(await (await handle.getFile()).arrayBuffer());
      if (bytes.length === sramSize) {
        mod.HEAPU8.set(bytes, mod._s9xwasm_sram_ptr());
      }
    } catch {
      // nothing saved yet for this namespace
    }
  };

  const persistSram = async (): Promise<void> => {
    if (!persistEnabled || !sramSize) return;
    const dir = await opfsDir(namespace, true);
    if (!dir) return;
    const ptr = mod._s9xwasm_sram_ptr();
    const bytes = mod.HEAPU8.slice(ptr, ptr + sramSize);
    try {
      const handle = await dir.getFileHandle('sram.bin', { create: true });
      const writable = await handle.createWritable();
      await writable.write(bytes);
      await writable.close();
    } catch {
      // persistence is best-effort
    }
  };

  // SRAM lives inside the cart's memory map, so it must be restored after
  // power-on rather than before.
  mod._s9xwasm_reset();
  await restoreSram();

  // ---------------------------------------------------------------- input
  const keyMasks = [0, 0, 0, 0, 0];
  const padMasks = [0, 0, 0, 0, 0];
  const tasMasks = [0, 0, 0, 0, 0];
  const sentMasks = [-1, -1, -1, -1, -1];
  let codeToControl = new Map<string, { pad: number; bit: number }>();

  const pushInputs = (): void => {
    for (let p = 0; p < 5; p++) {
      const mask = keyMasks[p] | padMasks[p] | tasMasks[p];
      if (mask !== sentMasks[p]) {
        sentMasks[p] = mask;
        mod._s9xwasm_input(p, mask);
      }
    }
  };

  const buildKeymap = (map: Record<string, string>): void => {
    codeToControl = new Map();
    for (const [action, code] of Object.entries(map)) {
      const dot = action.indexOf('.');
      if (dot < 0 || !code) continue;
      const pad = { p1: 0, p2: 1, p3: 2, p4: 3, p5: 4 }[action.slice(0, dot)];
      const bit = PAD_BITS[action.slice(dot + 1)];
      if (pad !== undefined && bit !== undefined) codeToControl.set(code, { pad, bit });
    }
  };
  buildKeymap(DEFAULT_KEYMAP);

  const applyKey = (code: string, down: boolean): boolean => {
    const ctl = codeToControl.get(code);
    if (!ctl) return false;
    const bit = 1 << ctl.bit;
    keyMasks[ctl.pad] = down ? keyMasks[ctl.pad] | bit : keyMasks[ctl.pad] & ~bit;
    pushInputs();
    return true;
  };

  const onKeyDown = (e: KeyboardEvent): void => {
    if (e.repeat) return;
    if (applyKey(e.code, true)) e.preventDefault();
  };
  const onKeyUp = (e: KeyboardEvent): void => {
    if (applyKey(e.code, false)) e.preventDefault();
  };
  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);

  /**
   * Gamepad polling (standard mapping). The SNES face buttons sit rotated
   * relative to a modern pad, so the physical bottom/right buttons (0/1) map
   * to B/A and the left/top ones (2/3) to Y/X — the layout every SNES pad
   * has had.
   */
  const pollGamepads = (): void => {
    if (!opts.gamepads || !navigator.getGamepads) return;
    const pads = navigator.getGamepads();
    const maxPads = opts.multitap ? 5 : 2;
    let changed = false;
    for (let p = 0; p < maxPads; p++) {
      const pad = pads[p];
      let mask = 0;
      if (pad && pad.connected) {
        const btn = (i: number): boolean => !!pad.buttons[i]?.pressed;
        const ax = (i: number): number => pad.axes[i] ?? 0;
        if (btn(0)) mask |= 1 << PAD_BITS.b;
        if (btn(1)) mask |= 1 << PAD_BITS.a;
        if (btn(2)) mask |= 1 << PAD_BITS.y;
        if (btn(3)) mask |= 1 << PAD_BITS.x;
        if (btn(4)) mask |= 1 << PAD_BITS.l;
        if (btn(5)) mask |= 1 << PAD_BITS.r;
        if (btn(8)) mask |= 1 << PAD_BITS.select;
        if (btn(9)) mask |= 1 << PAD_BITS.start;
        if (btn(12) || ax(1) < -0.4) mask |= 1 << PAD_BITS.up;
        if (btn(13) || ax(1) > 0.4) mask |= 1 << PAD_BITS.down;
        if (btn(14) || ax(0) < -0.4) mask |= 1 << PAD_BITS.left;
        if (btn(15) || ax(0) > 0.4) mask |= 1 << PAD_BITS.right;
      }
      if (mask !== padMasks[p]) {
        padMasks[p] = mask;
        changed = true;
      }
    }
    if (changed) pushInputs();
  };

  // Browsers may refuse to start audio without a user gesture; retry on the
  // next interaction if the context comes up suspended.
  const resumeAudio = (): void => {
    if (audioCtx.state === 'suspended') void audioCtx.resume();
  };
  window.addEventListener('pointerdown', resumeAudio);
  window.addEventListener('keydown', resumeAudio);

  // --------------------------------------------------------------- render
  // Frame geometry changes at runtime: games switch between 224 and 239
  // lines, and hi-res/interlace modes double either dimension mid-game.
  let imageData: ImageData | null = null;
  let lastW = 0;
  let lastH = 0;

  // Square-pixel mode still needs the 8:7 correction the SNES applies; 4:3 is
  // what the same picture looked like on a CRT. Kept apart from the resize
  // below so the menu can restyle the canvas without a new frame.
  const applyAspect = (): void => {
    if (!lastW) return;
    canvas.style.aspectRatio = opts.aspect === '4:3' ? '4 / 3' : `${lastW} / ${lastH}`;
  };

  const renderFrame = (): void => {
    const w = mod._s9xwasm_frame_width();
    const h = mod._s9xwasm_frame_height();
    if (w <= 0 || h <= 0) return;

    // Crop the overscan rows, keeping the interlaced modes' 2x scale.
    let srcY = 0;
    let outH = h;
    if (opts.cropOverscan) {
      if (h === SNES_HEIGHT_EXTENDED) {
        srcY = 7;
        outH = SNES_HEIGHT;
      } else if (h === SNES_HEIGHT_EXTENDED * 2) {
        srcY = 14;
        outH = SNES_HEIGHT * 2;
      }
    }

    if (w !== lastW || outH !== lastH || !imageData) {
      canvas.width = w;
      canvas.height = outH;
      imageData = ctx2d.createImageData(w, outH);
      lastW = w;
      lastH = outH;
      applyAspect();
    }

    const ptr = mod._s9xwasm_frame_rgba() + srcY * w * 4;
    imageData.data.set(mod.HEAPU8.subarray(ptr, ptr + w * outH * 4));
    ctx2d.putImageData(imageData, 0, 0);
  };

  // ------------------------------------------------------------ main loop
  // Audio-clocked pacing: keep ~90ms of audio queued ahead of the worklet's
  // consumption. While the AudioContext is suspended (no consumption), fall
  // back to wall-clock pacing so video still runs.
  const TARGET_BUFFER = Math.round(sampleRate * 0.09);
  const MAX_FRAMES_PER_TICK = 5;

  let rafId = 0;
  let running = false;
  let paused = false;
  let wallClockFrames = 0;
  let wallClockStart = 0;
  let fpsCount = 0;
  let fpsWindowStart = 0;
  let persistTimer: ReturnType<typeof setInterval> | null = null;

  // Audio-clocked pacing only works while the audio clock actually advances.
  // A context can report `running` and still never render a quantum when
  // there is no output device (headless browsers, VMs without a sound card),
  // and then the buffer deficit never reappears and the picture freezes for
  // good. Watch AudioContext.currentTime and treat a clock that has not moved
  // for half a second as stalled, so pacing falls back to the wall clock.
  const AUDIO_STALL_MS = 500;
  let audioClockTime = -1;
  let audioClockWall = 0;
  let audioStalled = false;

  const audioClockAdvancing = (now: number): boolean => {
    const t = audioCtx.currentTime;
    if (t !== audioClockTime) {
      audioClockTime = t;
      audioClockWall = now;
      audioStalled = false;
    } else if (now - audioClockWall > AUDIO_STALL_MS) {
      audioStalled = true;
    }
    return !audioStalled;
  };

  const runFrames = (count: number): void => {
    for (let i = 0; i < count; i++) {
      // Only the last frame of a catch-up burst reaches the canvas.
      mod._s9xwasm_skip_render(i < count - 1 ? 1 : 0);
      const samps = mod._s9xwasm_exec();
      if (samps > 0) {
        const ptr = mod._s9xwasm_audio_ptr();
        const chunk = mod.HEAP16.slice(ptr >> 1, (ptr >> 1) + samps);
        sink.port.postMessage(chunk, [chunk.buffer]);
        enqueuedFrames += samps >> 1;
      }
      fpsCount++;
    }
  };

  const tick = (now: number): void => {
    if (!running || paused) return;
    rafId = requestAnimationFrame(tick);

    pollGamepads();

    let frames = 0;
    if (audioCtx.state === 'running' && audioClockAdvancing(now)) {
      const buffered = enqueuedFrames - consumedFrames;
      const deficit = TARGET_BUFFER - buffered;
      if (deficit > 0) frames = Math.ceil(deficit / framesPerExec);
      wallClockStart = 0;
    } else {
      // Wall-clock fallback (audio blocked or stalled): accumulate at the
      // core framerate.
      if (!wallClockStart) {
        wallClockStart = now;
        wallClockFrames = 0;
      }
      const due = Math.floor(((now - wallClockStart) / 1000) * framerate);
      frames = due - wallClockFrames;
      wallClockFrames = due;
    }

    frames = Math.max(0, Math.min(MAX_FRAMES_PER_TICK, frames));
    if (frames > 0) {
      runFrames(frames);
      renderFrame();
    }

    if (!fpsWindowStart) fpsWindowStart = now;
    if (now - fpsWindowStart >= 1000) {
      emit({ type: 'frame', fps: (fpsCount * 1000) / (now - fpsWindowStart) });
      fpsWindowStart = now;
      fpsCount = 0;
    }
  };

  const startLoop = (): void => {
    if (rafId) cancelAnimationFrame(rafId);
    wallClockStart = 0;
    rafId = requestAnimationFrame(tick);
  };

  const setInput = (map: InputPreset | KeyMap): void => {
    if (typeof map === 'string') {
      buildKeymap(DEFAULT_KEYMAP);
    } else {
      buildKeymap({ ...DEFAULT_KEYMAP, ...map });
    }
  };

  // -------------------------------------------------------- live settings
  // The region the cartridge was mapped with. The core reads the forced
  // standard in InitROM and clears it there, so a change only lands by
  // re-mapping the cartridge — which is why the option is tagged "needs
  // reset" and applied from reset() below.
  let mappedRegion: Snes9xRegion = opts.region;

  const remapCartridge = (): void => {
    // Battery RAM survives both a power cycle on hardware and S9xReset here,
    // so it is carried across the re-map rather than lost to it.
    const sramPtr = mod._s9xwasm_sram_ptr();
    const sram = sramSize ? mod.HEAPU8.slice(sramPtr, sramPtr + sramSize) : null;

    mod._s9xwasm_set_region?.(SNES9X_REGION_IDS[opts.region]);
    const ptr = heapAlloc(mod, romBytes);
    const ok = mod._s9xwasm_load_rom(ptr, romBytes.length);
    mod._free(ptr);
    if (!ok) throw new Error('snes9x: ROM re-load failed while changing region');
    mappedRegion = opts.region;

    framerate = mod._s9xwasm_framerate_micro() / 1e6;
    framesPerExec = sampleRate / framerate;

    mod._s9xwasm_reset();
    if (sram) mod.HEAPU8.set(sram, mod._s9xwasm_sram_ptr());
  };

  /**
   * How each setting reaches the running emulator. A key left out here — or
   * dropped because the loaded wasm predates its shim setter — is reported as
   * unsupported and does not appear in the menu.
   */
  const appliers: Snes9xAppliers = {
    renderFilter: (value) => {
      canvas.style.imageRendering = value === 'pixelated' ? 'pixelated' : 'auto';
    },
    aspect: () => applyAspect(),
    cropOverscan: () => {
      // Forces the resize path, which re-crops and re-sizes the backing store.
      lastH = 0;
      renderFrame();
    },
    volume: (value) => {
      gain.gain.value = Math.max(0, Math.min(1, Number(value)));
    },
    gamepads: (value) => {
      // Whatever a pad was holding when polling stopped would otherwise stay
      // pressed forever.
      if (!value) {
        padMasks.fill(0);
        pushInputs();
      }
    },
    multitap: (value) => mod._s9xwasm_set_multitap(value ? 1 : 0),
    logLevel: (value) => mod._s9xwasm_set_loglevel(SNES9X_LOG_LEVEL_IDS[value as Snes9xLogLevel]),
  };

  const setInterpolation = mod._s9xwasm_set_interpolation;
  if (setInterpolation) {
    appliers.interpolation = (value) =>
      setInterpolation.call(mod, SNES9X_INTERPOLATION_IDS[value as Snes9xInterpolation]);
  }
  const setSpriteTiles = mod._s9xwasm_set_sprite_tiles_per_line;
  if (setSpriteTiles) {
    appliers.maxSpriteTilesPerLine = (value) => setSpriteTiles.call(mod, Number(value));
  }
  const setSuperFX = mod._s9xwasm_set_superfx_multiplier;
  if (setSuperFX) {
    appliers.superFXClockMultiplier = (value) => setSuperFX.call(mod, Number(value));
  }
  if (mod._s9xwasm_set_region) {
    // Recorded now, applied by reset().
    appliers.region = () => {};
  }

  const engineConfig = bindConfig(state, appliers);

  const menu = opts.escMenu
    ? createMenu({
        mount:
          (config as { attachTo?: HTMLElement }).attachTo ??
          canvas.parentElement ??
          document.body,
        config: engineConfig,
        onReset: () => instance.reset(),
        onChange: (values) => settingsStore.save(values),
        onRestoreDefaults: () => settingsStore.clear(),
      })
    : null;

  const instance: Snes9xInstance = {
    config: engineConfig,
    menu,
    start() {
      if (running) return;
      running = true;
      paused = false;
      resumeAudio();
      startLoop();
      if (persistEnabled && sramSize) {
        persistTimer = setInterval(() => void persistSram(), 15000);
      }
      emit({ type: 'ready' });
    },
    pause() {
      if (!running || paused) return;
      paused = true;
      cancelAnimationFrame(rafId);
      rafId = 0;
      void audioCtx.suspend();
      void persistSram();
    },
    resume() {
      if (!running || !paused) return;
      paused = false;
      void audioCtx.resume();
      startLoop();
    },
    async clearSram() {
      if (!sramSize) return;
      const ptr = mod._s9xwasm_sram_ptr();
      mod.HEAPU8.fill(0, ptr, ptr + sramSize);
      await persistSram();
    },
    reset() {
      if (opts.region !== mappedRegion) remapCartridge();
      else mod._s9xwasm_reset();
    },
    setInput,
    readWram(offset: number) {
      const read = mod._s9xwasm_read_wram;
      if (typeof read !== 'function' || !Number.isInteger(offset) || offset < 0 || offset > 0x1ffff) return null;
      const value = read(offset);
      return value < 0 ? null : value & 0xff;
    },
    setTasInput(buttons: string[]) {
      const bitNames: Record<string, number> = { B: 0, Y: 1, Select: 2, Start: 3, Up: 4, Down: 5, Left: 6, Right: 7, A: 8, X: 9, L: 10, R: 11 };
      let mask = 0;
      for (const button of buttons) {
        const bit = bitNames[button];
        if (bit !== undefined) mask |= 1 << bit;
      }
      tasMasks[0] = mask;
      pushInputs();
    },
    async resumeAudioForCapture() {
      await audioCtx.resume();
    },
    audioCaptureStream() {
      return audioCaptureDestination.stream;
    },
    stepFrame() {
      if (!running) throw new Error('snes9x: start the emulator before stepping');
      paused = true;
      if (rafId) cancelAnimationFrame(rafId);
      rafId = 0;
      runFrames(1);
      renderFrame();
    },
    async saveState(): Promise<Uint8Array> {
      const size = mod._s9xwasm_state_size();
      const ptr = mod._s9xwasm_state_save();
      if (!ptr || !size) throw new Error('snes9x: failed to save state');
      return mod.HEAPU8.slice(ptr, ptr + size);
    },
    async loadState(data: Uint8Array): Promise<void> {
      const ptr = heapAlloc(mod, data);
      const ok = mod._s9xwasm_state_load(ptr, data.length);
      mod._free(ptr);
      if (!ok) throw new Error('snes9x: failed to load state');
    },
    async screenshot(): Promise<Blob> {
      renderFrame();
      return new Promise<Blob>((resolve, reject) => {
        canvas.toBlob((blob) => {
          if (blob) resolve(blob);
          else reject(new Error('snes9x: screenshot failed'));
        }, 'image/png');
      });
    },
    async purgeStorage(): Promise<{ data: boolean; settings: boolean }> {
      let data = false;
      try {
        const root = await navigator.storage.getDirectory();
        const engineDir = await root.getDirectoryHandle('snes9x');
        await engineDir.removeEntry(namespace, { recursive: true });
        data = true;
      } catch {
        // nothing persisted for this namespace
      }
      settingsStore.clear();
      return { data, settings: true };
    },
    destroy() {
      running = false;
      paused = false;
      if (rafId) cancelAnimationFrame(rafId);
      rafId = 0;
      if (persistTimer) clearInterval(persistTimer);
      persistTimer = null;
      void persistSram();
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('pointerdown', resumeAudio);
      window.removeEventListener('keydown', resumeAudio);
      menu?.destroy();
      sink.disconnect();
      gain.disconnect();
      void audioCtx.close();
      emit({ type: 'exit' });
    },
  };

  return instance;
}

export default { manifest, load };
