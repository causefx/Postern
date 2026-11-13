/**
 * Theme preference: light, dark, or follow the system.
 * The choice lives in localStorage; "system" is stored as no entry at all. js/theme-boot.js applies it
 * before first paint, and this module keeps <html data-theme> right after that.
 */
const KEY = 'postern.theme';
const THEME_EVENT = 'postern:theme';

export const THEME_OPTIONS = [
  { id: 'light', label: 'Light', icon: 'sun' },
  { id: 'dark', label: 'Dark', icon: 'moon' },
  { id: 'system', label: 'System', icon: 'monitor' },
];

const systemDark = window.matchMedia('(prefers-color-scheme: dark)');

export function getThemePreference() {
  try {
    const saved = localStorage.getItem(KEY);
    if (saved === 'light' || saved === 'dark') return saved;
  } catch {
    /* storage blocked: follow the system */
  }
  return 'system';
}

/** The theme actually shown: "light" or "dark". */
export function resolveTheme(pref = getThemePreference()) {
  if (pref === 'system') return systemDark.matches ? 'dark' : 'light';
  return pref;
}

export function applyTheme() {
  const root = document.documentElement;
  root.dataset.theme = resolveTheme();
  // Browser chrome follows the page background of whichever theme is showing. The page ships one
  // theme-color per system scheme; both get the same value so a forced theme wins over the system.
  const page = getComputedStyle(root).getPropertyValue('--bg-page').trim();
  if (!page) return;
  for (const meta of document.querySelectorAll('meta[name="theme-color"]')) meta.setAttribute('content', page);
}

/** Calls fn whenever the theme preference changes, wherever the change came from. */
export function onThemeChange(fn) {
  window.addEventListener(THEME_EVENT, fn);
  return () => window.removeEventListener(THEME_EVENT, fn);
}

export function setThemePreference(pref) {
  try {
    if (pref === 'light' || pref === 'dark') localStorage.setItem(KEY, pref);
    else localStorage.removeItem(KEY);
  } catch {
    /* storage blocked: the choice lasts for this page only */
  }
  applyTheme();
  window.dispatchEvent(new Event(THEME_EVENT));
}

// Follow the OS when it changes, and a choice made in another tab.
systemDark.addEventListener('change', applyTheme);
window.addEventListener('storage', (e) => {
  if (e.key === KEY || e.key === null) applyTheme();
});

applyTheme();
