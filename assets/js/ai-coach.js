(function initializeAiCoach() {
  const panel = document.getElementById('ai-panel');
  const openButton = document.getElementById('ai-fab-inline');
  const input = document.getElementById('ai-input');
  const sendButton = document.getElementById('ai-send');
  const status = document.getElementById('ai-status');
  let aiMode = 'coach';
  let aiHistory = [];
  let healthChecked = false;

  function setStatus(kind, label) {
    if (!status) return;
    status.className = `ai-status ${kind}`;
    status.textContent = label;
  }

  async function checkHealth() {
    setStatus('checking', 'Connecting…');
    try {
      const health = await window.apiRequest('/health', { timeoutMs: 60000 });
      if (!health.openai) throw new Error('AI is not configured on the server.');
      setStatus('online', 'Online');
      healthChecked = true;
      return true;
    } catch (error) {
      setStatus('offline', 'Offline');
      if (!healthChecked) addAiMsg('bot', `⚠️ ${error.message}`);
      healthChecked = true;
      return false;
    }
  }

  openButton.addEventListener('click', () => {
    const isOpen = panel.classList.toggle('open');
    if (isOpen) {
      input.focus();
      checkHealth();
    }
  });

  window.setAiMode = function setAiMode(mode) {
    aiMode = mode;
    aiHistory = [];
    document.querySelectorAll('.ai-mode-btn').forEach((button) => {
      button.classList.toggle('active', button.dataset.mode === mode);
    });
    const labels = {
      coach: '🧠 Coach mode — ask about your goals, progress, or today\'s plan.',
      russian: '🇷🇺 Russian practice — I\'ll respond in Russian and correct your mistakes.',
      finance: '💰 Finance mode — ask about spending, savings, or your car goal.',
    };
    addAiMsg('bot', labels[mode] || labels.coach);
  };

  window.aiSend = async function aiSend() {
    const message = input.value.trim();
    if (!message || sendButton.disabled) return;
    if (message.length > 2000) {
      addAiMsg('bot', '⚠️ Please keep messages under 2,000 characters.');
      return;
    }

    input.value = '';
    addAiMsg('user', message);
    sendButton.disabled = true;
    setStatus('checking', 'Thinking…');
    const typing = addAiMsg('bot', 'Thinking…', 'typing');

    try {
      const data = await window.apiRequest('/chat', {
        method: 'POST',
        body: JSON.stringify({
          message,
          mode: aiMode,
          history: aiHistory.slice(-10),
          context: window.getPlannerCoachContext?.() || null,
        }),
      });
      typing.remove();
      const reply = data.reply || 'The AI returned an empty response. Please try again.';
      addAiMsg('bot', reply);
      aiHistory.push(
        { role: 'user', content: message },
        { role: 'assistant', content: reply },
      );
      aiHistory = aiHistory.slice(-20);
      setStatus('online', 'Online');
    } catch (error) {
      typing.remove();
      addAiMsg('bot', `❌ ${error.message}`);
      setStatus('offline', 'Offline');
    } finally {
      sendButton.disabled = false;
      input.focus();
    }
  };

  function addAiMsg(role, text, extraClass = '') {
    const box = document.getElementById('ai-messages');
    const message = document.createElement('div');
    message.className = `ai-msg ${role}${extraClass ? ` ${extraClass}` : ''}`;
    message.textContent = text;
    box.appendChild(message);
    box.scrollTop = box.scrollHeight;
    return message;
  }

  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      window.aiSend();
    }
  });
})();
