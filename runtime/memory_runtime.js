const fs = require("fs");
const path = require("path");

const SECTION_NAMES = [
  "long_term_memory",
  "relationship_memory",
  "trip_state",
  "heartbeat_state",
  "memory_evolution",
  "conversation_state",
];

const DEFAULT_MEMORY = {
  long_term_memory: {
    food_preference: "不吃辣",
    travel_preference: "少步行",
    budget_preference: "中等预算",
    activity_preference: ["安静", "独处"],
    time_preference: null,
    area_preference: null,
    interest_tags: ["安静", "独处友好"],
    behavior_summary: [],
  },
  relationship_memory: {
    trust_level: "normal",
    reminder_preference: "normal",
    communication_style: "short_and_inviting",
    companionship_preference: null,
    taboo_topics: [],
    last_interaction_at: null,
    feedback_history: [],
  },
  trip_state: {
    current_location: null,
    completed_places: [],
    next_destination: null,
    budget_remaining: null,
    activity_state: null,
    user_feedback: null,
  },
  heartbeat_state: {
    last_trigger_time: null,
    trigger_type: null,
    cooldown_until: null,
    reminder_context: null,
  },
  memory_evolution: {
    growth_events: [],
  },
  conversation_state: {
    active_session_id: null,
    sessions: {},
  },
};

const MAX_CONVERSATION_MESSAGES = 20;
const MAX_CONVERSATION_TEXT_LENGTH = 800;

const BLOCKED_PRIVACY_KEYS = new Set([
  "real_name",
  "id_card",
  "phone",
  "telephone",
  "email",
  "home_address",
  "身份证",
  "手机号",
  "电话",
  "邮箱",
  "真实姓名",
  "家庭住址",
]);

function ok(data) {
  return { success: true, data };
}

function fail(error) {
  return { success: false, error };
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function createSessionId() {
  return `session_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function normalizeSessionId(sessionId) {
  if (sessionId == null || sessionId === "") {
    return "";
  }

  return String(sessionId).trim().replace(/[^\w.-]/g, "_").slice(0, 80);
}

function getMemoryStorePath() {
  return path.resolve(__dirname, "..", "backend", "memory_store.json");
}

function isValidSection(sectionName) {
  return SECTION_NAMES.includes(sectionName);
}

function normalizeMemory(memory) {
  const normalized = clone(DEFAULT_MEMORY);

  if (!memory || typeof memory !== "object" || Array.isArray(memory)) {
    return normalized;
  }

  for (const sectionName of SECTION_NAMES) {
    if (
      memory[sectionName] &&
      typeof memory[sectionName] === "object" &&
      !Array.isArray(memory[sectionName])
    ) {
      normalized[sectionName] = {
        ...normalized[sectionName],
        ...memory[sectionName],
      };
    }
  }

  normalized.conversation_state = normalizeConversationState(memory.conversation_state);

  return normalized;
}

function redactSensitiveText(text) {
  return String(text || "")
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[redacted_email]")
    .replace(/\b1[3-9]\d{9}\b/g, "[redacted_phone]")
    .replace(/\b\d{15}(\d{2}[\dXx])?\b/g, "[redacted_id]")
    .slice(0, MAX_CONVERSATION_TEXT_LENGTH);
}

function sanitizeConversationValue(value) {
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
    return value.map((item) => sanitizeConversationValue(item));
  }

  if (typeof value === "object") {
    const sanitized = {};
    for (const [key, child] of Object.entries(value)) {
      sanitized[key] = sanitizeConversationValue(child);
    }
    return sanitized;
  }

  return String(value);
}

function trimConversationMessages(messages) {
  return messages
    .filter((message) => message && typeof message === "object" && !Array.isArray(message))
    .slice(-MAX_CONVERSATION_MESSAGES)
    .map((message) => ({
      timestamp: message.timestamp || null,
      session_id: normalizeSessionId(message.session_id) || null,
      role: message.role === "assistant" ? "assistant" : "user",
      content: sanitizeConversationValue(message.content),
      intent: message.intent || null,
      skill_results: message.skill_results &&
        typeof message.skill_results === "object" &&
        !Array.isArray(message.skill_results)
        ? sanitizeConversationValue(message.skill_results)
        : {},
    }));
}

function normalizeConversationState(conversationState) {
  const normalized = clone(DEFAULT_MEMORY.conversation_state);

  if (
    !conversationState ||
    typeof conversationState !== "object" ||
    Array.isArray(conversationState)
  ) {
    return normalized;
  }

  normalized.active_session_id = conversationState.active_session_id || null;
  normalized.sessions = {};

  if (conversationState.sessions && typeof conversationState.sessions === "object") {
    for (const [sessionId, session] of Object.entries(conversationState.sessions)) {
      if (!session || typeof session !== "object" || Array.isArray(session)) {
        continue;
      }

      const safeSessionId = normalizeSessionId(session.session_id || sessionId);
      if (!safeSessionId) {
        continue;
      }

      normalized.sessions[safeSessionId] = {
        session_id: safeSessionId,
        created_at: session.created_at || null,
        updated_at: session.updated_at || null,
        messages: trimConversationMessages(Array.isArray(session.messages) ? session.messages : []),
        last_skill_results: session.last_skill_results &&
          typeof session.last_skill_results === "object" &&
          !Array.isArray(session.last_skill_results)
          ? session.last_skill_results
          : {},
        last_intent: session.last_intent || null,
        last_response: session.last_response || "",
        summary: session.summary || "",
        last_recommendation: session.last_recommendation &&
          typeof session.last_recommendation === "object" &&
          !Array.isArray(session.last_recommendation)
          ? sanitizeConversationValue(session.last_recommendation)
          : null,
        last_recommended_restaurant: session.last_recommended_restaurant &&
          typeof session.last_recommended_restaurant === "object" &&
          !Array.isArray(session.last_recommended_restaurant)
          ? sanitizeConversationValue(session.last_recommended_restaurant)
          : null,
        last_route_destination: session.last_route_destination || null,
        last_queue_restaurant: session.last_queue_restaurant || null,
      };
    }
  }

  if (normalized.active_session_id) {
    normalized.active_session_id = normalizeSessionId(normalized.active_session_id);
  }

  return normalized;
}

function findBlockedPrivacyKey(value, trail = []) {
  if (!value || typeof value !== "object") {
    return null;
  }

  for (const [key, child] of Object.entries(value)) {
    if (BLOCKED_PRIVACY_KEYS.has(key)) {
      return [...trail, key].join(".");
    }

    if (child && typeof child === "object") {
      const found = findBlockedPrivacyKey(child, [...trail, key]);
      if (found) {
        return found;
      }
    }
  }

  return null;
}

function validateTopLevelSections(memory) {
  if (!memory || typeof memory !== "object" || Array.isArray(memory)) {
    return "memory 必须是对象。";
  }

  for (const key of Object.keys(memory)) {
    if (!isValidSection(key)) {
      return `不允许创建 MEMORY.md 中没有的顶级模块：${key}`;
    }
  }

  return null;
}

function loadMemory() {
  const memoryPath = getMemoryStorePath();

  if (!fs.existsSync(memoryPath)) {
    return ok(clone(DEFAULT_MEMORY));
  }

  try {
    const raw = fs.readFileSync(memoryPath, "utf8");
    const parsed = JSON.parse(raw);
    return ok(normalizeMemory(parsed));
  } catch (error) {
    return fail(`memory_store.json 读取或解析失败：${error.message}`);
  }
}

function saveMemory(memory) {
  const sectionError = validateTopLevelSections(memory);
  if (sectionError) {
    return fail(sectionError);
  }

  const blockedKey = findBlockedPrivacyKey(memory);
  if (blockedKey) {
    return fail(`不允许写入真实用户隐私字段：${blockedKey}`);
  }

  try {
    const memoryPath = getMemoryStorePath();
    const normalized = normalizeMemory(memory);
    fs.writeFileSync(memoryPath, `${JSON.stringify(normalized, null, 2)}\n`, "utf8");
    return ok(normalized);
  } catch (error) {
    return fail(`memory_store.json 写入失败：${error.message}`);
  }
}

function getMemorySection(sectionName) {
  if (!isValidSection(sectionName)) {
    return fail(`不支持的 memory section：${sectionName}`);
  }

  const loaded = loadMemory();
  if (!loaded.success) {
    return loaded;
  }

  return ok(loaded.data[sectionName]);
}

function updateMemorySection(sectionName, patch) {
  if (!isValidSection(sectionName)) {
    return fail(`不支持的 memory section：${sectionName}`);
  }

  if (!patch || typeof patch !== "object" || Array.isArray(patch)) {
    return fail("patch 必须是对象。");
  }

  const blockedKey = findBlockedPrivacyKey(patch);
  if (blockedKey) {
    return fail(`不允许写入真实用户隐私字段：${blockedKey}`);
  }

  const loaded = loadMemory();
  if (!loaded.success) {
    return loaded;
  }

  const memory = loaded.data;
  memory[sectionName] = {
    ...memory[sectionName],
    ...patch,
  };

  const saved = saveMemory(memory);
  if (!saved.success) {
    return saved;
  }

  return ok(saved.data[sectionName]);
}

function createConversationSession(sessionId) {
  const safeSessionId = normalizeSessionId(sessionId) || createSessionId();
  const now = new Date().toISOString();

  return {
    session_id: safeSessionId,
    created_at: now,
    updated_at: now,
    messages: [],
    last_skill_results: {},
    last_intent: null,
    last_response: "",
    summary: "",
    last_recommendation: null,
    last_recommended_restaurant: null,
    last_route_destination: null,
    last_queue_restaurant: null,
  };
}

function getConversationState(sessionId) {
  const loaded = loadMemory();
  if (!loaded.success) {
    return loaded;
  }

  const conversationState = loaded.data.conversation_state || clone(DEFAULT_MEMORY.conversation_state);
  const resolvedSessionId = normalizeSessionId(sessionId) ||
    normalizeSessionId(conversationState.active_session_id) ||
    "default";
  const session = conversationState.sessions[resolvedSessionId] ||
    createConversationSession(resolvedSessionId);

  return ok({
    ...session,
    session_id: resolvedSessionId,
    messages: trimConversationMessages(session.messages || []),
    last_skill_results: session.last_skill_results || {},
  });
}

function updateConversationState(sessionId, patch) {
  if (!patch || typeof patch !== "object" || Array.isArray(patch)) {
    return fail("conversation patch must be an object.");
  }

  const blockedKey = findBlockedPrivacyKey(patch);
  if (blockedKey) {
    return fail(`涓嶅厑璁稿啓鍏ョ湡瀹炵敤鎴烽殣绉佸瓧娈碉細${blockedKey}`);
  }

  const loaded = loadMemory();
  if (!loaded.success) {
    return loaded;
  }

  const memory = loaded.data;
  const conversationState = normalizeConversationState(memory.conversation_state);
  const resolvedSessionId = normalizeSessionId(sessionId) ||
    normalizeSessionId(conversationState.active_session_id) ||
    createSessionId();
  const currentSession = conversationState.sessions[resolvedSessionId] ||
    createConversationSession(resolvedSessionId);
  const now = new Date().toISOString();
  const nextMessages = patch.messages
    ? trimConversationMessages(patch.messages)
    : currentSession.messages;

  const nextSession = {
    ...currentSession,
    ...sanitizeConversationValue(patch),
    session_id: resolvedSessionId,
    created_at: currentSession.created_at || patch.created_at || now,
    updated_at: now,
    messages: nextMessages,
    last_skill_results: patch.last_skill_results &&
      typeof patch.last_skill_results === "object" &&
      !Array.isArray(patch.last_skill_results)
      ? sanitizeConversationValue(patch.last_skill_results)
      : currentSession.last_skill_results || {},
    last_intent: patch.last_intent || currentSession.last_intent || null,
    last_response: typeof patch.last_response === "string"
      ? redactSensitiveText(patch.last_response)
      : currentSession.last_response || "",
  };

  conversationState.active_session_id = resolvedSessionId;
  conversationState.sessions[resolvedSessionId] = nextSession;
  memory.conversation_state = conversationState;

  const saved = saveMemory(memory);
  if (!saved.success) {
    return saved;
  }

  return ok(saved.data.conversation_state.sessions[resolvedSessionId]);
}

function appendGrowthEvent(event) {
  if (!event || typeof event !== "object" || Array.isArray(event)) {
    return fail("growth event 必须是对象。");
  }

  if (!event.type || !event.description) {
    return fail("growth event 必须包含 type 和 description。");
  }

  const loaded = loadMemory();
  if (!loaded.success) {
    return loaded;
  }

  const memory = loaded.data;
  const growthEvents = Array.isArray(memory.memory_evolution.growth_events)
    ? memory.memory_evolution.growth_events
    : [];

  const timestamp = new Date().toISOString();
  const growthEvent = {
    ...event,
    event_id: event.event_id || `growth_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    timestamp: event.timestamp || timestamp,
    source_module: event.source_module || "memory_evolution",
  };

  const blockedKey = findBlockedPrivacyKey(growthEvent);
  if (blockedKey) {
    return fail(`不允许写入真实用户隐私字段：${blockedKey}`);
  }

  memory.memory_evolution.growth_events = [...growthEvents, growthEvent];

  const saved = saveMemory(memory);
  if (!saved.success) {
    return saved;
  }

  return ok(growthEvent);
}

function resetTripState() {
  return updateMemorySection("trip_state", clone(DEFAULT_MEMORY.trip_state));
}

function detectPreferenceUpdate(userInput) {
  const text = typeof userInput === "string"
    ? userInput
    : JSON.stringify(userInput || "");

  if (
    text.includes("不吃辣") ||
    text.includes("以后不太想吃辣") ||
    text.includes("不要辣")
  ) {
    return {
      should_update: true,
      section: "long_term_memory",
      patch: { food_preference: "不吃辣" },
      growth_event: {
        type: "food_preference_changed",
        description: "用户明确表达饮食偏好变化为不吃辣",
        source_module: "long_term_memory",
      },
    };
  }

  return { should_update: false };
}

module.exports = {
  DEFAULT_MEMORY,
  SECTION_NAMES,
  getMemoryStorePath,
  loadMemory,
  saveMemory,
  getMemorySection,
  updateMemorySection,
  getConversationState,
  updateConversationState,
  appendGrowthEvent,
  resetTripState,
  detectPreferenceUpdate,
};
