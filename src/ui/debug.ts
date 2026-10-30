// Input debug page (Layer 2): live presses, timestamps, and gamepad polling stats.
// Rendering only. Timing math comes from engine/ and input/.

import { frameMs, msToFrame } from '../engine/timing';
import {
  DEFAULT_MAPPING,
  DEFAULT_POLL_MODE,
  GamepadTracker,
  HAT_DIRECTIONS,
  attachKeyboard,
  browserPollerDeps,
  decodeHat,
  gamepadAxisName,
  gamepadButtonName,
  gamepadHatControl,
  isResolutionTooCoarse,
  startGamepadPolling,
  type AxisDirection,
  type InputPress,
  type IntervalSummary,
  type PollMode,
} from '../input';

const MAX_LOG_ROWS = 50;
const FPS_OPTIONS = [30, 60, 120];
const POLL_MODES: Record<string, PollMode> = {
  auto: DEFAULT_POLL_MODE,
  raf: { kind: 'raf' },
  i8: { kind: 'interval', ms: 8 },
  i4: { kind: 'interval', ms: 4 },
  i1: { kind: 'interval', ms: 1 },
};

const fmt = (ms: number, digits = 2) => ms.toFixed(digits);

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Partial<HTMLElementTagNameMap[K]> = {},
  children: (Node | string)[] = [],
): HTMLElementTagNameMap[K] {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children);
  return node;
}

export function renderDebugPage(root: HTMLElement): () => void {
  let fps = 60;
  let pollKey = 'auto';
  let lastPress: InputPress | null = null;
  let count = 0;

  const tracker = new GamepadTracker(DEFAULT_MAPPING);
  const deps = browserPollerDeps();

  // --- layout -------------------------------------------------------------
  const fpsSelect = el(
    'select',
    { id: 'fps' },
    FPS_OPTIONS.map((v) => el('option', { value: String(v), textContent: `${v} fps`, selected: v === fps })),
  );
  const pollSelect = el('select', { id: 'poll' }, [
    el('option', { value: 'auto', textContent: 'Auto: 4 ms timer while focused (default)' }),
    el('option', { value: 'raf', textContent: 'Every animation frame' }),
    el('option', { value: 'i8', textContent: 'Timer, 8 ms' }),
    el('option', { value: 'i4', textContent: 'Timer, 4 ms' }),
    el('option', { value: 'i1', textContent: 'Timer, 1 ms' }),
  ]);
  const clearBtn = el('button', { type: 'button', textContent: 'Clear log' });

  const padList = el('ul', { className: 'pads' });
  const statActive = el('dd');
  const statPoll = el('dd');
  const statUpdate = el('dd');
  const statResolution = el('dd');
  const warning = el('p', { className: 'warning', hidden: true });

  const logBody = el('tbody');
  const emptyRow = el('tr', { className: 'empty' }, [
    el('td', { colSpan: 6, textContent: 'Press a mapped key or a gamepad button.' }),
  ]);
  logBody.append(emptyRow);

  root.replaceChildren(
    el('header', {}, [
      el('h1', { textContent: 'Combo Timing Trainer' }),
      el('p', { className: 'sub', textContent: 'Input debug — Layer 2' }),
    ]),
    el('section', { className: 'controls' }, [
      el('label', {}, ['Target framerate ', fpsSelect]),
      el('label', {}, ['Gamepad polling ', pollSelect]),
      clearBtn,
    ]),
    el('section', { className: 'card' }, [
      el('h2', { textContent: 'Gamepads' }),
      padList,
      el('h2', { textContent: 'Gamepad polling' }),
      el('dl', { className: 'stats' }, [
        el('dt', { textContent: 'Polling now' }),
        statActive,
        el('dt', { textContent: 'Poll interval' }),
        statPoll,
        el('dt', { textContent: 'Time between input changes' }),
        statUpdate,
        el('dt', { textContent: 'Timestamp resolution' }),
        statResolution,
      ]),
      warning,
      el('p', {
        className: 'hint',
        textContent:
          'Input changes only count when the pad’s data changes. With an arcade stick or buttons, that mostly reflects how fast you move. The fastest gap is an upper limit on how often the browser reads the pad.',
      }),
    ]),
    el('section', { className: 'card' }, [
      el('h2', { textContent: 'Presses' }),
      el('div', { className: 'table-wrap' }, [
        el('table', {}, [
          el('thead', {}, [
            el('tr', {}, ['#', 'Source', 'Control', 'Button', 'Timestamp (ms)', 'Since last'].map((h) =>
              el('th', { textContent: h }),
            )),
          ]),
          logBody,
        ]),
      ]),
    ]),
    el('section', { className: 'card' }, [
      el('h2', { textContent: 'Default mapping' }),
      mappingTable(),
    ]),
  );

  // --- presses ------------------------------------------------------------
  const onPress = (press: InputPress) => {
    count += 1;
    emptyRow.remove();
    let since = '—';
    if (lastPress) {
      const gap = press.timestamp - lastPress.timestamp;
      since = `${fmt(gap)} ms (${msToFrame(gap, fps)}f)`;
    }
    lastPress = press;

    const tsNote = press.timestampSource === 'event' ? '' : ` [${press.timestampSource}]`;
    const row = el('tr', { className: press.button ? '' : 'unmapped' }, [
      el('td', { textContent: String(count) }),
      el('td', {
        textContent: press.source === 'gamepad' ? `pad ${press.gamepadIndex ?? '?'}` : 'keyboard',
      }),
      el('td', { textContent: press.control }),
      el('td', { textContent: press.button ?? '(unmapped)' }),
      el('td', { className: 'num', textContent: fmt(press.timestamp, 3) + tsNote }),
      el('td', { className: 'num', textContent: since }),
    ]);
    logBody.prepend(row);
    while (logBody.rows.length > MAX_LOG_ROWS) logBody.lastElementChild?.remove();
  };

  const keyboard = attachKeyboard(window, { mapping: DEFAULT_MAPPING, onPress });

  let poller = startGamepadPolling({ tracker, mode: POLL_MODES[pollKey]!, onPress, deps });

  // --- stats refresh --------------------------------------------------------
  const describe = (s: IntervalSummary | null) =>
    s
      ? `median ${fmt(s.median)} ms · mean ${fmt(s.mean)} · min ${fmt(s.min)} · max ${fmt(s.max)} (n=${s.count})`
      : 'no data yet';

  const refresh = () => {
    const pads = deps.getGamepads().filter((p): p is Gamepad => !!p && p.connected);
    padList.replaceChildren(
      ...(pads.length
        ? pads.map((p) => {
            const held = p.buttons.flatMap((b, i) => (b.pressed ? [String(i)] : []));
            const axes = p.axes.map((v, i) => `${i}: ${v.toFixed(2)}`);
            const hats = Object.keys(DEFAULT_MAPPING.gamepadHats)
              .map(Number)
              .filter((axis) => axis < p.axes.length)
              .map((axis) => `Hat ${axis}: ${decodeHat(p.axes[axis]!).join('-') || 'neutral'}`);
            return el('li', {}, [
              `#${p.index}: ${p.id}${p.mapping === 'standard' ? '' : ' — non-standard mapping, buttons may not match'}`,
              el('div', {
                className: 'live num',
                textContent: [
                  `Buttons held: ${held.join(', ') || 'none'}`,
                  `Axes: ${axes.join('  ') || 'none'}`,
                  ...hats,
                ].join(' · '),
              }),
            ]);
          })
        : [el('li', { className: 'hint', textContent: 'None detected. Press a button on the pad to wake it up.' })]),
    );

    const active = poller.active();
    statActive.textContent =
      active.kind === 'raf' ? 'every animation frame' : `timer, every ${active.ms} ms`;
    if (pollKey === 'auto') {
      statActive.textContent += active.kind === 'raf' ? ' (page not focused)' : ' (page focused)';
    }
    statPoll.textContent = describe(tracker.pollMeter.summary());
    const changes = tracker.updateMeter.summary();
    statUpdate.textContent = changes
      ? `fastest ${fmt(changes.min)} ms · median ${fmt(changes.median)} ms (n=${changes.count})`
      : 'no data yet';
    const res = tracker.resolutionMs();
    const frame = frameMs(fps);
    statResolution.textContent =
      res === null ? 'no data yet' : `${fmt(res)} ms ≈ ${fmt(res / frame)} frames at ${fps} fps`;

    const coarse = res !== null && pads.length > 0 && isResolutionTooCoarse(res, fps);
    warning.hidden = !coarse;
    if (coarse) {
      warning.textContent = `Gamepad timing is only accurate to about ${fmt(res)} ms, which is ${fmt(res / frame)} frames at ${fps} fps. Gamepad results may be off by a frame; the keyboard is more precise.`;
    }
  };
  const refreshId = window.setInterval(refresh, 250);
  refresh();

  // --- control handlers ---------------------------------------------------
  fpsSelect.addEventListener('change', () => {
    fps = Number(fpsSelect.value);
    refresh();
  });
  pollSelect.addEventListener('change', () => {
    pollKey = pollSelect.value;
    poller.stop();
    tracker.resetStats();
    poller = startGamepadPolling({ tracker, mode: POLL_MODES[pollKey]!, onPress, deps });
    refresh();
  });
  clearBtn.addEventListener('click', () => {
    logBody.replaceChildren(emptyRow);
    lastPress = null;
    count = 0;
  });

  return () => {
    keyboard.stop();
    poller.stop();
    window.clearInterval(refreshId);
  };
}

function mappingTable(): HTMLElement {
  const keyFor: Record<string, string[]> = {};
  const padFor: Record<string, string[]> = {};
  for (const [code, button] of Object.entries(DEFAULT_MAPPING.keyboard)) {
    (keyFor[button] ??= []).push(code.replace(/^Key/, ''));
  }
  for (const [index, button] of Object.entries(DEFAULT_MAPPING.gamepad)) {
    (padFor[button] ??= []).push(gamepadButtonName(Number(index)));
  }
  for (const [key, button] of Object.entries(DEFAULT_MAPPING.gamepadAxes)) {
    const axis = Number(key.slice(0, -1));
    const dir = key.slice(-1) as AxisDirection;
    (padFor[button] ??= []).push(gamepadAxisName(axis, dir));
  }
  for (const [axis, hat] of Object.entries(DEFAULT_MAPPING.gamepadHats)) {
    for (const dir of HAT_DIRECTIONS) {
      (padFor[hat[dir]] ??= []).push(gamepadHatControl(Number(axis), dir));
    }
  }
  const buttons = [...new Set([...Object.keys(keyFor), ...Object.keys(padFor)])];
  return el('div', { className: 'table-wrap' }, [
    el('table', {}, [
      el('thead', {}, [
        el('tr', {}, ['Button', 'Keyboard', 'Gamepad'].map((h) => el('th', { textContent: h }))),
      ]),
      el(
        'tbody',
        {},
        buttons.map((b) =>
          el('tr', {}, [
            el('td', { textContent: b }),
            el('td', { textContent: (keyFor[b] ?? []).join(', ') }),
            el('td', { textContent: (padFor[b] ?? []).join(', ') }),
          ]),
        ),
      ),
    ]),
  ]);
}
