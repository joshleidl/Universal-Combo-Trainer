// Controls page: assign keyboard keys and gamepad controls to buttons, and test them live.
// Rendering only. Binding logic lives in input/mapping.ts, saving in storage/mapping.ts.

import {
  BUTTON_IDS,
  DEFAULT_POLL_MODE,
  GamepadTracker,
  attachKeyboard,
  bindControl,
  browserPollerDeps,
  controlLabel,
  listBindings,
  mapControl,
  parseControl,
  startGamepadPolling,
  unbindControl,
  type Binding,
  type InputMapping,
  type InputPress,
} from '../input';
import type { ButtonId } from '../engine/types';
import { el } from './dom';

/** The app's current mapping, shared by every page. */
export interface MappingHolder {
  current: InputMapping;
  /** Saves and makes `mapping` current. */
  save(mapping: InputMapping): void;
  /** Goes back to the defaults. */
  reset(): void;
}

/** Keys that keep their usual job while binding: Escape cancels, Tab moves focus. */
const RESERVED_KEYS = new Set(['Escape', 'Tab']);

/** `onBound` runs after each new binding (the app plays a sound if sounds are on). */
export function renderControlsPage(root: HTMLElement, holder: MappingHolder, onBound: () => void = () => {}): () => void {
  let listeningFor: ButtonId | null = null;

  const statusLine = el('p', { className: 'controls-status', role: 'status' });
  const tableBody = el('tbody');
  const padInfo = el('p', { className: 'hint' });
  const resetBtn = el('button', { type: 'button', className: 'danger', textContent: 'Reset to defaults' });
  const rowsByButton = new Map<ButtonId, HTMLTableRowElement>();

  root.replaceChildren(
    el('header', {}, [
      el('h2', { className: 'page-title', textContent: 'Controls' }),
      el('p', {
        className: 'sub',
        textContent: 'Choose which keys and gamepad controls press each button. Changes save automatically.',
      }),
    ]),
    el('section', { className: 'card' }, [
      statusLine,
      padInfo,
      el('div', { className: 'table-wrap' }, [
        el('table', { className: 'bindings' }, [
          el('thead', {}, [el('tr', {}, ['Button', 'Keyboard', 'Gamepad', ''].map((h) => el('th', { textContent: h })))]),
          tableBody,
        ]),
      ]),
      el('div', { className: 'actions' }, [resetBtn]),
      el('p', {
        className: 'hint',
        textContent:
          'Click “Bind”, then press a key, pad button, stick direction or d-pad/lever direction. Each control presses one button, so binding it again moves it. A button can have several controls. Escape and Tab can’t be bound. Space, and Start/Back on a pad, restart practice only while they aren’t bound.',
      }),
    ]),
  );

  // --- rendering ----------------------------------------------------------
  function renderTable() {
    const bindings = listBindings(holder.current);
    const extra = [...new Set(bindings.map((b) => b.button))].filter((b) => !(BUTTON_IDS as readonly string[]).includes(b));
    rowsByButton.clear();
    tableBody.replaceChildren(
      ...[...BUTTON_IDS, ...extra].map((button) => {
        const mine = bindings.filter((b) => b.button === button);
        const listening = listeningFor === button;
        const bindBtn = el('button', {
          type: 'button',
          textContent: listening ? 'Cancel' : 'Bind',
          ariaLabel: listening ? `Cancel binding ${button}` : `Bind a control to ${button}`,
        });
        bindBtn.addEventListener('click', () => {
          listeningFor = listening ? null : button;
          renderTable();
          renderStatus();
        });
        const row = el('tr', { className: listening ? 'listening' : '' }, [
          el('td', { className: 'bind-button', textContent: button }),
          el('td', {}, [chips(mine.filter((b) => b.source === 'keyboard'))]),
          el('td', {}, [chips(mine.filter((b) => b.source === 'gamepad'))]),
          el('td', {}, [bindBtn]),
        ]);
        rowsByButton.set(button, row);
        return row;
      }),
    );
  }

  function chips(list: Binding[]): HTMLElement {
    if (list.length === 0) return el('span', { className: 'muted', textContent: '—' });
    return el(
      'span',
      { className: 'chips' },
      list.map((b) => {
        const remove = el('button', {
          type: 'button',
          className: 'chip-remove',
          textContent: '✕',
          ariaLabel: `Remove ${b.label} from ${b.button}`,
          title: 'Remove',
        });
        remove.addEventListener('click', () => {
          apply(unbindControl(holder.current, b.ref));
          setStatus(`Removed ${b.label} from ${b.button}.`);
        });
        return el('span', { className: 'chip' }, [b.label, remove]);
      }),
    );
  }

  function renderStatus() {
    if (listeningFor) setStatus(`Press a key or pad control for ${listeningFor}… (Escape to cancel)`, 'listening');
    else setStatus('Press any key or pad control to test it.');
  }

  function setStatus(text: string, kind: '' | 'listening' | 'hit' = '') {
    statusLine.textContent = text;
    statusLine.className = `controls-status ${kind}`.trim();
  }

  function flash(button: ButtonId) {
    const row = rowsByButton.get(button);
    if (!row) return;
    row.classList.remove('hit');
    void row.offsetWidth; // restart the animation
    row.classList.add('hit');
  }

  /** Saves a changed mapping and starts using it. */
  function apply(mapping: InputMapping) {
    holder.save(mapping);
    use(mapping);
  }

  function use(mapping: InputMapping) {
    keyboard.setMapping(mapping);
    tracker.setMapping(mapping);
    renderTable();
  }

  // --- input --------------------------------------------------------------
  const onPress = (press: InputPress) => {
    if (press.source === 'keyboard' && RESERVED_KEYS.has(press.control)) {
      if (press.control === 'Escape' && listeningFor) {
        listeningFor = null;
        renderTable();
        renderStatus();
      }
      return;
    }
    const ref = parseControl(press.source, press.control);
    if (!ref) return;
    const label = controlLabel(ref);

    if (listeningFor) {
      const target = listeningFor;
      const previous = mapControl(holder.current, ref);
      listeningFor = null;
      apply(bindControl(holder.current, ref, target));
      flash(target);
      onBound();
      setStatus(
        previous && previous !== target
          ? `Bound ${label} to ${target} (moved from ${previous}).`
          : `Bound ${label} to ${target}.`,
        'hit',
      );
      return;
    }

    if (press.button) {
      flash(press.button);
      setStatus(`${label} → ${press.button}`, 'hit');
    } else {
      setStatus(`${label} isn’t bound to a button.`);
    }
  };

  // While binding, stop keys from scrolling, typing or clicking the focused button.
  const onKeyDown = (e: KeyboardEvent) => {
    if (listeningFor && !RESERVED_KEYS.has(e.code)) e.preventDefault();
  };
  window.addEventListener('keydown', onKeyDown, true);

  const keyboard = attachKeyboard(window, { mapping: holder.current, onPress });
  const tracker = new GamepadTracker(holder.current);
  const deps = browserPollerDeps();
  const poller = startGamepadPolling({ tracker, mode: DEFAULT_POLL_MODE, onPress, deps });

  const updatePads = () => {
    const pads = deps.getGamepads().filter((p): p is Gamepad => !!p && p.connected);
    padInfo.textContent = pads.length
      ? `Gamepad${pads.length > 1 ? 's' : ''}: ${pads.map((p) => p.id).join('; ')}. Bindings apply to every pad.`
      : 'No gamepad detected. Press a button on the pad to wake it up.';
  };
  const padTimer = window.setInterval(updatePads, 1000);

  resetBtn.addEventListener('click', () => {
    if (!window.confirm('Reset all keyboard and gamepad bindings to the defaults?')) return;
    holder.reset();
    listeningFor = null;
    use(holder.current);
    setStatus('Bindings reset to the defaults.');
  });

  renderTable();
  renderStatus();
  updatePads();

  return () => {
    window.removeEventListener('keydown', onKeyDown, true);
    window.clearInterval(padTimer);
    keyboard.stop();
    poller.stop();
  };
}
