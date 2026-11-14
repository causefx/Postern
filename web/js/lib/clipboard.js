import { toast } from '../components/common/Toast.js';

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

/** Copy to clipboard and show a short "copied" toast. `label` names what was copied. */
export async function copyValue(text, label = 'Value copied') {
  const value = typeof text === 'function' ? text() : text;
  try {
    await copyText(value);
    toast.quick(label);
  } catch {
    toast.error("Couldn't copy", { detail: 'The browser blocked access to the clipboard.' });
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
