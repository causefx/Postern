export async function copyText(text) {
  await navigator.clipboard.writeText(text);
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
