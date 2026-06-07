const fs = require("fs");
const path = require("path");

const DEFAULT_HEARTBEAT_STATE = {
  last_trigger_time: null,
  trigger_type: null,
  cooldown_until: null,
  reminder_context: {},
};

const DEFAULT_HEARTBEAT_INTERVAL_MS = 60 * 60 * 1000;
const DEFAULT_COOLDOWN_DURATION_MS = 60 * 60 * 1000;
const DEFAULT_LOOP_INTERVAL_MS = 60 * 1000;
const DEFAULT_LOOP_COOLDOWN_DURATION_MS = 30 * 60 * 1000;
const HEARTBEAT_FIELDS = Object.keys(DEFAULT_HEARTBEAT_STATE);

const heartbeatLoopState = {
  timer: null,
  running: false,
  intervalMs: null,
  tick_count: 0,
  started_at: null,
  stopped_at: null,
  last_tick_at: null,
  last_result: null,
  last_error: null,
  options: {},
  is_ticking: false,
  loop_id: 0,
};

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function getMemoryStorePath() {
  return path.resolve(__dirname, "..", "backend", "memory_store.json");
}

function isPlainObject(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function normalizeNullableString(value) {
  if (value == null || value === "") {
    return null;
  }
  return String(value);
}

function normalizeReminderContext(value) {
  return isPlainObject(value) ? clone(value) : {};
}

function normalizeHeartbeatState(state) {
  const source = isPlainObject(state) ? state : {};

  return {
    last_trigger_time: normalizeNullableString(source.last_trigger_time),
    trigger_type: normalizeNullableString(source.trigger_type),
    cooldown_until: normalizeNullableString(source.cooldown_until),
    reminder_context: normalizeReminderContext(source.reminder_context),
  };
}

function loadMemoryStore() {
  const memoryStorePath = getMemoryStorePath();

  if (!fs.existsSync(memoryStorePath)) {
    return {};
  }

  const raw = fs.readFileSync(memoryStorePath, "utf8");
  if (!raw.trim()) {
    return {};
  }

  const parsed = JSON.parse(raw);
  return isPlainObject(parsed) ? parsed : {};
}

function saveMemoryStore(memoryStore) {
  const memoryStorePath = getMemoryStorePath();
  fs.writeFileSync(memoryStorePath, `${JSON.stringify(memoryStore, null, 2)}\n`, "utf8");
}

function ok(payload) {
  return { success: true, ...payload };
}

function fail(error) {
  return { success: false, error };
}

function getNow(options = {}) {
  const value = options.now;
  if (value instanceof Date) {
    return value;
  }
  if (typeof value === "string" || typeof value === "number") {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed;
    }
  }
  return new Date();
}

function normalizeDuration(value, defaultValue, fieldName) {
  if (value == null) {
    return defaultValue;
  }

  const duration = Number(value);
  if (!Number.isFinite(duration) || duration <= 0) {
    throw new Error(`${fieldName} must be a positive number.`);
  }

  return duration;
}

function parseIsoTime(value) {
  if (!value) {
    return NaN;
  }
  return Date.parse(value);
}

function toIso(value) {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function isHeartbeatInCooldown(state = loadHeartbeatState(), options = {}) {
  const now = getNow(options).getTime();
  const cooldownUntil = parseIsoTime(state.cooldown_until);

  return Number.isFinite(cooldownUntil) && cooldownUntil > now;
}

function getCooldownResult(state, options = {}) {
  if (options.ignore_cooldown === true) {
    return null;
  }

  if (!isHeartbeatInCooldown(state, options)) {
    return null;
  }

  return ok({
    triggered: false,
    status: "blocked_by_cooldown",
    reason: "blocked_by_cooldown",
    heartbeat_state: state,
  });
}

function buildCooldownUntil(now, cooldownDurationMs) {
  return new Date(now.getTime() + cooldownDurationMs).toISOString();
}

function loadHeartbeatState() {
  const memoryStore = loadMemoryStore();
  return normalizeHeartbeatState(memoryStore.heartbeat_state);
}

function saveHeartbeatState(state) {
  const memoryStore = loadMemoryStore();
  const normalizedState = normalizeHeartbeatState(state);

  memoryStore.heartbeat_state = normalizedState;
  saveMemoryStore(memoryStore);

  return clone(normalizedState);
}

function getHeartbeatState() {
  return loadHeartbeatState();
}

function updateHeartbeatState(patch) {
  if (!isPlainObject(patch)) {
    throw new Error("heartbeat_state patch must be an object.");
  }

  const currentState = loadHeartbeatState();
  const allowedPatch = {};

  for (const fieldName of HEARTBEAT_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(patch, fieldName)) {
      allowedPatch[fieldName] = patch[fieldName];
    }
  }

  return saveHeartbeatState({
    ...currentState,
    ...allowedPatch,
  });
}

function resetHeartbeatState() {
  return saveHeartbeatState(DEFAULT_HEARTBEAT_STATE);
}

function setHeartbeatCooldown(cooldownDurationMs, options = {}) {
  const duration = normalizeDuration(
    cooldownDurationMs,
    DEFAULT_COOLDOWN_DURATION_MS,
    "cooldown_duration_ms"
  );
  const now = getNow(options);

  return updateHeartbeatState({
    cooldown_until: buildCooldownUntil(now, duration),
  });
}

function triggerScheduledHeartbeat(options = {}) {
  try {
    const heartbeatIntervalMs = normalizeDuration(
      options.heartbeat_interval_ms,
      DEFAULT_HEARTBEAT_INTERVAL_MS,
      "heartbeat_interval_ms"
    );
    const cooldownDurationMs = normalizeDuration(
      options.cooldown_duration_ms,
      DEFAULT_COOLDOWN_DURATION_MS,
      "cooldown_duration_ms"
    );
    const now = getNow(options);
    const currentState = loadHeartbeatState();
    const cooldownResult = getCooldownResult(currentState, {
      now,
      ignore_cooldown: options.ignore_cooldown,
    });

    if (cooldownResult) {
      return cooldownResult;
    }

    const lastTriggerTime = parseIsoTime(currentState.last_trigger_time);
    if (
      Number.isFinite(lastTriggerTime) &&
      now.getTime() - lastTriggerTime < heartbeatIntervalMs
    ) {
      return ok({
        triggered: false,
        status: "not_due",
        reason: "scheduled heartbeat interval has not elapsed.",
        heartbeat_state: currentState,
      });
    }

    const nextState = saveHeartbeatState({
      ...currentState,
      last_trigger_time: now.toISOString(),
      trigger_type: "scheduled",
      cooldown_until: buildCooldownUntil(now, cooldownDurationMs),
      reminder_context: {
        source: "scheduled",
        heartbeat_interval_ms: heartbeatIntervalMs,
      },
    });

    return ok({
      triggered: true,
      status: "triggered",
      heartbeat_state: nextState,
    });
  } catch (error) {
    return fail(error.message || String(error));
  }
}

function getActiveConversationSession(conversationState) {
  if (!isPlainObject(conversationState) || !isPlainObject(conversationState.sessions)) {
    return null;
  }

  const activeSessionId = conversationState.active_session_id;
  if (activeSessionId && conversationState.sessions[activeSessionId]) {
    return conversationState.sessions[activeSessionId];
  }

  const sessions = Object.values(conversationState.sessions);
  return sessions.length > 0 ? sessions[sessions.length - 1] : null;
}

function getConditionalReasons(tripState, conversationState) {
  const reasons = [];

  if (isPlainObject(tripState)) {
    if (tripState.activity_state) {
      reasons.push("trip_activity_state");
    }
    if (tripState.next_destination) {
      reasons.push("trip_next_destination");
    }
  }

  const activeSession = getActiveConversationSession(conversationState);
  if (activeSession) {
    if (activeSession.last_intent) {
      reasons.push("conversation_last_intent");
    }
    if (Array.isArray(activeSession.messages) && activeSession.messages.length > 0) {
      reasons.push("conversation_messages");
    }
  }

  return reasons;
}

function buildConditionalReminderContext(tripState, conversationState, reasons) {
  const activeSession = getActiveConversationSession(conversationState);

  return {
    source: "conditional",
    reasons,
    trip_state: {
      activity_state: isPlainObject(tripState) ? tripState.activity_state || null : null,
      next_destination: isPlainObject(tripState) ? tripState.next_destination || null : null,
    },
    conversation_state: activeSession
      ? {
          session_id: activeSession.session_id || null,
          last_intent: activeSession.last_intent || null,
        }
      : {},
  };
}

function triggerConditionalHeartbeat(context = {}, options = {}) {
  try {
    const cooldownDurationMs = normalizeDuration(
      options.cooldown_duration_ms,
      DEFAULT_COOLDOWN_DURATION_MS,
      "cooldown_duration_ms"
    );
    const now = getNow(options);
    const memoryStore = loadMemoryStore();
    const tripState = isPlainObject(context.trip_state)
      ? context.trip_state
      : memoryStore.trip_state || {};
    const conversationState = isPlainObject(context.conversation_state)
      ? context.conversation_state
      : memoryStore.conversation_state || {};
    const currentState = loadHeartbeatState();
    const cooldownResult = getCooldownResult(currentState, {
      now,
      ignore_cooldown: options.ignore_cooldown,
    });

    if (cooldownResult) {
      return cooldownResult;
    }

    const forcedTriggerType = normalizeNullableString(options.trigger_type || options.force_trigger_type);
    const reasons = getConditionalReasons(tripState, conversationState);
    if (reasons.length === 0 && !forcedTriggerType) {
      return ok({
        triggered: false,
        status: "no_condition",
        reason: "no conditional heartbeat source matched.",
        heartbeat_state: currentState,
      });
    }

    const nextState = saveHeartbeatState({
      ...currentState,
      last_trigger_time: now.toISOString(),
      trigger_type: forcedTriggerType || "conditional",
      cooldown_until: buildCooldownUntil(now, cooldownDurationMs),
      reminder_context: {
        ...buildConditionalReminderContext(tripState, conversationState, reasons),
        trigger_type: forcedTriggerType || "conditional",
        reason: options.reason || null,
      },
    });

    return ok({
      triggered: true,
      status: "triggered",
      heartbeat_state: nextState,
    });
  } catch (error) {
    return fail(error.message || String(error));
  }
}

function evaluateHeartbeatTriggers(context = {}, options = {}) {
  const mode = options.mode || (context && context.trigger_mode) || "conditional";

  if (mode === "scheduled") {
    return triggerScheduledHeartbeat(options);
  }

  return triggerConditionalHeartbeat(context, options);
}

function getSessionId(options = {}) {
  const sessionId = options.session_id || options.sessionId || options.conversation_id;
  return sessionId != null && String(sessionId).trim() !== ""
    ? String(sessionId).trim()
    : "default";
}

function mapTriggerType(triggerResult, options = {}) {
  if (options.force_trigger_type) {
    return String(options.force_trigger_type);
  }

  const heartbeatState = triggerResult && triggerResult.heartbeat_state
    ? triggerResult.heartbeat_state
    : {};
  const triggerType = heartbeatState.trigger_type || options.trigger_type || "conditional";

  if (triggerType === "conditional") {
    const reminderContext = heartbeatState.reminder_context || {};
    const reasons = Array.isArray(reminderContext.reasons) ? reminderContext.reasons : [];
    if (reasons.includes("trip_next_destination") || reasons.includes("trip_activity_state")) {
      return "trip_next_step";
    }
    if (reasons.includes("conversation_last_intent") || reasons.includes("conversation_messages")) {
      return "inactivity_check";
    }
  }

  return triggerType;
}

function buildHeartbeatResponseText(triggerType) {
  if (triggerType === "trip_next_step") {
    return "要不要继续看看下一段怎么走？我可以先把上下文整理好，你决定要不要继续。";
  }

  if (triggerType === "queue_follow_up") {
    return "要不要顺手看一下排队进度，或者看看接下来是否需要调整出发时间？";
  }

  if (triggerType === "inactivity_check") {
    return "如果愿意的话，我可以陪你轻轻看一眼接下来有什么适合做的事。";
  }

  if (triggerType === "scheduled") {
    return "到一个小提醒时间了，要不要一起看看现在有什么需要关注的事？";
  }

  return "我整理到一个提醒上下文，要不要一起看看是否需要继续处理？";
}

function buildConversationHandoffSummary(conversationState) {
  const activeSession = getActiveConversationSession(conversationState);

  if (!activeSession) {
    return {};
  }

  return {
    active_session_id: conversationState.active_session_id || activeSession.session_id || null,
    session: {
      session_id: activeSession.session_id || null,
      last_intent: activeSession.last_intent || null,
      updated_at: activeSession.updated_at || null,
      message_count: Array.isArray(activeSession.messages) ? activeSession.messages.length : 0,
    },
  };
}

function buildHeartbeatContext(memory, triggerResult, options = {}) {
  const sessionId = getSessionId(options);
  const triggerType = mapTriggerType(triggerResult, options);
  const heartbeatState = triggerResult && triggerResult.heartbeat_state
    ? triggerResult.heartbeat_state
    : loadHeartbeatState();
  const reminderContext = heartbeatState.reminder_context || {};

  return {
    type: "heartbeat_check",
    trigger_type: triggerType,
    context: {
      session_id: sessionId,
      trip_state: isPlainObject(memory && memory.trip_state) ? clone(memory.trip_state) : {},
      heartbeat_state: clone(heartbeatState),
      conversation_state: isPlainObject(memory && memory.conversation_state)
        ? buildConversationHandoffSummary(memory.conversation_state)
        : {},
      reminder_context: clone(reminderContext),
      reason: triggerResult && triggerResult.reason
        ? triggerResult.reason
        : reminderContext.reason || triggerResult.status || "heartbeat_triggered",
    },
    response_hint: buildHeartbeatResponseText(triggerType),
  };
}

async function triggerHeartbeatHandoff(triggerResult, options = {}) {
  try {
    if (!triggerResult || triggerResult.success === false) {
      return fail((triggerResult && triggerResult.error) || "heartbeat trigger failed.");
    }

    if (triggerResult.triggered === false) {
      return ok({
        triggered: false,
        reason: triggerResult.reason || triggerResult.status || "not_triggered",
        heartbeat_state: triggerResult.heartbeat_state || loadHeartbeatState(),
      });
    }

    const memory = loadMemoryStore();
    const handoff = buildHeartbeatContext(memory, triggerResult, options);
    const { handleUserInput } = require("./life_concierge_runtime");
    const runtimeResult = await handleUserInput(handoff, {
      session_id: getSessionId(options),
      useLLM: false,
    });

    return ok({
      triggered: true,
      trigger_type: handoff.trigger_type,
      handoff,
      runtime_result: runtimeResult,
      heartbeat_state: loadHeartbeatState(),
    });
  } catch (error) {
    return fail(error.message || String(error));
  }
}

async function runHeartbeatCheck(options = {}) {
  try {
    const memory = loadMemoryStore();
    const sessionId = getSessionId(options);
    const forceTriggerType = normalizeNullableString(options.force_trigger_type);
    const mode = options.mode || options.trigger_mode ||
      (forceTriggerType === "scheduled" ? "scheduled" : "conditional");
    const triggerOptions = {
      mode,
      heartbeat_interval_ms: options.heartbeat_interval_ms,
      cooldown_duration_ms: options.cooldown_duration_ms,
      ignore_cooldown: options.ignore_cooldown,
      now: options.now,
      trigger_type: forceTriggerType,
      force_trigger_type: forceTriggerType,
      reason: options.reason,
    };
    const triggerResult = evaluateHeartbeatTriggers(
      {
        trigger_mode: mode,
        trip_state: isPlainObject(options.trip_state) ? options.trip_state : memory.trip_state || {},
        conversation_state: isPlainObject(options.conversation_state)
          ? options.conversation_state
          : memory.conversation_state || {},
      },
      triggerOptions
    );

    if (!triggerResult.success) {
      return triggerResult;
    }

    if (!triggerResult.triggered) {
      return ok({
        triggered: false,
        reason: triggerResult.reason || triggerResult.status || "not_triggered",
        heartbeat_state: triggerResult.heartbeat_state || loadHeartbeatState(),
      });
    }

    return triggerHeartbeatHandoff(triggerResult, {
      ...options,
      session_id: sessionId,
      force_trigger_type: forceTriggerType || triggerResult.heartbeat_state.trigger_type,
    });
  } catch (error) {
    return fail(error.message || String(error));
  }
}

function normalizeLoopInterval(value) {
  return normalizeDuration(value, DEFAULT_LOOP_INTERVAL_MS, "intervalMs");
}

function normalizeMaxTicks(value) {
  if (value == null) {
    return null;
  }

  const maxTicks = Number(value);
  if (!Number.isInteger(maxTicks) || maxTicks <= 0) {
    throw new Error("maxTicks must be a positive integer.");
  }

  return maxTicks;
}

function getHeartbeatLoopStatus() {
  return {
    running: heartbeatLoopState.running,
    intervalMs: heartbeatLoopState.intervalMs,
    tick_count: heartbeatLoopState.tick_count,
    started_at: heartbeatLoopState.started_at,
    stopped_at: heartbeatLoopState.stopped_at,
    last_tick_at: heartbeatLoopState.last_tick_at,
    last_result: heartbeatLoopState.last_result,
    last_error: heartbeatLoopState.last_error,
  };
}

function buildLoopRunOptions() {
  const options = heartbeatLoopState.options || {};

  return {
    session_id: options.session_id || "default",
    cooldown_duration_ms: options.cooldown_duration_ms,
    force_trigger_type: options.force_trigger_type,
    ignore_cooldown: options.ignore_cooldown === true,
  };
}

function recordLoopError(error) {
  heartbeatLoopState.last_error = {
    message: error && error.message ? error.message : String(error),
    timestamp: new Date().toISOString(),
  };
}

function compactLoopResult(result) {
  if (!result || typeof result !== "object") {
    return result || null;
  }

  return {
    success: Boolean(result.success),
    triggered: result.triggered === true,
    reason: result.reason || null,
    trigger_type: result.trigger_type || null,
    runtime_result: result.runtime_result
      ? {
          success: Boolean(result.runtime_result.success),
          intent: result.runtime_result.intent || null,
          error: result.runtime_result.error || null,
        }
      : null,
    heartbeat_state: result.heartbeat_state
      ? {
          last_trigger_time: result.heartbeat_state.last_trigger_time || null,
          trigger_type: result.heartbeat_state.trigger_type || null,
          cooldown_until: result.heartbeat_state.cooldown_until || null,
        }
      : null,
    error: result.error || null,
  };
}

function shouldStopForMaxTicks() {
  const maxTicks = heartbeatLoopState.options && heartbeatLoopState.options.maxTicks;
  return Number.isInteger(maxTicks) &&
    maxTicks > 0 &&
    heartbeatLoopState.tick_count >= maxTicks;
}

async function runHeartbeatLoopTick(loopId = heartbeatLoopState.loop_id) {
  if (
    !heartbeatLoopState.running ||
    heartbeatLoopState.is_ticking ||
    loopId !== heartbeatLoopState.loop_id
  ) {
    return;
  }

  heartbeatLoopState.is_ticking = true;
  heartbeatLoopState.tick_count += 1;
  heartbeatLoopState.last_tick_at = new Date().toISOString();

  try {
    const result = await runHeartbeatCheck(buildLoopRunOptions());
    if (loopId !== heartbeatLoopState.loop_id) {
      return;
    }
    heartbeatLoopState.last_result = compactLoopResult(result);
    heartbeatLoopState.last_error = result && result.success === false
      ? {
          message: result.error || "runHeartbeatCheck failed.",
          timestamp: new Date().toISOString(),
        }
      : null;

    if (typeof heartbeatLoopState.options.onTick === "function") {
      try {
        heartbeatLoopState.options.onTick(result, getHeartbeatLoopStatus());
      } catch (error) {
        recordLoopError(error);
      }
    }
  } catch (error) {
    if (loopId !== heartbeatLoopState.loop_id) {
      return;
    }
    heartbeatLoopState.last_result = null;
    recordLoopError(error);
  } finally {
    if (loopId !== heartbeatLoopState.loop_id) {
      return;
    }
    heartbeatLoopState.is_ticking = false;

    if (shouldStopForMaxTicks()) {
      stopHeartbeatLoop();
    }
  }
}

function startHeartbeatLoop(options = {}) {
  try {
    if (heartbeatLoopState.running) {
      return ok({
        started: false,
        already_running: true,
        status: getHeartbeatLoopStatus(),
      });
    }

    const intervalMs = normalizeLoopInterval(options.intervalMs);
    const maxTicks = normalizeMaxTicks(options.maxTicks);
    normalizeDuration(
      options.cooldown_duration_ms,
      DEFAULT_LOOP_COOLDOWN_DURATION_MS,
      "cooldown_duration_ms"
    );

    heartbeatLoopState.running = true;
    heartbeatLoopState.intervalMs = intervalMs;
    heartbeatLoopState.tick_count = 0;
    heartbeatLoopState.started_at = new Date().toISOString();
    heartbeatLoopState.stopped_at = null;
    heartbeatLoopState.last_tick_at = null;
    heartbeatLoopState.last_result = null;
    heartbeatLoopState.last_error = null;
    heartbeatLoopState.is_ticking = false;
    heartbeatLoopState.loop_id += 1;
    heartbeatLoopState.options = {
      session_id: options.session_id || "default",
      cooldown_duration_ms: options.cooldown_duration_ms || DEFAULT_LOOP_COOLDOWN_DURATION_MS,
      force_trigger_type: options.force_trigger_type,
      ignore_cooldown: options.ignore_cooldown === true,
      maxTicks,
      onTick: options.onTick,
    };

    heartbeatLoopState.timer = setInterval(() => {
      runHeartbeatLoopTick(heartbeatLoopState.loop_id);
    }, intervalMs);

    setTimeout(() => {
      runHeartbeatLoopTick(heartbeatLoopState.loop_id);
    }, 0);

    return ok({
      started: true,
      already_running: false,
      status: getHeartbeatLoopStatus(),
    });
  } catch (error) {
    return fail(error.message || String(error));
  }
}

function stopHeartbeatLoop() {
  if (!heartbeatLoopState.running) {
    return ok({
      stopped: false,
      status: getHeartbeatLoopStatus(),
    });
  }

  if (heartbeatLoopState.timer) {
    clearInterval(heartbeatLoopState.timer);
  }

  heartbeatLoopState.timer = null;
  heartbeatLoopState.running = false;
  heartbeatLoopState.stopped_at = new Date().toISOString();

  return ok({
    stopped: true,
    status: getHeartbeatLoopStatus(),
  });
}

function formatLoopDemoResult(result) {
  return {
    success: result && result.success,
    triggered: result && result.triggered,
    reason: result && result.reason,
    trigger_type: result && result.trigger_type,
    runtime_intent: result && result.runtime_result && result.runtime_result.intent,
    heartbeat_trigger_type: result &&
      result.heartbeat_state &&
      result.heartbeat_state.trigger_type,
  };
}

if (require.main === module) {
  startHeartbeatLoop({
    intervalMs: 5000,
    maxTicks: 3,
    session_id: "heartbeat_demo",
    force_trigger_type: "inactivity_check",
    cooldown_duration_ms: DEFAULT_LOOP_COOLDOWN_DURATION_MS,
    onTick: (result, status) => {
      console.log(JSON.stringify({
        type: "heartbeat_demo_tick",
        tick_count: status.tick_count,
        running: status.running,
        result: formatLoopDemoResult(result),
      }, null, 2));
    },
  });
}

module.exports = {
  DEFAULT_HEARTBEAT_STATE,
  DEFAULT_HEARTBEAT_INTERVAL_MS,
  DEFAULT_COOLDOWN_DURATION_MS,
  loadHeartbeatState,
  saveHeartbeatState,
  getHeartbeatState,
  updateHeartbeatState,
  resetHeartbeatState,
  isHeartbeatInCooldown,
  setHeartbeatCooldown,
  triggerScheduledHeartbeat,
  triggerConditionalHeartbeat,
  evaluateHeartbeatTriggers,
  buildHeartbeatContext,
  triggerHeartbeatHandoff,
  runHeartbeatCheck,
  startHeartbeatLoop,
  stopHeartbeatLoop,
  getHeartbeatLoopStatus,
};
