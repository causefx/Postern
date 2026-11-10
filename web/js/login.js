import { LoginPage } from './components/login/LoginPage.js';

document.getElementById('app').replaceChildren(LoginPage());
const password = document.getElementById('password');
if (password && !password.closest('.password-block')?.hidden) password.focus();
