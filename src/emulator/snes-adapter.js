// Integration boundary. A real TAS requires deterministic frame stepping and input injection.
export class SnesAdapter {
  async loadRom(_bytes, _canvas) { throw new Error('SNES core integration pending; see README.md'); }
  async stepFrame(_inputs) { throw new Error('Single-frame stepping not implemented'); }
  readWram(_address) { throw new Error('WRAM access not implemented'); }
  saveState() { throw new Error('Save-state bridge not implemented'); }
  loadState(_state) { throw new Error('Save-state bridge not implemented'); }
}
