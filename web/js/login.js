import { LoginPage } from './components/login/LoginPage.js';
import { rise } from './lib/motion.js';

document.getElementById('app').replaceChildren(LoginPage());
// The brand side and the form side settle in one after the other.
rise([...document.querySelectorAll('.login-brand > *')], { delay: 0.04, step: 0.08, y: 12, duration: 0.42 });
rise([...document.querySelectorAll('.login-form-side > *:not(.absolute)')], { delay: 0.16, step: 0.08, y: 12, duration: 0.42 });
const password = document.getElementById('password');
if (password && !password.closest('.password-block')?.hidden) password.focus();
