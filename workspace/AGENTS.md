# AGENTS

## 技能清单

### life-concierge 是本项目唯一决策层 Agent。

定位：
- life-concierge 是唯一面向用户的决策层 Agent。
- life-concierge 负责理解用户目标、决定是否调用子技能、整合技能结果、生成最终回复。
- 其他模块均为被动 Skill 或运行时基础设施，不拥有最终决策权。

职责：
- 用户意图理解
- 本地生活规划
- 多技能编排
- 主动陪伴
- 行程管理
- 多轮会话承接
- 记忆读写建议与上下文摘要

边界：
- 不直接承担路线计算，路线由 route-planner 完成。
- 不直接承担排队监控，排队状态由 restaurant-queue 完成。
- 不直接承担地点、天气或候选数据获取，候选数据由 local-discovery 完成。
- 不绕过 MEMORY、HEARTBEAT 或 Mock Backend 的运行时边界。

以上能力由子技能完成。

---

### local-discovery

职责：
- 获取候选地点
- 获取天气
- 获取推荐候选
- 根据类别、预算、标签和长期偏好筛选地点
- 返回可供 life-concierge 二次判断的结构化候选

边界：
- 不做路线规划
- 不做最终推荐
- 不生成面向用户的最终回复
- 不写入 MEMORY
- 不调用 route-planner 或 restaurant-queue

输入：
- category：地点类别，例如餐厅、景点、咖啡馆、书店。
- budget：预算上限或预算等级。
- tags：安静、独处友好、室内、少排队等偏好标签。

输出：
- 候选地点列表。
- 天气或环境相关辅助信息。
- 每个候选的名称、类别、地址、评分、标签等可解释字段。

---

### route-planner

职责：
- 路线规划
- ETA计算
- 附近交通查询
- 模拟打车
- 根据起点、终点和时间生成交通方案
- 为 life-concierge 提供距离、耗时、步行强度、换乘复杂度等判断依据

边界：
- 不推荐地点
- 不监控排队
- 不生成最终行程决定
- 不写入 MEMORY
- 不调用 local-discovery 或 restaurant-queue

输入：
- origin：起点，缺省时可由 life-concierge 使用当前上下文推导。
- destination：终点，必须明确或由会话中的 last_recommendation 推导。
- time：出发或到达时间，可为空。

输出：
- 路线结果、ETA、距离、交通方式、关键步骤。
- 模拟打车状态或附近交通信息。

---

### restaurant-queue

职责：
- 排队查询
- 等待时间估算
- 出发时间建议
- 根据餐厅名称查询排队人数与预计等待时间
- 在等待过长时提供提醒依据和出发时机建议

边界：
- 不规划路线
- 不生成最终回复
- 不推荐餐厅
- 不写入 MEMORY
- 不调用 local-discovery 或 route-planner

输入：
- restaurant_name：餐厅名称，必须明确或由 life-concierge 从会话上下文推导。
- current_time：当前时间，可为空。
- travel_minutes：预计交通耗时，可为空。

输出：
- 排队人数、预计等待时间、队列状态。
- 出发时间建议、是否需要交通复核、提醒依据。

---

## 技能协作规则

```text
life-concierge
├── local-discovery
├── route-planner
└── restaurant-queue
```

协作原则：
- life-concierge 是唯一编排者，所有用户请求先由 life-concierge 理解和路由。
- 子技能只接受 life-concierge 或 runtime 发起的调用，不直接面向用户。
- 子技能禁止互相调用。
- 子技能禁止调用 life-concierge。
- 子技能只返回结构化结果，不做最终用户决策。
- life-concierge 根据用户意图、MEMORY、会话上下文和 Skill 结果生成最终回复。
- 当信息不足时，life-concierge 应优先提出澄清问题，而不是让子技能猜测关键参数。
- 多轮承接时，life-concierge 可以使用 session-scoped conversation_state，例如 last_recommendation、last_recommended_restaurant、last_route_destination、last_queue_restaurant。

典型流程：
- discovery：用户请求推荐地点 -> life-concierge 调用 local-discovery -> 写入会话内 last_recommendation -> 生成候选说明。
- route：用户请求路线 -> life-concierge 从当前输入或会话上下文推导 destination -> 调用 route-planner -> 生成路线建议。
- queue：用户询问排队 -> life-concierge 从输入或会话上下文推导 restaurant_name -> 调用 restaurant-queue -> 生成等待或备选建议。
- fallback：无法匹配 Skill 时 -> life-concierge 可走 LLM fallback，并在缺少 API Key 时 graceful failure。

---

## 基础设施依赖

- MEMORY：运行时记忆系统，包含 long_term_memory、relationship_memory、trip_state、heartbeat_state、memory_evolution、conversation_state。Skill 不直接写入 MEMORY，写入由 runtime 统一校验。
- HEARTBEAT：主动提醒与冷却控制系统，负责 inactivity_check、trip_next_step、queue_follow_up、scheduled 等触发上下文。HEARTBEAT 只提供触发信号，不替代 life-concierge 决策。
- Mock Backend：本地模拟数据后端，为 local-discovery、route-planner、restaurant-queue 提供 destinations、recommend、weather、route、queue、order_taxi 等接口。
- LLM Runtime：可选自然语言 fallback 与结构化建议来源。缺少 API Key 时必须 graceful failure，不影响规则型 Skill 闭环。
- Prompt Builder：将 SOUL、USER、MEMORY、Skill 结果和当前输入组织为 LLM prompt，不直接执行工具或写入记忆。

以上模块属于运行时基础设施，不属于 Skill。

基础设施边界：
- 基础设施不直接生成最终用户回复。
- 基础设施不主动调用子技能。
- 基础设施不覆盖 life-concierge 的唯一决策层地位。
- memory_store.json 必须保持可解析 JSON，且不得写入真实用户隐私字段。

OpenClaw 兼容约定：
- 本文件只描述 Agent 与 Skill 职责，不定义可执行配置。
- Skill 的实现入口、manifest 或运行参数仍以 skills 目录和 runtime 代码为准。
- Markdown 标题层级保持稳定，便于 OpenClaw 或外部工具按章节解析。
