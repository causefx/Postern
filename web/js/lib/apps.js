/**
 * The apps Postern knows, from the apps/ folder. The server checks them and puts the list in the page
 * (<script type="application/json" id="postern-apps">), so it is here before anything renders.
 *
 * Each app: { id, label, auth, keyHint?, note? }
 *   auth: how the app takes its key, { header?, query?, authz? }, or null when Postern cannot send it.
 *   keyHint: where to find the key in the app.
 *   note: shown instead of a key suggestion, for an app Postern cannot send a key to.
 */
function readAppData() {
  try {
    const el = document.getElementById('postern-apps');
    const data = JSON.parse(el?.textContent || '{}');
    return { apps: Array.isArray(data.apps) ? data.apps : [] };
  } catch {
    return { apps: [] };
  }
}

const data = readAppData();

/** Apps by id. */
export const APPS = Object.fromEntries(data.apps.map((a) => [a.id, a]));

/** Apps sorted by label, for pickers. */
export function appList() {
  return data.apps;
}

export function appInfo(id) {
  return (id && APPS[id]) || null;
}

/** The bundled icon for an app, or null for an app this version does not know. */
export function appIconURL(id) {
  return appInfo(id) ? `/admin/app-icons/${id}.svg` : null;
}

/** An uploaded icon, by its stored name. */
export function uploadedIconURL(name) {
  return name ? `/admin/icons/${encodeURIComponent(name)}` : null;
}

/** What a service shows: its uploaded icon, else its app's icon, else null for the letter tile. */
export function serviceIconURL({ icon, app } = {}) {
  return uploadedIconURL(icon) || appIconURL(app);
}
