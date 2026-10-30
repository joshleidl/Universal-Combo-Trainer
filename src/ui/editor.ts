// Combo editor page (Layer 3): build, save, load and delete combos.
// Rendering only. Combo edits come from combo/, saving from storage/, frame math from engine/.

import {
  addStep,
  cloneCombo,
  combosEqual,
  moveStep,
  newCombo,
  onTimeWindow,
  removeStep,
  updateStep,
  type StepPatch,
} from '../combo/edit';
import { SHARE_PREFIX, encodeCombo } from '../combo/share';
import { validateCombo } from '../engine/attempt';
import type { Combo, StartMode, Step, TimingMode } from '../engine/types';
import { BUTTON_IDS } from '../input/mapping';
import { validateForSave, type ComboStore } from '../storage/combos';
import { el } from './dom';

/** Editor state that outlives the page, so switching to another page keeps unsaved edits. */
export interface EditorSession {
  /** Id of the saved combo being edited, or null for one not saved yet. */
  id: string | null;
  draft: Combo;
  /** What the draft is compared against to detect unsaved changes. */
  baseline: Combo;
  /** One-time message for the next time the editor opens (e.g. after opening a share link). */
  notice?: string;
}

const FPS_PRESETS = [30, 60, 120];

const TIMING_HINTS: Record<TimingMode, string> = {
  relative: 'Relative: each step’s target frame counts from the previous input.',
  absolute: 'Absolute: every target frame counts from frame 0 of the attempt.',
};
const START_HINTS: Record<StartMode, string> = {
  firstInput: 'First input: pressing step 1 starts the attempt (frame 0), so step 1 only checks the button.',
  countdown: 'Countdown: a countdown sets frame 0 and step 1 is timed like any other step.',
};

/** Opens the last combo the user had open, else the first saved one, else a new draft. */
export function initialSession(store: ComboStore): EditorSession {
  const lastId = store.lastOpenedId();
  const saved = (lastId !== null ? store.get(lastId) : undefined) ?? store.list()[0];
  if (saved) return { id: saved.id, draft: cloneCombo(saved.combo), baseline: saved.combo };
  const fresh = newCombo();
  return { id: null, draft: cloneCombo(fresh), baseline: fresh };
}

export function isDirty(session: EditorSession): boolean {
  return !combosEqual(session.draft, session.baseline);
}

export function renderEditorPage(root: HTMLElement, store: ComboStore, session: EditorSession): () => void {
  // --- elements -----------------------------------------------------------
  const comboList = el('ul', { className: 'combo-list' });
  const newBtn = el('button', { type: 'button', textContent: 'New combo' });

  const nameInput = el('input', { type: 'text', id: 'combo-name', autocomplete: 'off' });
  const fpsInput = el('input', { type: 'number', id: 'combo-fps', min: '1', step: 'any', className: 'num-input' });
  fpsInput.setAttribute('list', 'fps-presets');
  const fpsPresets = el(
    'datalist',
    { id: 'fps-presets' },
    FPS_PRESETS.map((v) => el('option', { value: String(v) })),
  );
  const timingSelect = el('select', { id: 'combo-timing' }, [
    el('option', { value: 'relative', textContent: 'Relative (default)' }),
    el('option', { value: 'absolute', textContent: 'Absolute' }),
  ]);
  const startSelect = el('select', { id: 'combo-start' }, [
    el('option', { value: 'firstInput', textContent: 'First input (default)' }),
    el('option', { value: 'countdown', textContent: 'Countdown' }),
  ]);
  const modeHints = el('div', { className: 'mode-hints' });

  const stepList = el('ol', { className: 'steps' });
  const addBtn = el('button', { type: 'button', textContent: '+ Add step' });

  const errorList = el('ul', { className: 'errors', hidden: true });
  const saveBtn = el('button', { type: 'button', className: 'primary', textContent: 'Save' });
  const saveAsBtn = el('button', { type: 'button', textContent: 'Save as new' });
  const revertBtn = el('button', { type: 'button', textContent: 'Revert' });
  const deleteBtn = el('button', { type: 'button', className: 'danger', textContent: 'Delete' });
  const status = el('span', { className: 'status', role: 'status' });
  const practiceBtn = el('button', { type: 'button', className: 'practice-btn', textContent: 'Practice ▶' });
  const shareBtn = el('button', { type: 'button', textContent: 'Copy share link' });
  const notice = el('p', { className: 'notice', role: 'status', hidden: !session.notice, textContent: session.notice ?? '' });
  delete session.notice;

  root.replaceChildren(
    el('section', { className: 'card' }, [
      el('div', { className: 'card-head' }, [el('h2', { textContent: 'Saved combos' }), newBtn]),
      comboList,
    ]),
    el('section', { className: 'card editor' }, [
      el('div', { className: 'card-head' }, [el('h2', { textContent: 'Edit combo' }), practiceBtn]),
      notice,
      el('div', { className: 'fields' }, [
        el('label', { className: 'field grow' }, [el('span', { textContent: 'Name' }), nameInput]),
        el('label', { className: 'field' }, [el('span', { textContent: 'Framerate (fps)' }), fpsInput, fpsPresets]),
        el('label', { className: 'field' }, [el('span', { textContent: 'Timing' }), timingSelect]),
        el('label', { className: 'field' }, [el('span', { textContent: 'Start' }), startSelect]),
      ]),
      modeHints,
      el('h2', { textContent: 'Steps' }),
      stepList,
      addBtn,
      errorList,
      el('div', { className: 'actions' }, [saveBtn, saveAsBtn, revertBtn, deleteBtn, shareBtn, status]),
    ]),
  );

  // --- step rows ----------------------------------------------------------
  interface StepRow {
    targetInput: HTMLInputElement;
    earlyInput: HTMLInputElement;
    lateInput: HTMLInputElement;
    windowText: HTMLElement;
    upBtn: HTMLButtonElement;
    downBtn: HTMLButtonElement;
  }
  let rows: StepRow[] = [];

  const setDraft = (draft: Combo) => {
    session.draft = draft;
  };

  const numberInput = (value: number, label: string) =>
    el('input', {
      type: 'number',
      min: '0',
      step: '1',
      inputMode: 'numeric',
      className: 'num-input',
      value: Number.isFinite(value) ? String(value) : '',
      ariaLabel: label,
    });

  function buildStepRow(step: Step, index: number): HTMLLIElement {
    const n = index + 1;
    const buttonSelect = el(
      'select',
      { ariaLabel: `Step ${n} button` },
      // Keep an unknown button (e.g. from hand-edited data) selectable rather than silently changing it.
      [...new Set([...BUTTON_IDS, step.button])].map((b) =>
        el('option', { value: b, textContent: b, selected: b === step.button }),
      ),
    );
    const targetInput = numberInput(step.targetFrame, `Step ${n} target frame`);
    const earlyInput = numberInput(step.tolEarly, `Step ${n} early tolerance`);
    const lateInput = numberInput(step.tolLate, `Step ${n} late tolerance`);
    const labelInput = el('input', {
      type: 'text',
      value: step.label ?? '',
      placeholder: 'e.g. cr.MK',
      ariaLabel: `Step ${n} label`,
      autocomplete: 'off',
    });
    const windowText = el('span', { className: 'step-window' });
    const upBtn = el('button', { type: 'button', textContent: '↑', title: 'Move up', ariaLabel: `Move step ${n} up` });
    const downBtn = el('button', { type: 'button', textContent: '↓', title: 'Move down', ariaLabel: `Move step ${n} down` });
    const removeBtn = el('button', { type: 'button', textContent: '✕', title: 'Remove step', ariaLabel: `Remove step ${n}` });

    const patch = (p: StepPatch) => {
      setDraft(updateStep(session.draft, index, p));
      refresh();
    };
    buttonSelect.addEventListener('change', () => patch({ button: buttonSelect.value }));
    targetInput.addEventListener('input', () => patch({ targetFrame: targetInput.valueAsNumber }));
    earlyInput.addEventListener('input', () => patch({ tolEarly: earlyInput.valueAsNumber }));
    lateInput.addEventListener('input', () => patch({ tolLate: lateInput.valueAsNumber }));
    labelInput.addEventListener('input', () => patch({ label: labelInput.value }));
    upBtn.addEventListener('click', () => move(index, index - 1, 'up'));
    downBtn.addEventListener('click', () => move(index, index + 1, 'down'));
    removeBtn.addEventListener('click', () => {
      setDraft(removeStep(session.draft, index));
      rebuildSteps();
      const next = stepList.querySelectorAll<HTMLButtonElement>('.step-remove')[Math.min(index, rows.length - 1)];
      (next ?? addBtn).focus();
    });
    removeBtn.classList.add('step-remove');

    rows.push({ targetInput, earlyInput, lateInput, windowText, upBtn, downBtn });

    return el('li', { className: 'step' }, [
      el('span', { className: 'step-num', textContent: String(n) }),
      el('label', { className: 'field' }, [el('span', { textContent: 'Button' }), buttonSelect]),
      el('label', { className: 'field' }, [el('span', { textContent: 'Target frame' }), targetInput]),
      el('label', { className: 'field' }, [el('span', { textContent: 'Early tol.' }), earlyInput]),
      el('label', { className: 'field' }, [el('span', { textContent: 'Late tol.' }), lateInput]),
      el('label', { className: 'field grow' }, [el('span', { textContent: 'Label (optional)' }), labelInput]),
      el('div', { className: 'step-actions' }, [upBtn, downBtn, removeBtn]),
      windowText,
    ]);
  }

  function move(from: number, to: number, dir: 'up' | 'down') {
    setDraft(moveStep(session.draft, from, to));
    rebuildSteps();
    // Keep focus on the moved step's button so repeated moves work from the keyboard.
    const row = rows[to];
    const target = row && (dir === 'up' ? row.upBtn : row.downBtn);
    (target && !target.disabled ? target : (dir === 'up' ? row?.downBtn : row?.upBtn))?.focus();
  }

  function rebuildSteps() {
    rows = [];
    stepList.replaceChildren(...session.draft.steps.map(buildStepRow));
    refresh();
  }

  // --- whole-form updates -------------------------------------------------

  /** Writes the draft into every field. Used on load, revert and new. */
  function loadFields() {
    const d = session.draft;
    nameInput.value = d.name;
    fpsInput.value = Number.isFinite(d.fps) ? String(d.fps) : '';
    timingSelect.value = d.timingMode;
    startSelect.value = d.startMode;
    rebuildSteps();
    renderList();
  }

  /** Updates everything derived from the draft without rebuilding inputs (keeps focus). */
  function refresh() {
    const d = session.draft;
    const firstInputStart = d.startMode === 'firstInput';
    const from = d.timingMode === 'relative' ? 'after the previous input' : 'after frame 0';
    const fpsOk = Number.isFinite(d.fps) && d.fps > 0;

    modeHints.replaceChildren(
      el('p', { className: 'hint', textContent: TIMING_HINTS[d.timingMode] }),
      el('p', { className: 'hint', textContent: START_HINTS[d.startMode] }),
    );

    rows.forEach((row, i) => {
      const step = d.steps[i];
      if (!step) return;
      const startsAttempt = i === 0 && firstInputStart;
      for (const input of [row.targetInput, row.earlyInput, row.lateInput]) input.disabled = startsAttempt;
      row.upBtn.disabled = i === 0;
      row.downBtn.disabled = i === d.steps.length - 1;
      row.windowText.textContent = startsAttempt
        ? 'Starts the attempt (frame 0). Timing is not checked.'
        : windowDescription(step, d.fps, fpsOk, i === 0 ? 'after frame 0' : from);
    });

    const errors = validateForSave(d);
    errorList.hidden = errors.length === 0;
    errorList.replaceChildren(...errors.map((e) => el('li', { textContent: friendlyError(e) })));

    const dirty = isDirty(session);
    saveBtn.disabled = errors.length > 0 || (!dirty && session.id !== null);
    saveAsBtn.disabled = errors.length > 0;
    practiceBtn.disabled = validateCombo(d).length > 0;
    shareBtn.disabled = validateCombo(d).length > 0;
    practiceBtn.title = dirty ? 'Practices the combo as edited, including unsaved changes' : '';
    revertBtn.disabled = !dirty;
    deleteBtn.disabled = session.id === null;
    if (session.id === null) setStatus('Not saved yet');
    else setStatus(dirty ? 'Unsaved changes' : 'Saved', dirty ? 'dirty' : '');
  }

  function setStatus(text: string, kind: '' | 'dirty' | 'error' = '') {
    status.textContent = text;
    status.className = `status ${kind}`.trim();
  }

  function renderList() {
    const saved = store.list();
    if (saved.length === 0) {
      comboList.replaceChildren(el('li', { className: 'empty', textContent: 'No saved combos yet.' }));
      return;
    }
    comboList.replaceChildren(
      ...saved.map(({ id, combo }) => {
        const current = id === session.id;
        const btn = el('button', { type: 'button', className: current ? 'combo current' : 'combo' }, [
          el('span', { className: 'combo-name', textContent: combo.name }),
          el('span', {
            className: 'combo-meta',
            textContent: `${combo.steps.length} step${combo.steps.length === 1 ? '' : 's'} · ${combo.fps} fps · ${combo.timingMode}`,
          }),
        ]);
        if (current) btn.setAttribute('aria-current', 'true');
        btn.addEventListener('click', () => {
          if (current || !confirmDiscard()) return;
          open(id);
        });
        return el('li', {}, [btn]);
      }),
    );
  }

  function open(id: string) {
    const saved = store.get(id);
    if (!saved) return;
    session.id = id;
    session.baseline = saved.combo;
    setDraft(cloneCombo(saved.combo));
    store.setLastOpened(id);
    loadFields();
  }

  function startNew() {
    const fresh = newCombo();
    session.id = null;
    session.baseline = fresh;
    setDraft(cloneCombo(fresh));
    loadFields();
    nameInput.select();
  }

  function confirmDiscard(): boolean {
    if (!isDirty(session)) return true;
    return window.confirm(`Discard unsaved changes to "${session.draft.name || 'this combo'}"?`);
  }

  /** Runs a storage write, showing a message instead of throwing (e.g. storage full). */
  function tryStore(write: () => void): boolean {
    try {
      write();
      return true;
    } catch (err) {
      setStatus(`Couldn’t save: ${err instanceof Error ? err.message : String(err)}`, 'error');
      return false;
    }
  }

  // --- events -------------------------------------------------------------
  nameInput.addEventListener('input', () => {
    setDraft({ ...session.draft, name: nameInput.value });
    refresh();
  });
  fpsInput.addEventListener('input', () => {
    setDraft({ ...session.draft, fps: fpsInput.valueAsNumber });
    refresh();
  });
  timingSelect.addEventListener('change', () => {
    setDraft({ ...session.draft, timingMode: timingSelect.value as TimingMode });
    refresh();
  });
  startSelect.addEventListener('change', () => {
    setDraft({ ...session.draft, startMode: startSelect.value as StartMode });
    refresh();
  });
  addBtn.addEventListener('click', () => {
    setDraft(addStep(session.draft));
    rebuildSteps();
    rows.at(-1)?.targetInput.focus();
  });
  shareBtn.addEventListener('click', () => {
    // Shares the combo as shown, including unsaved changes.
    const url = `${location.origin}${location.pathname}${location.search}${SHARE_PREFIX}${encodeCombo(session.draft)}`;
    const fallback = () => window.prompt('Copy this link to share the combo:', url);
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(url).then(
        () => setStatus('Share link copied'),
        () => fallback(),
      );
    } else {
      fallback();
    }
  });
  practiceBtn.addEventListener('click', () => {
    location.hash = '#practice';
  });
  newBtn.addEventListener('click', () => {
    if (confirmDiscard()) startNew();
  });
  saveBtn.addEventListener('click', () => {
    const ok = tryStore(() => {
      const saved =
        session.id === null ? store.create(session.draft) : store.update(session.id, session.draft);
      adoptSaved(saved.id, saved.combo);
    });
    if (ok) setStatus('Saved');
  });
  saveAsBtn.addEventListener('click', () => {
    const name =
      session.id !== null && session.draft.name.trim() === session.baseline.name
        ? `${session.draft.name.trim()} (copy)`
        : session.draft.name;
    const ok = tryStore(() => {
      const saved = store.create({ ...session.draft, name });
      adoptSaved(saved.id, saved.combo);
    });
    if (ok) setStatus('Saved as a new combo');
  });
  revertBtn.addEventListener('click', () => {
    setDraft(cloneCombo(session.baseline));
    loadFields();
  });
  deleteBtn.addEventListener('click', () => {
    if (session.id === null) return;
    if (!window.confirm(`Delete "${session.baseline.name}"? This can’t be undone.`)) return;
    if (!tryStore(() => store.delete(session.id as string))) return;
    const next = store.list()[0];
    if (next) open(next.id);
    else startNew();
  });

  /** After a save, the stored (normalized) combo becomes both the baseline and the draft. */
  function adoptSaved(id: string, combo: Combo) {
    session.id = id;
    session.baseline = combo;
    setDraft(cloneCombo(combo));
    store.setLastOpened(id);
    loadFields();
  }

  const onBeforeUnload = (e: BeforeUnloadEvent) => {
    if (!isDirty(session)) return;
    e.preventDefault();
    e.returnValue = '';
  };
  window.addEventListener('beforeunload', onBeforeUnload);

  loadFields();

  return () => {
    window.removeEventListener('beforeunload', onBeforeUnload);
  };
}

function windowDescription(step: Step, fps: number, fpsOk: boolean, from: string): string {
  const ints = [step.targetFrame, step.tolEarly, step.tolLate].every((n) => Number.isInteger(n) && n >= 0);
  if (!ints || !fpsOk) return '';
  const w = onTimeWindow(step, fps);
  const frames = w.firstFrame === w.lastFrame ? `frame ${w.firstFrame}` : `frames ${w.firstFrame} to ${w.lastFrame}`;
  return `On time: ${frames}, ${w.startMs.toFixed(1)} to ${w.endMs.toFixed(1)} ms ${from}.`;
}

const FIELD_NAMES: Record<string, string> = {
  targetFrame: 'target frame',
  tolEarly: 'early tolerance',
  tolLate: 'late tolerance',
  fps: 'framerate',
};

/** Turns an engine validation message into plain wording for the page. */
function friendlyError(message: string): string {
  const text = message.replace(/\b(targetFrame|tolEarly|tolLate|fps)\b/g, (m) => FIELD_NAMES[m] ?? m);
  return text.charAt(0).toUpperCase() + text.slice(1);
}
