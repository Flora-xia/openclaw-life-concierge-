const fs = require("fs");
const path = require("path");

function readTextFileSafe(filePath) {
  if (!filePath) {
    return "";
  }

  try {
    return fs.readFileSync(filePath, "utf8");
  } catch (_) {
    return "";
  }
}

function readJsonFileSafe(filePath) {
  if (!filePath) {
    return {};
  }

  try {
    const raw = fs.readFileSync(filePath, "utf8");
    return JSON.parse(raw);
  } catch (_) {
    return {};
  }
}

function formatForPrompt(value) {
  if (value == null) {
    return "";
  }

  if (typeof value === "string") {
    return value;
  }

  try {
    return JSON.stringify(value, null, 2);
  } catch (_) {
    return String(value);
  }
}

function resolveDefaultPath(projectRoot, relativePath) {
  return path.resolve(projectRoot, relativePath);
}

function buildPrompt(params = {}) {
  const projectRoot = path.resolve(__dirname, "..");
  const memoryStorePath = params.memoryStorePath || resolveDefaultPath(projectRoot, "backend/memory_store.json");
  const soulPath = params.soulPath || resolveDefaultPath(projectRoot, "workspace/SOUL.md");
  const userPath = params.userPath || resolveDefaultPath(projectRoot, "workspace/USER.md");
  const memoryMdPath = params.memoryMdPath || resolveDefaultPath(projectRoot, "workspace/MEMORY.md");

  const userInput = params.userInput == null ? "" : params.userInput;
  const skillResults = params.skillResults || {};
  const memoryStore = readJsonFileSafe(memoryStorePath);
  const soulText = readTextFileSafe(soulPath);
  const userText = readTextFileSafe(userPath);
  const memoryRulesText = readTextFileSafe(memoryMdPath);

  return [
    "# OpenClaw Life Concierge Prompt",
    "",
    "## Agent 身份说明",
    "你是 OpenClaw 本地生活全天候私人管家。你需要遵循 SOUL.md 中的邀请式表达、温和、克制、不强迫原则。",
    "你可以基于用户输入、运行时记忆、静态用户画像、记忆规则和最近 Skill 结果生成回复或提出结构化工具请求。",
    "你不能直接执行工具，不能写入记忆，不能编造真实数据，不能写入真实用户隐私，也不能替用户做最终决定。",
    "",
    "## SOUL.md",
    "```markdown",
    soulText,
    "```",
    "",
    "## USER.md",
    "```markdown",
    userText,
    "```",
    "",
    "## MEMORY.md",
    "```markdown",
    memoryRulesText,
    "```",
    "",
    "## memory_store.json 当前状态",
    "```json",
    formatForPrompt(memoryStore),
    "```",
    "",
    "## 最近 Skill 执行结果",
    "```json",
    formatForPrompt(skillResults),
    "```",
    "",
    "## 当前用户输入",
    "```json",
    formatForPrompt(userInput),
    "```",
    "",
    "## 输出要求",
    "- 回复应自然、简短、邀请式。",
    "- 不要替用户做最终决定。",
    "- 不要编造真实数据。",
    "- 不要写入真实用户隐私。",
    "- 如需要调用工具，只能提出结构化 `tool_request`，不能直接执行工具。",
    "- 如只是生成回复，返回 `response_text`。",
    "- 如需要更新记忆，返回 `memory_update_suggestion`。",
    "- 返回内容应尽量使用 JSON 格式，方便 runtime 解析。",
    "",
    "## 建议 JSON 输出格式",
    "```json",
    JSON.stringify({
      response_text: "面向用户的自然语言回复",
      intent: "可选意图",
      tool_request: {
        skill: "local-discovery | route-planner | restaurant-queue | none",
        intent: "recommend | route | queue_status | departure_advice | none",
        params: {},
      },
      memory_update_suggestion: {
        section: "long_term_memory | relationship_memory | trip_state | heartbeat_state | memory_evolution | none",
        patch: {},
        reason: "",
      },
    }, null, 2),
    "```",
  ].join("\n");
}

module.exports = {
  buildPrompt,
  readTextFileSafe,
  readJsonFileSafe,
  formatForPrompt,
};
