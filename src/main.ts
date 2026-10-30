import './style.css';
import { ComboStore, memoryStorage, type StorageLike } from './storage/combos';
import { renderDebugPage } from './ui/debug';
import { el } from './ui/dom';
import { initialSession, renderEditorPage } from './ui/editor';

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

  const routes = {
    editor: { hash: '#', label: 'Combos', render: (root: HTMLElement) => renderEditorPage(root, store, session) },
    debug: { hash: '#debug', label: 'Input debug', render: renderDebugPage },
  } as const;
  type Route = keyof typeof routes;

  const navLinks = Object.entries(routes).map(([key, r]) => {
    const a = el('a', { href: r.hash, textContent: r.label });
    a.dataset.route = key;
    return a;
  });
  const page = el('main');
  app.replaceChildren(
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
  const show = () => {
    const route: Route = location.hash === '#debug' ? 'debug' : 'editor';
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
