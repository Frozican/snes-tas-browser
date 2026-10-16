import type { Snes9xConfig } from './snes9x.config.js';
import {
  SNES9X_OPTION_GROUPS,
  type Snes9xOptionSpec,
  type Snes9xOptionValue,
} from './snes9x.options.js';

/**
 * In-game settings overlay, opened with Escape.
 *
 * It lives in a shadow root over the emulator viewport so the host page's CSS
 * cannot reach in and break it, and it drives the live `Snes9xConfig` directly
 * — every change applies to the running game immediately, except the handful
 * the core only reads while mapping the cartridge (tagged "needs reset").
 */
export interface Snes9xMenu {
  readonly isOpen: boolean;
  open(): void;
  close(): void;
  toggle(): void;
  destroy(): void;
}

export interface Snes9xMenuConfig {
  /** Element the overlay is positioned against — usually the runtime container. */
  mount: HTMLElement;
  config: Snes9xConfig;
  onReset: () => void;
  /** Called after any change, with the full set of values, for persistence. */
  onChange?: (values: Record<string, Snes9xOptionValue>) => void;
  onRestoreDefaults?: () => void;
}

const STYLES = `
:host {
  --accent: var(--snes9x-menu-accent, var(--demo-accent, #6657b2));
  --accent-2: var(--snes9x-menu-accent-2, var(--demo-accent2, #c44a5c));
  --text: var(--snes9x-menu-text, #ececf2);
  --muted: var(--snes9x-menu-muted, #9494a6);
  --panel: var(--snes9x-menu-panel, rgba(18, 17, 25, 0.96));

  position: absolute;
  inset: 0;
  z-index: 30;
  display: none;
  font-family: var(--demo-font-sans, system-ui, -apple-system, "Segoe UI", sans-serif);
  color: var(--text);
}

:host([open]) { display: block; }

.scrim {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  padding: clamp(0.5rem, 3vh, 2rem);
  background: rgba(0, 0, 0, 0.62);
  backdrop-filter: blur(3px);
}

.panel {
  display: flex;
  flex-direction: column;
  width: min(34rem, 100%);
  max-height: 100%;
  background: var(--panel);
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-top: 2px solid var(--accent);
  border-radius: 4px;
  box-shadow: 0 24px 60px rgba(0, 0, 0, 0.7);
  overflow: hidden;
}

/* The panel only takes focus to keep keystrokes off the game; the row
   highlight is what tracks the selection, so a ring around the whole dialog
   would just be noise. */
.panel:focus { outline: none; }

header {
  display: flex;
  align-items: baseline;
  gap: 0.6rem;
  padding: 0.85rem 1rem 0.7rem;
  border-bottom: 1px solid rgba(255, 255, 255, 0.09);
}

h2 {
  margin: 0;
  font-size: 0.85rem;
  font-weight: 800;
  letter-spacing: 0.22em;
  text-transform: uppercase;
  color: var(--accent);
}

.system {
  margin-left: auto;
  font-family: var(--demo-font-mono, ui-monospace, monospace);
  font-size: 0.65rem;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--muted);
}

.body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 0.35rem 0.35rem 0.6rem;
  scrollbar-width: thin;
}

h3 {
  margin: 0.7rem 0 0.25rem;
  padding: 0 0.65rem;
  font-family: var(--demo-font-mono, ui-monospace, monospace);
  font-size: 0.62rem;
  font-weight: 700;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: var(--muted);
}

.row {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 0.4rem 0.65rem;
  border-left: 2px solid transparent;
  border-radius: 2px;
  cursor: default;
}

.row[data-active="true"] {
  background: rgba(255, 255, 255, 0.06);
  border-left-color: var(--accent);
}

.label {
  flex: 1;
  min-width: 0;
  font-size: 0.82rem;
}

.tag {
  margin-left: 0.4rem;
  padding: 0.05rem 0.3rem;
  border: 1px solid rgba(255, 255, 255, 0.22);
  border-radius: 2px;
  font-family: var(--demo-font-mono, ui-monospace, monospace);
  font-size: 0.55rem;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--muted);
  vertical-align: middle;
}

.control {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 0.2rem;
}

.chip {
  padding: 0.2rem 0.5rem;
  border: 1px solid rgba(255, 255, 255, 0.14);
  border-radius: 2px;
  background: rgba(255, 255, 255, 0.03);
  color: var(--muted);
  font: inherit;
  font-size: 0.72rem;
  cursor: pointer;
}

.chip:hover { border-color: rgba(255, 255, 255, 0.32); color: var(--text); }

.chip[aria-checked="true"] {
  background: rgba(255, 255, 255, 0.1);
  border-color: var(--accent-2);
  color: var(--text);
  font-weight: 600;
}

footer {
  display: flex;
  flex-direction: column;
  gap: 0.55rem;
  padding: 0.7rem 1rem 0.85rem;
  border-top: 1px solid rgba(255, 255, 255, 0.09);
}

.desc {
  min-height: 2.2em;
  margin: 0;
  font-size: 0.7rem;
  line-height: 1.35;
  color: var(--muted);
}

.actions { display: flex; gap: 0.4rem; }

.action {
  flex: 1;
  padding: 0.4rem 0.5rem;
  border: 1px solid rgba(255, 255, 255, 0.16);
  border-radius: 2px;
  background: rgba(255, 255, 255, 0.04);
  color: var(--text);
  font: inherit;
  font-size: 0.72rem;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  cursor: pointer;
}

.action:hover { border-color: rgba(255, 255, 255, 0.34); }

.action[data-active="true"] {
  border-color: var(--accent);
  background: rgba(255, 255, 255, 0.1);
}

.keys {
  font-family: var(--demo-font-mono, ui-monospace, monospace);
  font-size: 0.6rem;
  letter-spacing: 0.06em;
  color: var(--muted);
  text-align: center;
}

@media (prefers-reduced-motion: no-preference) {
  :host([open]) .panel { animation: rise 120ms ease-out; }
  @keyframes rise {
    from { opacity: 0; transform: translateY(6px); }
    to { opacity: 1; transform: none; }
  }
}
`;

/** One navigable line: either an option row or a footer action. */
type MenuItem =
  | { kind: 'option'; option: Snes9xOptionSpec; row: HTMLElement; chips: HTMLButtonElement[] }
  | { kind: 'action'; description: string; el: HTMLElement; run: () => void };

const BOOLEAN_CHOICES = [
  { value: false, label: 'Off' },
  { value: true, label: 'On' },
];

/** The values an option offers, in the order the menu cycles through them. */
function choicesOf(option: Snes9xOptionSpec): Array<{ value: Snes9xOptionValue; label: string }> {
  return option.type === 'boolean' ? BOOLEAN_CHOICES : option.values;
}

export function createMenu(config: Snes9xMenuConfig): Snes9xMenu {
  const { mount, config: engineConfig } = config;

  const host = document.createElement('div');
  host.className = 'snes9x-menu';
  const root = host.attachShadow({ mode: 'open' });

  const style = document.createElement('style');
  style.textContent = STYLES;

  const panel = document.createElement('div');
  panel.className = 'panel';
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-modal', 'true');
  panel.setAttribute('aria-label', 'Emulator settings');
  panel.tabIndex = -1;

  const scrim = document.createElement('div');
  scrim.className = 'scrim';
  scrim.appendChild(panel);
  root.append(style, scrim);

  // The overlay is absolutely positioned, so the container has to establish a
  // containing block; a host page that already positions it is left alone.
  // Falling back to <body> is the one case where that would be intrusive, so
  // there the overlay pins to the viewport instead.
  if (mount === document.body) {
    host.style.position = 'fixed';
  } else if (getComputedStyle(mount).position === 'static') {
    mount.style.position = 'relative';
  }
  mount.appendChild(host);

  const items: MenuItem[] = [];
  let activeIndex = 0;
  let isOpen = false;
  let lastFocused: Element | null = null;

  const description = document.createElement('p');
  description.className = 'desc';

  function setActive(index: number): void {
    if (items.length === 0) return;
    activeIndex = ((index % items.length) + items.length) % items.length;

    items.forEach((item, i) => {
      const el = item.kind === 'option' ? item.row : item.el;
      el.dataset.active = String(i === activeIndex);
    });

    const active = items[activeIndex];
    description.textContent =
      active.kind === 'option' ? active.option.description : active.description;

    const el = active.kind === 'option' ? active.row : active.el;
    el.scrollIntoView({ block: 'nearest' });
  }

  function currentValue(option: Snes9xOptionSpec): string {
    const value = engineConfig.read(option.key);
    return String(value === undefined ? option.default : value);
  }

  function syncRow(item: Extract<MenuItem, { kind: 'option' }>): void {
    const value = currentValue(item.option);
    for (const chip of item.chips) {
      chip.setAttribute('aria-checked', String(chip.dataset.value === value));
    }
  }

  function applyValue(option: Snes9xOptionSpec, value: Snes9xOptionValue): void {
    if (!engineConfig.write(option.key, value)) return;

    const item = items.find(
      (candidate): candidate is Extract<MenuItem, { kind: 'option' }> =>
        candidate.kind === 'option' && candidate.option.key === option.key,
    );
    if (item) syncRow(item);

    config.onChange?.(engineConfig.values());
  }

  /** Steps through an option's choices, wrapping at both ends. */
  function cycle(option: Snes9xOptionSpec, direction: 1 | -1): void {
    const choices = choicesOf(option);
    // A host may have set a value the menu does not list (`volume: 0.4`), in
    // which case there is no current choice and stepping starts from the top.
    const current = choices.findIndex(
      (choice) => String(choice.value) === currentValue(option),
    );
    const next = (current + direction + choices.length) % choices.length;
    applyValue(option, choices[next].value);
  }

  function buildRow(option: Snes9xOptionSpec): void {
    const row = document.createElement('div');
    row.className = 'row';

    const label = document.createElement('div');
    label.className = 'label';
    label.textContent = option.label;
    if (option.requiresReset) {
      const tag = document.createElement('span');
      tag.className = 'tag';
      tag.textContent = 'needs reset';
      label.appendChild(tag);
    }

    const control = document.createElement('div');
    control.className = 'control';

    const chips = choicesOf(option).map((choice) => {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'chip';
      chip.setAttribute('role', 'radio');
      chip.dataset.value = String(choice.value);
      chip.textContent = choice.label;
      chip.addEventListener('click', () => {
        setActive(items.findIndex((item) => item.kind === 'option' && item.option === option));
        applyValue(option, choice.value);
      });
      control.appendChild(chip);
      return chip;
    });

    row.append(label, control);
    const index = items.length;
    row.addEventListener('mouseenter', () => setActive(index));
    items.push({ kind: 'option', option, row, chips });
    body.appendChild(row);
  }

  const body = document.createElement('div');
  body.className = 'body';

  const header = document.createElement('header');
  const title = document.createElement('h2');
  title.textContent = 'Settings';
  const systemLabel = document.createElement('span');
  systemLabel.className = 'system';
  systemLabel.textContent = 'Super Nintendo';
  header.append(title, systemLabel);

  for (const group of SNES9X_OPTION_GROUPS) {
    const supported = group.options.filter((option) => engineConfig.supports(option.key));
    if (supported.length === 0) continue;

    const heading = document.createElement('h3');
    heading.textContent = group.label;
    body.appendChild(heading);
    supported.forEach(buildRow);
  }

  const footer = document.createElement('footer');
  const actions = document.createElement('div');
  actions.className = 'actions';

  function buildAction(label: string, desc: string, run: () => void): void {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'action';
    button.textContent = label;
    const index = items.length;
    button.addEventListener('click', () => {
      setActive(index);
      run();
    });
    button.addEventListener('mouseenter', () => setActive(index));
    actions.appendChild(button);
    items.push({ kind: 'action', description: desc, el: button, run });
  }

  buildAction('Resume', 'Close this menu and return to the game.', () => close());
  buildAction('Restore defaults', 'Reset every setting above to its default.', () => {
    engineConfig.restoreDefaults();
    for (const item of items) {
      if (item.kind === 'option') syncRow(item);
    }
    config.onRestoreDefaults?.();
    config.onChange?.(engineConfig.values());
  });
  buildAction('Reset game', 'Reboot the console. Unsaved progress is lost.', () => {
    config.onReset();
    close();
  });

  const keys = document.createElement('p');
  keys.className = 'keys';
  keys.textContent = '↑ ↓ select · ← → change · Enter apply · Esc close';

  footer.append(description, actions, keys);
  panel.append(header, body, footer);

  scrim.addEventListener('mousedown', (event) => {
    if (event.target === scrim) close();
  });

  function open(): void {
    if (isOpen) return;
    isOpen = true;

    // Re-read on every open: the host may have written to the config itself,
    // and `restoreDefaults` moves values without going through this menu.
    for (const item of items) {
      if (item.kind === 'option') syncRow(item);
    }

    host.setAttribute('open', '');
    lastFocused = document.activeElement;
    setActive(activeIndex);
    panel.focus({ preventScroll: true });
  }

  function close(): void {
    if (!isOpen) return;
    isOpen = false;
    host.removeAttribute('open');
    // Hand focus back so the emulator keeps receiving keyboard input.
    if (lastFocused instanceof HTMLElement) lastFocused.focus({ preventScroll: true });
    lastFocused = null;
  }

  function toggle(): void {
    if (isOpen) close();
    else open();
  }

  function handleNavigation(event: KeyboardEvent): boolean {
    const item = items[activeIndex];
    switch (event.key) {
      case 'ArrowDown':
        setActive(activeIndex + 1);
        return true;
      case 'ArrowUp':
        setActive(activeIndex - 1);
        return true;
      case 'ArrowRight':
        if (item?.kind === 'option') cycle(item.option, 1);
        return true;
      case 'ArrowLeft':
        if (item?.kind === 'option') cycle(item.option, -1);
        return true;
      case 'Home':
        setActive(0);
        return true;
      case 'End':
        setActive(items.length - 1);
        return true;
      case 'Enter':
      case ' ':
        if (item?.kind === 'action') item.run();
        else if (item?.kind === 'option') cycle(item.option, 1);
        return true;
      default:
        return false;
    }
  }

  // Capture phase, so menu keystrokes are swallowed before the SDK's own
  // window listeners translate them into pad presses. Key *up* is deliberately
  // left alone: swallowing it would strand any button the player was holding
  // when the menu opened in the pressed state.
  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopImmediatePropagation();
      toggle();
      return;
    }
    if (!isOpen) return;

    event.stopImmediatePropagation();
    if (handleNavigation(event)) event.preventDefault();
  };

  const onKeyPress = (event: KeyboardEvent): void => {
    if (isOpen) event.stopImmediatePropagation();
  };

  window.addEventListener('keydown', onKeyDown, true);
  window.addEventListener('keypress', onKeyPress, true);

  setActive(0);

  return {
    get isOpen() {
      return isOpen;
    },
    open,
    close,
    toggle,
    destroy() {
      window.removeEventListener('keydown', onKeyDown, true);
      window.removeEventListener('keypress', onKeyPress, true);
      host.remove();
    },
  };
}
