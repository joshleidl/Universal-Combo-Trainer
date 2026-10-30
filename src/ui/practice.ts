// Practice page (Layer 4): run attempts and show live per-step feedback, the timeline of the
// last attempt, and session stats. Rendering only: grading comes from engine/, the attempt
// flow and stats from practice/, and press events from input/.

import { validateCombo, currentStepIndex, attemptResult, type AttemptState } from '../engine/attempt';
import { DEFAULT_SETTINGS, frameMs } from '../engine/timing';
import type { Combo, Grade, Settings } from '../engine/types';
import { cloneCombo, combosEqual } from '../combo/edit';
import {
  DEFAULT_POLL_MODE,
  GamepadTracker,
  attachKeyboard,
  browserPollerDeps,
  isResolutionTooCoarse,
  startGamepadPolling,
  listBindings,
  mapControl,
  parseControl,
  toPressEvent,
  type InputMapping,
  type InputPress,
} from '../input';
import {
  buildTimeline,
  countdownBeatTimes,
  countdownGoAt,
  countdownShown,
  createPractice,
  describeAttempt,
  describeStep,
  metronomeTicks,
  practiceCues,
  timingPreview,
  type PreviewSound,
  practicePress,
  practiceRestart,
  practiceTick,
  practiceWithSettings,
  resetStats,
  rulerStep,
  shownAttempt,
  summarizeStep,
  waitingToStart,
  type Countdown,
  type PracticeState,
  type SessionStats,
} from '../practice';
import type { ScheduledSound, SoundPlayer } from '../audio/sounds';
import type { AppSettings } from '../storage/settings';
import { el } from './dom';
import type { EditorSession } from './editor';

/** The app's saved settings, shared by every page. */
export interface SettingsHolder {
  current: AppSettings;
  /** Saves and makes `settings` current. */
  save(settings: AppSettings): void;
}

/** Practice state that outlives the page, so stats survive a trip to another page. */
export interface PracticeMemory {
  /** The combo the stats belong to. Stats reset when the practiced combo changes. */
  combo: Combo | null;
  stats: SessionStats | null;
}

export function newPracticeMemory(): PracticeMemory {
  return { combo: null, stats: null };
}

/** Unmapped controls that re-arm immediately: Space, or Back / Start on a standard pad. */
const RESTART_CONTROLS = [
  { source: 'keyboard', control: 'Space', name: 'Space' },
  { source: 'gamepad', control: 'Button 9', name: 'Start' },
  { source: 'gamepad', control: 'Button 8', name: 'Back' },
] as const;
const isRestart = (press: InputPress) =>
  press.button === null && RESTART_CONTROLS.some((c) => c.source === press.source && c.control === press.control);

/** Names of the restart controls that aren't bound to a button in this mapping. */
function freeRestartNames(mapping: InputMapping): string[] {
  return RESTART_CONTROLS.filter((c) => {
    const ref = parseControl(c.source, c.control);
    return ref !== null && mapControl(mapping, ref) === null;
  }).map((c) => c.name);
}

const GRADE_CLASS: Record<Grade, string> = {
  ON_TIME: 'on-time',
  EARLY: 'early',
  LATE: 'late',
  WRONG_BUTTON: 'wrong',
  MISSED: 'missed',
};

const fmt = (n: number, digits = 1) => n.toFixed(digits);

export function renderPracticePage(
  root: HTMLElement,
  editor: EditorSession,
  memory: PracticeMemory,
  mapping: InputMapping,
  app: SettingsHolder,
  sound: SoundPlayer,
): () => void {
  const combo = cloneCombo(editor.draft);
  const header = el('header', {}, [
    el('h2', { className: 'page-title', textContent: `Practice: ${combo.name || 'untitled combo'}` }),
    el('p', {
      className: 'sub',
      textContent: `${combo.steps.length} step${combo.steps.length === 1 ? '' : 's'} · ${combo.fps} fps · ${combo.timingMode} timing · ${combo.startMode === 'countdown' ? 'countdown start' : 'starts on first input'}`,
    }),
  ]);

  // Invalid combos get a message instead of a practice view.
  const problems = validateCombo(combo);
  const blocker = problems.length > 0 ? `This combo has problems to fix in the editor first: ${problems.join('; ')}.` : null;
  if (blocker) {
    root.replaceChildren(
      header,
      el('section', { className: 'card' }, [
        el('p', { textContent: blocker }),
        el('p', {}, [el('a', { href: '#', textContent: 'Back to the editor' })]),
      ]),
    );
    return () => {};
  }

  const settings = (): Settings => ({
    ...DEFAULT_SETTINGS,
    strict: app.current.strict,
    latencyOffsetMs: { ...app.current.latencyOffsetMs },
  });
  const isCountdown = combo.startMode === 'countdown';
  const keepStats = memory.combo !== null && memory.stats !== null && combosEqual(memory.combo, combo);
  let state: PracticeState = createPractice(combo, settings(), keepStats ? (memory.stats ?? undefined) : undefined);
  memory.combo = combo;
  memory.stats = state.stats;

  // --- elements -----------------------------------------------------------
  const strictBox = el('input', { type: 'checkbox', checked: app.current.strict });
  const soundBox = el('input', { type: 'checkbox', checked: app.current.sound });
  const metronomeBox = el('input', { type: 'checkbox', checked: app.current.metronome });
  const volumeSlider = el('input', {
    type: 'range',
    min: '0',
    max: '1',
    step: '0.05',
    value: String(app.current.volume),
    ariaLabel: 'Volume',
  });
  const soundNote = el('p', { className: 'hint', hidden: true });
  const countdownBox = el('div', { className: 'countdown', ariaHidden: 'true' });
  const restartNames = freeRestartNames(mapping);
  const restartBtn = el('button', {
    type: 'button',
    textContent: restartNames.includes('Space') ? 'Restart (Space)' : 'Restart',
  });
  const previewBtn = el('button', {
    type: 'button',
    textContent: 'Hear timing',
    title: 'Play a tone where each press should land',
  });
  const statusLine = el('p', { className: 'practice-status', role: 'status' });
  const stepRow = el('ol', { className: 'practice-steps' });
  const gamepadWarning = el('p', { className: 'warning', hidden: true });
  const timelineBox = el('div', { className: 'timeline' });
  const timelineNote = el('p', { className: 'hint' });
  const statsSummary = el('p', { className: 'stats-summary' });
  const statsBody = el('tbody');
  const resetBtn = el('button', { type: 'button', textContent: 'Reset stats' });

  root.replaceChildren(
    header,
    el('section', { className: 'controls' }, [
      el('label', { className: 'check' }, [strictBox, ' Strict mode (a wrong button ends the attempt)']),
      restartBtn,
      previewBtn,
      el('a', { href: '#', textContent: 'Edit combo' }),
    ]),
    el('section', { className: 'controls sound-controls' }, [
      el('label', { className: 'check' }, [soundBox, ' Sounds']),
      el('label', { className: 'check' }, [metronomeBox, ' Metronome tick on target frames']),
      el('label', { className: 'volume' }, ['Volume ', volumeSlider]),
    ]),
    soundNote,
    el('section', { className: 'card practice-card' }, [
      countdownBox,
      statusLine,
      stepRow,
      gamepadWarning,
      el('p', { className: 'hint' }, keyHint(mapping)),
      el('p', { className: 'hint' }, latencyHint(app.current)),
    ]),
    el('section', { className: 'card' }, [el('h2', { textContent: 'Last attempt' }), timelineBox, timelineNote]),
    el('section', { className: 'card' }, [
      el('div', { className: 'card-head' }, [el('h2', { textContent: 'Session stats' }), resetBtn]),
      statsSummary,
      el('div', { className: 'table-wrap' }, [
        el('table', {}, [
          el('thead', {}, [
            el('tr', {}, ['Step', 'On time', 'Avg Δ', 'Spread'].map((h) => el('th', { textContent: h }))),
          ]),
          statsBody,
        ]),
      ]),
      el('p', { className: 'hint', textContent: 'Δ is frames early (−) or late (+) against the target frame. Spread is the standard deviation.' }),
    ]),
  );

  // --- rendering ----------------------------------------------------------
  let lastRendered: PracticeState | null = null;

  function render() {
    if (state === lastRendered) return;
    const statsChanged = lastRendered?.stats !== state.stats;
    const shownChanged = !lastRendered || shownAttempt(lastRendered) !== shownAttempt(state);
    lastRendered = state;
    memory.stats = state.stats;

    renderStatus();
    renderSteps();
    if (shownChanged) renderTimeline(state.lastFinished);
    if (statsChanged || shownChanged) renderStats();
  }

  function renderStatus() {
    const a = state.attempt;
    const next = currentStepIndex(a);
    const nextStep = next !== null ? combo.steps[next] : undefined;
    let text: string;
    let cls = '';
    const names = restartNames.join(' / ');
    const firstStep = combo.steps[0];
    const goTarget = firstStep ? `${stepName(firstStep.button, firstStep.label)} on frame ${firstStep.targetFrame} after Go` : '';
    if (a.phase === 'done') {
      const result = attemptResult(a);
      const skip = !isCountdown && names ? `; ${names} skips it` : '';
      text = `${result ? describeAttempt(result) : 'Done.'} Next attempt after the countdown. Pressing a button restarts the countdown${skip}.`;
      cls = result?.success ? 'success' : 'fail';
    } else if (state.countdown !== null) {
      // Countdown mode before Go (the attempt is already live during the last beat).
      text = `Get ready: press ${goTarget}. Pressing a button before the last beat restarts the countdown.`;
    } else if (waitingToStart(state)) {
      text = `Press any button${names ? ` or ${names}` : ''} to start the countdown, then press ${goTarget}.`;
    } else if (a.phase === 'armed' && nextStep) {
      text = `Ready. Press ${stepName(nextStep.button, nextStep.label)} to start.`;
    } else if (nextStep) {
      text = `Next: ${stepName(nextStep.button, nextStep.label)}`;
    } else {
      text = '';
    }
    statusLine.textContent = text;
    statusLine.className = `practice-status ${cls}`.trim();
  }

  function renderSteps() {
    const shown = shownAttempt(state);
    const awaiting = shown === state.attempt ? currentStepIndex(state.attempt) : null;
    stepRow.replaceChildren(
      ...combo.steps.map((step, i) => {
        const r = shown.results.find((x) => x.stepIndex === i);
        const isStart = combo.startMode === 'firstInput' && i === 0;
        const classes = ['practice-step'];
        if (r) classes.push(GRADE_CLASS[r.grade]);
        if (i === awaiting) classes.push('awaiting');
        const target = isStart ? 'start' : `${step.targetFrame}f${tolText(step.tolEarly, step.tolLate)}`;
        return el('li', { className: classes.join(' ') }, [
          el('span', { className: 'ps-button', textContent: step.button }),
          el('span', { className: 'ps-label', textContent: step.label ?? '' }),
          el('span', { className: 'ps-target', textContent: target }),
          el('span', { className: 'ps-result', textContent: r ? describeStep(r, isStart) : '' }),
        ]);
      }),
    );
  }

  function renderTimeline(attempt: AttemptState | null) {
    const tl = attempt ? buildTimeline(attempt) : null;
    if (!attempt || !tl) {
      timelineBox.replaceChildren();
      timelineNote.textContent = attempt
        ? 'The attempt ended on its first press, so there is no timeline.'
        : 'Finish an attempt to see its timeline.';
      return;
    }
    const pct = (frame: number) => `${(frame / tl.endFrame) * 100}%`;
    const lanes = tl.steps.map((s) => {
      const lane = el('div', { className: `tl-lane ${GRADE_CLASS[s.grade]}` }, [
        el('span', { className: 'tl-name', textContent: s.label ? `${s.expected} · ${s.label}` : s.expected }),
      ]);
      const track = el('div', { className: 'tl-track' });
      if (!s.isStart) {
        const win = el('div', { className: 'tl-window', title: `On-time window` });
        win.style.left = pct(s.windowStart);
        win.style.width = pct(s.windowEnd - s.windowStart);
        const target = el('div', { className: 'tl-target', title: 'Target frame' });
        target.style.left = pct(s.target);
        target.style.width = pct(1);
        track.append(win, target);
      }
      if (s.deadline !== undefined) {
        const dl = el('div', { className: 'tl-deadline', title: 'Missed after this' });
        dl.style.left = pct(s.deadline);
        track.append(dl);
      }
      if (s.input !== null) {
        const mark = el('div', {
          className: 'tl-input',
          title: s.pressed ? `Pressed ${s.pressed}` : `Pressed ${s.expected}`,
        });
        mark.style.left = pct(s.input);
        track.append(mark);
        if (s.pressed) {
          const tag = el('span', { className: 'tl-tag', textContent: s.pressed });
          tag.style.left = pct(s.input);
          track.append(tag);
        }
      }
      lane.append(track);
      return lane;
    });

    const ignoredLane = tl.ignored.length
      ? [
          el('div', { className: 'tl-lane ignored' }, [
            el('span', { className: 'tl-name', textContent: 'Ignored' }),
            el(
              'div',
              { className: 'tl-track' },
              tl.ignored.map((m) => {
                const mark = el('div', { className: 'tl-input', title: `Ignored ${m.button}` });
                mark.style.left = pct(m.frame);
                return mark;
              }),
            ),
          ]),
        ]
      : [];

    const step = rulerStep(tl.endFrame);
    const ticks: HTMLElement[] = [];
    for (let fr = 0; fr <= tl.endFrame; fr += step) {
      const t = el('span', { className: 'tl-tick', textContent: String(fr) });
      t.style.left = pct(fr);
      ticks.push(t);
    }
    timelineBox.replaceChildren(
      ...lanes,
      ...ignoredLane,
      el('div', { className: 'tl-lane ruler' }, [el('span', { className: 'tl-name', textContent: 'Frame' }), el('div', { className: 'tl-track' }, ticks)]),
    );
    const result = attemptResult(attempt);
    timelineNote.textContent = `${result ? describeAttempt(result) : ''} Shaded: on-time window. Line: target frame. Dot: your press. Frames count from ${isCountdown ? 'Go' : 'the first press'} at ${tl.fps} fps (1 frame = ${fmt(frameMs(tl.fps), 2)} ms).`;
  }

  function renderStats() {
    const st = state.stats;
    statsSummary.textContent =
      st.attempts === 0
        ? 'No attempts yet.'
        : `${st.attempts} attempt${st.attempts === 1 ? '' : 's'} · ${st.successes} clean (${fmt((st.successes / st.attempts) * 100, 0)}%) · streak ${st.streak} · best ${st.bestStreak}`;
    statsBody.replaceChildren(
      ...combo.steps.map((step, i) => {
        const sum = summarizeStep(st.steps[i] ?? { reached: 0, onTime: 0, deltas: [] });
        const isStart = combo.startMode === 'firstInput' && i === 0;
        const rate =
          sum.onTimeRate === null ? '—' : `${sum.onTime}/${sum.reached} (${fmt(sum.onTimeRate * 100, 0)}%)`;
        return el('tr', {}, [
          el('td', { textContent: `${i + 1}. ${stepName(step.button, step.label)}` }),
          el('td', { className: 'num', textContent: isStart ? (sum.reached ? `started ${sum.reached}×` : '—') : rate }),
          el('td', { className: 'num', textContent: isStart || sum.meanDelta === null ? '—' : `${sum.meanDelta > 0 ? '+' : ''}${fmt(sum.meanDelta, 2)}f` }),
          el('td', { className: 'num', textContent: isStart || sum.spread === null ? '—' : `${fmt(sum.spread, 2)}f` }),
        ]);
      }),
    );
  }

  // --- sound and countdown display ----------------------------------------
  let beatSounds: ScheduledSound[] = [];
  let beatsFor: Countdown | null = null;
  const tickSounds = new Map<string, ScheduledSound>();
  /** The last countdown, kept after "Go" so "Go!" stays up for a beat. */
  let shownCountdown: Countdown | null = null;

  function scheduleSounds(prev: PracticeState, next: PracticeState) {
    const opts = app.current;
    if (opts.sound) for (const cue of practiceCues(prev, next)) sound.play(cue);

    if (next.countdown !== beatsFor) {
      for (const b of beatSounds) b.cancel();
      beatSounds = [];
      beatsFor = next.countdown;
      if (beatsFor && opts.sound) {
        const times = countdownBeatTimes(beatsFor);
        beatSounds = times.map((t, i) => sound.play(i === times.length - 1 ? 'go' : 'beat', t));
      }
    }

    // Ticks no longer expected (step already graded, attempt over) are cancelled.
    const ticks = opts.metronome ? metronomeTicks(next.attempt) : [];
    const keep = new Set(ticks.map((t) => t.key));
    for (const [key, s] of tickSounds) {
      if (!keep.has(key)) {
        s.cancel();
        tickSounds.delete(key);
      }
    }
    const now = performance.now();
    for (const t of ticks) {
      if (!tickSounds.has(t.key) && t.at >= now) tickSounds.set(t.key, sound.play('tick', t.at));
    }
  }

  function stopSounds() {
    for (const b of beatSounds) b.cancel();
    beatSounds = [];
    beatsFor = null;
    for (const s of tickSounds.values()) s.cancel();
    tickSounds.clear();
  }

  function renderCountdown(now: number) {
    if (state.countdown) shownCountdown = state.countdown;
    else if (shownCountdown && now < countdownGoAt(shownCountdown)) shownCountdown = null; // cancelled, not finished
    const beat = countdownShown(shownCountdown, now);
    const text = beat === null ? '' : beat === 0 ? 'Go!' : String(beat);
    if (countdownBox.textContent !== text) {
      countdownBox.textContent = text;
      countdownBox.classList.toggle('go', beat === 0);
    }
  }

  function renderSoundNote() {
    const wantsSound = app.current.sound || app.current.metronome;
    soundNote.hidden = !(wantsSound && sound.blocked);
    soundNote.textContent = 'The browser holds sound back until you click the page or press a key (gamepad buttons don’t count).';
  }

  /** Moves to a new state: plays its sounds and redraws. */
  function update(next: PracticeState) {
    if (next === state) return;
    const prev = state;
    state = next;
    scheduleSounds(prev, next);
    render();
  }

  // --- timing preview -----------------------------------------------------
  /** How long a step card stays lit when its preview tone plays. */
  const PREVIEW_FLASH_MS = 150;
  let preview: { startAt: number; sounds: PreviewSound[]; handles: ScheduledSound[] } | null = null;

  /** Plays the combo's expected timing. Works with Sounds off: the user asked to hear it. */
  function startPreview() {
    stopPreview();
    sound.unlock();
    const startAt = performance.now();
    const sounds = timingPreview(combo);
    preview = { startAt, sounds, handles: sounds.map((p) => sound.play(p.kind, startAt + p.at)) };
  }

  function stopPreview() {
    if (!preview) return;
    for (const h of preview.handles) h.cancel();
    preview = null;
    renderPreview(performance.now());
  }

  /** Lights up each step card as its preview tone plays. */
  function renderPreview(now: number) {
    const lit = new Set<number>();
    if (preview) {
      const elapsed = now - preview.startAt;
      for (const p of preview.sounds) {
        if (p.stepIndex !== undefined && elapsed >= p.at && elapsed < p.at + PREVIEW_FLASH_MS) lit.add(p.stepIndex);
      }
      const last = preview.sounds[preview.sounds.length - 1];
      if (!last || elapsed > last.at + PREVIEW_FLASH_MS) preview = null;
    }
    [...stepRow.children].forEach((li, i) => li.classList.toggle('previewing', lit.has(i)));
  }

  // --- input --------------------------------------------------------------
  const onPress = (press: InputPress) => {
    // Playing the combo stops the preview, so its tones don't mix with the attempt.
    stopPreview();
    if (isRestart(press)) {
      update(practiceRestart(state, press.timestamp));
    } else {
      const ev = toPressEvent(press);
      if (ev) update(practicePress(state, ev));
    }
  };

  // Space would otherwise scroll the page or click the focused button.
  const onSpace = (e: KeyboardEvent) => {
    if (e.code === 'Space' && !(e.target instanceof HTMLInputElement && e.target.type === 'text')) e.preventDefault();
  };
  window.addEventListener('keydown', onSpace, true);
  window.addEventListener('keyup', onSpace, true);

  const keyboard = attachKeyboard(window, { mapping, onPress });
  const tracker = new GamepadTracker(mapping);
  const deps = browserPollerDeps();
  const poller = startGamepadPolling({ tracker, mode: DEFAULT_POLL_MODE, onPress, deps });

  // Ticks drive the countdown and MISSED. Grading itself uses the press timestamps.
  const onTick = () => {
    const now = performance.now();
    update(practiceTick(state, now));
    renderCountdown(now);
    renderSoundNote();
    renderPreview(now);
  };
  let frame = requestAnimationFrame(function loop() {
    onTick();
    frame = requestAnimationFrame(loop);
  });
  // rAF pauses in background tabs; a slow timer keeps the countdown and misses going there.
  const backupTick = window.setInterval(onTick, 250);

  // SPEC §5: warn when gamepad timing is coarser than about one target frame.
  const checkResolution = () => {
    const padConnected = deps.getGamepads().some((pad) => pad?.connected);
    const res = tracker.resolutionMs();
    const coarse = padConnected && res !== null && isResolutionTooCoarse(res, combo.fps);
    gamepadWarning.hidden = !coarse;
    if (coarse) {
      gamepadWarning.textContent = `Gamepad timing is only accurate to about ${fmt(res)} ms (${fmt(res / frameMs(combo.fps), 2)} frames at ${combo.fps} fps), so gamepad results may be off by a frame. Keep this tab focused for faster polling; the keyboard is more precise.`;
    }
  };
  const resolutionTimer = window.setInterval(checkResolution, 1000);

  // --- controls -----------------------------------------------------------
  const saveApp = (change: Partial<AppSettings>) => app.save({ ...app.current, ...change });
  strictBox.addEventListener('change', () => {
    saveApp({ strict: strictBox.checked });
    strictBox.blur();
    update(practiceWithSettings(state, settings()));
  });
  const onSoundChange = () => {
    saveApp({ sound: soundBox.checked, metronome: metronomeBox.checked });
    soundBox.blur();
    metronomeBox.blur();
    sound.unlock();
    // Reschedule from scratch so turning sound off silences what's already queued.
    stopSounds();
    scheduleSounds(state, state);
    if (soundBox.checked) sound.play('onTime');
  };
  soundBox.addEventListener('change', onSoundChange);
  metronomeBox.addEventListener('change', onSoundChange);
  volumeSlider.addEventListener('input', () => {
    sound.volume = Number(volumeSlider.value);
  });
  volumeSlider.addEventListener('change', () => {
    saveApp({ volume: Number(volumeSlider.value) });
    volumeSlider.blur();
    if (app.current.sound || app.current.metronome) sound.play('onTime');
  });
  previewBtn.addEventListener('click', () => {
    previewBtn.blur();
    startPreview();
  });
  restartBtn.addEventListener('click', () => {
    restartBtn.blur();
    update(practiceRestart(state, performance.now()));
  });
  resetBtn.addEventListener('click', () => {
    resetBtn.blur();
    lastRendered = null; // redraw everything, including clearing the timeline
    update(resetStats(state));
  });

  render();
  renderSoundNote();

  return () => {
    stopPreview();
    stopSounds();
    cancelAnimationFrame(frame);
    window.clearInterval(backupTick);
    window.clearInterval(resolutionTimer);
    window.removeEventListener('keydown', onSpace, true);
    window.removeEventListener('keyup', onSpace, true);
    keyboard.stop();
    poller.stop();
  };
}

function stepName(button: string, label?: string): string {
  return label ? `${button} (${label})` : button;
}

function tolText(early: number, late: number): string {
  if (early === 0 && late === 0) return '';
  if (early === late) return ` ±${early}`;
  return ` −${early}/+${late}`;
}

function latencyHint(s: AppSettings): (Node | string)[] {
  const ms = (n: number) => `${n > 0 ? '+' : ''}${n.toFixed(1)} ms`;
  return [
    `Latency offsets: keyboard ${ms(s.latencyOffsetMs.keyboard)}, gamepad ${ms(s.latencyOffsetMs.gamepad)}. `,
    el('a', { href: '#calibrate', textContent: 'Calibrate' }),
    '.',
  ];
}

function keyHint(mapping: InputMapping): (Node | string)[] {
  const byButton = new Map<string, string[]>();
  for (const b of listBindings(mapping)) {
    if (b.source !== 'keyboard') continue;
    byButton.set(b.button, [...(byButton.get(b.button) ?? []), b.label]);
  }
  const keys = [...byButton].map(([b, k]) => `${k.join('/')} = ${b}`).join(', ');
  return [
    `Keyboard: ${keys || 'no keys bound'}. `,
    el('a', { href: '#controls', textContent: 'Change controls' }),
    '. Space, and Start/Back on a pad, restart while they aren’t bound to a button.',
  ];
}
