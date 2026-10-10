import { api, errorMessage } from './api.js';

export async function mountLogin({ root = document, navigate = () => location.assign('/workspace') } = {}) {

const password = root.querySelector('#password');
const status = root.querySelector('#form-status');
const loginForm = root.querySelector('#login-form');
const loginButton = loginForm.querySelector('[type=submit]');
let loggingIn = false;
let checkingSession = true;
loginButton.disabled = true;
root.querySelector('.show-password').addEventListener('click', function () {
  const show = password.type === 'password';
  password.type = show ? 'text' : 'password';
  this.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
  this.setAttribute('aria-pressed', String(show));
});
loginForm.addEventListener('submit', async event => {
  event.preventDefault();
  if (checkingSession || loggingIn || accountDialog.open) return;
  loggingIn = true;
  loginButton.disabled = true;
  status.textContent = 'Logging in…';
  try {
    await api('/api/login', { method: 'POST', body: {
      username: loginForm.elements.username.value,
      password: password.value,
      remember: loginForm.elements['remember-me'].checked,
    } });
    password.value = '';
    navigate();
  } catch (error) { status.textContent = errorMessage(error); }
  finally { loggingIn = false; loginButton.disabled = false; }
});

const content = {
  help: ['A little help getting started', 'Create an account, save your recovery code, and add questions and answers to your FAQ workspace. You can test your chatbot against those saved FAQs.'],
  terms: ['Terms of use', 'Published terms of use must be added by the site owner before the service launches publicly.'],
  privacy: ['Privacy policy', 'This application stores your username, a password hash, a recovery code hash, login sessions and your FAQs in its database. The site owner must publish a complete privacy policy before public launch.'],
};
const infoDialog = root.querySelector('#info-dialog');
const accountDialog = root.querySelector('#account-dialog');
const accountForm = root.querySelector('#account-form');
const accountStatus = root.querySelector('#account-status');
const accountButton = root.querySelector('#account-submit');
const recoveryResult = root.querySelector('#recovery-result');
const savedRecoveryCode = root.querySelector('#saved-recovery-code');
let mode = 'signup';
let accountBusy = false;
function openAccount(nextMode) {
  if (checkingSession || loggingIn || accountBusy) return;
  mode = nextMode;
  accountForm.reset();
  accountForm.hidden = false;
  recoveryResult.hidden = true;
  savedRecoveryCode.value = '';
  accountStatus.textContent = '';
  const reset = mode === 'reset';
  root.querySelector('#account-title').textContent = reset ? 'Reset your password' : 'Create your account';
  root.querySelector('#account-description').textContent = reset
    ? 'Enter your username and the recovery code you saved when you created your account.'
    : 'Choose a username with 3–32 letters, numbers, periods, underscores or hyphens.';
  root.querySelector('#recovery-field').hidden = !reset;
  root.querySelector('#recovery-code').required = reset;
  accountButton.textContent = reset ? 'Reset password' : 'Create account';
  accountDialog.showModal();
}
root.querySelectorAll('[data-dialog]').forEach(link => link.addEventListener('click', event => {
  event.preventDefault();
  const type = link.dataset.dialog;
  if (type === 'signup' || type === 'reset') return openAccount(type);
  const [title, copy] = content[type];
  root.querySelector('#dialog-title').textContent = title;
  root.querySelector('#dialog-copy').textContent = copy;
  infoDialog.showModal();
}));
accountForm.addEventListener('submit', async event => {
  event.preventDefault();
  if (accountBusy) return;
  accountBusy = true;
  for (const input of accountForm.elements) input.disabled = true;
  accountStatus.textContent = 'Saving…';
  try {
    const data = await api(mode === 'signup' ? '/api/register' : '/api/reset-password', { method: 'POST', body: {
      username: accountForm.elements.username.value,
      password: accountForm.elements.password.value,
      recoveryCode: accountForm.elements.recoveryCode.value,
    } });
    accountForm.reset();
    accountForm.hidden = true;
    savedRecoveryCode.value = data.recoveryCode;
    recoveryResult.hidden = false;
    accountStatus.textContent = mode === 'signup' ? 'Your account is ready.' : 'Password updated. Your old recovery code and login sessions have been revoked.';
    savedRecoveryCode.focus();
  } catch (error) { accountStatus.textContent = errorMessage(error); }
  finally { accountBusy = false; for (const input of accountForm.elements) input.disabled = false; }
});
root.querySelector('#account-close').addEventListener('click', () => { if (!accountBusy) accountDialog.close(); });
accountDialog.addEventListener('cancel', event => { if (accountBusy) event.preventDefault(); });
accountDialog.addEventListener('close', () => {
  accountForm.reset();
  savedRecoveryCode.value = '';
});
root.querySelector('#recovery-done').addEventListener('click', () => {
  accountDialog.close();
  if (mode === 'signup') navigate();
  else { status.textContent = 'Password updated. Log in with your new password.'; root.querySelector('#username').focus(); }
});

const answers = {
  setup: ['How do I get started?', 'Create an account, add your FAQ questions and answers, and test your assistant in your workspace.'],
  availability: ['Are you available 24/7?', 'Your FAQ assistant can answer whenever this website is online. Keep your FAQ answers up to date to help visitors.'],
};
root.querySelectorAll('[data-faq]').forEach(button => button.addEventListener('click', () => {
  const [question, answer] = answers[button.dataset.faq];
  root.querySelector('#demo-question').textContent = question;
  root.querySelector('#demo-answer').textContent = answer;
}));
root.querySelector('#year').textContent = new Date().getFullYear();
const accountLinks = root.querySelectorAll('[data-dialog="signup"], [data-dialog="reset"]');
for (const link of accountLinks) link.setAttribute('aria-disabled', 'true');
status.textContent = 'Checking your session…';
try {
  await api('/api/me');
  navigate();
} catch (error) {
  status.textContent = error.status === 401 ? '' : errorMessage(error);
  checkingSession = false;
  loginButton.disabled = false;
  for (const link of accountLinks) link.removeAttribute('aria-disabled');
}

}

if (document.querySelector('#login-form')) await mountLogin();
