import type { EngineManifest } from '@wasm-gaming/engine-specs';
import { SNES9X_OPTIONS_SCHEMA } from './snes9x.options.js';

export const manifest: EngineManifest = {
  id: 'snes9x',
  version: '0.1.0',
  name: 'Snes9x (WebAssembly)',
  description:
    'Snes9x — the long-running Super Nintendo / Super Famicom emulator — compiled to WebAssembly. Loads .sfc/.smc cartridge images, including the enhancement chips (Super FX, SA-1, DSP-1, S-DD1, SPC7110, C4, OBC1, S-RTC).',
  artifacts: {
    wasm: 'snes9x/snes9x.wasm',
    js: 'snes9x/snes9x.js',
  },
  assets: [
    {
      key: 'rom',
      mountPath: '/rom.sfc',
      required: true,
      accept: ['.sfc', '.smc', '.fig', '.swc'],
      description:
        'Super Nintendo / Super Famicom cartridge image. Copier headers (the 512-byte kind) are detected and skipped automatically.',
    },
  ],
  input: 'snes9x',
  video: { baseWidth: 256, baseHeight: 224, aspect: '4:3' },
  options: SNES9X_OPTIONS_SCHEMA,
  capabilities: { saveStates: true, sram: true, coreSelectable: false },
};

export default manifest;
