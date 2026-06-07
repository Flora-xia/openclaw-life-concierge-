const DEFAULT_BASE_URL = "https://api.deepseek.com";
const DEFAULT_MODEL = "deepseek-chat";

function getLLMConfig(options = {}) {
  return {
    provider: "deepseek",
    apiKey: options.apiKey || process.env.DEEPSEEK_API_KEY || "",
    baseUrl: options.baseUrl || process.env.DEEPSEEK_BASE_URL || DEFAULT_BASE_URL,
    model: options.model || process.env.DEEPSEEK_MODEL || DEFAULT_MODEL,
    temperature: options.temperature ?? Number(process.env.DEEPSEEK_TEMPERATURE || 0.3),
    maxTokens: options.maxTokens ?? Number(process.env.DEEPSEEK_MAX_TOKENS || 1200),
  };
}

function normalizePrompt(prompt) {
  if (prompt == null) {
    return "";
  }

  if (typeof prompt === "string") {
    return prompt;
  }

  try {
    return JSON.stringify(prompt, null, 2);
  } catch (_) {
    return String(prompt);
  }
}

function normalizeBaseUrl(baseUrl) {
  return String(baseUrl || DEFAULT_BASE_URL).replace(/\/+$/, "");
}

function getChatCompletionsUrl(baseUrl) {
  const normalized = normalizeBaseUrl(baseUrl);

  if (normalized.endsWith("/chat/completions")) {
    return normalized;
  }

  return `${normalized}/chat/completions`;
}

function buildPayload(prompt, config, stream) {
  return {
    model: config.model,
    messages: [
      {
        role: "user",
        content: normalizePrompt(prompt),
      },
    ],
    temperature: config.temperature,
    max_tokens: config.maxTokens,
    stream: Boolean(stream),
  };
}

function baseResult(config, extra) {
  return {
    provider: "deepseek",
    model: config.model,
    ...extra,
  };
}

function failure(config, error, rawText = "") {
  return baseResult(config, {
    success: false,
    error,
    raw_text: rawText,
  });
}

function extractMessageContent(data) {
  const choice = data && Array.isArray(data.choices) ? data.choices[0] : null;
  const message = choice && choice.message ? choice.message : null;
  return message && typeof message.content === "string" ? message.content : "";
}

async function readResponseText(response) {
  try {
    return await response.text();
  } catch (_) {
    return "";
  }
}

async function callDeepSeek(prompt, options = {}) {
  const config = getLLMConfig(options);

  if (!config.apiKey) {
    return failure(config, "缺少 DEEPSEEK_API_KEY。");
  }

  if (typeof fetch !== "function") {
    return failure(config, "当前 Node.js 环境不支持 fetch，请使用 Node 18+。");
  }

  if (options.stream) {
    return callDeepSeekStream(prompt, options.onToken, options);
  }

  try {
    const response = await fetch(getChatCompletionsUrl(config.baseUrl), {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(buildPayload(prompt, config, false)),
    });

    const rawResponseText = await readResponseText(response);

    if (!response.ok) {
      return failure(config, `DeepSeek API 请求失败：HTTP ${response.status}`, rawResponseText);
    }

    let data;
    try {
      data = JSON.parse(rawResponseText);
    } catch (_) {
      return failure(config, "DeepSeek API 返回了非 JSON 响应。", rawResponseText);
    }

    const rawText = extractMessageContent(data);

    return baseResult(config, {
      success: true,
      raw_text: rawText,
      response: data,
    });
  } catch (error) {
    return failure(config, error.message || String(error));
  }
}

function defaultParsed(rawText) {
  return {
    response_text: rawText || "",
    intent: "",
    tool_request: {
      skill: "none",
      intent: "none",
      params: {},
    },
    memory_update_suggestion: {
      section: "none",
      patch: {},
      reason: "",
    },
    raw_text: rawText || "",
  };
}

function stripMarkdownJsonBlock(text) {
  const trimmed = String(text || "").trim();
  const match = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  return match ? match[1].trim() : trimmed;
}

function parseJsonText(text) {
  try {
    return JSON.parse(text);
  } catch (_) {
    return null;
  }
}

function parseLLMOutput(rawText) {
  const fallback = defaultParsed(rawText);
  const candidate = stripMarkdownJsonBlock(rawText);
  const parsedJson = parseJsonText(candidate);

  if (!parsedJson || typeof parsedJson !== "object" || Array.isArray(parsedJson)) {
    return fallback;
  }

  const toolRequest = parsedJson.tool_request && typeof parsedJson.tool_request === "object"
    ? parsedJson.tool_request
    : {};
  const memorySuggestion = parsedJson.memory_update_suggestion &&
    typeof parsedJson.memory_update_suggestion === "object"
    ? parsedJson.memory_update_suggestion
    : {};

  return {
    response_text: typeof parsedJson.response_text === "string"
      ? parsedJson.response_text
      : fallback.response_text,
    intent: typeof parsedJson.intent === "string" ? parsedJson.intent : "",
    tool_request: {
      skill: typeof toolRequest.skill === "string" ? toolRequest.skill : "none",
      intent: typeof toolRequest.intent === "string" ? toolRequest.intent : "none",
      params: toolRequest.params && typeof toolRequest.params === "object" && !Array.isArray(toolRequest.params)
        ? toolRequest.params
        : {},
    },
    memory_update_suggestion: {
      section: typeof memorySuggestion.section === "string" ? memorySuggestion.section : "none",
      patch: memorySuggestion.patch && typeof memorySuggestion.patch === "object" && !Array.isArray(memorySuggestion.patch)
        ? memorySuggestion.patch
        : {},
      reason: typeof memorySuggestion.reason === "string" ? memorySuggestion.reason : "",
    },
    raw_text: rawText || "",
  };
}

async function generateLLMResponse(prompt, options = {}) {
  const config = getLLMConfig(options);
  const normalizedPrompt = normalizePrompt(prompt);
  const result = await callDeepSeek(normalizedPrompt, options);

  if (!result.success) {
    return baseResult(config, {
      success: false,
      error: result.error,
      parsed: parseLLMOutput(result.raw_text || ""),
      raw_text: result.raw_text || "",
    });
  }

  const parsed = parseLLMOutput(result.raw_text);

  return baseResult(config, {
    success: true,
    parsed,
    raw_text: result.raw_text,
  });
}

function parseSseLine(line) {
  const trimmed = String(line || "").trim();
  if (!trimmed.startsWith("data:")) {
    return null;
  }

  const data = trimmed.slice(5).trim();
  if (!data || data === "[DONE]") {
    return data;
  }

  return parseJsonText(data);
}

function extractDeltaContent(event) {
  const choice = event && Array.isArray(event.choices) ? event.choices[0] : null;
  const delta = choice && choice.delta ? choice.delta : null;
  return delta && typeof delta.content === "string" ? delta.content : "";
}

async function callDeepSeekStream(prompt, onToken, options = {}) {
  const config = getLLMConfig(options);

  if (!config.apiKey) {
    return failure(config, "缺少 DEEPSEEK_API_KEY。");
  }

  if (typeof fetch !== "function") {
    return failure(config, "当前 Node.js 环境不支持 fetch，请使用 Node 18+。");
  }

  try {
    const response = await fetch(getChatCompletionsUrl(config.baseUrl), {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(buildPayload(prompt, config, true)),
    });

    if (!response.ok) {
      const rawError = await readResponseText(response);
      return failure(config, `DeepSeek API 流式请求失败：HTTP ${response.status}`, rawError);
    }

    if (!response.body || typeof response.body.getReader !== "function") {
      return failure(config, "当前响应不支持流式读取。");
    }

    const decoder = new TextDecoder();
    const reader = response.body.getReader();
    let buffer = "";
    let rawText = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() || "";

      for (const line of lines) {
        const event = parseSseLine(line);
        if (!event || event === "[DONE]") {
          continue;
        }

        const token = extractDeltaContent(event);
        if (!token) {
          continue;
        }

        rawText += token;
        if (typeof onToken === "function") {
          try {
            onToken(token);
          } catch (_) {
            // Token callbacks are user-provided; keep streaming resilient.
          }
        }
      }
    }

    return baseResult(config, {
      success: true,
      raw_text: rawText,
    });
  } catch (error) {
    return failure(config, error.message || String(error));
  }
}

async function generateLLMResponseStream(prompt, onToken, options = {}) {
  const config = getLLMConfig(options);
  const normalizedPrompt = normalizePrompt(prompt);
  const result = await callDeepSeekStream(normalizedPrompt, onToken, options);

  if (!result.success) {
    return baseResult(config, {
      success: false,
      error: result.error,
      parsed: parseLLMOutput(result.raw_text || ""),
      raw_text: result.raw_text || "",
    });
  }

  const parsed = parseLLMOutput(result.raw_text);

  return baseResult(config, {
    success: true,
    parsed,
    raw_text: result.raw_text,
  });
}

// TODO: 多模型支持。
// TODO: 会话/多轮上下文管理。
// TODO: 重试/降级。
// TODO: prompt injection 检测。
// TODO: 流式增强，如 token 累积 buffer 策略和更细粒度事件输出。

module.exports = {
  getLLMConfig,
  normalizePrompt,
  callDeepSeek,
  parseLLMOutput,
  generateLLMResponse,
  generateLLMResponseStream,
};
