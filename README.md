# SNES TAS Browser — Starter

A responsive browser-based SNES TAS editor prototype. Bring your own `.sfc` / `.smc` ROM; selected ROM bytes are read locally and are not uploaded.

## Current status
**Not yet a complete emulator.** The project contains the interface, frame timeline, per-frame controller editing, and JSON movie import/export. Actual SNES execution/rendering, deterministic single-frame stepping, core-backed WRAM watching, and synchronized MP4 export still need implementation.

Recommended core candidate: [`@wasm-gaming/snes9x-wasm`](https://github.com/wasm-gaming/snes9x-wasm). It documents ROM loading, audio/video, and save states. A controllable frame-by-frame API and direct WRAM reads must be verified or added before calling this frame-perfect TAS.

## Run locally
Requires Node.js 20+:
```bash
npm install
npm run dev
```
## Build
```bash
npm run build
npm run preview
```
## GitHub Pages
Create a repository named `snes-tas-browser`, push these files to `main`, then choose **Settings → Pages → GitHub Actions**. The included workflow deploys `dist/` after each push. URL: `https://YOUR-USERNAME.github.io/snes-tas-browser/`.

## Roadmap
1. Integrate SNES9x WASM and prove deterministic frame stepping.
2. Record controller state per frame and replay from reset/save state.
3. Add WRAM reads using the core's actual memory API.
4. Capture emulator audio and video against emulated frame time; test sync/duration.
5. Add MP4 export and browser/mobile tests.
