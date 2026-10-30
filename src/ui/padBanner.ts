// App-wide banner asking the user to press a button on their controller so the browser starts
// reporting it, then briefly confirming once it's detected. State logic lives in input/wake.ts.

import { PAD_BANNER_START, nextPadBanner, type PadBanner } from '../input/wake';
import { el } from './dom';
import type { SettingsHolder } from './practice';

/** How often to look for pads. Cheap: it only reads navigator.getGamepads(). */
const CHECK_MS = 250;

/** Creates the banner and keeps it updated for the life of the app. */
export function createPadBanner(app: SettingsHolder): HTMLElement {
  const text = el('span', { className: 'pad-banner-text' });
  const dismiss = el('button', { type: 'button', className: 'pad-banner-dismiss', textContent: 'Dismiss' });
  const banner = el('div', { className: 'pad-banner', role: 'status', hidden: true }, [text, dismiss]);

  let state: PadBanner = PAD_BANNER_START;

  const padIds = (): string[] => {
    try {
      return [...(navigator.getGamepads?.() ?? [])].filter((p): p is Gamepad => !!p && p.connected).map((p) => p.id);
    } catch {
      return []; // Blocked by a permissions policy, or no Gamepad API.
    }
  };

  const update = () => {
    const next = nextPadBanner(state, padIds(), performance.now(), app.current.padBannerDismissed);
    if (next === state) return;
    state = next;
    banner.hidden = state.kind === 'hidden';
    banner.classList.toggle('detected', state.kind === 'detected');
    dismiss.hidden = state.kind !== 'waiting';
    if (state.kind === 'waiting') {
      text.textContent =
        'Using a controller or arcade stick? Press any button on it to wake it up: browsers hide controllers until one is pressed.';
    } else if (state.kind === 'detected') {
      text.textContent = `✓ Controller detected: ${state.name}. You’re ready to go.`;
    }
  };

  dismiss.addEventListener('click', () => {
    app.save({ ...app.current, padBannerDismissed: true });
    update();
  });

  if (typeof navigator.getGamepads === 'function') {
    window.addEventListener('gamepadconnected', update);
    window.addEventListener('gamepaddisconnected', update);
    window.setInterval(update, CHECK_MS);
    update();
  }
  return banner;
}
