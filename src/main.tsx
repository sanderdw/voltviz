import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './app/App';
import './index.css';

// A deploy replaces every hashed chunk, so a tab (or cached index.html) from an older build
// 404s on its next lazy import. Reload once to pick up the new build; a second failure
// within RELOAD_GUARD_MS is left to the caller (a genuinely broken chunk must not loop).
const RELOAD_GUARD_MS = 10_000;
window.addEventListener('vite:preloadError', event => {
  try {
    const last = Number(sessionStorage.getItem('voltviz:chunkReload')) || 0;
    if (Date.now() - last < RELOAD_GUARD_MS) return;
    sessionStorage.setItem('voltviz:chunkReload', String(Date.now()));
  } catch {
    return; // storage blocked: no guard against a reload loop, so don't reload
  }
  event.preventDefault();
  window.location.reload();
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
