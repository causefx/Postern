import { h } from '../../lib/h.js';
import { state, setState, subscribe } from '../../state.js';

let root;

export function mountToast(parent) {
  root = h('div', {
    className: 'toast toast-end toast-bottom postern-toast',
    'aria-live': 'polite',
  });
  parent.append(root);
  subscribe(render);
  render();
}

function render() {
  if (!root) return;
  root.replaceChildren();
  if (!state.toast) return;
  root.append(
    h(
      'div',
      { className: `alert ${state.toast.type === 'error' ? 'alert-error' : 'alert-soft alert-success'} shadow-lg` },
      h('span', {}, state.toast.message),
    ),
  );
}

export function showToast(message, type = 'success') {
  setState({ toast: { message, type } });
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => setState({ toast: null }), 2800);
}
