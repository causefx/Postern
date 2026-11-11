import { slugify } from './slug.js';
import { authToPayload } from './authPresets.js';
import { gateToPayload } from './callerGate.js';

function cleanPaths(openPaths) {
  return (openPaths || [])
    .filter((p) => (p.path || '').trim())
    .map((p) => ({ match: p.match === 'regex' ? 'regex' : 'prefix', path: p.path.trim() }));
}

/** Stable JSON used for the dirty check. */
export function draftSnapshot(draft) {
  return JSON.stringify({
    name: slugify(draft.name) || draft.name,
    url: draft.url.trim(),
    access: draft.access,
    openPaths: cleanPaths(draft.openPaths),
    auth: authToPayload(draft.auth),
    gate: draft.access === 'postern' ? gateToPayload(draft.gate) : null,
  });
}

/** Body sent to create/update. */
export function draftSaveBody(draft) {
  return {
    name: slugify(draft.name) || draft.name,
    url: draft.url,
    enabled: draft.enabled,
    access: draft.access,
    gate: draft.access === 'postern' ? gateToPayload(draft.gate) : null,
    openPaths: cleanPaths(draft.openPaths),
    auth: authToPayload(draft.auth),
  };
}

export function openPathCount(draft) {
  return (draft.openPaths || []).filter((p) => (p.path || '').trim()).length;
}
