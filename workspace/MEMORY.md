# MEMORY

## 用途

本文件定义私人管家记忆体系的核心规则和字段骨架，用于未来 `life-concierge`、LLM 与 `memory_store` 进行记忆映射、决策参考和话术生成。


状态标注：

- `待后续开发`：字段仅为规则占位。
- `待后续开发 / dynamic`：未来需要由运行时、LLM 或 `memory_store` 动态写入、修改、检索或更新。

## 记忆设计原则

- 只记录对陪伴、规划、偏好理解和关系成长有帮助的信息。
- 用户明确表达、主动纠正、拒绝或授权优先于系统推断。
- 用户始终拥有最终决定权，记忆服务用户，不控制用户。
- 单次行为只作为参考，不直接覆盖长期偏好。
- 高频、稳定、重复出现的行为可逐步增强偏好权重。
- 敏感信息、禁忌话题、情绪状态只在用户明确表达或授权时记录。
- 重大偏好变化、关系节点变化、长期兴趣变化应进入 `memory_evolution`。
- 示例内容不得被当作真实用户偏好写入。

## 记忆更新规则

- 明确表达优先：用户直接说明喜欢、不喜欢、不要提醒、以后改成某种方式时，优先更新对应记忆。
- 主动纠正优先：用户纠正 AI 的记忆、建议、称呼或提醒方式时，覆盖旧判断。
- 近期高于久远：同类偏好冲突时，优先采用更近期、更明确的信息。
- 稳定高于偶然：长期稳定偏好优先于一次性行为。
- 当前状态优先当前决策：`trip_state` 可临时影响当次行程，但不能永久改写 `long_term_memory`。
- 拒绝优先触发：用户拒绝提醒或关闭主动联系时，优先影响 `relationship_memory` 与 `heartbeat_state`。
- 重大变化留痕：偏好、关系、兴趣、行程体验发生明显变化时，可同步写入 `memory_evolution.growth_events`。
- 无法判断时不擅自更新，由 `life-concierge` 使用邀请式表达向用户确认。

## 记忆冲突处理

- `long_term_memory` 冲突：用户明确新偏好覆盖旧偏好；行为变化先调整权重，不立即覆盖。
- `relationship_memory` 冲突：最新边界、拒绝、提醒偏好和陪伴偏好优先于历史互动。
- `trip_state` 冲突：当前行程状态优先服务当次决策，但不自动写入长期偏好。
- `heartbeat_state` 冲突：cooldown 和用户拒绝优先于所有主动触发。
- `memory_evolution` 冲突：只记录历史变化，不直接作为当前偏好覆盖值。
- 跨模块冲突：由 `life-concierge` 按用户意愿、当前场景、安全性、时间和预算综合判断。

## 模块间关系

- `long_term_memory`：提供稳定偏好，影响候选筛选、预算、路线风格和活动推荐。
- `relationship_memory`：提供互动边界，影响提醒频率、陪伴方式、语气和 cooldown。
- `trip_state`：提供当前行程的最小延续状态，支持多段式规划。
- `heartbeat_state`：提供主动触发上下文，只判断是否触发并交接给 `life-concierge`。
- `memory_evolution`：提供长期变化轨迹，记录重要偏好变化、关系节点和高价值经历。
- `life-concierge`：读取各模块进行决策、编排 Skill 和生成符合 `SOUL.md` 的邀请式表达。

## long_term_memory

### 用途

记录用户长期偏好、兴趣标签和稳定行为习惯，用于个性化推荐、路线优化和长期陪伴一致性。

### 核心字段

- `food_preference`：待后续开发 / dynamic
- `travel_preference`：待后续开发 / dynamic
- `budget_preference`：待后续开发 / dynamic
- `activity_preference`：待后续开发 / dynamic
- `time_preference`：待后续开发 / dynamic
- `area_preference`：待后续开发 / dynamic
- `interest_tags`：待后续开发 / dynamic
- `behavior_summary`：待后续开发 / dynamic

### 更新规则

- 用户明确表达新偏好时，更新对应字段。
- 用户明确表达不喜欢、不要推荐、不想继续某类活动时，降低或移除相关偏好。
- 多次重复选择同类地点、活动或预算区间时，可增强对应 `interest_tags`。
- 单次行为只作为参考，不直接覆盖长期偏好。
- 当前行程选择只影响 `trip_state`，除非用户明确说明这是长期偏好。
- 明显兴趣变化可同步记录到 `memory_evolution.growth_events`。

### 冲突处理

- 明确表达的新偏好优先于历史推断。
- 长期稳定偏好优先于偶然行为。
- 临时行程需求不覆盖长期偏好。
- 无法判断长期变化时，由 `life-concierge` 向用户确认。

### 依赖关系

- 影响 `trip_state` 的候选地点、路线节奏、预算和活动选择。
- 影响 `heartbeat_state` 的主动建议方向。
- 重大变化写入 `memory_evolution.growth_events`。

## relationship_memory

### 用途

记录用户与 AI 的互动关系、信任变化、提醒偏好、陪伴边界和沟通风格，用于更有分寸感的长期陪伴。

### 核心字段

- `trust_level`：待后续开发 / dynamic
- `reminder_preference`：待后续开发 / dynamic
- `communication_style`：待后续开发 / dynamic
- `companionship_preference`：待后续开发 / dynamic
- `taboo_topics`：待后续开发 / dynamic
- `last_interaction_at`：待后续开发 / dynamic
- `feedback_history`：待后续开发 / dynamic

### 更新规则

- 用户拒绝提醒、要求减少打扰或关闭主动联系时，更新 `reminder_preference`。
- 用户频繁忽略同类提醒时，降低该类提醒频率。
- 用户接受某种陪伴方式或表达喜欢某种沟通方式时，更新 `companionship_preference` 或 `communication_style`。
- 称呼、幽默、沟通节奏统一归入 `communication_style`。
- 提醒相关偏好统一归入 `reminder_preference`。
- 陪伴相关偏好统一归入 `companionship_preference`。
- 信任相关变化统一归入 `trust_level`。
- 重要关系变化可同步记录到 `memory_evolution.growth_events`。

### 冲突处理

- 最新边界声明优先于历史接受记录。
- 用户明确禁忌话题、提醒偏好、陪伴偏好优先于 AI 推断。
- 短期情绪不永久覆盖长期陪伴偏好。
- 与主动触发冲突时，拒绝与 cooldown 优先。

### 依赖关系

- 影响 `heartbeat_state` 的触发频率、cooldown 和提醒强度。
- 影响 `life-concierge` 的话术、语气和陪伴方式。
- 与 `long_term_memory` 共同影响推荐表达的主动程度。
- 重要变化写入 `memory_evolution.growth_events`。

## trip_state

### 用途

记录当前行程需要延续的最小状态，用于多段式路线规划和当次行程决策。

天气来自 `local-discovery`，路线来自 `route-planner`，排队来自 `restaurant-queue`；这些执行层实时结果不长期写入 MEMORY。

### 核心字段

- `current_location`：待后续开发 / dynamic
- `completed_places`：待后续开发 / dynamic
- `next_destination`：待后续开发 / dynamic
- `budget_remaining`：待后续开发 / dynamic
- `activity_state`：待后续开发 / dynamic
- `user_feedback`：待后续开发 / dynamic

### 更新规则

- 用户到达、完成、取消或更换地点时，更新 `current_location`、`completed_places` 或 `next_destination`。
- 用户调整预算时，更新 `budget_remaining`。
- 用户改变活动状态、暂停、继续或结束行程时，更新 `activity_state`。
- 用户表达不喜欢当前地点或不想继续同类型活动时，更新 `user_feedback` 并影响下一段候选方向。
- 行程结束后，高价值反馈可沉淀到 `long_term_memory` 或 `memory_evolution.growth_events`。
- 未经确认的临时选择不得写入长期偏好。

### 冲突处理

- 当前行程状态优先服务当次决策。
- 用户最新选择优先于原计划。
- 执行层结果冲突时，由 `life-concierge` 综合时间、预算、距离、用户反馈和用户意愿判断。
- 临时行程需求不自动覆盖 `long_term_memory`。

### 依赖关系

- 读取 `long_term_memory` 优化候选地点、预算和路线风格。
- 读取 `relationship_memory` 调整提醒表达和陪伴强度。
- 向 `heartbeat_state` 提供 Trip Trigger 所需的最小上下文。
- 高价值行程经历写入 `memory_evolution.growth_events`。

## heartbeat_state

### 用途

记录 HEARTBEAT 触发历史、cooldown 和提醒上下文，用于判断是否将触发上下文交给 `life-concierge`。

### 核心字段

- `last_trigger_time`：待后续开发 / dynamic
- `trigger_type`：待后续开发 / dynamic
- `cooldown_until`：待后续开发 / dynamic
- `reminder_context`：待后续开发 / dynamic

### 更新规则

- 用户拒绝提醒后进入 cooldown，期间不重复触发相同提醒。
- 用户明确关闭主动联系后，停止相关主动问候。
- HEARTBEAT 只判断触发条件，不生成最终用户话术。
- 触发上下文必须交给 `life-concierge`。
- HEARTBEAT 不直接调用 `local-discovery`、`route-planner`、`restaurant-queue`，不直接访问 Mock Backend。
- 触发后是否提醒、是否调用执行层 Skill、如何表达，由 `life-concierge` 决定。

### 冲突处理

- cooldown 优先于所有主动触发。
- 用户拒绝优先于历史接受记录。
- `relationship_memory.reminder_preference` 表示低频提醒时，应降低触发频率。
- 高价值行程提醒仍需交给 `life-concierge` 判断，不由 HEARTBEAT 直接决定。

### 依赖关系

- 依赖 `relationship_memory.reminder_preference`、`feedback_history` 和 `communication_style`。
- 依赖 `trip_state` 的最小行程上下文。
- 可参考 `long_term_memory.time_preference` 和 `activity_preference`。
- 重要主动陪伴节点写入 `memory_evolution.growth_events`。

## memory_evolution

### 用途

记录用户偏好、行为、兴趣、关系和重要经历的长期变化轨迹，不直接覆盖当前偏好。

### 核心字段

- `growth_events`：待后续开发 / dynamic
  - `event_id`：待后续开发 / dynamic
  - `timestamp`：待后续开发 / dynamic
  - `type`：待后续开发 / dynamic
  - `description`：待后续开发 / dynamic
  - `source_module`：待后续开发 / dynamic

### 更新规则

- 只记录重要变化、关键节点和高价值共同经历。
- 普通、一次性、低价值日常事件不进入该模块。
- `long_term_memory` 出现重大偏好变化时，可写入 `growth_events`。
- `relationship_memory` 出现信任、边界或陪伴模式重要变化时，可写入 `growth_events`。
- `trip_state` 出现高价值体验、首次完成或重要反馈时，可写入 `growth_events`。
- `heartbeat_state` 出现重要陪伴触发、接受或拒绝节点时，可写入 `growth_events`。

### 冲突处理

- `memory_evolution` 不覆盖当前偏好，只保留历史脉络。
- 当前决策优先读取 `long_term_memory`、`relationship_memory` 和 `trip_state` 的最新状态。
- 无法判断节点是否重要时，不自动写入，由 `life-concierge` 邀请用户确认。

### 依赖关系

- 接收 `long_term_memory` 的重大偏好变化。
- 接收 `relationship_memory` 的重要关系变化。
- 接收 `trip_state` 的高价值行程经历。
- 接收 `heartbeat_state` 的重要主动陪伴节点。

## 运行时使用约定

- LLM 读取本文件时，应优先读取模块用途、核心字段、更新规则和冲突处理。
- `memory_store` 映射字段时，应优先识别标注为 `待后续开发 / dynamic` 的字段。
- `life-concierge` 可读取记忆进行推荐、行程编排、主动提醒判断和邀请式话术生成。
- 本文件不允许写入真实用户数据，不作为运行时状态文件。
- 所有主动行为仍需遵循 `SOUL.md` 的邀请式表达与用户最终决定权原则。

## 文档级测试示例

### 示例 1：长期偏好更新

- 用户输入：“我以后不太想吃辣了。”
- 预期影响模块：`long_term_memory`
- 预期字段：`food_preference`
- 应用规则：明确表达优先、主动纠正优先。
- 不应写入：`trip_state`
- 备注：如果被判断为重大长期变化，可写入 `memory_evolution.growth_events`。

### 示例 2：主动提醒冷却

- 用户输入：“最近先别主动提醒我吃饭。”
- 预期影响模块：`relationship_memory`、`heartbeat_state`
- 预期字段：`reminder_preference`、`cooldown_until`、`trigger_type` 或 `reminder_context`
- 应用规则：用户拒绝优先、cooldown 优先。
- 备注：HEARTBEAT 不生成最终话术，应交给 `life-concierge` 用邀请式表达确认。
