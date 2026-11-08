const form = document.getElementById('login');
const err = document.getElementById('err');
const pass = document.getElementById('pass');
const toggle = document.getElementById('toggle-pass');
const eye = document.getElementById('eye-icon');
const host = document.getElementById('host');
const insecure = document.getElementById('insecure');

host.textContent = location.host;
if (location.protocol !== 'https:') {
  insecure.classList.remove('hidden');
  insecure.classList.add('flex');
}

const eyeOpen =
  '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>';
const eyeClosed =
  '<path d="M3 3l18 18M10.5 10.5a3 3 0 0 0 4.2 4.2M7 7C4 8.5 2 12 2 12s3.5 7 10 7c1.7 0 3.2-.4 4.5-1M14 6.2C13.4 6.1 12.7 6 12 6 5.5 6 2 12 2 12a18 18 0 0 0 3.2 3.8"/>';

toggle.addEventListener('click', () => {
  const show = pass.type === 'password';
  pass.type = show ? 'text' : 'password';
  toggle.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
  eye.innerHTML = show ? eyeClosed : eyeOpen;
});

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  err.textContent = '';
  pass.classList.remove('border-danger-line');
  const password = pass.value;
  const remember = document.getElementById('remember').checked;
  try {
    const res = await fetch(`${location.protocol}//${location.host}/admin/api/login`, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password, remember }),
    });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) {
      err.textContent = j.error || 'Wrong password';
      pass.classList.add('border-danger-line');
      pass.focus();
      pass.select();
      return;
    }
    location.replace('/admin/');
  } catch (ex) {
    err.textContent = ex.message || 'Sign in failed';
  }
});
