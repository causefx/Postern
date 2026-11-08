import { h } from '../../lib/h.js';
import { SecretField } from '../common/SecretField.js';
import { CodeBlock } from '../common/CodeBlock.js';
import { authPreview, authLabel, authMethodShort } from '../../lib/authPreview.js';

export function ServiceDetail({ service, onRotate, onEdit, onDelete }) {
  const base = service.publicBase || `${location.origin}/p/${service.name}/`;
  const upstreamGate = service.access === 'upstream';
  const curl = upstreamGate ? upstreamCurl(service, base) : `curl -H "Authorization: Bearer $POSTERN_TOKEN" \\\n  ${base}api/…`;

  return h(
    'div',
    {
      className: 'detail grid gap-5 p-5 border-t border-line bg-space-sunk rounded-b-[14px]',
      style: { gridTemplateColumns: 'repeat(auto-fit,minmax(min(320px,100%),1fr))' },
    },
    !service.enabled
      ? h('p', { className: 'col-span-full m-0 text-sm text-warn' }, 'This service is off — callers are refused until you switch it on.')
      : null,
    h(
      'div',
      { className: 'flex flex-col gap-2' },
      h('span', { className: 'label-caps' }, upstreamGate ? 'Caller access' : 'Caller token'),
      upstreamGate
        ? h(
            'div',
            { className: 'flex flex-col gap-2' },
            h(
              'p',
              { className: 'm-0 text-sm text-cream-dim leading-relaxed' },
              'Callers send ',
              h('span', { className: 'font-mono text-[13px]' }, authMethodShort(service.auth)),
              ' with either the Postern token or the real upstream key (',
              h('span', { className: 'font-mono text-[13px]' }, authLabel(service.auth)),
              ').',
            ),
            SecretField({ value: service.token }),
            h('p', { className: 'm-0 text-xs text-muted' }, 'Postern token — also accepted in the upstream credential field'),
            h(
              'p',
              { className: 'm-0 text-xs text-muted leading-relaxed' },
              'Callers using the real key are unaffected by rotating this token.',
            ),
          )
        : h(
            'div',
            { className: 'flex flex-col gap-2' },
            SecretField({ value: service.token }),
            h('p', { className: 'm-0 text-xs text-muted' }, 'Send as Authorization: Bearer'),
            h(
              'p',
              { className: 'm-0 text-xs text-muted leading-relaxed' },
              'Rotating issues a new token and stops the old one immediately. The upstream key is never affected.',
            ),
          ),
      h(
        'div',
        { className: 'flex flex-wrap gap-2 mt-1' },
        h('button', { type: 'button', className: 'btn btn-sm', onClick: onRotate }, 'Rotate token'),
        h('button', { type: 'button', className: 'btn btn-sm', onClick: onEdit }, 'Edit service'),
        h('button', { type: 'button', className: 'btn btn-sm btn-outline btn-error', onClick: onDelete }, 'Delete'),
      ),
    ),
    h(
      'div',
      { className: 'flex flex-col gap-2' },
      h('span', { className: 'label-caps' }, 'Try it'),
      CodeBlock({ text: curl }),
      h('span', { className: 'label-caps mt-2' }, 'Postern forwards it upstream with'),
      h('pre', { className: 'code-block border-dashed' }, authPreview(service.auth, { url: service.url })),
    ),
  );
}

function upstreamCurl(service, base) {
  const a = service.auth || {};
  switch (a.type) {
    case 'header':
      return `curl -H "${a.name || 'X-Api-Key'}: $TOKEN_OR_KEY" \\\n  ${base}api/…`;
    case 'query':
      return `curl "${base}api/…?${a.name || 'apikey'}=$TOKEN_OR_KEY"`;
    case 'bearer':
      return `curl -H "Authorization: Bearer $TOKEN_OR_KEY" \\\n  ${base}api/…`;
    case 'basic':
      return `curl -u "${a.username || 'user'}:$TOKEN_OR_PASSWORD" \\\n  ${base}api/…`;
    default:
      return `curl ${base}api/…`;
  }
}
