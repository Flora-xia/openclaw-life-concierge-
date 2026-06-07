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
    意图: "intent",
    餐厅: "restaurant_name",
    餐厅名称: "restaurant_name",
    当前时间: "current_time",
    交通耗时: "travel_minutes",
    出发缓冲: "departure_buffer_minutes",
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
  if (params.restaurant_name) {
    return "queue";
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
    restaurant_name: pick(params, ["restaurant_name", "restaurant", "name", "餐厅", "餐厅名称"]),
    current_time: pick(params, ["current_time", "time", "当前时间"]),
    travel_minutes: pick(params, ["travel_minutes", "travel_time", "交通耗时"]),
    departure_buffer_minutes: pick(params, ["departure_buffer_minutes", "buffer_minutes", "出发缓冲"]),
  };
}

function requireString(params, key) {
  const value = params[key];
  if (value == null || String(value).trim() === "") {
    return null;
  }
  return String(value).trim();
}

function optionalNumber(params, key) {
  if (params[key] == null || params[key] === "") {
    return null;
  }
  const value = Number(params[key]);
  return Number.isFinite(value) ? value : null;
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

async function requestJson(url, options) {
  const activeFetch = typeof fetch === "function" ? fetch : globalThis.fetch;
  if (typeof activeFetch !== "function") {
    return {
      ok: false,
      data: { error: "当前 Node 环境不支持 fetch，请使用 Node 18+ 或提供全局 fetch。" },
    };
  }

  try {
    const response = await activeFetch(url, options);
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

function getQueueStatus(waitMinutes) {
  if (waitMinutes <= 15) {
    return "short";
  }
  if (waitMinutes <= 45) {
    return "medium";
  }
  return "long";
}

function parseBaseTime(value) {
  if (!value) {
    return new Date();
  }

  const text = String(value).trim();
  const timeOnly = text.match(/^(\d{1,2}):(\d{2})$/);

  if (timeOnly) {
    const date = new Date();
    date.setHours(Number(timeOnly[1]), Number(timeOnly[2]), 0, 0);
    return date;
  }

  const parsed = new Date(text);
  if (Number.isNaN(parsed.getTime())) {
    return new Date();
  }
  return parsed;
}

function addMinutes(baseTime, minutes) {
  return new Date(baseTime.getTime() + minutes * 60 * 1000);
}

function formatTime(date) {
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  return `${hours}:${minutes}`;
}

function buildReminderBasis(queueStatus, hasTravelMinutes) {
  if (queueStatus === "short") {
    return {
      suggestion_key: "queue_turn_soon",
      needs_transport_check: true,
      hint: "排队较短，可作为即将轮到或准备到店提醒依据。",
    };
  }

  if (queueStatus === "medium") {
    return {
      suggestion_key: "queue_waiting_normal",
      needs_transport_check: !hasTravelMinutes,
      hint: "排队时间适中，可继续观察排队进度。",
    };
  }

  return {
    suggestion_key: "queue_wait_long",
    needs_transport_check: false,
    hint: "排队时间较长，可作为等待过久或备选判断依据。",
  };
}

async function fetchQueue(restaurantName) {
  const url = buildUrl("/queue", { restaurant_name: restaurantName });
  const response = await requestJson(url);

  if (!response.ok) {
    return {
      error: response.data && response.data.error
        ? response.data.error
        : "Mock Backend /queue 请求失败。",
    };
  }

  const queuePeople = Number(response.data.queue_people);
  const waitMinutes = Number(response.data.wait_minutes);

  if (!Number.isFinite(queuePeople) || !Number.isFinite(waitMinutes)) {
    return { error: "Mock Backend /queue 返回缺少 queue_people 或 wait_minutes。" };
  }

  return {
    restaurant_name: restaurantName,
    queue_people: queuePeople,
    wait_minutes: waitMinutes,
  };
}

async function buildQueueData(params) {
  const restaurantName = requireString(params, "restaurant_name");

  if (!restaurantName) {
    return { error: "需要 restaurant_name 参数。" };
  }

  return fetchQueue(restaurantName);
}

async function handleQueue(intent, params) {
  const queueData = await buildQueueData(params);
  if (queueData.error) {
    return failure(intent, queueData.error);
  }

  return success(intent, queueData);
}

async function handleQueueStatus(intent, params) {
  const queueData = await buildQueueData(params);
  if (queueData.error) {
    return failure(intent, queueData.error);
  }

  return success(intent, {
    ...queueData,
    queue_status: getQueueStatus(queueData.wait_minutes),
  });
}

async function handleDepartureAdvice(intent, params) {
  const queueData = await buildQueueData(params);
  if (queueData.error) {
    return failure(intent, queueData.error);
  }

  const travelMinutes = optionalNumber(params, "travel_minutes");
  const bufferMinutes = optionalNumber(params, "departure_buffer_minutes") ?? 5;
  const baseTime = parseBaseTime(params.current_time);
  const estimatedTurnTime = addMinutes(baseTime, queueData.wait_minutes);
  const assumedTravelMinutes = travelMinutes ?? 15;
  const departureTime = addMinutes(estimatedTurnTime, -assumedTravelMinutes - bufferMinutes);
  const queueStatus = getQueueStatus(queueData.wait_minutes);
  const reminderBasis = buildReminderBasis(queueStatus, travelMinutes != null);

  return success(intent, {
    ...queueData,
    queue_status: queueStatus,
    estimated_turn_time: formatTime(estimatedTurnTime),
    recommended_departure_time: formatTime(departureTime),
    needs_transport_check: travelMinutes == null || reminderBasis.needs_transport_check,
    suggestion_key: reminderBasis.suggestion_key,
    hint: reminderBasis.hint,
  });
}

async function handleReminderHint(intent, params) {
  const queueData = await buildQueueData(params);
  if (queueData.error) {
    return failure(intent, queueData.error);
  }

  const queueStatus = getQueueStatus(queueData.wait_minutes);
  const reminderBasis = buildReminderBasis(queueStatus, false);

  return success(intent, {
    ...queueData,
    queue_status: queueStatus,
    needs_transport_check: reminderBasis.needs_transport_check,
    suggestion_key: reminderBasis.suggestion_key,
    hint: reminderBasis.hint,
  });
}

async function run(event = {}) {
  try {
    const resolved = resolveEvent(event);
    const intent = normalizeIntent(resolved.intent);

    if (resolved.error) {
      return failure(intent, resolved.error);
    }

    if (!intent) {
      return failure("unknown", "无法解析 intent，请传入 queue、queue_status、departure_advice 或 reminder_hint。");
    }

    if (intent === "queue") {
      return handleQueue(intent, resolved.params);
    }

    if (intent === "queue_status") {
      return handleQueueStatus(intent, resolved.params);
    }

    if (intent === "departure_advice") {
      return handleDepartureAdvice(intent, resolved.params);
    }

    if (intent === "reminder_hint") {
      return handleReminderHint(intent, resolved.params);
    }

    return failure(intent, `不支持的 intent：${intent}。支持 queue、queue_status、departure_advice、reminder_hint。`);
  } catch (error) {
    return failure("unknown", error.message || "restaurant-queue 执行失败。");
  }
}

module.exports = run;
module.exports.handler = run;
