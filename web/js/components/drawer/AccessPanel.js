import { h } from '../../lib/h.js';
import { Button } from '../common/Button.js';
import { Icon } from '../common/Icon.js';
import { MenuButton } from '../common/Menu.js';
import { CallerGateEditor } from './CallerGateEditor.js';
import { OpenPathsEditor } from './OpenPathsEditor.js';
import { isAuthNone } from '../../lib/authPresets.js';
import { copyValue } from '../../lib/clipboard.js';
import { toast } from '../common/Toast.js';
import { api } from '../../api.js';
import { pop } from '../../lib/motion.js';
import {
  dateInputValue,
  endOfDayISO,
  expiryDateValue,
  expiryLabel,
  expiryShort,
  isScoped,
  lastUsedShort,
  READ_ONLY_METHODS,
  SCOPE_METHODS,
  scopeLabel,
  tokenState,
} from '../../lib/tokenDisplay.js';

/** Service name -> the token ids last shown, so only a token that just appeared animates in. */
const knownTokens = new Map();

/**
 * Access tab: mode cards, then shared Tokens list below.
 */
export function AccessPanel({ draft, token, tokens = [], savedName, serviceLabel, onChange, onTokensUpdated }) {
  const wrap = h('div', { className: 'flex flex-col gap-4' });
  let adding = false;
  let editingExpiry = '';
  /** Draft of the scope being edited: { id, methods: Set, paths, errors }, or null. */
  let editingScope = null;

  function paint() {
    const label = serviceLabel();
    const upstreamDisabled = isAuthNone(draft.auth);
    const postern = draft.access === 'postern';

    wrap.replaceChildren(
      h('span', { className: 'field-label' }, 'How do callers get in?'),
      h(
        'div',
        {
          className: 'flex flex-col gap-3',
          role: 'radiogroup',
          'aria-label': 'How callers get in',
        },
        accessCard({
          selected: postern,
          title: 'Postern token',
          body: 'Callers use a token Postern issues. The upstream key never leaves the server.',
          onSelect: () => {
            if (draft.access === 'postern') return;
            draft.access = 'postern';
            paint();
            onChange?.();
          },
          extra: postern
            ? CallerGateEditor({
                gate: draft.gate,
                onChange: () => onChange?.(),
              })
            : null,
        }),
        accessCard({
          selected: !postern,
          title: `Same as ${label}`,
          body: upstreamDisabled
            ? `Add upstream credentials on Connection first — then callers can use ${label}'s own auth shape.`
            : `Callers use the upstream's own credential shape, with the Postern token or the real key. Works with apps that only speak ${label}.`,
          disabled: upstreamDisabled,
          onSelect: () => {
            if (upstreamDisabled || draft.access === 'upstream') return;
            draft.access = 'upstream';
            paint();
            onChange?.();
          },
        }),
      ),
      tokensSection(label),
    );
    popNewTokens();
  }

  /** A token that was not on screen the last time this service's list was drawn pops in. */
  function popNewTokens() {
    const cards = [...wrap.querySelectorAll('.tok-card[data-tid]')];
    const known = knownTokens.get(savedName);
    knownTokens.set(savedName, new Set(cards.map((el) => el.dataset.tid)));
    if (!known) return;
    const fresh = cards.filter((el) => !known.has(el.dataset.tid));
    if (fresh.length) requestAnimationFrame(() => fresh.forEach((el) => pop(el)));
  }

  function tokenRows() {
    if (tokens.length) return tokens;
    if (token) return [{ id: '', name: 'default', secret: token }];
    return [];
  }

  function pauseToken(t) {
    return setPaused(t, !t.paused, true);
  }

  /** Pauses or resumes a token. The first change offers Undo; undoing it does not offer another. */
  async function setPaused(t, paused, undoable) {
    if (!t.id) return;
    const name = t.name || 'token';
    try {
      const updated = await api.setTokenPaused(savedName, t.id, paused);
      toast.success(paused ? 'Token paused' : 'Token resumed', {
        detail: paused ? `Calls with ${name} now get 403` : `Calls with ${name} work again`,
        undo: undoable ? () => setPaused(t, !paused, false) : undefined,
      });
      onTokensUpdated?.(updated);
    } catch (err) {
      toast.error("Couldn't update the token", { detail: err.message });
    }
  }

  async function applyExpiry(t, iso, detail) {
    try {
      const updated = await api.setTokenExpiry(savedName, t.id, iso);
      editingExpiry = '';
      toast.success(iso ? 'Expiry set' : 'Expiry removed', { detail });
      onTokensUpdated?.(updated);
    } catch (err) {
      toast.error("Couldn't change the expiry", { detail: err.message });
    }
  }

  function saveExpiry(t, value) {
    const iso = endOfDayISO(value);
    if (!iso) {
      toast.error('Pick an expiry date', { detail: 'Choose a day, or use 7, 30 or 90 days.' });
      return;
    }
    return applyExpiry(t, iso, `${t.name || 'Token'} expires ${value}`);
  }

  function expiryEditor(t) {
    const input = h('input', {
      type: 'date',
      className: 'input',
      min: dateInputValue(0),
      value: expiryDateValue(t) || dateInputValue(30),
      'aria-label': `Expiry date for ${t.name || 'token'}`,
    });
    const preset = (days) =>
      h(
        'button',
        {
          type: 'button',
          className: 'btn btn-ghost btn-sm',
          onClick: () => {
            input.value = dateInputValue(days);
          },
        },
        `${days} days`,
      );
    return h(
      'div',
      { className: 'token-expiry-editor' },
      input,
      preset(7),
      preset(30),
      preset(90),
      Button({ size: 'sm', onClick: () => saveExpiry(t, input.value) }, 'Save'),
      t.expiresAt
        ? Button(
            { variant: 'ghost', size: 'sm', onClick: () => applyExpiry(t, '', `Removed expiry on ${t.name || 'token'}`) },
            'Remove expiry',
          )
        : null,
      Button(
        {
          variant: 'ghost',
          size: 'sm',
          onClick: () => {
            editingExpiry = '';
            paint();
          },
        },
        'Cancel',
      ),
    );
  }

  /** What the draft would allow, in the shape a token's `scope` has. */
  function liveScope() {
    return {
      methods: SCOPE_METHODS.filter((m) => editingScope.methods.has(m)),
      paths: editingScope.paths.filter((p) => String(p.path || '').trim()),
    };
  }

  /** The scope chip of the token being edited; it follows the draft while you type. */
  let scopeChipEl = null;

  function paintScopeChip(el, scope, open) {
    const limited = isScoped({ scope });
    el.textContent = limited ? scopeLabel({ scope }) : 'Full access';
    el.classList.toggle('is-chip', limited);
    el.classList.toggle('is-open', !!open);
  }

  function refreshScopeChip() {
    if (editingScope && scopeChipEl?.isConnected) paintScopeChip(scopeChipEl, liveScope(), true);
  }

  function closeScope() {
    editingScope = null;
    paint();
  }

  function scopeControl(t) {
    const editing = editingScope?.id === t.id;
    const btn = h('button', {
      type: 'button',
      className: 'tok-scope',
      disabled: !t.id,
      'aria-expanded': editing ? 'true' : 'false',
      title: editing ? 'Close the scope editor' : 'Edit what this token may do',
      onClick: () => (editing ? closeScope() : startScope(t)),
    });
    paintScopeChip(btn, editing ? liveScope() : t.scope, editing);
    if (editing) scopeChipEl = btn;
    return btn;
  }

  function startScope(t) {
    const s = t.scope || {};
    editingScope = {
      id: t.id,
      methods: new Set(s.methods || []),
      paths: (s.paths || []).map((p) => ({ ...p })),
      errors: null,
    };
    editingExpiry = '';
    paint();
  }

  async function saveScope(t) {
    const draft = editingScope;
    // A row left blank is not a rule; drop it so error rows line up with what is sent.
    draft.paths = draft.paths.filter((p) => String(p.path || '').trim());
    const body = {
      methods: SCOPE_METHODS.filter((m) => draft.methods.has(m)),
      paths: draft.paths.map((p) => ({ match: p.match || 'prefix', path: p.path.trim() })),
    };
    const open = !body.methods.length && !body.paths.length;
    try {
      const updated = await api.setTokenScope(savedName, t.id, open ? null : body);
      editingScope = null;
      toast.success(open ? 'Scope removed' : 'Scope saved', { detail: open ? `${t.name || 'Token'} has full access` : `${t.name || 'Token'} is limited` });
      onTokensUpdated?.(updated);
    } catch (err) {
      draft.errors = err.errors || {};
      toast.error("Couldn't save the scope", { detail: err.message });
      paint();
    }
  }

  function scopeEditor(t) {
    const draft = editingScope;
    const chip = (method) => {
      const on = draft.methods.has(method);
      return h(
        'button',
        {
          type: 'button',
          className: `activity-filter-chip${on ? ' is-active' : ''}`,
          'aria-pressed': on ? 'true' : 'false',
          onClick: () => {
            if (on) draft.methods.delete(method);
            else draft.methods.add(method);
            paint();
          },
        },
        method,
      );
    };
    const preset = (label, methods) =>
      h(
        'button',
        {
          type: 'button',
          className: 'btn btn-ghost btn-sm',
          onClick: () => {
            draft.methods = new Set(methods);
            paint();
          },
        },
        label,
      );
    const methodError = draft.errors?.['scope.methods'];
    return h(
      'div',
      { className: 'token-scope-editor' },
      h(
        'div',
        { className: 'scope-block' },
        h('span', { className: 'scope-label' }, 'Methods'),
        h('div', { className: 'scope-chips', role: 'group', 'aria-label': 'Allowed methods' }, ...SCOPE_METHODS.map(chip)),
        h(
          'div',
          { className: 'scope-presets' },
          preset('Read only', READ_ONLY_METHODS),
          preset('Any method', []),
        ),
        methodError
          ? h('p', { className: 'm-0 text-xs text-danger' }, methodError)
          : h('p', { className: 'scope-hint' }, 'None selected allows every method.'),
      ),
      h(
        'div',
        { className: 'scope-block' },
        h('span', { className: 'scope-label' }, 'Paths'),
        OpenPathsEditor({
          paths: draft.paths,
          errors: draft.errors,
          errorKey: 'scope.paths',
          label: 'Allowed path',
          placeholder: '/api/v3/series',
          onChange: () => {
            if (draft.errors) draft.errors = null;
            refreshScopeChip();
          },
        }),
        h('p', { className: 'scope-hint' }, 'No paths allows every path. A request must match at least one.'),
      ),
      h(
        'div',
        { className: 'scope-actions' },
        Button({ size: 'sm', onClick: () => saveScope(t) }, 'Save'),
        t.scope
          ? Button(
              {
                variant: 'ghost',
                size: 'sm',
                onClick: () => {
                  draft.methods = new Set();
                  draft.paths = [];
                  saveScope(t);
                },
              },
              'Remove limit',
            )
          : null,
        Button(
          {
            variant: 'ghost',
            size: 'sm',
            onClick: () => {
              editingScope = null;
              paint();
            },
          },
          'Cancel',
        ),
      ),
    );
  }

  async function rotateToken(t) {
    try {
      const updated = t.id ? await api.rotateTokenId(savedName, t.id) : await api.rotateToken(savedName);
      toast.success('Token rotated', { detail: `${t.name || 'Token'} has a new secret. The old one stops working` });
      onTokensUpdated?.(updated);
    } catch (e) {
      toast.error("Couldn't rotate the token", { detail: e.message });
    }
  }

  async function deleteToken(t, rows) {
    if (rows.length < 2 || !t.id) return;
    if (!confirm(`Delete token ${t.name}? Callers using it will get 401.`)) return;
    try {
      const updated = await api.deleteToken(savedName, t.id);
      toast.success('Token deleted', { detail: `Callers using ${t.name} now get 401` });
      onTokensUpdated?.(updated);
    } catch (e) {
      toast.error("Couldn't delete the token", { detail: e.message });
    }
  }

  async function addToken(name) {
    try {
      const updated = await api.addToken(savedName, name);
      adding = false;
      toast.success('Token added', { detail: name ? `${name} can call this service` : 'It can call this service' });
      onTokensUpdated?.(updated);
    } catch (e) {
      toast.error("Couldn't add the token", { detail: e.message });
    }
  }

  function newTokenControls() {
    if (!savedName) return null;
    if (!adding) {
      return h(
        'button',
        {
          type: 'button',
          className: 'btn-add-row',
          'aria-label': 'New token',
          onClick: () => {
            adding = true;
            paint();
          },
        },
        Icon('plus', { size: 14 }),
        h('span', { className: 'desktop-only' }, 'New token'),
        h('span', { className: 'mobile-only' }, 'New'),
      );
    }
    const nameInput = h('input', {
      className: 'input flex-1 min-w-0',
      placeholder: 'Name, e.g. phone',
      'aria-label': 'New token name',
    });
    return h(
      'div',
      { className: 'flex gap-2 items-center' },
      nameInput,
      Button(
        {
          size: 'sm',
          className: 'shrink-0',
          onClick: () => addToken(nameInput.value.trim()),
        },
        'Add',
      ),
      Button(
        {
          variant: 'ghost',
          size: 'sm',
          className: 'shrink-0',
          onClick: () => {
            adding = false;
            paint();
          },
        },
        'Cancel',
      ),
    );
  }

  function tokenCard(t, rows) {
    const state = tokenState(t);
    const prefix = t.secret && t.secret.length > 4 ? `${t.secret.slice(0, 4)}····` : '••••••••';
    const stateTitle = { active: 'Active', paused: 'Paused', expired: 'Expired' }[state];
    const left = expiryShort(t);
    const expiryBadge = (cls) =>
      left
        ? h(
            'span',
            { className: `tok-exp${left.soon ? ' is-soon' : ''} ${cls}`.trim(), title: expiryLabel(t) },
            Icon('clock', { size: 12 }),
            left.text,
          )
        : null;

    const mid = h(
      'div',
      { className: 'tok-mid' },
      state === 'active'
        ? scopeControl(t)
        : h('span', { className: `tok-chip is-${state}`, title: expiryLabel(t) || stateTitle }, stateTitle),
      expiryBadge('desktop-only'),
    );

    const copyBtn = h(
      'button',
      {
        type: 'button',
        className: 'tok-icon-btn',
        'aria-label': `Copy ${t.name || 'token'}`,
        title: 'Copy token',
        onClick: async () => {
          try {
            await copyValue(t.secret);
          } catch {
            /* toast already shown */
          }
        },
      },
      Icon('copy', { size: 14 }),
    );
    const resumeBtn = h(
      'button',
      { type: 'button', className: 'tok-resume', onClick: () => pauseToken(t) },
      'Resume',
    );

    const menu = MenuButton(
      {
        label: `More actions for ${t.name || 'token'}`,
        className: 'btn btn-ghost btn-sm btn-square tok-icon-btn',
        items: [
          {
            label: t.paused ? 'Resume' : 'Pause',
            icon: t.paused ? 'play' : 'pause',
            disabled: !t.id,
            onSelect: () => pauseToken(t),
          },
          {
            label: t.expiresAt ? 'Change expiry…' : 'Set expiry…',
            icon: 'clock',
            disabled: !t.id,
            onSelect: () => {
              editingExpiry = t.id;
              editingScope = null;
              paint();
            },
          },
          {
            label: isScoped(t) ? 'Edit scope…' : 'Limit access…',
            icon: 'lock',
            disabled: !t.id,
            onSelect: () => startScope(t),
          },
          { label: 'Rotate…', icon: 'rotate', onSelect: () => rotateToken(t) },
          { separator: true },
          {
            label: 'Delete token…',
            icon: 'trash',
            danger: true,
            disabled: rows.length < 2 || !t.id,
            onSelect: () => deleteToken(t, rows),
          },
        ],
      },
      Icon('more', { size: 15 }),
    );

    const editing = editingScope?.id === t.id || editingExpiry === t.id;
    return h(
      'div',
      { className: `tok-card is-${state}${editing ? ' is-open' : ''}`, dataset: t.id ? { tid: t.id } : undefined },
      h(
        'div',
        { className: 'tok-row' },
        h('span', { className: `tok-dot is-${state}`, role: 'img', 'aria-label': stateTitle, title: stateTitle }),
        h('span', { className: 'tok-name', title: t.name || 'token' }, t.name || 'token'),
        mid,
        h(
          'div',
          { className: 'tok-meta' },
          h('code', { className: 'tok-key' }, prefix),
          h('span', { className: `tok-used${t.lastUsedAt ? '' : ' is-never'}` }, lastUsedShort(t)),
          expiryBadge('mobile-only'),
        ),
        h('div', { className: 'tok-actions' }, state === 'paused' && t.id ? resumeBtn : copyBtn, menu),
      ),
      editingExpiry === t.id
        ? h('div', { className: 'tok-panel' }, expiryEditor(t))
        : editingScope?.id === t.id
          ? h('div', { className: 'tok-panel' }, scopeEditor(t))
          : null,
    );
  }

  function tokensSection(label) {
    const rows = tokenRows();
    const head = h(
      'div',
      { className: 'tok-head' },
      h('span', { className: 'tok-title' }, 'Caller tokens', h('span', { className: 'tok-count' }, ` · ${rows.length}`)),
      !adding ? newTokenControls() : null,
    );

    if (!savedName) {
      return h(
        'div',
        { className: 'flex flex-col gap-2' },
        h('span', { className: 'tok-title' }, 'Caller tokens'),
        h(
          'p',
          { className: 'm-0 text-xs text-muted' },
          'A caller token is issued when you save this service.',
        ),
      );
    }

    return h(
      'div',
      { className: 'flex flex-col gap-2' },
      head,
      adding ? newTokenControls() : null,
      h('div', { className: 'tok-list' }, ...rows.map((t) => tokenCard(t, rows))),
      h(
        'p',
        { className: 'm-0 text-xs text-muted leading-relaxed' },
        'Tokens work in both modes. Paused tokens and requests outside a token’s scope get 403, and expired tokens get 401. Rotating keeps a token’s scope and won’t lock out callers who were given the real ',
        capitalize(label),
        ' key.',
      ),
    );
  }

  function accessCard({ selected, title, body, onSelect, extra, disabled }) {
    return h(
      'div',
      {
        role: 'radio',
        tabindex: disabled ? -1 : 0,
        'aria-checked': selected,
        'aria-disabled': disabled ? 'true' : 'false',
        className: `access-card${selected ? ' access-card-active' : ''}${disabled ? ' access-card-disabled' : ''}`,
        onClick: () => {
          if (!disabled) onSelect();
        },
        onKeyDown: (e) => {
          if (disabled) return;
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onSelect();
          }
        },
      },
      h(
        'div',
        { className: 'flex items-start gap-3 text-left' },
        h('span', {
          className: `access-card-radio${selected ? ' access-card-radio-on' : ''}`,
          'aria-hidden': 'true',
        }),
        h(
          'div',
          { className: 'flex flex-col gap-1 min-w-0 flex-1' },
          h('span', { className: 'text-sm font-semibold text-base-content' }, title),
          h('span', { className: 'text-[13px] text-muted leading-relaxed' }, body),
        ),
      ),
      extra
        ? h(
            'div',
            {
              className: 'access-card-extra',
              onClick: (e) => e.stopPropagation(),
              onKeyDown: (e) => e.stopPropagation(),
            },
            extra,
          )
        : null,
    );
  }

  paint();
  wrap._refresh = paint;
  return wrap;
}

function capitalize(s) {
  if (!s) return s;
  return s.charAt(0).toUpperCase() + s.slice(1);
}
