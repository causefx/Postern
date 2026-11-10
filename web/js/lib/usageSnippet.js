import { defaultGate, isGateEmpty, DEFAULT_GATE_HEADER, DEFAULT_GATE_QUERY } from './callerGate.js';

function gateOf(draft) {
  if (draft.access !== 'postern') return null;
  return draft.gate && !isGateEmpty(draft.gate) ? draft.gate : defaultGate();
}

/** Caller examples for the Usage tab. lang is curl | js | python. */
export function usageSnippet({ draft, lang, sendAs, url }) {
  if (draft.access === 'upstream') return upstreamSnippet({ draft, lang, sendAs, url });
  return posternSnippet({ draft, lang, sendAs, url });
}

export function usageSendOptions(draft) {
  if (draft.access === 'upstream') {
    const opts = [];
    if (draft.auth?.header) opts.push({ id: 'up-header', label: draft.auth.header.name || 'X-Api-Key' });
    if (draft.auth?.query) opts.push({ id: 'up-query', label: `?${draft.auth.query.name || 'apikey'}` });
    if (draft.auth?.authz?.kind === 'basic') opts.push({ id: 'up-basic', label: 'Basic' });
    else if (draft.auth?.authz) opts.push({ id: 'up-bearer', label: 'Bearer' });
    return opts;
  }
  const g = gateOf(draft);
  const opts = [];
  if (g.bearer) opts.push({ id: 'bearer', label: 'Bearer' });
  if (g.header) opts.push({ id: 'header', label: g.header.name || DEFAULT_GATE_HEADER });
  if (g.query) opts.push({ id: 'query', label: `?${g.query.name || DEFAULT_GATE_QUERY}` });
  return opts;
}

function posternSnippet({ draft, lang, sendAs, url }) {
  const g = gateOf(draft);
  if (sendAs === 'header' && g?.header) {
    const name = g.header.name || DEFAULT_GATE_HEADER;
    if (lang === 'curl') return `curl -H "${name}: $POSTERN_TOKEN" \\\n  "${url}"`;
    if (lang === 'js') return `await fetch("${url}", {\n  headers: { "${name}": process.env.POSTERN_TOKEN },\n});`;
    return `requests.get(\n  "${url}",\n  headers={"${name}": os.environ["POSTERN_TOKEN"]},\n)`;
  }
  if (sendAs === 'query' && g?.query) {
    const name = g.query.name || DEFAULT_GATE_QUERY;
    const u = url.includes('?') ? `${url}&${name}=$POSTERN_TOKEN` : `${url}?${name}=$POSTERN_TOKEN`;
    if (lang === 'curl') return `curl "${u}"`;
    if (lang === 'js') return `await fetch(\`${url}?${name}=\${process.env.POSTERN_TOKEN}\`);`;
    return `requests.get("${url}", params={"${name}": os.environ["POSTERN_TOKEN"]})`;
  }
  if (lang === 'curl') return `curl -H "Authorization: Bearer $POSTERN_TOKEN" \\\n  "${url}"`;
  if (lang === 'js')
    return `await fetch("${url}", {\n  headers: { Authorization: \`Bearer \${process.env.POSTERN_TOKEN}\` },\n});`;
  return `requests.get(\n  "${url}",\n  headers={"Authorization": f"Bearer {os.environ['POSTERN_TOKEN']}"},\n)`;
}

function upstreamSnippet({ draft, lang, sendAs, url }) {
  const a = draft.auth || {};
  if (sendAs === 'up-header' && a.header) {
    const name = a.header.name || 'X-Api-Key';
    if (lang === 'curl') return `curl -H "${name}: $TOKEN_OR_KEY" \\\n  "${url}"`;
    if (lang === 'js') return `await fetch("${url}", { headers: { "${name}": tokenOrKey } });`;
    return `requests.get("${url}", headers={"${name}": token_or_key})`;
  }
  if (sendAs === 'up-query' && a.query) {
    const name = a.query.name || 'apikey';
    if (lang === 'curl') return `curl "${url}?${name}=$TOKEN_OR_KEY"`;
    if (lang === 'js') return `await fetch(\`${url}?${name}=\${tokenOrKey}\`);`;
    return `requests.get("${url}", params={"${name}": token_or_key})`;
  }
  if (sendAs === 'up-basic' && a.authz) {
    const user = a.authz.username || 'user';
    if (lang === 'curl') return `curl -u "${user}:$TOKEN_OR_PASSWORD" \\\n  "${url}"`;
    if (lang === 'js')
      return `await fetch("${url}", {\n  headers: { Authorization: "Basic " + btoa("${user}:" + password) },\n});`;
    return `requests.get("${url}", auth=("${user}", password))`;
  }
  if (lang === 'curl') return `curl -H "Authorization: Bearer $TOKEN_OR_KEY" \\\n  "${url}"`;
  if (lang === 'js') return `await fetch("${url}", {\n  headers: { Authorization: \`Bearer \${tokenOrKey}\` },\n});`;
  return `requests.get("${url}", headers={"Authorization": f"Bearer {token_or_key}"})`;
}
