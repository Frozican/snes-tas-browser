# SNES TAS Browser

A browser-based workbench for creating and editing tool-assisted speedrun (TAS) input movies for Super Nintendo games. The app is hosted on GitHub Pages and is designed to work with your own legally obtained ROM files.

**Live app:** https://frozican.github.io/snes-tas-browser/

## What it currently includes

- Load SNES ROM files in `.sfc`, `.smc`, `.fig`, or `.swc` format.
- Run the Snes9x WebAssembly core in the browser.
- Edit controller inputs on a frame-by-frame timeline, including painting inputs across frames.
- Apply or clear a button hold across a selected frame range.
- Play back the input movie and navigate frames; backward navigation relies on saved emulator-state checkpoints.
- Save and load emulator states.
- Import/export the app's `.snes-tas` / JSON movie format.
- Import BizHawk `.bk2` movie files (compatibility can vary by movie/core settings).
- Record gameplay video where supported by the browser; the browser may export WebM rather than MP4.
- RAM Watch UI for SNES WRAM addresses `7E:0000`–`7F:FFFF`. Live reads require the custom WASM core build to deploy successfully.

## Important limitations

This project is actively developed. Do not assume it is yet a fully frame-perfect or deterministic TAS environment. Movie synchronization, BK2 compatibility, frame stepping, rewind/checkpoint behavior, audio/video timing, and RAM Watch should be tested with the specific game and browser you use. Some features may be incomplete or behave differently between desktop and mobile browsers.

ROM data is selected and processed locally in the browser; the app does not intentionally upload your ROM to a server. Use only ROMs you have the right to use.

## Use the website

1. Open the [SNES TAS Browser](https://frozican.github.io/snes-tas-browser/).
2. Choose **Load ROM** and select a supported ROM file from your device.
3. Use the timeline or on-screen controller to edit frame inputs. You can also use **Hold Button for Range** to apply an input over multiple frames.
4. Use **Import TAS** to load a supported `.snes-tas`, JSON, or BK2 movie, or **Export .snes-tas** to save your project.
5. Use save states and video recording where available.

On phones, browser file pickers and recording formats depend on the device and browser. A desktop browser is recommended for longer TAS sessions.

## Run locally

Requirements: Node.js 20+ and Docker for the custom WebAssembly core build.

```bash
npm install
npm run dev
```

The Vite development server serves the app. To build the same custom core used for RAM Watch, run:

```bash
bash scripts/build-snes9x-ramwatch.sh
npm run build
npm run preview
```

The core build script uses Docker and Emscripten, fetches a pinned version of the upstream `wasm-gaming/snes9x-wasm` project, adds a bounds-checked WRAM byte-read export, and stages the generated WASM files in `public/core`.

## Deployment

GitHub Actions builds the app and deploys it to GitHub Pages on pushes to `main`. The repository's Pages source should be set to **GitHub Actions**.

## Technology

- Vite
- TypeScript/JavaScript
- Snes9x compiled to WebAssembly via Emscripten
- GitHub Actions and GitHub Pages

## Development priorities

- Verify the custom WASM build and RAM Watch against real games.
- Improve BK2 compatibility and validate movie playback synchronization.
- Test deterministic frame stepping and rewind/checkpoint behavior.
- Validate audio/video synchronization and exports across browsers.
- Improve mobile controls and accessibility.

## Credits

- [Snes9x](https://github.com/snes9xgit/snes9x) — SNES emulation core.
- [wasm-gaming/snes9x-wasm](https://github.com/wasm-gaming/snes9x-wasm) — WebAssembly build and JavaScript SDK foundation.
