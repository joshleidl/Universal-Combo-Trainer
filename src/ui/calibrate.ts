// Latency calibration page (SPEC §6): tap along to a steady beat, then use the median offset for
// that input source. Rendering only: the beat schedule and the math live in calibration/.

import type { ScheduledSound, SoundPlayer } from '../audio/sounds';
import {
  CAL_BEATS,
  CAL_COUNT_IN,
  CAL_MIN_TAPS,
  beatTimes,
  calibrationFinished,
  calibrationPhase,
  calibrationResults,
  calibrationTap,
  createCalibration,
  type CalibrationState,
} from '../calibration/calibration';
import type { InputSource } from '../engine/types';
import {
  DEFAULT_POLL_MODE,
  GamepadTracker,
  attachKeyboard,
  browserPollerDeps,
  startGamepadPolling,
  type InputMapping,
  type InputPress,
} from '../input';
import { MAX_LATENCY_OFFSET_MS, isLatencyOffset } from '../storage/settings';
import { el } from './dom';
import type { SettingsHolder } from './practice';

/** How long the pulse stays lit after each beat. */
const PULSE_MS = 100;
/** Tapping less steady than this (standard deviation) gets a "try again" hint. */
const UNSTEADY_MS = 30;

const SOURCE_NAME: Record<InputSource, string> = { keyboard: 'Keyboard', gamepad: 'Gamepad' };
const signedMs = (n: number) => `${n > 0 ? '+' : n < 0 ? '−' : ''}${Math.abs(n).toFixed(1)} ms`;

export function renderCalibratePage(
  root: HTMLElement,
  mapping: InputMapping,
  app: SettingsHolder,
  sound: SoundPlayer,
): () => void {
  let run: CalibrationState | null = null;
  let beats: ScheduledSound[] = [];

  // --- elements -----------------------------------------------------------
  const pulse = el('div', { className: 'cal-pulse', ariaHidden: 'true' });
  const statusLine = el('p', { className: 'practice-status', role: 'status' });
  const tapLine = el('p', { className: 'hint' });
  const startBtn = el('button', { type: 'button', className: 'primary', textContent: 'Start' });
  const stopBtn = el('button', { type: 'button', textContent: 'Stop', disabled: true });
  const soundNote = el('p', { className: 'hint', hidden: true });
  const resultCard = el('section', { className: 'card', hidden: true });
  const offsetInputs = {} as Record<InputSource, HTMLInputElement>;
  const offsetRows = (['keyboard', 'gamepad'] as const).map((source) => {
    const input = el('input', {
      type: 'number',
      step: '0.1',
      min: String(-MAX_LATENCY_OFFSET_MS),
      max: String(MAX_LATENCY_OFFSET_MS),
      className: 'num-input',
      id: `offset-${source}`,
    });
    offsetInputs[source] = input;
    input.addEventListener('change', () => {
      const v = input.valueAsNumber;
      if (isLatencyOffset(v)) setOffset(source, v);
      else showOffsets();
    });
    const zero = el('button', { type: 'button', textContent: 'Set to 0' });
    zero.addEventListener('click', () => {
      zero.blur();
      setOffset(source, 0);
    });
    return el('div', { className: 'offset-row' }, [
      el('label', { htmlFor: input.id, textContent: SOURCE_NAME[source] }),
      input,
      el('span', { textContent: 'ms' }),
      zero,
    ]);
  });

  root.replaceChildren(
    el('header', {}, [
      el('h2', { className: 'page-title', textContent: 'Latency calibration' }),
      el('p', {
        className: 'sub',
        textContent: 'Measures the delay between a beat and your press, so countdown starts and the metronome line up with how you play.',
      }),
    ]),
    el('section', { className: 'card cal-card' }, [
      el('p', {}, [
        `Press Start, listen to ${CAL_COUNT_IN} count-in beats, then tap any button exactly on each of the next ${CAL_BEATS} beats. `,
        'Tap with the keyboard or gamepad you practice with; each one gets its own offset. Follow the sound if you can: the flash is a guide.',
      ]),
      el('div', { className: 'cal-stage' }, [pulse, el('div', {}, [statusLine, tapLine])]),
      el('div', { className: 'actions' }, [startBtn, stopBtn]),
      soundNote,
    ]),
    resultCard,
    el('section', { className: 'card' }, [
      el('h2', { textContent: 'Offsets in use' }),
      el('p', { className: 'hint', textContent: 'Subtracted from every press before grading. Positive means your presses register late. Type a value or set it to 0.' }),
      ...offsetRows,
      el('p', {
        className: 'hint',
        textContent:
          'When it matters: countdown starts (step 1 is timed from Go) and the metronome. In first-input combos every press shifts by the same amount, so the offset cancels out, unless you mix keyboard and gamepad in one attempt.',
      }),
    ]),
  );

  // --- offsets ------------------------------------------------------------
  function setOffset(source: InputSource, ms: number) {
    const value = Math.round(ms * 10) / 10;
    app.save({ ...app.current, latencyOffsetMs: { ...app.current.latencyOffsetMs, [source]: value } });
    showOffsets();
    if (!resultCard.hidden && run) renderResults(run);
  }

  function showOffsets() {
    for (const source of ['keyboard', 'gamepad'] as const) {
      offsetInputs[source].value = String(app.current.latencyOffsetMs[source]);
    }
  }

  // --- run ----------------------------------------------------------------
  function start() {
    stopBeats();
    sound.unlock();
    run = createCalibration(performance.now());
    const times = beatTimes(run);
    beats = times.map((t, i) => sound.play(i < CAL_COUNT_IN ? 'beat' : 'tick', t));
    resultCard.hidden = true;
    tapLine.textContent = '';
    startBtn.textContent = 'Start over';
    stopBtn.disabled = false;
  }

  function stop(message: string) {
    stopBeats();
    stopBtn.disabled = true;
    startBtn.textContent = 'Start';
    statusLine.textContent = message;
    pulse.textContent = '';
    pulse.classList.remove('on');
  }

  function stopBeats() {
    for (const b of beats) b.cancel();
    beats = [];
  }

  function finish(state: CalibrationState) {
    stop('Done. Check the result below.');
    renderResults(state);
  }

  function renderResults(state: CalibrationState) {
    const results = calibrationResults(state);
    resultCard.hidden = false;
    if (results.length === 0) {
      resultCard.replaceChildren(
        el('h2', { textContent: 'Result' }),
        el('p', { textContent: 'No taps were recorded. Tap on each beat after the count-in, then try again.' }),
      );
      return;
    }
    resultCard.replaceChildren(
      el('h2', { textContent: 'Result' }),
      ...results.map((r) => {
        const current = app.current.latencyOffsetMs[r.source];
        const suggested = Math.round(r.medianMs * 10) / 10;
        const notes: string[] = [];
        if (!r.usable) notes.push(`Only ${r.count} taps landed near a beat; at least ${CAL_MIN_TAPS} are needed. Try again.`);
        else if (r.spreadMs > UNSTEADY_MS) notes.push('Your taps varied a lot, so this may be off. Consider trying again.');
        const use = el('button', {
          type: 'button',
          className: 'primary',
          textContent: current === suggested ? 'In use' : `Use ${signedMs(suggested)}`,
          disabled: !r.usable || current === suggested,
        });
        use.addEventListener('click', () => {
          use.blur();
          setOffset(r.source, suggested);
        });
        return el('div', { className: 'cal-result' }, [
          el('p', {}, [
            el('strong', { textContent: `${SOURCE_NAME[r.source]}: ${signedMs(r.medianMs)}` }),
            ` (median of ${r.count} taps, spread ${r.spreadMs.toFixed(1)} ms). Currently ${signedMs(current)}.`,
          ]),
          ...notes.map((n) => el('p', { className: 'warning', textContent: n })),
          use,
        ]);
      }),
    );
  }

  // --- display ------------------------------------------------------------
  function renderRun(now: number) {
    if (!run || stopBtn.disabled) return;
    if (calibrationFinished(run, now)) {
      finish(run);
      return;
    }
    const phase = calibrationPhase(run, now);
    const lit = beatTimes(run).some((t) => now >= t && now < t + PULSE_MS);
    pulse.classList.toggle('on', lit);
    pulse.classList.toggle('count-in', phase.kind === 'countIn');
    let text = '';
    let label = '';
    if (phase.kind === 'waiting') label = 'Get ready…';
    else if (phase.kind === 'countIn') {
      text = String(phase.left);
      label = 'Count-in: listen, don’t tap yet.';
    } else if (phase.kind === 'recording') {
      text = String(phase.beat);
      label = `Tap on every beat: ${phase.beat} of ${CAL_BEATS}.`;
    }
    if (pulse.textContent !== text) pulse.textContent = text;
    if (statusLine.textContent !== label) statusLine.textContent = label;
    soundNote.hidden = !sound.blocked;
    soundNote.textContent = 'The browser is holding sound back. Click the page or press a key, then press Start again.';
  }

  // --- input --------------------------------------------------------------
  const onPress = (press: InputPress) => {
    if (press.source === 'keyboard' && press.control === 'Escape') {
      if (!stopBtn.disabled) stop('Stopped.');
      return;
    }
    if (!run || stopBtn.disabled) return;
    const next = calibrationTap(run, press.source, press.timestamp);
    if (next === run) return;
    run = next;
    const tap = next.taps[next.taps.length - 1];
    if (tap) {
      const counts = calibrationResults(next).map((r) => `${SOURCE_NAME[r.source].toLowerCase()} ${r.count}`);
      tapLine.textContent = `Last tap: ${signedMs(tap.offsetMs)} (${tap.source}). Taps so far: ${counts.join(', ')}.`;
    }
  };

  // Space would otherwise scroll the page or click the focused button.
  const onSpace = (e: KeyboardEvent) => {
    if (e.code === 'Space' && !(e.target instanceof HTMLInputElement)) e.preventDefault();
  };
  window.addEventListener('keydown', onSpace, true);

  const keyboard = attachKeyboard(window, { mapping, onPress });
  const tracker = new GamepadTracker(mapping);
  const poller = startGamepadPolling({ tracker, mode: DEFAULT_POLL_MODE, onPress, deps: browserPollerDeps() });

  let frame = requestAnimationFrame(function loop() {
    renderRun(performance.now());
    frame = requestAnimationFrame(loop);
  });
  // rAF pauses in background tabs; this still ends the run there.
  const backup = window.setInterval(() => renderRun(performance.now()), 250);

  startBtn.addEventListener('click', () => {
    startBtn.blur();
    start();
  });
  stopBtn.addEventListener('click', () => {
    stopBtn.blur();
    stop('Stopped.');
  });

  showOffsets();
  statusLine.textContent = 'Press Start when ready.';

  return () => {
    stopBeats();
    cancelAnimationFrame(frame);
    window.clearInterval(backup);
    window.removeEventListener('keydown', onSpace, true);
    keyboard.stop();
    poller.stop();
  };
}
