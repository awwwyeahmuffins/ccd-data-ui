// chatUI.js
// --------------------------------------------------------------------------------
// Chat DOM components — message bubbles, input area, suggestions, streaming display.

// ---------------------------------------------------------------------------
// Markdown-lite renderer (XSS-safe)
// ---------------------------------------------------------------------------

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = String(str);
  return div.innerHTML;
}

function renderMarkdown(text) {
  let html = escapeHtml(text);
  // Bold: **text**
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  // Italic: *text*
  html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');
  // Bullet lists: lines starting with "- "
  html = html.replace(/^- (.+)$/gm, '<li>$1</li>');
  html = html.replace(/(<li>.*<\/li>\n?)+/g, '<ul>$&</ul>');
  // Line breaks
  html = html.replace(/\n/g, '<br>');
  return html;
}

// ---------------------------------------------------------------------------
// Chat Section Builder
// ---------------------------------------------------------------------------

const SUGGESTIONS = [
  'What makes this precinct unique?',
  'How does income compare to the county?',
  'Summarize the election history',
];

export function createChatSection() {
  const section = document.createElement('div');
  section.className = 'precinct-chat';

  section.innerHTML = `
    <div class="chat-header" role="button" tabindex="0" aria-expanded="false">
      <span class="chat-header-title">Chat with Precinct</span>
      <span class="chat-header-chevron">&#9660;</span>
    </div>
    <div class="chat-body" style="display:none;">
      <div class="chat-status" style="display:none;"></div>
      <div class="chat-messages">
        <div class="chat-welcome">Ask anything about this precinct's demographics, elections, or political landscape.</div>
        <div class="chat-suggestions"></div>
      </div>
      <div class="chat-input-area">
        <textarea class="chat-input" placeholder="Ask a question..." rows="1"></textarea>
        <button class="chat-send-btn" title="Send">&#9654;</button>
        <button class="chat-stop-btn" title="Stop generating" style="display:none;">&#9632;</button>
      </div>
    </div>
  `;

  // Populate suggestion buttons
  const suggestionsContainer = section.querySelector('.chat-suggestions');
  for (const text of SUGGESTIONS) {
    const btn = document.createElement('button');
    btn.className = 'chat-suggestion-btn';
    btn.textContent = text;
    suggestionsContainer.appendChild(btn);
  }

  // Toggle expand/collapse
  const header = section.querySelector('.chat-header');
  const body = section.querySelector('.chat-body');
  const chevron = section.querySelector('.chat-header-chevron');

  header.addEventListener('click', () => {
    const expanded = body.style.display !== 'none';
    body.style.display = expanded ? 'none' : 'flex';
    chevron.style.transform = expanded ? '' : 'rotate(180deg)';
    header.setAttribute('aria-expanded', String(!expanded));
    if (!expanded) {
      header.dispatchEvent(new CustomEvent('chat-expanded', { bubbles: true }));
    }
  });

  header.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      header.click();
    }
  });

  // Auto-resize textarea
  const textarea = section.querySelector('.chat-input');
  textarea.addEventListener('input', () => {
    textarea.style.height = 'auto';
    textarea.style.height = Math.min(textarea.scrollHeight, 120) + 'px';
  });

  return section;
}

// ---------------------------------------------------------------------------
// Message Rendering
// ---------------------------------------------------------------------------

export function appendMessage(container, role, content) {
  const msg = document.createElement('div');
  msg.className = role === 'user' ? 'chat-message-user' : 'chat-message-assistant';
  msg.innerHTML = renderMarkdown(content);
  container.appendChild(msg);
  container.scrollTop = container.scrollHeight;
  return msg;
}

export function createStreamingMessage(container) {
  const msg = document.createElement('div');
  msg.className = 'chat-message-assistant';

  const cursor = document.createElement('span');
  cursor.className = 'typing-cursor';
  msg.appendChild(cursor);

  container.appendChild(msg);
  container.scrollTop = container.scrollHeight;

  let text = '';

  return {
    append(token) {
      text += token;
      // Re-render content + cursor
      msg.innerHTML = renderMarkdown(text);
      const c = document.createElement('span');
      c.className = 'typing-cursor';
      msg.appendChild(c);
      container.scrollTop = container.scrollHeight;
    },
    finish() {
      msg.innerHTML = renderMarkdown(text);
      container.scrollTop = container.scrollHeight;
      return text;
    },
  };
}

// ---------------------------------------------------------------------------
// Chat Controller
// ---------------------------------------------------------------------------

export function initChatController({
  precinctCode,
  chatSection,
  conversationManager,
  systemPrompt,
  streamChatFn,
  onStatusChange,
}) {
  const messagesContainer = chatSection.querySelector('.chat-messages');
  const textarea = chatSection.querySelector('.chat-input');
  const sendBtn = chatSection.querySelector('.chat-send-btn');
  const stopBtn = chatSection.querySelector('.chat-stop-btn');
  const suggestions = chatSection.querySelector('.chat-suggestions');

  let abortController = null;
  let generating = false;

  // Restore previous conversation
  const prevMessages = conversationManager.getMessages(precinctCode);
  if (prevMessages.length > 0) {
    // Hide welcome + suggestions
    const welcome = messagesContainer.querySelector('.chat-welcome');
    if (welcome) welcome.style.display = 'none';
    suggestions.style.display = 'none';

    for (const msg of prevMessages) {
      appendMessage(messagesContainer, msg.role, msg.content);
    }
  }

  async function sendMessage(text) {
    const trimmed = text.trim();
    if (!trimmed || generating) return;

    // Hide welcome + suggestions on first message
    const welcome = messagesContainer.querySelector('.chat-welcome');
    if (welcome) welcome.style.display = 'none';
    suggestions.style.display = 'none';

    // Add user message
    conversationManager.addUserMessage(precinctCode, trimmed);
    appendMessage(messagesContainer, 'user', trimmed);

    // Clear input
    textarea.value = '';
    textarea.style.height = 'auto';

    // Start streaming
    generating = true;
    sendBtn.style.display = 'none';
    stopBtn.style.display = '';
    onStatusChange?.('generating');

    abortController = new AbortController();
    const fullMessages = conversationManager.buildFullMessages(precinctCode, systemPrompt);
    const streamer = createStreamingMessage(messagesContainer);

    await streamChatFn(fullMessages, {
      onToken(token) {
        streamer.append(token);
      },
      onDone(fullText) {
        const finalText = streamer.finish();
        conversationManager.addAssistantMessage(precinctCode, finalText);
        finishGenerating();
      },
      onError(err) {
        streamer.append('\n\n[Error: ' + (err.message || 'Stream failed') + ']');
        const finalText = streamer.finish();
        conversationManager.addAssistantMessage(precinctCode, finalText);
        finishGenerating();
      },
      signal: abortController.signal,
    });
  }

  function finishGenerating() {
    generating = false;
    abortController = null;
    sendBtn.style.display = '';
    stopBtn.style.display = 'none';
    onStatusChange?.('idle');
  }

  function stopGenerating() {
    if (abortController) {
      abortController.abort();
    }
  }

  // Event: Enter to send, Shift+Enter for newline
  textarea.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage(textarea.value);
    }
  });

  sendBtn.addEventListener('click', () => sendMessage(textarea.value));
  stopBtn.addEventListener('click', stopGenerating);

  // Suggestion clicks
  suggestions.addEventListener('click', (e) => {
    const btn = e.target.closest('.chat-suggestion-btn');
    if (btn) {
      sendMessage(btn.textContent);
    }
  });

  // Cleanup function
  return function cleanup() {
    stopGenerating();
  };
}
