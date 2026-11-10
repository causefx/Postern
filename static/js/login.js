import { LoginPage } from './components/login/LoginPage.js';

document.getElementById('app').replaceChildren(LoginPage());
document.getElementById('password')?.focus();
