import { h } from '../../lib/h.js';
import { Button } from '../common/Button.js';
import { Icon } from '../common/Icon.js';
import { AUTH_PRESETS, isAuthNone } from '../../lib/authPresets.js';

const TYPES = [
  { id: 'header', label: 'Header' },
  { id: 'query', label: 'URL param' },
  { id: 'bearer', label: 'Bearer' },
  { id: 'basic', label: 'Basic' },
];

/**
 * Compact multi-slot auth editor for the slide-out.
 * Mutates `auth` in place; calls onChange after edits.
 */
export function AuthRowsEditor({ auth, editing, onChange, serviceLabel = 'service', showPresets = true }) {
  const wrap = h('div', { className: 'flex flex-col gap-2.5' });
  const hadSecret = {
    header: !!auth.header?.stored,
    query: !!auth.query?.stored,
    authz: !!auth.authz?.stored,
  };

  function rememberStored() {
    if (auth.header) auth.header.stored = hadSecret.header;
    if (auth.query) auth.query.stored = hadSecret.query;
    if (auth.authz) auth.authz.stored = hadSecret.authz;
  }

  function secretMissing(row) {
    return !hadSecret[slotKey(row.type)] && !String(row.secret || '').trim();
  }

  function bump() {
    redraw();
    onChange?.();
  }

  function soft() {
    onChange?.();
  }

  function rowsFromAuth() {
    const rows = [];
    if (auth.header) {
      rows.push({ type: 'header', name: auth.header.name || 'X-Api-Key', username: '', secret: auth.header.secret || '' });
    }
    if (auth.query) {
      rows.push({ type: 'query', name: auth.query.name || 'apikey', username: '', secret: auth.query.secret || '' });
    }
    if (auth.authz) {
      rows.push({
        type: auth.authz.kind === 'basic' ? 'basic' : 'bearer',
        name: '',
        username: auth.authz.username || '',
        secret: auth.authz.secret || '',
      });
    }
    return rows;
  }

  function applyRows(rows) {
    auth.header = null;
    auth.query = null;
    auth.authz = null;
    for (const r of rows) {
      if (r.type === 'header') {
        auth.header = { name: r.name || 'X-Api-Key', secret: r.secret || '', stored: hadSecret.header };
      } else if (r.type === 'query') {
        auth.query = { name: r.name || 'apikey', secret: r.secret || '', stored: hadSecret.query };
      } else if (r.type === 'basic') {
        auth.authz = { kind: 'basic', username: r.username || '', secret: r.secret || '', stored: hadSecret.authz };
      } else {
        auth.authz = { kind: 'bearer', username: '', secret: r.secret || '', stored: hadSecret.authz };
      }
    }
  }

  function usedTypes(rows, exceptIdx = -1) {
    const set = new Set();
    rows.forEach((r, i) => {
      if (i === exceptIdx) return;
      if (r.type === 'header') set.add('header');
      else if (r.type === 'query') set.add('query');
      else set.add('authz'); // bearer and basic share authz slot
    });
    return set;
  }

  function labelFor(type) {
    return TYPES.find((t) => t.id === type)?.label || 'Credential';
  }

  function slotKey(type) {
    if (type === 'header' || type === 'query') return type;
    return 'authz';
  }

  function addRow() {
    const rows = rowsFromAuth();
    const used = usedTypes(rows);
    let type = 'header';
    if (used.has('header')) type = used.has('query') ? 'bearer' : 'query';
    if (used.has('authz') && used.has('header') && used.has('query')) return;
    if (used.has(slotKey(type))) {
      for (const t of ['header', 'query', 'bearer']) {
        if (!used.has(slotKey(t))) {
          type = t;
          break;
        }
      }
    }
    rows.push({
      type,
      name: type === 'header' ? 'X-Api-Key' : type === 'query' ? 'apikey' : '',
      username: '',
      secret: '',
    });
    applyRows(rows);
    bump();
  }

  function applyPreset(p) {
    auth.header = p.auth.header ? { ...p.auth.header, secret: auth.header?.secret || '' } : null;
    auth.query = p.auth.query ? { ...p.auth.query, secret: auth.query?.secret || '' } : null;
    auth.authz = p.auth.authz ? { ...p.auth.authz, secret: auth.authz?.secret || '' } : null;
    rememberStored();
    bump();
  }

  function redraw() {
    const rows = rowsFromAuth();
    const head = h(
      'div',
      { className: 'flex flex-wrap items-center justify-between gap-2' },
      h('span', { className: 'field-label' }, 'Upstream credentials'),
    );
    if (showPresets) {
      const sel = h(
        'select',
        {
          className: 'auth-row-select max-w-[11rem]',
          onChange: (e) => {
            const p = AUTH_PRESETS[Number(e.target.value)];
            if (p) applyPreset(p);
            e.target.selectedIndex = 0;
          },
        },
        h('option', { value: '', selected: true, disabled: true }, 'Fill from preset'),
        ...AUTH_PRESETS.map((p, i) => h('option', { value: String(i) }, p.label)),
      );
      head.append(sel);
    }
    const nodes = [head, ...rows.map((row, idx) => rowEl(row, idx, rows))];
    if (rows.length < 3) {
      nodes.push(
        h(
          'button',
          { type: 'button', className: 'btn-add-row', onClick: addRow },
          Icon('plus', { size: 14 }),
          'Add credential',
        ),
      );
    }
    nodes.push(
      h(
        'p',
        { className: 'm-0 text-xs text-muted leading-relaxed' },
        isAuthNone(auth)
          ? 'No credentials — the upstream needs none, or add a slot above.'
          : 'Stored values are never shown. A new credential needs a value before it can be saved.',
      ),
    );
    wrap.replaceChildren(...nodes);
  }

  function rowEl(row, idx, rows) {
    const used = usedTypes(rows, idx);
    const typeSel = h(
      'select',
      {
        className: 'auth-row-select',
        onChange: (e) => {
          const next = e.target.value;
          const key = slotKey(next);
          if (used.has(key)) {
            // swap with existing slot of that kind
            const other = rows.findIndex((r, i) => i !== idx && slotKey(r.type) === key);
            if (other >= 0) {
              const tmp = rows[other].type;
              rows[other].type = row.type;
              row.type = tmp;
            } else {
              row.type = next;
            }
          } else {
            row.type = next;
          }
          if (row.type === 'header' && !row.name) row.name = 'X-Api-Key';
          if (row.type === 'query' && !row.name) row.name = 'apikey';
          applyRows(rows);
          bump();
        },
      },
      ...TYPES.map((t) => {
        const blocked = used.has(slotKey(t.id)) && slotKey(t.id) !== slotKey(row.type);
        return h('option', { value: t.id, selected: row.type === t.id, disabled: blocked }, t.label);
      }),
    );

    const nameOrUser =
      row.type === 'basic'
        ? h('input', {
            className: 'input font-mono flex-1 min-w-0',
            placeholder: 'username',
            value: row.username || '',
            onInput: (e) => {
              row.username = e.target.value;
              applyRows(rows);
              soft();
            },
          })
        : row.type === 'bearer'
          ? h('span', { className: 'text-xs text-muted shrink-0 w-[5.5rem]' }, 'Authorization')
          : h('input', {
              className: 'input font-mono flex-1 min-w-0',
              placeholder: row.type === 'header' ? 'X-Api-Key' : 'apikey',
              value: row.name || '',
              onInput: (e) => {
                row.name = e.target.value;
                applyRows(rows);
                soft();
              },
            });

    const missing = secretMissing(row);
    const stored = hadSecret[slotKey(row.type)];
    const secret = h('input', {
      type: 'password',
      className: 'input font-mono',
      autocomplete: 'off',
      placeholder: missing ? 'Required' : stored ? '••••••••' : 'value',
      value: row.secret || '',
      'aria-invalid': missing ? 'true' : null,
      'aria-label': missing ? `${labelFor(row.type)} value is required` : `${labelFor(row.type)} value`,
      onInput: (e) => {
        row.secret = e.target.value;
        applyRows(rows);
        const still = secretMissing(row);
        e.target.placeholder = still ? 'Required' : stored ? '••••••••' : 'value';
        if (still) e.target.setAttribute('aria-invalid', 'true');
        else e.target.removeAttribute('aria-invalid');
        const chip = e.target.parentElement?.querySelector('.auth-secret-chip');
        if (chip) chip.hidden = !stored || !!row.secret;
        soft();
      },
    });
    const secretWrap = h(
      'div',
      { className: 'auth-secret-wrap' },
      secret,
      stored
        ? h('span', { className: 'auth-secret-chip', hidden: !!row.secret }, 'unchanged')
        : null,
    );

    return h(
      'div',
      { className: 'auth-row' },
      typeSel,
      nameOrUser,
      secretWrap,
      Button(
        {
          variant: 'ghost',
          size: 'sm',
          square: true,
          className: 'text-muted',
          'aria-label': 'Remove credential',
          onClick: () => {
            rows.splice(idx, 1);
            applyRows(rows);
            bump();
          },
        },
        Icon('close', { size: 14 }),
      ),
    );
  }

  redraw();
  return wrap;
}
