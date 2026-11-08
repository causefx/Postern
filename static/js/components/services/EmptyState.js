import { h } from '../../lib/h.js';
import { Icon } from '../common/Icon.js';

export function EmptyState({ onAdd }) {
  return h(
    'section',
    {
      className:
        'flex flex-col items-center text-center gap-10 py-12 sm:py-16 max-w-3xl mx-auto w-full',
    },
    h(
      'div',
      { className: 'flex flex-col gap-3 max-w-xl' },
      h(
        'h1',
        { className: 'font-display m-0 text-[30px] sm:text-[34px] font-bold tracking-tight text-eggshell' },
        'Put a front door on your first service',
      ),
      h(
        'p',
        { className: 'm-0 text-muted text-[15px] leading-relaxed' },
        'Register something on your private network. Postern publishes it at its own route and hands callers a token, while the real API key stays here.',
      ),
    ),
    h(
      'div',
      {
        className:
          'flex flex-col sm:flex-row items-stretch sm:items-center justify-center gap-3 sm:gap-2.5 w-full',
      },
      flowCard({
        icon: Icon('globe', { size: 18 }),
        iconWrap: 'w-9 h-9 rounded-full bg-space-raised text-denim border border-line',
        title: 'Caller on the internet',
        sub: 'sends a Postern token',
      }),
      Icon('arrow', { size: 18, className: 'text-denim hidden sm:block shrink-0' }),
      flowCard({
        icon: Icon('door', { size: 20 }),
        iconWrap: 'w-10 h-10 rounded-[10px] bg-eggshell text-ink',
        title: 'Postern',
        sub: 'swaps token for real key',
        highlight: true,
      }),
      Icon('arrow', { size: 18, className: 'text-denim hidden sm:block shrink-0' }),
      flowCard({
        icon: Icon('lock', { size: 18 }),
        iconWrap: 'w-9 h-9 rounded-full bg-space-raised text-denim border border-line',
        title: 'Your private service',
        sub: 'never exposed directly',
      }),
    ),
    h(
      'div',
      {
        className:
          'grid grid-cols-1 sm:grid-cols-3 gap-8 sm:gap-6 w-full text-left pt-2',
      },
      step(1, 'Name it', 'The name becomes the route, like /p/sonarr/.'),
      step(2, 'Point to the upstream', 'Its private URL and API key. Only Postern needs to reach it.'),
      step(3, 'Share the token', 'Turn it off or rotate it anytime without touching the service.'),
    ),
    h(
      'button',
      { type: 'button', className: 'btn btn-primary gap-2 h-12 px-5 text-[15px] font-semibold', onClick: onAdd },
      Icon('plus', { size: 16 }),
      'Add your first service',
    ),
  );
}

function flowCard({ icon, iconWrap, title, sub, highlight = false }) {
  return h(
    'div',
    {
      className: [
        'flex flex-col items-center gap-2.5 px-5 py-5 rounded-[14px] border flex-1 min-w-0',
        highlight
          ? 'border-line-strong bg-space-raised shadow-[0_0_0_1px_rgba(240,235,216,0.04)]'
          : 'border-line bg-base-200',
      ].join(' '),
    },
    h('div', { className: `flex items-center justify-center ${iconWrap}`, 'aria-hidden': 'true' }, icon),
    h(
      'div',
      { className: 'flex flex-col gap-0.5' },
      h('span', { className: 'font-semibold text-sm text-eggshell' }, title),
      h('span', { className: 'text-xs text-muted' }, sub),
    ),
  );
}

function step(n, title, body) {
  return h(
    'div',
    { className: 'flex flex-col gap-2.5' },
    h(
      'div',
      {
        className:
          'w-7 h-7 rounded-full border border-slate bg-ink-raised text-cream-dim text-xs font-semibold flex items-center justify-center',
        'aria-hidden': 'true',
      },
      String(n),
    ),
    h('div', { className: 'font-semibold text-[15px] text-eggshell' }, title),
    h('p', { className: 'm-0 text-sm text-muted leading-relaxed' }, body),
  );
}
