const api = (path, opts = {}) =>
  fetch('/admin/api/' + path, {
    ...opts,
    headers: { 'Content-Type': 'application/json', 'X-Postern-Admin': '1' },
  }).then(async r => {
    if (r.status === 204) return null;
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || r.statusText);
    return j;
  });

const $ = id => document.getElementById(id);

function card(s) {
  const node = $('service-card').content.cloneNode(true);
  const base = location.origin + '/p/' + s.name;
  const field = name => node.querySelector('[data-field="' + name + '"]');
  node.querySelector('.card').dataset.name = s.name;
  field('name').textContent = s.name;
  field('badge').classList.toggle('hidden', s.enabled);
  field('toggle').textContent = s.enabled ? 'Disable' : 'Enable';
  field('url').textContent = s.url;
  field('nokey').classList.toggle('hidden', s.hasKey);
  field('base').textContent = base + '/';
  field('token').textContent = s.token;
  field('example').textContent = 'curl -H "Authorization: Bearer ' + s.token + '" ' + base + '/api/v3/system/status';
  return node;
}

async function load() {
  const list = await api('services');
  const box = $('list');
  box.replaceChildren();
  if (!list.length) {
    box.append($('empty-state').content.cloneNode(true));
    return;
  }
  for (const s of list) box.append(card(s));
}

$('add').addEventListener('submit', async e => {
  e.preventDefault();
  $('addErr').textContent = '';
  try {
    await api('services', { method: 'POST', body: JSON.stringify({
      name: $('n').value, url: $('u').value, apiKey: $('k').value, keyHeader: $('h').value,
    })});
    $('add').reset(); $('h').value = 'X-Api-Key';
    load();
  } catch (err) { $('addErr').textContent = err.message; }
});

$('list').addEventListener('click', async e => {
  const act = e.target.dataset.act;
  if (!act) return;
  const name = e.target.closest('.card').dataset.name;
  const cur = (await api('services')).find(s => s.name === name);
  const put = body => api('services/' + name, { method: 'PUT', body: JSON.stringify({ url: cur.url, enabled: cur.enabled, keyHeader: cur.keyHeader, ...body }) });
  try {
    if (act === 'copy') { await navigator.clipboard.writeText(cur.token); e.target.textContent = 'Copied'; return; }
    if (act === 'del') { if (!confirm('Delete ' + name + '?')) return; await api('services/' + name, { method: 'DELETE' }); }
    if (act === 'toggle') await put({ enabled: !cur.enabled });
    if (act === 'regen') { if (!confirm('Old token stops working immediately. Continue?')) return; await put({ regenToken: true }); }
    if (act === 'edit') {
      const url = prompt('Upstream URL', cur.url); if (url === null) return;
      const key = prompt('New upstream API key (leave blank to keep current)', '');
      await put({ url, apiKey: key || '' });
    }
    load();
  } catch (err) { alert(err.message); }
});

load();
