import { h } from '../../lib/h.js';
import { filteredServices } from '../../state.js';
import { ServiceRow } from './ServiceRow.js';

export function ServiceList({ handlers }) {
  const items = filteredServices();
  const section = h('section', { className: 'flex flex-col gap-2.5', 'aria-label': 'Services' });
  section.append(
    h(
      'div',
      { className: 'svc-row svc-head' },
      h('span', {}, 'Service'),
      h('span', {}, 'Public route'),
      h('span', {}, 'Upstream'),
      h('span', {}, 'Upstream auth'),
      h('span', {}, ''),
    ),
  );
  for (const s of items) {
    section.append(ServiceRow({ service: s, handlers }));
  }
  if (!items.length) {
    section.append(h('p', { className: 'text-muted text-sm px-1' }, 'No services match this filter.'));
  }
  return section;
}
