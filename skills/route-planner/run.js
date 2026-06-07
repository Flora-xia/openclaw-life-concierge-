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
    ...data,
  };
}

function failure(error, details) {
  return {
    success: false,
    error,
    ...(details ? { details } : {}),
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
    const parsed = JSON.parse(trimmed);
    return parseInput(parsed);
  } catch (_) {
    // Continue with simple key-value parsing for raw_text inputs.
  }

  const keyMap = {
    起点: "origin",
    终点: "destination",
    目的地: "destination",
    时间: "time",
    车型: "vehicle_type",
    纬度: "lat",
    经度: "lng",
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
  if (params.order_id) {
    return "taxi_status";
  }
  if (params.lat != null && params.lng != null) {
    return "nearby";
  }
  if (params.origin != null && params.destination != null && params.vehicle_type != null) {
    return "taxi";
  }
  if (params.origin != null && params.destination != null) {
    return "route";
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
    origin: pick(params, ["origin", "from", "start", "起点"]),
    destination: pick(params, ["destination", "to", "end", "终点", "目的地"]),
    time: pick(params, ["time", "时间"]),
    lat: pick(params, ["lat", "latitude", "纬度"]),
    lng: pick(params, ["lng", "lon", "longitude", "经度"]),
    vehicle_type: pick(params, ["vehicle_type", "vehicle", "car_type", "车型"]),
    order_id: pick(params, ["order_id", "订单号"]),
  };
}

function requireString(params, key) {
  const value = params[key];
  if (value == null || String(value).trim() === "") {
    return null;
  }
  return String(value).trim();
}

function requireNumber(params, key) {
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
      status: 0,
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
      status: response.status,
      data,
    };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      data: { error: error.message || "无法连接 Mock Backend。" },
    };
  }
}

async function handleRoute(params) {
  const origin = requireString(params, "origin");
  const destination = requireString(params, "destination");

  if (!origin || !destination) {
    return failure("route intent 需要 origin 和 destination 参数。");
  }

  const url = buildUrl("/route", {
    origin,
    destination,
    time: params.time,
  });
  const response = await requestJson(url);

  if (!response.ok) {
    return failure("Mock Backend /route 请求失败。", response.data);
  }

  return success("route", response.data);
}

async function handleNearby(params) {
  const lat = requireNumber(params, "lat");
  const lng = requireNumber(params, "lng");

  if (lat == null || lng == null) {
    return failure("nearby intent 需要有效的 lat 和 lng 参数。");
  }

  const url = buildUrl("/nearby", { lat, lng });
  const response = await requestJson(url);

  if (!response.ok) {
    return failure("Mock Backend /nearby 请求失败。", response.data);
  }

  return success("nearby", response.data);
}

async function handleTaxi(params) {
  const origin = requireString(params, "origin");
  const destination = requireString(params, "destination");
  const vehicleType = requireString(params, "vehicle_type") || "comfort";

  if (!origin || !destination) {
    return failure("taxi intent 需要 origin 和 destination 参数。");
  }

  const url = buildUrl("/order_taxi");
  const response = await requestJson(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      origin,
      destination,
      vehicle_type: vehicleType,
      起点: origin,
      终点: destination,
      车型: vehicleType,
    }),
  });

  if (!response.ok) {
    return failure("Mock Backend /order_taxi 请求失败。", response.data);
  }

  if (response.data && response.data.status === "failed") {
    return {
      success: false,
      error: "taxi_order_failed",
      ...response.data,
    };
  }

  return success("taxi", response.data);
}

function handleTaxiStatus(params) {
  const orderId = requireString(params, "order_id");

  if (!orderId) {
    return failure("taxi_status intent 需要 order_id 参数。");
  }

  return success("taxi_status", {
    order_id: orderId,
    status: "not_implemented",
    message: "当前 Mock Backend 尚未提供独立订单状态查询接口，后续 Phase 6 可补充 /taxi_status。",
  });
}

async function run(event = {}) {
  try {
    const resolved = resolveEvent(event);

    if (resolved.error) {
      return failure(resolved.error);
    }

    const { intent, params } = resolved;

    if (!intent) {
      return failure("无法解析 intent，请传入 route、nearby、taxi 或 taxi_status。");
    }

    if (intent === "route") {
      return handleRoute(params);
    }

    if (intent === "nearby") {
      return handleNearby(params);
    }

    if (intent === "taxi") {
      return handleTaxi(params);
    }

    if (intent === "taxi_status") {
      return handleTaxiStatus(params);
    }

    return failure(`不支持的 intent：${intent}。支持 route、nearby、taxi、taxi_status。`);
  } catch (error) {
    return failure("route-planner 执行失败。", error.message || String(error));
  }
}

module.exports = run;
module.exports.run = run;
module.exports.handler = run;
