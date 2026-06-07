const {
  loadMemory,
  updateMemorySection,
  getConversationState,
  updateConversationState,
  appendGrowthEvent,
  detectPreferenceUpdate,
} = require("./memory_runtime");
const { buildPrompt } = require("./prompt_builder");
const { generateLLMResponse, generateLLMResponseStream } = require("./llm_runtime");
const { evaluateHeartbeatTriggers } = require("./heartbeat_runtime");

const localDiscovery = require("../skills/local-discovery/run.js");
const routePlanner = require("../skills/route-planner/run.js");
const restaurantQueue = require("../skills/restaurant-queue/run.js");

function ok(payload) {
  return { success: true, ...payload };
}

function fail(intent, error) {
  return {
    success: false,
    intent: intent || "unknown",
    error,
  };
}

function skillFailure(intent, skillName, result) {
  const error = result && result.error
    ? result.error
    : `${skillName} 调用失败。`;
  return fail(intent, error);
}

function defaultLLMResult() {
  return { used: false };
}

function defaultLLMSuggestions() {
  return {
    response_text: "",
    suggested_intent: "",
    suggested_tool_request: {},
    suggested_memory_update: {},
  };
}

const DEFAULT_ROUTE_ORIGIN = "\u5f53\u524d\u4f4d\u7f6e";
const DEFAULT_CONTEXT_MAX_AGE_MS = 30 * 60 * 1000;

function getObjectInput(input) {
  return input && typeof input === "object" && !Array.isArray(input) ? input : {};
}

function isPlainObject(value) {
  return value && typeof value === "object" && !Array.isArray(value);
}

function normalizeRuntimeEnvelope(input) {
  if (!isPlainObject(input)) {
    return input;
  }

  if (isPlainObject(input.input)) {
    const normalized = {
      ...input.input,
    };

    for (const key of ["session_id", "sessionId", "conversation_id", "conversationId"]) {
      if (normalized[key] == null && input[key] != null) {
        normalized[key] = input[key];
      }
    }

    return normalized;
  }

  if (typeof input.input === "string") {
    return {
      ...input,
      current_input: input.input,
    };
  }

  if (typeof input.message === "string" && input.current_input == null && input.text == null) {
    return {
      ...input,
      current_input: input.message,
    };
  }

  return input;
}

function getInputText(input) {
  if (typeof input === "string") {
    return input;
  }

  if (!isPlainObject(input)) {
    return "";
  }

  for (const key of ["text", "message", "current_input", "raw_text"]) {
    if (typeof input[key] === "string") {
      return input[key];
    }
  }

  if (typeof input.input === "string") {
    return input.input;
  }

  if (isPlainObject(input.input)) {
    return getInputText(input.input);
  }

  if (isPlainObject(input.params)) {
    return getInputText(input.params);
  }

  return "";
}

function resolveSessionId(input, options = {}) {
  const objectInput = getObjectInput(input);
  const nestedInput = getObjectInput(objectInput.input);
  const candidate = options.session_id ||
    options.sessionId ||
    options.conversation_id ||
    objectInput.session_id ||
    objectInput.sessionId ||
    objectInput.conversation_id ||
    nestedInput.session_id ||
    nestedInput.sessionId ||
    nestedInput.conversation_id;

  if (candidate != null && String(candidate).trim() !== "") {
    return String(candidate).trim();
  }

  return "default";
}

function summarizeConversationState(conversationState) {
  if (!conversationState || typeof conversationState !== "object") {
    return {};
  }

  const messages = Array.isArray(conversationState.messages)
    ? conversationState.messages.slice(-6)
    : [];

  return {
    session_id: conversationState.session_id || "default",
    last_intent: conversationState.last_intent || null,
    last_response: conversationState.last_response || "",
    recent_messages: messages.map((message) => ({
      role: message.role,
      content: message.content,
      intent: message.intent || null,
      timestamp: message.timestamp || null,
    })),
    last_skill_results: conversationState.last_skill_results || {},
    last_recommendation: conversationState.last_recommendation || null,
    last_recommended_restaurant: conversationState.last_recommended_restaurant || null,
    last_route_destination: conversationState.last_route_destination || null,
    last_queue_restaurant: conversationState.last_queue_restaurant || null,
  };
}

function buildConversationMessages(conversationState, sessionId, input, intent, skillResults, response) {
  const now = new Date().toISOString();
  const previousMessages = conversationState && Array.isArray(conversationState.messages)
    ? conversationState.messages
    : [];

  return [
    ...previousMessages,
    {
      timestamp: now,
      session_id: sessionId,
      role: "user",
      content: sanitizeConversationPayload(input == null ? "" : input),
      intent,
      skill_results: {},
    },
    {
      timestamp: now,
      session_id: sessionId,
      role: "assistant",
      content: sanitizeConversationPayload(response || ""),
      intent,
      skill_results: skillResults || {},
    },
  ];
}

function updateConversationAfterTurn(sessionId, conversationState, input, intent, skillResults, response) {
  return updateConversationState(sessionId, {
    messages: buildConversationMessages(
      conversationState,
      sessionId,
      input,
      intent,
      skillResults,
      response
    ),
    last_skill_results: skillResults || {},
    last_intent: intent,
    last_response: response || "",
    ...buildConversationContextPatch(intent, skillResults || {}),
  });
}

function redactSensitiveText(text) {
  return String(text || "")
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[redacted_email]")
    .replace(/\b1[3-9]\d{9}\b/g, "[redacted_phone]")
    .replace(/\b\d{15}(\d{2}[\dXx])?\b/g, "[redacted_id]");
}

function sanitizeConversationPayload(value) {
  if (value == null) {
    return value;
  }

  if (typeof value === "string") {
    return redactSensitiveText(value);
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((item) => sanitizeConversationPayload(item));
  }

  if (typeof value === "object") {
    const sanitized = {};
    for (const [key, child] of Object.entries(value)) {
      sanitized[key] = sanitizeConversationPayload(child);
    }
    return sanitized;
  }

  return String(value);
}

function textIncludesAny(text, values) {
  return values.some((value) => text.includes(value));
}

function getContextMaxAgeMs(options = {}) {
  const value = Number(options.context_max_age_ms ?? options.contextMaxAgeMs);
  if (Number.isFinite(value) && value >= 0) {
    return value;
  }
  return DEFAULT_CONTEXT_MAX_AGE_MS;
}

function isConversationContextFresh(conversationState, options = {}) {
  const maxAgeMs = getContextMaxAgeMs(options);
  if (maxAgeMs === 0) {
    return false;
  }

  const updatedAt = conversationState && conversationState.updated_at
    ? Date.parse(conversationState.updated_at)
    : NaN;

  if (!Number.isFinite(updatedAt)) {
    return true;
  }

  return Date.now() - updatedAt <= maxAgeMs;
}

function hasConversationHistory(conversationState) {
  return Boolean(
    conversationState &&
    (
      conversationState.last_intent ||
      (Array.isArray(conversationState.messages) && conversationState.messages.length > 0)
    )
  );
}

function getResultData(result) {
  return result && result.data ? result.data : result;
}

function getDiscoveryCandidates(result) {
  const data = getResultData(result);
  return Array.isArray(data) ? data : [];
}

function isRestaurantPlace(place) {
  if (!place || typeof place !== "object") {
    return false;
  }

  if (place.category === "\u9910\u5385") {
    return true;
  }

  return Array.isArray(place.tags) &&
    place.tags.some((tag) => String(tag).includes("\u9910\u5385"));
}

function summarizePlace(place) {
  if (!place || typeof place !== "object" || !place.name) {
    return null;
  }

  return {
    name: place.name,
    category: place.category || null,
    address: place.address || null,
  };
}

function getPlaceName(place) {
  if (typeof place === "string") {
    return place;
  }
  return place && typeof place === "object" && place.name ? place.name : null;
}

function getFirstPlaceSummary(result, predicate = null) {
  const candidates = getDiscoveryCandidates(result);
  const first = predicate
    ? candidates.find((place) => predicate(place))
    : candidates[0];

  return summarizePlace(first);
}

function getFirstRecommendedPlace(conversationState) {
  if (conversationState && conversationState.last_recommendation) {
    const name = getPlaceName(conversationState.last_recommendation);
    if (name) {
      return name;
    }
  }

  const localDiscoveryResult = conversationState &&
    conversationState.last_skill_results &&
    conversationState.last_skill_results.local_discovery;
  const first = getFirstPlaceSummary(localDiscoveryResult);

  return first ? first.name : null;
}

function getFirstRecommendedRestaurant(conversationState) {
  if (conversationState && conversationState.last_recommended_restaurant) {
    const name = getPlaceName(conversationState.last_recommended_restaurant);
    if (name) {
      return name;
    }
  }

  const localDiscoveryResult = conversationState &&
    conversationState.last_skill_results &&
    conversationState.last_skill_results.local_discovery;
  const first = getFirstPlaceSummary(localDiscoveryResult, isRestaurantPlace);

  return first ? first.name : null;
}

function getContextRouteDestination(conversationState, tripState) {
  return getFirstRecommendedPlace(conversationState) ||
    (conversationState && conversationState.last_route_destination) ||
    (tripState && tripState.next_destination) ||
    null;
}

function getContextRouteOrigin(tripState) {
  return (tripState && tripState.current_location) || DEFAULT_ROUTE_ORIGIN;
}

function getLastQueuedRestaurant(conversationState) {
  const recommendedRestaurant = getFirstRecommendedRestaurant(conversationState);
  if (recommendedRestaurant) {
    return recommendedRestaurant;
  }

  if (conversationState && conversationState.last_route_destination) {
    return conversationState.last_route_destination;
  }

  const queueResult = conversationState &&
    conversationState.last_skill_results &&
    conversationState.last_skill_results.restaurant_queue;
  const data = queueResult && queueResult.data ? queueResult.data : queueResult;

  if (data && data.restaurant_name) {
    return data.restaurant_name;
  }

  if (conversationState && conversationState.last_queue_restaurant) {
    return conversationState.last_queue_restaurant;
  }

  const routeResult = conversationState &&
    conversationState.last_skill_results &&
    conversationState.last_skill_results.route_planner;
  const routeDestination = getRouteDestinationFromResult(routeResult);

  return routeDestination || null;
}

function enrichInputWithConversationContext(input, conversationState, memory, options = {}) {
  const objectInput = input && typeof input === "object" && !Array.isArray(input)
    ? input
    : null;
  const text = getInputText(input);
  if (!text.trim()) {
    return input;
  }

  const tripState = memory.trip_state || {};
  const routeFollowUpWords = [
    "\u53bb\u8fd9\u91cc",
    "\u53bb\u90a3\u91cc",
    "\u5230\u90a3\u91cc",
    "\u5230\u8fd9\u91cc",
    "\u8fd9\u91cc\u600e\u4e48\u53bb",
    "\u90a3\u91cc\u600e\u4e48\u53bb",
    "\u770b\u770b\u8def\u7ebf",
    "\u7ee7\u7eed\u89c4\u5212",
    "\u90a3\u5e2e\u6211\u89c4\u5212\u8def\u7ebf",
    "\u5e2e\u6211\u89c4\u5212\u8def\u7ebf",
    "\u89c4\u5212\u8def\u7ebf",
    "\u8def\u7ebf",
    "\u600e\u4e48\u8fc7\u53bb",
    "\u600e\u4e48\u53bb",
    "\u5e26\u6211\u53bb",
    "route",
  ];
  const queueFollowUpWords = [
    "\u5feb\u8f6e\u5230\u6211\u4e86\u5417",
    "\u7ee7\u7eed\u770b\u6392\u961f",
    "\u6392\u961f",
    "\u7b49\u4f4d",
    "\u592a\u957f",
    "\u8fd8\u8981\u7b49\u591a\u4e45",
    "\u5982\u679c\u6392\u961f\u592a\u957f\u600e\u4e48\u529e",
    "queue",
  ];

  if (
    textIncludesAny(text, routeFollowUpWords) &&
    hasConversationHistory(conversationState) &&
    isConversationContextFresh(conversationState, options)
  ) {
    const destination = getContextRouteDestination(conversationState, tripState);
    if (destination) {
      return {
        ...(objectInput || {}),
        origin: getContextRouteOrigin(tripState),
        destination,
        session_id: conversationState.session_id,
        raw_text: text,
      };
    }
  }

  if (textIncludesAny(text, queueFollowUpWords)) {
    const restaurantName = getLastQueuedRestaurant(conversationState);
    if (restaurantName) {
      return {
        ...(objectInput || {}),
        restaurant_name: restaurantName,
        session_id: conversationState.session_id,
        raw_text: text,
      };
    }

    return {
      ...(objectInput || {}),
      type: "queue_follow_up",
      needs_clarification: true,
      session_id: conversationState.session_id,
      raw_text: text,
    };
  }

  return input;
}

function shouldUseLLM(options = {}) {
  return Boolean(options && options.useLLM === true);
}

function buildRuntimePrompt(input, memory, skillResults, conversationState) {
  const conversationContext = summarizeConversationState(conversationState);

  return buildPrompt({
    userInput: {
      current_input: input,
      conversation_context: conversationContext,
    },
    skillResults: {
      ...(skillResults || {}),
      conversation_context: conversationContext,
    },
  });
}

async function callLLMForRuntime(input, memory, skillResults, options = {}, conversationState = {}) {
  try {
    const prompt = buildRuntimePrompt(input, memory, skillResults, conversationState);

    if (options.stream === true) {
      return await generateLLMResponseStream(prompt, options.onToken, options);
    }

    return await generateLLMResponse(prompt, options);
  } catch (error) {
    return {
      success: false,
      provider: "deepseek",
      model: options.model || process.env.DEEPSEEK_MODEL || "deepseek-chat",
      error: error.message || String(error),
      parsed: {},
      raw_text: "",
    };
  }
}

function applyLLMSuggestion(llmParsed) {
  const parsed = llmParsed && typeof llmParsed === "object" ? llmParsed : {};

  return {
    response_text: typeof parsed.response_text === "string" ? parsed.response_text : "",
    suggested_intent: typeof parsed.intent === "string" ? parsed.intent : "",
    suggested_tool_request: parsed.tool_request && typeof parsed.tool_request === "object"
      ? parsed.tool_request
      : {},
    suggested_memory_update: parsed.memory_update_suggestion &&
      typeof parsed.memory_update_suggestion === "object"
      ? parsed.memory_update_suggestion
      : {},
  };
}

function formatLLMResult(llmResult, used) {
  if (!used) {
    return defaultLLMResult();
  }

  return {
    used: true,
    success: Boolean(llmResult && llmResult.success),
    provider: llmResult && llmResult.provider ? llmResult.provider : null,
    model: llmResult && llmResult.model ? llmResult.model : null,
    parsed: llmResult && llmResult.parsed ? llmResult.parsed : {},
    error: llmResult && llmResult.error ? llmResult.error : "",
  };
}

function normalizeInput(input) {
  if (typeof input === "string") {
    return { text: input, object: null };
  }

  if (input && typeof input === "object" && !Array.isArray(input)) {
    return {
      text: getInputText(input) || JSON.stringify(input),
      object: input,
    };
  }

  return {
    text: "",
    object: null,
  };
}

function getInputParams(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return {};
  }

  if (input.params && typeof input.params === "object" && !Array.isArray(input.params)) {
    return input.params;
  }

  if (input.input && typeof input.input === "object" && !Array.isArray(input.input)) {
    return getInputParams(input.input);
  }

  return input;
}

function pick(params, keys) {
  for (const key of keys) {
    if (params[key] != null && params[key] !== "") {
      return params[key];
    }
  }
  return undefined;
}

function parseKeyValueText(text) {
  const result = {};
  const pattern = /(?:^|[\s,，])([A-Za-z_][\w]*|[\u4e00-\u9fa5]+)\s*[:=：]\s*([^,，\s]+)/g;

  for (const match of String(text || "").matchAll(pattern)) {
    result[match[1]] = match[2];
  }

  return result;
}

function extractRouteParams(input) {
  const normalized = normalizeInput(input);
  const params = {
    ...parseKeyValueText(normalized.text),
    ...getInputParams(normalized.object),
  };
  const origin = pick(params, ["origin", "from", "start", "起点"]);
  const destination = pick(params, ["destination", "to", "end", "终点", "目的地"]);
  const time = pick(params, ["time", "时间"]);

  return {
    origin,
    destination,
    time,
  };
}

function extractQueueParams(input) {
  const normalized = normalizeInput(input);
  const params = {
    ...parseKeyValueText(normalized.text),
    ...getInputParams(normalized.object),
  };

  return {
    restaurant_name: pick(params, ["restaurant_name", "restaurant", "name", "餐厅", "餐厅名称"]),
    current_time: pick(params, ["current_time", "time", "当前时间"]),
    travel_minutes: pick(params, ["travel_minutes", "travel_time", "交通耗时"]),
  };
}

function mapBudgetPreference(value) {
  if (typeof value === "number") {
    return value;
  }

  if (!value) {
    return undefined;
  }

  const text = String(value);
  if (text.includes("低") || text.includes("少") || text.includes("便宜")) {
    return 80;
  }
  if (text.includes("中")) {
    return 150;
  }
  if (text.includes("高")) {
    return 300;
  }

  const numeric = Number(text);
  return Number.isFinite(numeric) ? numeric : undefined;
}

function uniqueTags(values) {
  return [...new Set(values.filter(Boolean).map((item) => String(item).trim()).filter(Boolean))];
}

function getFoodPreferenceTags(foodPreference, category) {
  if (category !== "餐厅") {
    return [];
  }

  const text = String(foodPreference || "");
  if (text.includes("不吃辣") || text.includes("不要辣") || text.includes("不太想吃辣")) {
    return ["不辣"];
  }

  return [];
}

function isDiscoveryIntent(intent) {
  return intent === "discovery" || intent === "quiet_recommendation";
}

function resolveDiscoveryCategory(input) {
  const normalized = normalizeInput(input);
  const params = getInputParams(normalized.object);
  const explicitCategory = pick(params, ["category", "\u7c7b\u522b"]);
  if (explicitCategory) {
    return explicitCategory;
  }

  const text = normalized.text;
  if (textIncludesAny(text, [
    "\u63a8\u8350\u9910\u5385",
    "\u63a8\u8350\u4e00\u5bb6\u9910\u5385",
    "\u627e\u9910\u5385",
    "\u9644\u8fd1\u9910\u5385",
    "\u9910\u5385",
    "\u5403\u996d",
    "\u7f8e\u98df",
  ])) {
    return "\u9910\u5385";
  }

  if (textIncludesAny(text, [
    "\u9644\u8fd1\u666f\u70b9",
    "\u63a8\u8350\u666f\u70b9",
    "\u627e\u9644\u8fd1",
    "\u9644\u8fd1\u6709\u4ec0\u4e48",
    "\u666f\u70b9",
  ])) {
    return "\u666f\u70b9";
  }

  return undefined;
}

function hasRouteIntentText(text) {
  return textIncludesAny(text, [
    "\u5e2e\u6211\u89c4\u5212\u8def\u7ebf",
    "\u89c4\u5212\u8def\u7ebf",
    "\u600e\u4e48\u53bb",
    "\u600e\u4e48\u8fc7\u53bb",
    "\u53bb\u90a3\u91cc",
    "\u53bb\u8fd9\u91cc",
    "\u5230\u90a3\u91cc",
    "\u5230\u8fd9\u91cc",
    "\u770b\u770b\u8def\u7ebf",
    "\u8def\u7ebf",
  ]);
}

function hasQueueIntentText(text) {
  return textIncludesAny(text, [
    "\u6392\u961f",
    "\u7b49\u4f4d",
    "\u592a\u957f",
    "\u8fd8\u8981\u7b49\u591a\u4e45",
    "\u5982\u679c\u6392\u961f\u592a\u957f\u600e\u4e48\u529e",
    "\u8f6e\u5230",
  ]);
}

function hasGreetingIntentText(text) {
  const normalized = String(text || "").trim().toLowerCase();
  return textIncludesAny(normalized, [
    "\u4f60\u597d",
    "\u55e8",
    "\u5728\u5417",
    "hello",
    "hi",
  ]);
}

function hasDiscoveryIntentText(text) {
  return textIncludesAny(text, [
    "\u9644\u8fd1\u666f\u70b9",
    "\u627e\u9644\u8fd1",
    "\u666f\u70b9",
    "\u9644\u8fd1\u6709\u4ec0\u4e48",
    "\u63a8\u8350\u666f\u70b9",
    "\u63a8\u8350\u9910\u5385",
    "\u63a8\u8350\u4e00\u5bb6\u9910\u5385",
    "\u627e\u9910\u5385",
    "\u9644\u8fd1\u9910\u5385",
    "\u53bb\u54ea\u73a9",
    "\u53bb\u54ea\u91cc\u73a9",
    "\u54ea\u91cc\u597d\u73a9",
    "\u6709\u4ec0\u4e48\u597d\u73a9\u7684",
    "\u60f3\u51fa\u53bb\u73a9",
    "\u5468\u672b\u53bb\u54ea",
  ]);
}

function inferRuntimeIntent(input, memory) {
  const normalized = normalizeInput(input);
  const text = normalized.text;
  const object = normalized.object;
  const params = getInputParams(object);

  if (object && object.type === "heartbeat_check") {
    return "heartbeat_check";
  }

  if (object && object.type === "queue_follow_up") {
    return "queue";
  }

  if (detectPreferenceUpdate(input).should_update) {
    return "preference_update";
  }

  if (hasGreetingIntentText(text)) {
    return "greeting";
  }

  const routeParams = extractRouteParams(input);
  if (routeParams.origin && routeParams.destination) {
    return "route";
  }

  if (hasRouteIntentText(text)) {
    return "route";
  }

  if (
    params.restaurant_name ||
    params.restaurant ||
    params["餐厅"] ||
    hasQueueIntentText(text)
  ) {
    return "queue";
  }

  if (
    text.includes("安静") ||
    text.includes("独处") ||
    text.includes("坐坐") ||
    text.includes("推荐地方")
  ) {
    return "quiet_recommendation";
  }

  if (hasDiscoveryIntentText(text) || resolveDiscoveryCategory(input)) {
    return "discovery";
  }

  return "unknown";
}

function getCallableSkill(skillModule) {
  if (typeof skillModule === "function") {
    return skillModule;
  }

  if (skillModule && typeof skillModule.handler === "function") {
    return skillModule.handler;
  }

  if (skillModule && typeof skillModule.run === "function") {
    return skillModule.run;
  }

  return null;
}

async function callLocalDiscovery(params = {}) {
  const runSkill = getCallableSkill(localDiscovery);
  if (!runSkill) {
    return fail("quiet_recommendation", "local-discovery 缺少可调用导出函数。");
  }

  const memory = params.memory || {};
  const longTermMemory = memory.long_term_memory || {};
  const category = params.category;
  const preferenceTags = params.ignore_preference_tags
    ? []
    : [
        ...(Array.isArray(longTermMemory.activity_preference) ? longTermMemory.activity_preference : []),
        ...(Array.isArray(longTermMemory.interest_tags) ? longTermMemory.interest_tags : []),
        ...getFoodPreferenceTags(longTermMemory.food_preference, category),
      ];
  const tags = uniqueTags([
    ...preferenceTags,
    ...(Array.isArray(params.tags) ? params.tags : []),
  ]);

  return runSkill({
    intent: params.intent || "recommend",
    params: {
      category,
      budget: params.budget || mapBudgetPreference(longTermMemory.budget_preference),
      tags,
    },
  });
}

async function callRoutePlanner(params = {}) {
  const runSkill = getCallableSkill(routePlanner);
  if (!runSkill) {
    return fail("route", "route-planner 缺少可调用导出函数。");
  }

  return runSkill({
    intent: "route",
    params,
  });
}

async function callRestaurantQueue(params = {}) {
  const runSkill = getCallableSkill(restaurantQueue);
  if (!runSkill) {
    return fail("queue", "restaurant-queue 缺少可调用导出函数。");
  }

  return runSkill({
    intent: params.intent || "queue_status",
    params,
  });
}

function handleHeartbeatCheck(input, memory) {
  if (input && input.context && input.context.heartbeat_state) {
    const triggerType = input.trigger_type ||
      input.context.heartbeat_state.trigger_type ||
      "heartbeat_check";

    return ok({
      intent: "heartbeat_check",
      data: {
        status: "handoff_ready",
        heartbeat_handoff: {
          trigger_type: triggerType,
          accepted: true,
        },
        handoff_context: {
          to: "life-concierge",
          trigger_type: triggerType,
          reminder_context: input.context.reminder_context || {},
          cooldown_until: input.context.heartbeat_state.cooldown_until || null,
          reason: input.context.reason || null,
        },
        response_hint: input.response_hint || "",
      },
    });
  }

  const relationshipMemory = memory.relationship_memory || {};
  const triggerMode = (input && (input.trigger_mode || input.mode)) ||
    ((input && input.trigger_type) === "scheduled" ? "scheduled" : "conditional");
  const triggerResult = evaluateHeartbeatTriggers(
    {
      trigger_mode: triggerMode,
      trip_state: memory.trip_state || {},
      conversation_state: memory.conversation_state || {},
    },
    {
      mode: triggerMode,
      heartbeat_interval_ms: input && input.heartbeat_interval_ms,
      cooldown_duration_ms: input && input.cooldown_duration_ms,
      now: input && input.now,
    }
  );

  if (!triggerResult.success) {
    return fail("heartbeat_check", triggerResult.error);
  }

  const heartbeatState = triggerResult.heartbeat_state || memory.heartbeat_state || {};
  let status = triggerResult.status;

  if (triggerResult.status === "blocked_by_cooldown") {
    status = "blocked_by_cooldown";
  } else if (relationshipMemory.reminder_preference === "low_frequency") {
    status = "low_frequency_hint";
  } else if (triggerResult.triggered) {
    status = "handoff_ready";
  }

  return ok({
    intent: "heartbeat_check",
    data: {
      status,
      trigger_result: triggerResult,
      heartbeat_handoff: {
        trigger_type: heartbeatState.trigger_type || (input && input.trigger_type) || null,
        accepted: triggerResult.triggered === true,
      },
      handoff_context: {
        to: "life-concierge",
        trigger_type: heartbeatState.trigger_type || (input && input.trigger_type) || null,
        reminder_context: heartbeatState.reminder_context || (input && input.reminder_context) || {},
        cooldown_until: heartbeatState.cooldown_until || null,
        reminder_preference: relationshipMemory.reminder_preference || null,
      },
    },
  });
}

function getRouteDestinationFromResult(result) {
  if (result && result.params && result.params.destination) {
    return result.params.destination;
  }
  if (result && result.destination) {
    return result.destination;
  }
  return null;
}

function getQueueRestaurantFromResult(result) {
  const data = getResultData(result);
  return data && data.restaurant_name ? data.restaurant_name : null;
}

function buildConversationContextPatch(intent, skillResults) {
  const patch = {};

  if (isDiscoveryIntent(intent)) {
    const recommendation = getFirstPlaceSummary(skillResults.local_discovery);
    if (recommendation) {
      patch.last_recommendation = recommendation;
    }

    const restaurant = getFirstPlaceSummary(skillResults.local_discovery, isRestaurantPlace);
    if (restaurant) {
      patch.last_recommended_restaurant = restaurant;
    }
  }

  if (intent === "route") {
    const destination = getRouteDestinationFromResult(skillResults.route_planner);
    if (destination) {
      patch.last_route_destination = destination;
    }
  }

  if (intent === "queue") {
    const restaurantName = getQueueRestaurantFromResult(skillResults.restaurant_queue);
    if (restaurantName) {
      patch.last_queue_restaurant = restaurantName;
    }
  }

  return patch;
}

function updateTripStateFromResult(memory, intent, result) {
  const patch = {};

  if (isDiscoveryIntent(intent) && result && result.success) {
    patch.activity_state = "planning";
  }

  if (intent === "route" && result && result.success) {
    const destination = getRouteDestinationFromResult(result);
    if (destination) {
      patch.next_destination = destination;
    }
  }

  if (intent === "queue" && result && result.success) {
    patch.activity_state = "queue_checked";
  }

  if (Object.keys(patch).length === 0) {
    return {
      success: true,
      data: {
        patch: {},
        trip_state: memory.trip_state || {},
      },
    };
  }

  const updated = updateMemorySection("trip_state", patch);
  if (!updated.success) {
    return updated;
  }

  return {
    success: true,
    data: {
      patch,
      trip_state: updated.data,
    },
  };
}

function generateRuntimeResponse(intent, memory, skillResults) {
  if (intent === "preference_update") {
    return "我已经按你的明确表达更新了偏好，之后会尽量避开不合适的选择。";
  }

  if (intent === "quiet_recommendation") {
    return "我根据你的偏好先筛了一些安静、独处友好的候选，你可以看看要不要继续规划路线。";
  }

  if (intent === "greeting") {
    return "\u6211\u5728\u3002\u60f3\u627e\u5730\u65b9\u3001\u89c4\u5212\u8def\u7ebf\uff0c\u6216\u8005\u53ea\u662f\u5148\u804a\u4e24\u53e5\u90fd\u53ef\u4ee5\u3002";
  }

  if (intent === "discovery") {
    return "我先找了一些符合条件的候选，你可以继续让我规划路线或查看排队情况。";
  }

  if (intent === "route") {
    return "我先看了路线结果，你可以看看要不要继续比较交通方式。";
  }

  if (intent === "queue") {
    const queueResult = skillResults.restaurant_queue || {};
    if (queueResult.needs_clarification) {
      return "你想看哪家餐厅的排队情况？告诉我店名，我再帮你查。";
    }

    return "我先看了排队状态，你可以看看要不要再安排出发时间。";
  }

  if (intent === "heartbeat_check") {
    const heartbeatResult = skillResults.heartbeat_check || {};
    if (heartbeatResult.status === "blocked_by_cooldown") {
      return "当前还在冷却期，我先不重复打扰。";
    }
    if (heartbeatResult.response_hint) {
      return heartbeatResult.response_hint;
    }
    const handoff = heartbeatResult.heartbeat_handoff || {};
    if (handoff.trigger_type === "trip_next_step") {
      return "要不要继续看看下一段怎么走？我可以先把上下文整理好，你决定要不要继续。";
    }
    if (handoff.trigger_type === "queue_follow_up") {
      return "要不要顺手看一下排队进度，或者看看接下来是否需要调整出发时间？";
    }
    if (handoff.trigger_type === "inactivity_check") {
      return "如果愿意的话，我可以陪你轻轻看一眼接下来有什么适合做的事。";
    }
    if (handoff.trigger_type === "scheduled") {
      return "到一个小提醒时间了，要不要一起看看现在有什么需要关注的事？";
    }
    return "我整理了触发上下文，可以交给 life-concierge 决定是否温和提醒。";
  }

  return "我还不能确定你的意图，可以换个更明确的说法一起看看。";
}

async function handleUserInput(input, options = {}) {
  try {
    const loaded = loadMemory();
    if (!loaded.success) {
      return fail("unknown", loaded.error);
    }

    let memory = loaded.data;
    const memoryUpdates = [];
    const skillResults = {};
    const sessionId = resolveSessionId(input, options);
    const conversationLoaded = getConversationState(sessionId);
    if (!conversationLoaded.success) {
      return fail("unknown", conversationLoaded.error);
    }

    const conversationState = conversationLoaded.data;
    const effectiveInput = enrichInputWithConversationContext(input, conversationState, memory, options);
    const intent = inferRuntimeIntent(effectiveInput, memory);

    const preferenceUpdate = detectPreferenceUpdate(effectiveInput);
    if (preferenceUpdate.should_update) {
      const updated = updateMemorySection(preferenceUpdate.section, preferenceUpdate.patch);
      if (!updated.success) {
        return fail(intent, updated.error);
      }

      memoryUpdates.push({
        section: preferenceUpdate.section,
        patch: preferenceUpdate.patch,
      });

      const growth = appendGrowthEvent(preferenceUpdate.growth_event);
      if (!growth.success) {
        return fail(intent, growth.error);
      }

      memoryUpdates.push({
        section: "memory_evolution",
        growth_event: growth.data,
      });

      const reloaded = loadMemory();
      if (!reloaded.success) {
        return fail(intent, reloaded.error);
      }
      memory = reloaded.data;
    }

    if (isDiscoveryIntent(intent)) {
      const discoveryCategory = resolveDiscoveryCategory(effectiveInput);
      let result = await callLocalDiscovery({
        memory,
        category: discoveryCategory,
      });
      if (
        result &&
        result.success &&
        discoveryCategory &&
        Array.isArray(result.data) &&
        result.data.length === 0
      ) {
        const fallbackResult = await callLocalDiscovery({
          memory,
          category: discoveryCategory,
          ignore_preference_tags: true,
        });
        if (fallbackResult && fallbackResult.success && Array.isArray(fallbackResult.data) && fallbackResult.data.length > 0) {
          result = fallbackResult;
        }
      }
      skillResults.local_discovery = result;
      if (!result || !result.success) {
        const failureResult = skillFailure(intent, "local-discovery", result);
        updateConversationAfterTurn(sessionId, conversationState, input, intent, skillResults, failureResult.error);
        return failureResult;
      }
      const tripUpdate = updateTripStateFromResult(memory, intent, result);
      if (!tripUpdate.success) {
        return fail(intent, tripUpdate.error);
      }
      if (Object.keys(tripUpdate.data.patch).length > 0) {
        memoryUpdates.push({ section: "trip_state", patch: tripUpdate.data.patch });
      }
    } else if (intent === "route") {
      const params = extractRouteParams(effectiveInput);
      const result = await callRoutePlanner(params);
      skillResults.route_planner = result && typeof result === "object"
        ? { ...result, params }
        : result;
      if (!result || !result.success) {
        const failureResult = skillFailure(intent, "route-planner", result);
        updateConversationAfterTurn(sessionId, conversationState, input, intent, skillResults, failureResult.error);
        return failureResult;
      }
      const tripUpdate = updateTripStateFromResult(memory, intent, { ...result, params });
      if (!tripUpdate.success) {
        return fail(intent, tripUpdate.error);
      }
      if (Object.keys(tripUpdate.data.patch).length > 0) {
        memoryUpdates.push({ section: "trip_state", patch: tripUpdate.data.patch });
      }
    } else if (intent === "queue") {
      const params = extractQueueParams(effectiveInput);
      if (!params.restaurant_name) {
        skillResults.restaurant_queue = {
          success: false,
          needs_clarification: true,
          error: "需要 restaurant_name 参数。",
        };
      } else {
        const result = await callRestaurantQueue(params);
        skillResults.restaurant_queue = result;
        if (!result || !result.success) {
          const failureResult = skillFailure(intent, "restaurant-queue", result);
          updateConversationAfterTurn(sessionId, conversationState, input, intent, skillResults, failureResult.error);
          return failureResult;
        }
        const tripUpdate = updateTripStateFromResult(memory, intent, result);
        if (!tripUpdate.success) {
          return fail(intent, tripUpdate.error);
        }
        if (Object.keys(tripUpdate.data.patch).length > 0) {
          memoryUpdates.push({ section: "trip_state", patch: tripUpdate.data.patch });
        }
      }
    } else if (intent === "heartbeat_check") {
      const result = handleHeartbeatCheck(normalizeInput(effectiveInput).object || {}, memory);
      if (!result.success) {
        return result;
      }
      skillResults.heartbeat_check = result.data;
    }

    const finalMemory = loadMemory();
    if (!finalMemory.success) {
      return fail(intent, finalMemory.error);
    }

    const ruleResponse = generateRuntimeResponse(intent, finalMemory.data, skillResults);
    let response = ruleResponse;
    let llmResult = defaultLLMResult();
    let llmSuggestions = defaultLLMSuggestions();

    if (shouldUseLLM(options)) {
      const rawLLMResult = await callLLMForRuntime(
        effectiveInput,
        finalMemory.data,
        skillResults,
        options,
        conversationState
      );
      llmResult = formatLLMResult(rawLLMResult, true);
      llmSuggestions = applyLLMSuggestion(llmResult.parsed);

      if (llmResult.success && llmSuggestions.response_text) {
        response = llmSuggestions.response_text;
      }
    }

    const conversationUpdate = updateConversationAfterTurn(
      sessionId,
      conversationState,
      input,
      intent,
      skillResults,
      response
    );
    if (!conversationUpdate.success) {
      return fail(intent, conversationUpdate.error);
    }

    memoryUpdates.push({
      section: "conversation_state",
      session_id: sessionId,
      messages_appended: 2,
      last_intent: intent,
    });

    const finalMemoryWithConversation = loadMemory();
    if (!finalMemoryWithConversation.success) {
      return fail(intent, finalMemoryWithConversation.error);
    }

    return ok({
      session_id: sessionId,
      intent,
      memory_updates: memoryUpdates,
      skill_results: skillResults,
      response,
      heartbeat_handoff: intent === "heartbeat_check" &&
        skillResults.heartbeat_check &&
        skillResults.heartbeat_check.heartbeat_handoff
        ? skillResults.heartbeat_check.heartbeat_handoff
        : undefined,
      llm_result: llmResult,
      llm_suggestions: llmSuggestions,
      conversation_state: summarizeConversationState(conversationUpdate.data),
      memory_snapshot: {
        trip_state: finalMemoryWithConversation.data.trip_state,
        heartbeat_state: finalMemoryWithConversation.data.heartbeat_state,
        conversation_state: summarizeConversationState(conversationUpdate.data),
      },
    });
  } catch (error) {
    return fail("unknown", error.message || String(error));
  }
}

module.exports = {
  handleUserInput,
  inferRuntimeIntent,
  callLocalDiscovery,
  callRoutePlanner,
  callRestaurantQueue,
  handleHeartbeatCheck,
  updateTripStateFromResult,
  generateRuntimeResponse,
  shouldUseLLM,
  buildRuntimePrompt,
  callLLMForRuntime,
  applyLLMSuggestion,
};
