import { h } from '../../lib/h.js';
import { Icon } from '../common/Icon.js';
import { AUTH_PRESETS, presetMatches, isAuthNone } from '../../lib/authPresets.js';

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
export function AuthRowsEditor({ auth, editing, onChange, serviceLabel = 'service' }) {
  const wrap = h('div', { className: 'flex flex-col gap-2.5' });

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
        auth.header = { name: r.name || 'X-Api-Key', secret: r.secret || '' };
      } else if (r.type === 'query') {
        auth.query = { name: r.name || 'apikey', secret: r.secret || '' };
      } else if (r.type === 'basic') {
        auth.authz = { kind: 'basic', username: r.username || '', secret: r.secret || '' };
      } else {
        auth.authz = { kind: 'bearer', username: '', secret: r.secret || '' };
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

  function redraw() {
    const rows = rowsFromAuth();
    wrap.replaceChildren(
      h(
        'div',
        { className: 'flex flex-wrap items-center gap-2' },
        h('span', { className: 'label-caps' }, `${serviceLabel}'s credentials`.toUpperCase()),
      ),
      h(
        'div',
        { className: 'flex flex-wrap gap-1.5' },
        ...AUTH_PRESETS.map((p) => {
          const active = presetMatches(auth, p);
          return h(
            'button',
            {
              type: 'button',
              className: `preset-chip${active ? ' preset-chip-active' : ''}`,
              onClick: () => {
                auth.header = p.auth.header ? { ...p.auth.header, secret: auth.header?.secret || '' } : null;
                auth.query = p.auth.query ? { ...p.auth.query, secret: auth.query?.secret || '' } : null;
                auth.authz = p.auth.authz ? { ...p.auth.authz, secret: auth.authz?.secret || '' } : null;
                bump();
              },
            },
            p.label,
          );
        }),
      ),
      ...rows.map((row, idx) => rowEl(row, idx, rows)),
      rows.length < 3
        ? h(
            'button',
            { type: 'button', className: 'btn btn-sm btn-ghost justify-start w-fit', onClick: addRow },
            Icon('plus', { size: 14 }),
            'Add credential',
          )
        : null,
      h(
        'p',
        { className: 'm-0 text-xs text-muted leading-relaxed' },
        isAuthNone(auth)
          ? 'No credentials — the upstream needs none, or add a slot above.'
          : 'Stored values are never shown. Type a new one to replace it.',
      ),
    );
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
            className: 'input input-sm font-mono flex-1 min-w-0',
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
              className: 'input input-sm font-mono flex-1 min-w-0',
              placeholder: row.type === 'header' ? 'X-Api-Key' : 'apikey',
              value: row.name || '',
              onInput: (e) => {
                row.name = e.target.value;
                applyRows(rows);
                soft();
              },
            });

    const secret = h('input', {
      type: 'password',
      className: 'input input-sm font-mono flex-1 min-w-0',
      autocomplete: 'off',
      placeholder: editing ? '•••••••• unchanged' : 'value',
      value: row.secret || '',
      onInput: (e) => {
        row.secret = e.target.value;
        applyRows(rows);
        soft();
      },
    });

    return h(
      'div',
      { className: 'auth-row' },
      typeSel,
      nameOrUser,
      secret,
      h(
        'button',
        {
          type: 'button',
          className: 'btn btn-ghost btn-square btn-sm text-muted',
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
