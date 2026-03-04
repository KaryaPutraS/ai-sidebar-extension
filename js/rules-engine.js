/**
 * Agent Rules Engine
 * Manages system prompts and behavioral rules that enhance AI responses.
 * The extension acts as an agent layer that controls how AI models respond.
 */

class RulesEngine {
  constructor() {
    this.builtinRules = [
      {
        id: "structured",
        name: "Structured Output",
        description:
          "Force the AI to use headings, bullet points, and organized formatting",
        enabled: true,
        prompt:
          "Always structure your responses clearly. Use headings (##), bullet points, and numbered lists where appropriate. Break down complex topics into organized sections.",
      },
      {
        id: "concise",
        name: "Concise Responses",
        description: "Keep responses short and to the point",
        enabled: false,
        prompt:
          "Be concise and direct. Avoid unnecessary filler words, repetition, or over-explanation. Get to the point quickly while remaining helpful.",
      },
      {
        id: "step_by_step",
        name: "Step-by-Step Thinking",
        description: "AI explains its reasoning process step by step",
        enabled: true,
        prompt:
          "When solving problems or answering complex questions, think step by step. Show your reasoning process clearly before giving the final answer.",
      },
      {
        id: "examples",
        name: "Include Examples",
        description: "Always provide practical examples in responses",
        enabled: false,
        prompt:
          "Whenever possible, include practical examples, code snippets, or analogies to illustrate your points. Examples should be relevant and easy to understand.",
      },
      {
        id: "critical",
        name: "Critical Analysis",
        description:
          "AI provides pros/cons and considers multiple perspectives",
        enabled: false,
        prompt:
          "When analyzing topics, always consider multiple perspectives. Present pros and cons, potential risks, and alternative approaches. Be objective and balanced.",
      },
      {
        id: "no_hallucinate",
        name: "Anti-Hallucination",
        description: "AI explicitly states when unsure or lacking knowledge",
        enabled: true,
        prompt:
          'If you are not sure about something, explicitly say so. Never make up facts, URLs, citations, or data. If you don\'t know, say "I\'m not sure" and suggest how the user might find the answer.',
      },
      {
        id: "actionable",
        name: "Actionable Advice",
        description: "Responses include clear next steps and action items",
        enabled: false,
        prompt:
          "End your responses with clear, actionable next steps when applicable. Tell the user exactly what to do, not just what to consider.",
      },
    ];

    this.agentModes = {
      general: {
        name: "General Assistant",
        systemPrompt:
          "You are a helpful, knowledgeable assistant. Provide accurate, well-organized answers. Adapt your communication style to the user's needs.",
      },
      coder: {
        name: "Code Assistant",
        systemPrompt:
          "You are an expert software developer. When providing code: always include the programming language, write clean and well-commented code, explain the logic, mention edge cases, and suggest best practices. If reviewing code, point out bugs, security issues, and performance improvements.",
      },
      writer: {
        name: "Writing Assistant",
        systemPrompt:
          "You are a professional writing assistant. Help with grammar, style, tone, and structure. Provide suggestions to improve clarity and readability. Match the user's desired tone (formal, casual, academic, etc.). When editing, explain why changes improve the text.",
      },
      analyst: {
        name: "Data Analyst",
        systemPrompt:
          "You are a data analysis expert. Help interpret data, suggest visualizations, write queries, and explain statistical concepts. Be precise with numbers. When analyzing data, always consider sample size, biases, and statistical significance.",
      },
      translator: {
        name: "Translator",
        systemPrompt:
          "You are a professional translator. Translate text accurately while preserving meaning, tone, and cultural nuances. If a phrase has no direct translation, explain the closest equivalent and its nuances. Always specify the source and target languages.",
      },
      custom: {
        name: "Custom Rules",
        systemPrompt: "",
      },
    };

    this.customRules = [];
    this.globalSystemPrompt = "";
    this.activeMode = "general";
  }

  async loadRules() {
    return new Promise((resolve) => {
      chrome.storage.local.get("rulesConfig", (data) => {
        if (data.rulesConfig) {
          const config = data.rulesConfig;

          // Restore builtin rule states
          if (config.builtinStates) {
            for (const rule of this.builtinRules) {
              if (config.builtinStates[rule.id] !== undefined) {
                rule.enabled = config.builtinStates[rule.id];
              }
            }
          }

          this.customRules = config.customRules || [];
          this.globalSystemPrompt = config.globalSystemPrompt || "";
        }
        resolve();
      });
    });
  }

  async saveRules() {
    const builtinStates = {};
    for (const rule of this.builtinRules) {
      builtinStates[rule.id] = rule.enabled;
    }

    const config = {
      builtinStates,
      customRules: this.customRules,
      globalSystemPrompt: this.globalSystemPrompt,
    };

    return new Promise((resolve) => {
      chrome.storage.local.set({ rulesConfig: config }, resolve);
    });
  }

  setMode(mode) {
    this.activeMode = mode;
  }

  addCustomRule(name, description, prompt) {
    const rule = {
      id: `custom_${Date.now()}`,
      name,
      description,
      prompt,
      enabled: true,
    };
    this.customRules.push(rule);
    return rule;
  }

  removeCustomRule(id) {
    this.customRules = this.customRules.filter((r) => r.id !== id);
  }

  /**
   * Build the complete system prompt by combining:
   * 1. Agent mode base prompt
   * 2. Enabled builtin rules
   * 3. Enabled custom rules
   * 4. Global system prompt override
   * 5. Page context (if enabled)
   */
  buildSystemPrompt(pageContext = null) {
    const parts = [];

    // 1. Agent mode base prompt
    const mode = this.agentModes[this.activeMode];
    if (mode && mode.systemPrompt) {
      parts.push(mode.systemPrompt);
    }

    // 2. Enabled builtin rules
    const enabledBuiltin = this.builtinRules.filter((r) => r.enabled);
    if (enabledBuiltin.length > 0) {
      parts.push(
        "## Response Rules\n" +
          enabledBuiltin.map((r) => `- ${r.prompt}`).join("\n")
      );
    }

    // 3. Enabled custom rules
    const enabledCustom = this.customRules.filter((r) => r.enabled);
    if (enabledCustom.length > 0) {
      parts.push(
        "## Custom Rules\n" +
          enabledCustom.map((r) => `- ${r.prompt}`).join("\n")
      );
    }

    // 4. Global system prompt
    if (this.globalSystemPrompt.trim()) {
      parts.push(
        "## Additional Instructions\n" + this.globalSystemPrompt.trim()
      );
    }

    // 5. Page context
    if (pageContext) {
      let contextStr = "## Current Page Context\n";
      contextStr += `- Title: ${pageContext.title}\n`;
      contextStr += `- URL: ${pageContext.url}\n`;
      if (pageContext.selection) {
        contextStr += `- Selected Text: "${pageContext.selection}"\n`;
      }
      if (pageContext.metaDescription) {
        contextStr += `- Description: ${pageContext.metaDescription}\n`;
      }
      if (pageContext.bodyText) {
        contextStr += `- Page Content (excerpt):\n${pageContext.bodyText.substring(0, 3000)}\n`;
      }
      parts.push(contextStr);
    }

    return parts.join("\n\n");
  }
}
