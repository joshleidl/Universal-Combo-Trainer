import './style.css';
import { SoundPlayer } from './audio/sounds';
import { ComboStore, memoryStorage, type StorageLike } from './storage/combos';
import { loadMapping, resetMapping, saveMapping } from './storage/mapping';
import { loadSettings, saveSettings } from './storage/settings';
import { renderCalibratePage } from './ui/calibrate';
import { renderControlsPage, type MappingHolder } from './ui/controls';
import { renderDebugPage } from './ui/debug';
import { el } from './ui/dom';
import { decodeCombo, shareCodeFromHash } from './combo/share';
import { cloneCombo } from './combo/edit';
import { initialSession, isDirty, renderEditorPage } from './ui/editor';
import { createPadBanner } from './ui/padBanner';
import { newPracticeMemory, renderPracticePage, type SettingsHolder } from './ui/practice';

/** localStorage, or an in-memory stand-in when the browser blocks it (e.g. some private modes). */
function openStorage(): { storage: StorageLike; persistent: boolean } {
  try {
    const probe = '__uct_probe__';
    window.localStorage.setItem(probe, probe);
    window.localStorage.removeItem(probe);
    return { storage: window.localStorage, persistent: true };
  } catch {
    return { storage: memoryStorage(), persistent: false };
  }
}

const app = document.querySelector<HTMLDivElement>('#app');
if (app) {
  const { storage, persistent } = openStorage();
  const store = new ComboStore(storage);
  const session = initialSession(store);
  const practice = newPracticeMemory();
  const controls: MappingHolder = {
    current: loadMapping(storage),
    save(mapping) {
      saveMapping(storage, mapping);
      this.current = mapping;
    },
    reset() {
      this.current = resetMapping(storage);
    },
  };

  const settings: SettingsHolder = {
    current: loadSettings(storage),
    save(next) {
      saveSettings(storage, next);
      this.current = next;
    },
  };
  const sound = new SoundPlayer();
  sound.volume = settings.current.volume;
  // Browsers only allow audio after a click or key press on the page.
  const unlockAudio = () => {
    if (settings.current.sound || settings.current.metronome) sound.unlock();
  };
  window.addEventListener('pointerdown', unlockAudio, true);
  window.addEventListener('keydown', unlockAudio, true);

  const routes = {
    editor: { hash: '#', label: 'Combos', render: (root: HTMLElement) => renderEditorPage(root, store, session) },
    practice: { hash: '#practice', label: 'Practice', render: (root: HTMLElement) => renderPracticePage(root, session, practice, controls.current, settings, sound) },
    controls: { hash: '#controls', label: 'Controls', render: (root: HTMLElement) => renderControlsPage(root, controls, () => {
      if (settings.current.sound) sound.play('bound');
    }) },
    calibrate: { hash: '#calibrate', label: 'Calibrate', render: (root: HTMLElement) => renderCalibratePage(root, controls.current, settings, sound) },
    debug: { hash: '#debug', label: 'Input debug', render: (root: HTMLElement) => renderDebugPage(root, controls.current) },
  } as const;
  type Route = keyof typeof routes;

  const navLinks = Object.entries(routes).map(([key, r]) => {
    const a = el('a', { href: r.hash, textContent: r.label });
    a.dataset.route = key;
    return a;
  });
  const page = el('main');
  app.replaceChildren(
    createPadBanner(settings),
    el('header', { className: 'app-header' }, [
      el('h1', { textContent: 'Combo Timing Trainer' }),
      el('nav', {}, navLinks),
    ]),
    ...(persistent
      ? []
      : [el('p', { className: 'warning', textContent: 'This browser is blocking storage, so saved combos will be lost when you close the page.' })]),
    page,
  );

  let cleanup: (() => void) | null = null;
  /** Opens a `#share=` link in the editor as a new, unsaved combo, then clears it from the URL. */
  const openShareLink = () => {
    const code = shareCodeFromHash(location.hash);
    if (code === null) return;
    history.replaceState(null, '', `${location.pathname}${location.search}#`);
    const combo = decodeCombo(code);
    if (!combo) {
      session.notice = 'That share link is damaged or incomplete, so nothing was opened.';
      return;
    }
    const replace =
      !isDirty(session) ||
      window.confirm(`Open the shared combo "${combo.name}"? Unsaved changes to "${session.draft.name || 'this combo'}" will be lost.`);
    if (!replace) return;
    session.id = null;
    session.baseline = combo;
    session.draft = cloneCombo(combo);
    session.notice = `Opened the shared combo "${combo.name}". It isn’t saved yet: press Save to keep it.`;
  };

  const show = () => {
    openShareLink();
    const route = (Object.keys(routes) as Route[]).find((r) => r !== 'editor' && routes[r].hash === location.hash) ?? 'editor';
    cleanup?.();
    cleanup = routes[route].render(page);
    for (const a of navLinks) {
      if (a.dataset.route === route) a.setAttribute('aria-current', 'page');
      else a.removeAttribute('aria-current');
    }
  };
  window.addEventListener('hashchange', show);
  show();
}
