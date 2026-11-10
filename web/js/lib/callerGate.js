/** Defaults matching server callerToken trio. */
export const DEFAULT_GATE_HEADER = 'X-Proxy-Token';
export const DEFAULT_GATE_QUERY = 'token';

export function defaultGate() {
  return {
    bearer: true,
    header: { name: DEFAULT_GATE_HEADER },
    query: { name: DEFAULT_GATE_QUERY },
  };
}

export function gateFromView(view) {
  if (!view) return defaultGate();
  return {
    bearer: !!view.bearer,
    header: view.header ? { name: view.header.name || DEFAULT_GATE_HEADER } : null,
    query: view.query ? { name: view.query.name || DEFAULT_GATE_QUERY } : null,
  };
}

export function isDefaultGate(gate) {
  if (!gate) return true;
  if (!gate.bearer || !gate.header || !gate.query) return false;
  const h = (gate.header.name || DEFAULT_GATE_HEADER).trim();
  const q = (gate.query.name || DEFAULT_GATE_QUERY).trim();
  return h.toLowerCase() === DEFAULT_GATE_HEADER.toLowerCase() && q === DEFAULT_GATE_QUERY;
}

export function isGateEmpty(gate) {
  return !gate?.bearer && !gate?.header && !gate?.query;
}

/** Payload for API: null when default, else explicit object. */
export function gateToPayload(gate) {
  if (!gate || isDefaultGate(gate)) return null;
  if (isGateEmpty(gate)) return {}; // server rejects
  const out = {};
  if (gate.bearer) out.bearer = true;
  if (gate.header) out.header = { name: (gate.header.name || DEFAULT_GATE_HEADER).trim() };
  if (gate.query) out.query = { name: (gate.query.name || DEFAULT_GATE_QUERY).trim() };
  return out;
}

export function gateHint(gate) {
  const g = gate && !isGateEmpty(gate) ? gate : defaultGate();
  const parts = [];
  if (g.bearer) parts.push('Bearer');
  if (g.header) parts.push(g.header.name || DEFAULT_GATE_HEADER);
  if (g.query) parts.push(`?${g.query.name || DEFAULT_GATE_QUERY}`);
  if (parts.length === 1) return parts[0];
  if (parts.length === 2) return `${parts[0]} or ${parts[1]}`;
  return parts.slice(0, -1).join(', ') + ', or ' + parts[parts.length - 1];
}
