// SKILL.md 为 OpenClaw Skill 入口，承载官方 Skill 元数据。
// run.js 为本项目赛题实现代码。
// run.js 不属于 OpenClaw 官方 Skill 元数据规范。

const DEFAULT_BACKEND_URL = "http://localhost:8000";

function getBackendUrl() {
  return (process.env.MOCK_BACKEND_URL || DEFAULT_BACKEND_URL).replace(/\/+$/, "");
}

function success(intent, data) {
  return {
    success: true,
    intent,
    data,
  };
}

function failure(intent, error) {
  return {
    success: false,
    intent: intent || "unknown",
    error,
  };
}

function parseInput(value) {
  if (value == null) {
    return {};
  }

  if (typeof value === "string") {
    return parseTextInput(value);
  }

  if (typeof value === "object" && !Array.isArray(value)) {
    return value;
  }

  return { __parse_error: "输入必须是对象、JSON 字符串或可解析的参数文本。" };
}

function parseTextInput(text) {
  const trimmed = text.trim();

  if (!trimmed) {
    return {};
  }

  try {
    return parseInput(JSON.parse(trimmed));
  } catch (_) {
    // raw_text 只做轻量 key=value 解析，不读取真实用户隐私。
  }

  const keyMap = {
    分类: "category",
    预算: "budget",
    标签: "tags",
    意图: "intent",
  };
  const result = {};
  const pattern = /(?:^|[\s,，&])([A-Za-z_][\w]*|[\u4e00-\u9fa5]+)\s*[:=：]\s*([^,，&\s]+)/g;

  for (const match of trimmed.matchAll(pattern)) {
    const key = keyMap[match[1]] || match[1];
    result[key] = match[2];
  }

  if (Object.keys(result).length > 0) {
    return result;
  }

  return {
    raw_text: trimmed,
    __parse_error: "无法从 raw_text 解析参数，请传入 JSON 或明确的 key=value 参数。",
  };
}

function removeMetaFields(params) {
  const cleaned = { ...params };
  delete cleaned.intent;
  delete cleaned.action;
  delete cleaned.type;
  delete cleaned.params;
  delete cleaned.input;
  delete cleaned.raw_text;
  delete cleaned.__parse_error;
  return cleaned;
}

function resolveEvent(event) {
  const payload = parseInput(event);
  if (payload.__parse_error) {
    return { error: payload.__parse_error };
  }

  let intent = payload.intent || payload.action || payload.type;
  let params;

  if (payload.params != null) {
    params = parseInput(payload.params);
  } else if (payload.input != null) {
    const inputPayload = parseInput(payload.input);
    if (inputPayload.__parse_error) {
      return { error: inputPayload.__parse_error };
    }
    intent = intent || inputPayload.intent || inputPayload.action || inputPayload.type;
    params = inputPayload.params != null ? parseInput(inputPayload.params) : removeMetaFields(inputPayload);
  } else if (payload.raw_text != null) {
    const rawPayload = parseInput(payload.raw_text);
    if (rawPayload.__parse_error) {
      return { error: rawPayload.__parse_error };
    }
    intent = intent || rawPayload.intent || rawPayload.action || rawPayload.type;
    params = rawPayload.params != null ? parseInput(rawPayload.params) : removeMetaFields(rawPayload);
  } else {
    params = removeMetaFields(payload);
  }

  if (params && params.__parse_error) {
    return { error: params.__parse_error };
  }

  const normalizedParams = normalizeParams(params || {});

  return {
    intent: normalizeIntent(intent || inferIntent(normalizedParams)),
    params: normalizedParams,
  };
}

function normalizeIntent(intent) {
  if (!intent) {
    return null;
  }
  return String(intent).trim().toLowerCase().replace(/-/g, "_");
}

function inferIntent(params) {
  if (!params || typeof params !== "object") {
    return null;
  }
  if (params.intent || params.action || params.type) {
    return params.intent || params.action || params.type;
  }
  if (params.weather === true) {
    return "weather";
  }
  if (params.budget != null || params.tags != null) {
    return "recommend";
  }
  if (params.category != null) {
    return "destinations";
  }
  return null;
}

function pick(params, keys) {
  for (const key of keys) {
    if (params[key] != null && params[key] !== "") {
      return params[key];
    }
  }
  return undefined;
}

function normalizeParams(params) {
  return {
    ...params,
    category: pick(params, ["category", "分类"]),
    budget: pick(params, ["budget", "预算"]),
    tags: normalizeTags(pick(params, ["tags", "标签"])),
  };
}

function normalizeTags(tags) {
  if (Array.isArray(tags)) {
    return tags
      .map((tag) => String(tag).trim())
      .filter(Boolean)
      .join(",");
  }

  if (tags == null || tags === "") {
    return undefined;
  }

  return String(tags).trim();
}

function buildUrl(path, query) {
  const url = new URL(path, getBackendUrl());
  for (const [key, value] of Object.entries(query || {})) {
    if (value != null && value !== "") {
      url.searchParams.set(key, String(value));
    }
  }
  return url;
}

async function requestJson(url) {
  const activeFetch = typeof fetch === "function" ? fetch : globalThis.fetch;
  if (typeof activeFetch !== "function") {
    return {
      ok: false,
      data: { error: "当前 Node 环境不支持 fetch，请使用 Node 18+ 或提供全局 fetch。" },
    };
  }

  try {
    const response = await activeFetch(url);
    let data;

    try {
      data = await response.json();
    } catch (_) {
      data = { error: "Mock Backend 返回了非 JSON 响应。" };
    }

    return {
      ok: response.ok,
      data,
    };
  } catch (error) {
    return {
      ok: false,
      data: { error: error.message || "无法连接 Mock Backend。" },
    };
  }
}

function backendError(path, response) {
  if (response.data && response.data.error) {
    return response.data.error;
  }
  return `Mock Backend ${path} 请求失败。`;
}

async function handleDestinations(intent, params) {
  const url = buildUrl("/destinations", {
    category: params.category,
  });
  const response = await requestJson(url);

  if (!response.ok) {
    return failure(intent, backendError("/destinations", response));
  }

  return success(intent, Array.isArray(response.data) ? response.data : []);
}

async function handleRecommend(intent, params) {
  const url = buildUrl("/recommend", {
    category: params.category,
    budget: params.budget,
    tags: params.tags,
  });
  const response = await requestJson(url);

  if (!response.ok) {
    return failure(intent, backendError("/recommend", response));
  }

  return success(intent, Array.isArray(response.data) ? response.data : []);
}

async function handleWeather(intent) {
  const url = buildUrl("/weather");
  const response = await requestJson(url);

  if (!response.ok) {
    return failure(intent, backendError("/weather", response));
  }

  return success(intent, response.data || {});
}

async function run(event = {}) {
  try {
    const resolved = resolveEvent(event);
    const intent = normalizeIntent(resolved.intent);

    if (resolved.error) {
      return failure(intent, resolved.error);
    }

    if (!intent) {
      return failure("unknown", "无法解析 intent，请传入 destinations、recommend 或 weather。");
    }

    if (intent === "destinations") {
      return handleDestinations(intent, resolved.params);
    }

    if (intent === "recommend") {
      return handleRecommend(intent, resolved.params);
    }

    if (intent === "weather") {
      return handleWeather(intent);
    }

    return failure(intent, `不支持的 intent：${intent}。支持 destinations、recommend、weather。`);
  } catch (error) {
    return failure("unknown", error.message || "local-discovery 执行失败。");
  }
}

module.exports = run;
module.exports.handler = run;
