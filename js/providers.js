/**
 * AI Provider Connectors
 * Handles API communication with different AI model providers.
 * Gemini uses Google OAuth (no API key needed), others use API keys.
 */

class AIProviderManager {
  constructor() {
    this.providers = {
      gemini: new GeminiProvider(),
      chatgpt: new OpenAIProvider(),
      claude: new ClaudeProvider(),
      deepseek: new DeepSeekProvider(),
      custom: new CustomProvider(),
    };
    this.activeProvider = "gemini";
    this.settings = {};
    this.googleAuthToken = null;
  }

  async loadSettings() {
    return new Promise((resolve) => {
      chrome.storage.local.get("providerSettings", (data) => {
        this.settings = data.providerSettings || {};
        resolve(this.settings);
      });
    });
  }

  async saveSettings(settings) {
    this.settings = settings;
    return new Promise((resolve) => {
      chrome.storage.local.set({ providerSettings: settings }, resolve);
    });
  }

  setGoogleAuthToken(token) {
    this.googleAuthToken = token;
  }

  setActiveProvider(name) {
    this.activeProvider = name;
  }

  getActiveProvider() {
    return this.providers[this.activeProvider];
  }

  getProviderConfig() {
    const config = this.settings[this.activeProvider] || {};
    // Inject Google OAuth token for Gemini
    if (this.activeProvider === "gemini" && this.googleAuthToken) {
      config.authToken = this.googleAuthToken;
    }
    return config;
  }

  isProviderReady() {
    if (this.activeProvider === "gemini") {
      return !!this.googleAuthToken;
    }
    if (this.activeProvider === "custom") {
      const config = this.settings.custom || {};
      return !!config.baseUrl;
    }
    const config = this.settings[this.activeProvider] || {};
    return !!config.apiKey;
  }

  async sendMessage(messages, systemPrompt) {
    const provider = this.getActiveProvider();
    const config = this.getProviderConfig();

    if (this.activeProvider === "gemini" && !config.authToken && !config.apiKey) {
      throw new Error("Please sign in with Google to use Gemini.");
    }

    if (!config.apiKey && !config.authToken && this.activeProvider !== "custom") {
      throw new Error(
        `API key not configured for ${this.activeProvider}. Please go to Settings.`
      );
    }

    return provider.sendMessage(messages, systemPrompt, config);
  }

  async testConnection(providerName) {
    const provider = this.providers[providerName];
    const config = this.settings[providerName] || {};

    if (providerName === "gemini" && this.googleAuthToken) {
      config.authToken = this.googleAuthToken;
    }

    if (!config.apiKey && !config.authToken && providerName !== "custom") {
      throw new Error("Not authenticated");
    }

    return provider.testConnection(config);
  }
}

// --- Google (Gemini) Provider --- (Primary, OAuth-based)
class GeminiProvider {
  _buildHeaders(config) {
    if (config.authToken) {
      return {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.authToken}`,
      };
    }
    return { "Content-Type": "application/json" };
  }

  _buildUrl(config) {
    const model = config.model || "gemini-2.0-flash";
    if (config.authToken) {
      return `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
    }
    return `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${config.apiKey}`;
  }

  async sendMessage(messages, systemPrompt, config) {
    const url = this._buildUrl(config);
    const headers = this._buildHeaders(config);

    const contents = messages.map((m) => ({
      role: m.role === "assistant" ? "model" : "user",
      parts: [{ text: m.content }],
    }));

    const body = { contents };

    if (systemPrompt) {
      body.systemInstruction = { parts: [{ text: systemPrompt }] };
    }

    const response = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(
        err.error?.message || `Gemini API error: ${response.status}`
      );
    }

    const data = await response.json();
    return data.candidates[0].content.parts[0].text;
  }

  async testConnection(config) {
    const url = this._buildUrl(config);
    const headers = this._buildHeaders(config);

    const response = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: "Hi" }] }],
      }),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return true;
  }
}

// --- OpenAI (ChatGPT) Provider ---
class OpenAIProvider {
  async sendMessage(messages, systemPrompt, config) {
    const apiMessages = [];
    if (systemPrompt) {
      apiMessages.push({ role: "system", content: systemPrompt });
    }
    apiMessages.push(...messages);

    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({
        model: config.model || "gpt-4o",
        messages: apiMessages,
        max_tokens: 4096,
      }),
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(
        err.error?.message || `OpenAI API error: ${response.status}`
      );
    }

    const data = await response.json();
    return data.choices[0].message.content;
  }

  async testConnection(config) {
    const response = await fetch("https://api.openai.com/v1/models", {
      headers: { Authorization: `Bearer ${config.apiKey}` },
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return true;
  }
}

// --- Anthropic (Claude) Provider ---
class ClaudeProvider {
  async sendMessage(messages, systemPrompt, config) {
    const apiMessages = messages.map((m) => ({
      role: m.role === "assistant" ? "assistant" : "user",
      content: m.content,
    }));

    const body = {
      model: config.model || "claude-sonnet-4-6",
      max_tokens: 4096,
      messages: apiMessages,
    };

    if (systemPrompt) {
      body.system = systemPrompt;
    }

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": config.apiKey,
        "anthropic-version": "2023-06-01",
        "anthropic-dangerous-direct-browser-access": "true",
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(
        err.error?.message || `Claude API error: ${response.status}`
      );
    }

    const data = await response.json();
    return data.content[0].text;
  }

  async testConnection(config) {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": config.apiKey,
        "anthropic-version": "2023-06-01",
        "anthropic-dangerous-direct-browser-access": "true",
      },
      body: JSON.stringify({
        model: config.model || "claude-sonnet-4-6",
        max_tokens: 10,
        messages: [{ role: "user", content: "Hi" }],
      }),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return true;
  }
}

// --- DeepSeek Provider ---
class DeepSeekProvider {
  async sendMessage(messages, systemPrompt, config) {
    const apiMessages = [];
    if (systemPrompt) {
      apiMessages.push({ role: "system", content: systemPrompt });
    }
    apiMessages.push(...messages);

    const response = await fetch("https://api.deepseek.com/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({
        model: config.model || "deepseek-chat",
        messages: apiMessages,
        max_tokens: 4096,
      }),
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(
        err.error?.message || `DeepSeek API error: ${response.status}`
      );
    }

    const data = await response.json();
    return data.choices[0].message.content;
  }

  async testConnection(config) {
    const response = await fetch("https://api.deepseek.com/models", {
      headers: { Authorization: `Bearer ${config.apiKey}` },
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return true;
  }
}

// --- Custom OpenAI-compatible Provider ---
class CustomProvider {
  async sendMessage(messages, systemPrompt, config) {
    if (!config.baseUrl) {
      throw new Error("Custom provider base URL not configured.");
    }

    const apiMessages = [];
    if (systemPrompt) {
      apiMessages.push({ role: "system", content: systemPrompt });
    }
    apiMessages.push(...messages);

    const url = `${config.baseUrl.replace(/\/+$/, "")}/chat/completions`;

    const headers = { "Content-Type": "application/json" };
    if (config.apiKey) {
      headers["Authorization"] = `Bearer ${config.apiKey}`;
    }

    const response = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify({
        model: config.model || "default",
        messages: apiMessages,
        max_tokens: 4096,
      }),
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(
        err.error?.message || `Custom API error: ${response.status}`
      );
    }

    const data = await response.json();
    return data.choices[0].message.content;
  }

  async testConnection(config) {
    if (!config.baseUrl) throw new Error("Base URL not set");
    const url = `${config.baseUrl.replace(/\/+$/, "")}/models`;
    const headers = {};
    if (config.apiKey) {
      headers["Authorization"] = `Bearer ${config.apiKey}`;
    }
    const response = await fetch(url, { headers });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return true;
  }
}
