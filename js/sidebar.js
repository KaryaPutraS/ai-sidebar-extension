/**
 * Main Sidebar Controller
 * Orchestrates UI, providers, rules engine, and chat functionality.
 */

const providerManager = new AIProviderManager();
const rulesEngine = new RulesEngine();

// State
let chatHistory = []; // { role: "user"|"assistant", content: string }
let isLoading = false;

// DOM Elements
const $ = (sel) => document.querySelector(sel);
const mainPanel = $("#mainPanel");
const settingsPanel = $("#settingsPanel");
const rulesPanel = $("#rulesPanel");
const chatContainer = $("#chatContainer");
const welcomeScreen = $("#welcomeScreen");
const chatInput = $("#chatInput");
const sendBtn = $("#sendBtn");
const providerSelect = $("#providerSelect");
const agentMode = $("#agentMode");
const statusDot = $("#statusDot");
const pageContextToggle = $("#pageContextToggle");

// --- Init ---
async function init() {
  await providerManager.loadSettings();
  await rulesEngine.loadRules();

  // Restore last selected provider
  chrome.storage.local.get(["lastProvider", "lastMode"], (data) => {
    if (data.lastProvider) {
      providerSelect.value = data.lastProvider;
      providerManager.setActiveProvider(data.lastProvider);
    }
    if (data.lastMode) {
      agentMode.value = data.lastMode;
      rulesEngine.setMode(data.lastMode);
    }
    updateConnectionStatus();
  });

  populateSettingsUI();
  populateRulesUI();
  bindEvents();
}

// --- Events ---
function bindEvents() {
  // Send message
  sendBtn.addEventListener("click", handleSend);
  chatInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  });

  // Auto-resize input
  chatInput.addEventListener("input", () => {
    chatInput.style.height = "auto";
    chatInput.style.height = Math.min(chatInput.scrollHeight, 120) + "px";
  });

  // Provider change
  providerSelect.addEventListener("change", () => {
    const provider = providerSelect.value;
    providerManager.setActiveProvider(provider);
    chrome.storage.local.set({ lastProvider: provider });
    updateConnectionStatus();
  });

  // Agent mode change
  agentMode.addEventListener("change", () => {
    const mode = agentMode.value;
    rulesEngine.setMode(mode);
    chrome.storage.local.set({ lastMode: mode });
  });

  // Panel navigation
  $("#btnSettings").addEventListener("click", () => showPanel("settings"));
  $("#btnRules").addEventListener("click", () => showPanel("rules"));
  $("#btnBackFromSettings").addEventListener("click", () => showPanel("main"));
  $("#btnBackFromRules").addEventListener("click", () => showPanel("main"));
  $("#btnNewChat").addEventListener("click", newChat);

  // Quick actions
  document.querySelectorAll(".quick-action").forEach((btn) => {
    btn.addEventListener("click", () => {
      chatInput.value = btn.dataset.prompt;
      handleSend();
    });
  });

  // Save settings
  $("#saveSettings").addEventListener("click", saveProviderSettings);

  // Save rules
  $("#saveRules").addEventListener("click", async () => {
    // Save global system prompt
    rulesEngine.globalSystemPrompt = $("#globalSystemPrompt").value;
    await rulesEngine.saveRules();
    showToast("Rules saved!");
  });

  // Test buttons
  document.querySelectorAll(".test-btn").forEach((btn) => {
    btn.addEventListener("click", () => testProvider(btn));
  });

  // Add custom rule
  $("#addCustomRule").addEventListener("click", addCustomRuleUI);
}

// --- Chat ---
async function handleSend() {
  const text = chatInput.value.trim();
  if (!text || isLoading) return;

  // Hide welcome screen
  if (welcomeScreen) {
    welcomeScreen.style.display = "none";
  }

  // Add user message
  chatHistory.push({ role: "user", content: text });
  appendMessage("user", text);
  chatInput.value = "";
  chatInput.style.height = "auto";

  // Show typing indicator
  isLoading = true;
  sendBtn.disabled = true;
  const typingEl = showTypingIndicator();

  try {
    // Get page context if enabled
    let pageContext = null;
    if (pageContextToggle.checked) {
      pageContext = await getPageContext();
    }

    // Build system prompt from rules engine
    const systemPrompt = rulesEngine.buildSystemPrompt(pageContext);

    // Send to AI
    const response = await providerManager.sendMessage(
      chatHistory,
      systemPrompt
    );

    // Add assistant message
    chatHistory.push({ role: "assistant", content: response });
    removeTypingIndicator(typingEl);
    appendMessage("assistant", response);

    // Update status
    statusDot.className = "status-dot connected";
    statusDot.title = "Connected";
  } catch (error) {
    removeTypingIndicator(typingEl);
    appendMessage("assistant", `**Error:** ${error.message}`);
    statusDot.className = "status-dot error";
    statusDot.title = error.message;
  }

  isLoading = false;
  sendBtn.disabled = false;
  chatContainer.scrollTop = chatContainer.scrollHeight;
}

function appendMessage(role, content) {
  const msgDiv = document.createElement("div");
  msgDiv.className = `message ${role}`;

  const avatar = document.createElement("div");
  avatar.className = "message-avatar";
  avatar.textContent = role === "user" ? "U" : "AI";

  const bubble = document.createElement("div");
  bubble.className = "message-bubble";
  bubble.innerHTML = formatMarkdown(content);

  msgDiv.appendChild(avatar);
  msgDiv.appendChild(bubble);
  chatContainer.appendChild(msgDiv);
  chatContainer.scrollTop = chatContainer.scrollHeight;
}

function showTypingIndicator() {
  const msgDiv = document.createElement("div");
  msgDiv.className = "message assistant";
  msgDiv.id = "typingIndicator";

  const avatar = document.createElement("div");
  avatar.className = "message-avatar";
  avatar.textContent = "AI";

  const bubble = document.createElement("div");
  bubble.className = "message-bubble";
  bubble.innerHTML =
    '<div class="typing-indicator"><span></span><span></span><span></span></div>';

  msgDiv.appendChild(avatar);
  msgDiv.appendChild(bubble);
  chatContainer.appendChild(msgDiv);
  chatContainer.scrollTop = chatContainer.scrollHeight;
  return msgDiv;
}

function removeTypingIndicator(el) {
  if (el && el.parentNode) {
    el.parentNode.removeChild(el);
  }
}

function formatMarkdown(text) {
  // Simple markdown rendering
  let html = text
    // Code blocks
    .replace(/```(\w*)\n([\s\S]*?)```/g, (_, lang, code) => {
      const escaped = escapeHtml(code.trim());
      return `<pre><code class="language-${lang}">${escaped}</code></pre>`;
    })
    // Inline code
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    // Bold
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    // Italic
    .replace(/\*(.+?)\*/g, "<em>$1</em>")
    // Headers
    .replace(/^### (.+)$/gm, "<h4>$1</h4>")
    .replace(/^## (.+)$/gm, "<h3>$1</h3>")
    .replace(/^# (.+)$/gm, "<h2>$1</h2>")
    // Bullet lists
    .replace(/^[-*] (.+)$/gm, "<li>$1</li>")
    // Numbered lists
    .replace(/^\d+\. (.+)$/gm, "<li>$1</li>")
    // Paragraphs
    .replace(/\n\n/g, "</p><p>")
    // Line breaks
    .replace(/\n/g, "<br>");

  // Wrap consecutive <li> in <ul>
  html = html.replace(
    /(<li>.*?<\/li>)(?:<br>)?/g,
    "$1"
  );
  html = html.replace(
    /((?:<li>.*?<\/li>)+)/g,
    "<ul>$1</ul>"
  );

  return `<p>${html}</p>`;
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

function newChat() {
  chatHistory = [];
  chatContainer.innerHTML = "";
  if (welcomeScreen) {
    chatContainer.appendChild(welcomeScreen);
    welcomeScreen.style.display = "flex";
  }
}

// --- Page Context ---
async function getPageContext() {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ type: "GET_PAGE_CONTENT" }, (response) => {
      resolve(response?.content || null);
    });
  });
}

// --- Panels ---
function showPanel(name) {
  mainPanel.classList.toggle("hidden", name !== "main");
  settingsPanel.classList.toggle("active", name === "settings");
  rulesPanel.classList.toggle("active", name === "rules");
}

// --- Settings ---
function populateSettingsUI() {
  const s = providerManager.settings;
  $("#openaiKey").value = s.chatgpt?.apiKey || "";
  $("#openaiModel").value = s.chatgpt?.model || "gpt-4o";
  $("#claudeKey").value = s.claude?.apiKey || "";
  $("#claudeModel").value = s.claude?.model || "claude-sonnet-4-6";
  $("#geminiKey").value = s.gemini?.apiKey || "";
  $("#geminiModel").value = s.gemini?.model || "gemini-2.0-flash";
  $("#deepseekKey").value = s.deepseek?.apiKey || "";
  $("#deepseekModel").value = s.deepseek?.model || "deepseek-chat";
  $("#customBaseUrl").value = s.custom?.baseUrl || "";
  $("#customKey").value = s.custom?.apiKey || "";
  $("#customModel").value = s.custom?.model || "";
}

async function saveProviderSettings() {
  const settings = {
    chatgpt: {
      apiKey: $("#openaiKey").value.trim(),
      model: $("#openaiModel").value,
    },
    claude: {
      apiKey: $("#claudeKey").value.trim(),
      model: $("#claudeModel").value,
    },
    gemini: {
      apiKey: $("#geminiKey").value.trim(),
      model: $("#geminiModel").value,
    },
    deepseek: {
      apiKey: $("#deepseekKey").value.trim(),
      model: $("#deepseekModel").value,
    },
    custom: {
      baseUrl: $("#customBaseUrl").value.trim(),
      apiKey: $("#customKey").value.trim(),
      model: $("#customModel").value.trim(),
    },
  };

  await providerManager.saveSettings(settings);
  updateConnectionStatus();
  showToast("Settings saved!");
}

async function testProvider(btn) {
  const provider = btn.dataset.provider;
  btn.textContent = "...";
  btn.className = "test-btn";

  // Temporarily save current input values
  const tempSettings = {
    chatgpt: {
      apiKey: $("#openaiKey").value.trim(),
      model: $("#openaiModel").value,
    },
    claude: {
      apiKey: $("#claudeKey").value.trim(),
      model: $("#claudeModel").value,
    },
    gemini: {
      apiKey: $("#geminiKey").value.trim(),
      model: $("#geminiModel").value,
    },
    deepseek: {
      apiKey: $("#deepseekKey").value.trim(),
      model: $("#deepseekModel").value,
    },
    custom: {
      baseUrl: $("#customBaseUrl").value.trim(),
      apiKey: $("#customKey").value.trim(),
      model: $("#customModel").value.trim(),
    },
  };
  providerManager.settings = tempSettings;

  try {
    await providerManager.testConnection(provider);
    btn.textContent = "OK!";
    btn.className = "test-btn success";
  } catch (e) {
    btn.textContent = "Fail";
    btn.className = "test-btn error";
  }

  setTimeout(() => {
    btn.textContent = "Test";
    btn.className = "test-btn";
  }, 3000);
}

function updateConnectionStatus() {
  const config = providerManager.getProviderConfig();
  const hasKey =
    config.apiKey ||
    (providerManager.activeProvider === "custom" && config.baseUrl);
  statusDot.className = hasKey ? "status-dot connected" : "status-dot";
  statusDot.title = hasKey ? "API key configured" : "No API key set";
}

// --- Rules ---
function populateRulesUI() {
  const builtinContainer = $("#builtinRules");
  builtinContainer.innerHTML = "";

  for (const rule of rulesEngine.builtinRules) {
    builtinContainer.appendChild(createRuleCard(rule, false));
  }

  renderCustomRules();
  $("#globalSystemPrompt").value = rulesEngine.globalSystemPrompt;
}

function renderCustomRules() {
  const container = $("#customRules");
  container.innerHTML = "";
  for (const rule of rulesEngine.customRules) {
    container.appendChild(createRuleCard(rule, true));
  }
}

function createRuleCard(rule, isCustom) {
  const card = document.createElement("div");
  card.className = "rule-card";

  card.innerHTML = `
    <div class="rule-header">
      <span class="rule-name">${escapeHtml(rule.name)}</span>
      <div style="display:flex;align-items:center;gap:6px;">
        ${isCustom ? `<button class="icon-btn" data-delete="${rule.id}" title="Delete" style="width:22px;height:22px;font-size:12px;">&#10005;</button>` : ""}
        <label class="rule-toggle">
          <input type="checkbox" data-rule-id="${rule.id}" ${rule.enabled ? "checked" : ""} />
          <span class="slider"></span>
        </label>
      </div>
    </div>
    <div class="rule-description">${escapeHtml(rule.description)}</div>
  `;

  // Toggle handler
  const checkbox = card.querySelector('input[type="checkbox"]');
  checkbox.addEventListener("change", () => {
    rule.enabled = checkbox.checked;
  });

  // Delete handler
  if (isCustom) {
    const delBtn = card.querySelector(`[data-delete="${rule.id}"]`);
    delBtn.addEventListener("click", () => {
      rulesEngine.removeCustomRule(rule.id);
      renderCustomRules();
    });
  }

  return card;
}

function addCustomRuleUI() {
  const name = prompt("Rule name:");
  if (!name) return;
  const description = prompt("Short description:");
  if (!description) return;
  const promptText = prompt("Rule instruction (system prompt text):");
  if (!promptText) return;

  rulesEngine.addCustomRule(name, description, promptText);
  renderCustomRules();
}

// --- Toast ---
function showToast(message) {
  const existing = document.querySelector(".toast");
  if (existing) existing.remove();

  const toast = document.createElement("div");
  toast.className = "toast";
  toast.textContent = message;
  document.body.appendChild(toast);

  setTimeout(() => toast.remove(), 3000);
}

// --- Start ---
init();
