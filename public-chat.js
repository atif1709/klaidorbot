const username = decodeURIComponent(location.pathname.split('/').pop() || '').toLowerCase();
const title = document.querySelector('#chat-title');
const form = document.querySelector('#question-form');
const questionInput = document.querySelector('#question');
const sendButton = document.querySelector('#send');
const conversation = document.querySelector('#conversation');
const status = document.querySelector('#status');

if (!/^[a-z0-9._-]{3,32}$/.test(username)) {
  form.hidden = true;
  status.textContent = 'This chatbot link is invalid.';
} else {
  title.textContent = `Ask ${username}`;
}

function addMessage(text, kind, source) {
  const message = document.createElement('p');
  message.className = `message ${kind}`;
  message.textContent = text;
  if (source) {
    const label = document.createElement('span');
    label.className = 'source';
    label.textContent = `From the FAQs: ${source}`;
    message.append(label);
  }
  conversation.append(message);
  conversation.scrollTop = conversation.scrollHeight;
}

form.addEventListener('submit', async event => {
  event.preventDefault();
  if (!form.reportValidity()) return;
  const question = questionInput.value.trim();
  if (!question) {
    status.textContent = 'Enter a question before sending.';
    return;
  }
  sendButton.disabled = true;
  questionInput.disabled = true;
  status.textContent = '';
  addMessage(question, 'visitor');
  try {
    const response = await fetch(`/api/public/chat/${encodeURIComponent(username)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question }),
    });
    let data;
    try { data = await response.json(); }
    catch { throw new Error('The chatbot returned an invalid response. Please try again.'); }
    if (!response.ok) throw new Error(data.error || 'The chatbot could not answer right now.');
    addMessage(data.answer, 'assistant', data.source?.question);
    form.reset();
  } catch (error) {
    status.textContent = error instanceof TypeError
      ? 'Unable to reach the chatbot. Check your connection and try again.'
      : error.message;
  } finally {
    sendButton.disabled = false;
    questionInput.disabled = false;
    questionInput.focus();
  }
});
