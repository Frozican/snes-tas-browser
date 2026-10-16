#!/usr/bin/env bash
set -euo pipefail

# Build the upstream Snes9x WASM core with a bounds-checked WRAM read export.
mkdir -p public/core
docker run --rm \
  -v "$PWD:/workspace" -w /workspace \
  emscripten/emsdk:3.1.74 \
  bash -lc '
    set -euo pipefail
    rm -rf /tmp/snes9x-wasm-port
    git clone https://github.com/wasm-gaming/snes9x-wasm.git /tmp/snes9x-wasm-port
    cd /tmp/snes9x-wasm-port
    git checkout --detach bd2ed679b6b2422a83667b45efd75737c2758639
    python3 - <<PY
from pathlib import Path
p = Path("scripts/shim/s9x_shim.cpp")
s = p.read_text()
needle = "// ------------------------------------------------------------- exports"
addition = """// Read one byte from SNES 128 KiB work RAM (7E:0000-7F:FFFF).
// Return -1 for an invalid offset so callers can distinguish errors from 0.
WASM_EXPORT int s9xwasm_read_wram(int offset)
{
    if (offset < 0 || offset >= 0x20000)
        return -1;
    return static_cast<int>(Memory.RAM[offset]);
}

"""
if "s9xwasm_read_wram" not in s:
    if needle not in s:
        raise SystemExit("Could not locate shim export section; refusing unsafe patch")
    s = s.replace(needle, needle + "\n" + addition, 1)
p.write_text(s)
PY
    bash scripts/build-snes9x.sh
    cp dist/snes9x/snes9x.js /workspace/public/core/snes9x.js
    cp dist/snes9x/snes9x.wasm /workspace/public/core/snes9x.wasm
  '
