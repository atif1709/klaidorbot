import { api, errorMessage } from './api.js';

export async function mountWorkspace({ root = document, navigate = () => location.replace('/') } = {}) {

const pageStatus = root.querySelector('#page-status');
const faqForm = root.querySelector('#faq-form');
const faqStatus = root.querySelector('#faq-status');
const faqList = root.querySelector('#faq-list');
const saveButton = root.querySelector('#save-faq');
const cancelButton = root.querySelector('#cancel-edit');
let editingId = null;
let busy = true;
let ready = false;
const chatForm = root.querySelector('#chat-form');
const chatStatus = root.querySelector('#chat-status');
const logoutButton = root.querySelector('#logout');
const retryButton = root.querySelector('#retry-load');
let faqs = [];

function showError(target, error) {
  if (error.status === 401) navigate();
  else target.textContent = errorMessage(error);
}
function resetEditor() {
  faqForm.reset(); editingId = null; saveButton.textContent = 'Add FAQ'; cancelButton.hidden = true;
}
function renderFaqs() {
  faqList.replaceChildren();
  if (!faqs.length) {
    const empty = document.createElement('p'); empty.className = 'empty';
    empty.textContent = 'No FAQs yet. Add your first question and answer above.'; faqList.append(empty);
  }
  for (const faq of faqs) {
    const article = document.createElement('article'); article.className = 'faq-item';
    const title = document.createElement('h3'); title.textContent = faq.question;
    const answer = document.createElement('p'); answer.textContent = faq.answer;
    const actions = document.createElement('div'); actions.className = 'actions';
    const edit = document.createElement('button'); edit.type = 'button'; edit.className = 'secondary'; edit.textContent = 'Edit';
    edit.disabled = busy || !ready;
    edit.addEventListener('click', () => {
      if (busy || !ready) return;
      editingId = faq.id; faqForm.elements.question.value = faq.question; faqForm.elements.answer.value = faq.answer;
      saveButton.textContent = 'Save changes'; cancelButton.hidden = false; faqStatus.textContent = ''; faqForm.elements.question.focus();
    });
    const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'secondary'; remove.textContent = 'Delete'; remove.disabled = busy || !ready;
    const cancelDelete = document.createElement('button');
    cancelDelete.type = 'button'; cancelDelete.className = 'secondary'; cancelDelete.textContent = 'Cancel'; cancelDelete.hidden = true;
    let confirmingDelete = false;
    cancelDelete.addEventListener('click', () => {
      confirmingDelete = false; remove.textContent = 'Delete'; cancelDelete.hidden = true;
    });
    remove.addEventListener('click', async () => {
      if (busy || !ready) return;
      if (!confirmingDelete) {
        confirmingDelete = true; remove.textContent = 'Confirm delete'; cancelDelete.hidden = false; return;
      }
      setBusy(true);
      try {
        await api(`/api/faqs/${faq.id}`, { method: 'DELETE', body: {} });
        faqs = faqs.filter(item => item.id !== faq.id);
        if (editingId === faq.id) resetEditor();
        faqStatus.textContent = 'FAQ deleted.';
      } catch (error) { showError(faqStatus, error); }
      finally { renderFaqs(); setBusy(false); }
    });
    actions.append(edit, remove, cancelDelete); article.append(title, answer, actions); faqList.append(article);
  }
}
function setBusy(value) {
  busy = value;
  for (const form of [faqForm, chatForm]) {
    form.setAttribute('aria-busy', String(value));
    for (const input of form.elements) input.disabled = value || !ready;
  }
  logoutButton.disabled = value;
  retryButton.disabled = value;
  for (const button of faqList.querySelectorAll('button')) button.disabled = value || !ready;
}
cancelButton.addEventListener('click', () => { if (busy || !ready) return; resetEditor(); faqStatus.textContent = ''; });
faqForm.addEventListener('submit', async event => {
  event.preventDefault();
  if (busy || !ready) return;
  const id = editingId;
  const body = { question: faqForm.elements.question.value, answer: faqForm.elements.answer.value };
  setBusy(true); faqStatus.textContent = 'Saving…';
  try {
    const { faq } = await api(id ? `/api/faqs/${id}` : '/api/faqs', { method: id ? 'PUT' : 'POST', body });
    faqs = id ? faqs.map(item => item.id === id ? faq : item) : [faq, ...faqs];
    resetEditor(); faqStatus.textContent = 'FAQ saved. Your assistant can use this answer now.';
  } catch (error) { showError(faqStatus, error); }
  finally { renderFaqs(); setBusy(false); }
});

const conversation = root.querySelector('#conversation');
function message(text, className, source) {
  const bubble = document.createElement('p'); bubble.className = className; bubble.textContent = text;
  if (source) { const label = document.createElement('span'); label.className = 'source'; label.textContent = `From your FAQs: ${source.question}`; bubble.append(label); }
  conversation.append(bubble); conversation.scrollTop = conversation.scrollHeight;
}
chatForm.addEventListener('submit', async event => {
  event.preventDefault(); if (busy || !ready) return;
  setBusy(true);
  const question = chatForm.elements.question.value;
  message(question, 'user-message'); chatStatus.textContent = 'Looking through your FAQs…';
  try {
    const data = await api('/api/chat', { method: 'POST', body: { question } });
    message(data.answer, 'bot-message', data.source); chatForm.reset(); chatStatus.textContent = '';
  } catch (error) { showError(chatStatus, error); }
  finally { setBusy(false); }
});
logoutButton.addEventListener('click', async () => {
  if (busy) return;
  setBusy(true);
  try { await api('/api/logout', { method: 'POST', body: {} }); navigate(); }
  catch (error) { showError(pageStatus, error); setBusy(false); }
});
async function loadWorkspace() {
  ready = false;
  setBusy(true);
  retryButton.hidden = true;
  pageStatus.textContent = 'Loading your workspace…';
  try {
    const { user } = await api('/api/me');
    root.querySelector('#username').textContent = user.username;
    ({ faqs } = await api('/api/faqs'));
    ready = true;
    renderFaqs();
    pageStatus.textContent = '';
  } catch (error) {
    showError(pageStatus, error);
    retryButton.hidden = error.status === 401;
  } finally { setBusy(false); }
}
retryButton.addEventListener('click', () => { if (!busy) loadWorkspace(); });
await loadWorkspace();

}

if (document.querySelector('#faq-form')) await mountWorkspace();
