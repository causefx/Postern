import { showToast } from '../components/common/Toast.js';

function legacyCopy(text) {
  const el = document.createElement('textarea');
  el.value = text;
  el.setAttribute('readonly', '');
  el.style.position = 'fixed';
  el.style.top = '-9999px';
  el.style.left = '-9999px';
  document.body.append(el);
  el.select();
  el.setSelectionRange(0, el.value.length);
  const ok = document.execCommand('copy');
  el.remove();
  if (!ok) throw new Error('Copy failed');
}

export async function copyText(text) {
  const value = text == null ? '' : String(text);
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(value);
      return;
    } catch {
      /* fall through to legacy */
    }
  }
  legacyCopy(value);
}

/** Copy to clipboard and show a "Value copied" toast. */
export async function copyValue(text) {
  const value = typeof text === 'function' ? text() : text;
  try {
    await copyText(value);
    showToast('Value copied');
  } catch {
    showToast('Copy failed', 'error');
    throw new Error('Copy failed');
  }
}

/** Sets button text to "Copied" for 1.4s then restores. */
export function flashCopied(btn, label = 'Copied') {
  const prev = btn.dataset.label || btn.textContent;
  btn.dataset.label = prev;
  btn.textContent = label;
  clearTimeout(btn._copiedTimer);
  btn._copiedTimer = setTimeout(() => {
    btn.textContent = btn.dataset.label;
  }, 1400);
}
