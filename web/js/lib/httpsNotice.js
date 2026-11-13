import { state } from '../state.js';

const KEY = 'postern.httpsBannerDismissed';

export const HTTPS_HELP_URL = 'https://github.com/search?q=postern+https+caddy&type=repositories';

/** True while the admin UI is on plain HTTP and the person has not dismissed the warning. */
export function httpsWarningVisible() {
  if (state.meta.secure) return false;
  try {
    return localStorage.getItem(KEY) !== '1';
  } catch {
    return true;
  }
}

export function dismissHttpsWarning() {
  try {
    localStorage.setItem(KEY, '1');
  } catch {
    /* storage blocked: the warning comes back on the next load */
  }
}
