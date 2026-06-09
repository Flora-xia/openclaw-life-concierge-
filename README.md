# openclaw-life-concierge

基于 OpenClaw 构建的本地生活全天候陪伴式私人管家 Agent，通过长期记忆与 Heartbeat 主动协同机制整合本地生活服务，缓解 App 孤岛问题;同时在动态模拟沙盒中引入随机性与灵感探索机制，在符合用户偏好的前提下创造盲盒式惊喜体验，缓解选择疲劳;结合一站式、多段式路线规划及餐厅排队监控，让 AI 从被动工具进化为能够长期陪伴与持续协同的生活伙伴

项目采用 Agent 分层架构：

life-concierge：决策层，负责理解用户需求、规划行动和生成最终回复。
local-discovery：地点发现与推荐。
route-planner：路线规划与出行方案。
restaurant-queue：餐厅排队监控与出发建议。

完成 Memory、Heartbeat、Skill、Runtime、Mock Backend 与 Web Chat 的整体闭环，实现了一个具备长期陪伴能力、主动协同能力和本地生活服务整合能力的 Agent 原型。


# 演示示例

## 1. 用户请求推荐安静咖啡馆
<img width="680" height="362" alt="06409bc827abb7e9cd7ed9f5eca34fd9" src="https://github.com/user-attachments/assets/a8125d06-8af4-4404-ba60-e92d020c7a9f" />

## 2. 查看路线和出行方案
<img width="684" height="376" alt="aa55f22cbb4b19cf93e6cc68c74c4291" src="https://github.com/user-attachments/assets/9fd21024-3c3c-48eb-8346-1401b844370f" />

## 3. 多段式动态行程规划
<img width="667" height="518" alt="ef85692f12d174222e3b96b6f9069ef1" src="https://github.com/user-attachments/assets/0b71c565-63dc-488a-8e1e-3b1d4c92a9bf" />

## 4. 长期记忆与上下文承接
<img width="644" height="469" alt="cc55a8d099e7d8e2ddfddde51a95029d" src="https://github.com/user-attachments/assets/572e5b3b-9f65-448e-b1cb-1156ce93ad5a" />




## 1. 项目概述

### 1.1 项目名称

OpenClaw Life Concierge - 本地生活全天候陪伴式私人管家 Agent

### 1.2 项目定位

本项目是一个基于 OpenClaw 构建的本地生活全天候陪伴式私人管家 Agent。它面向日常生活中的找地方、路线规划、餐厅排队、盲盒出行、长期陪伴和主动问候等场景，通过 Agent / Skill 架构、长期记忆机制与 Heartbeat 主动协同机制，把分散的本地生活服务整合到一个连续对话入口中。

项目目标不是构建一个单次问答机器人，而是构建一个能够理解用户长期偏好、承接多轮上下文、在合适时机主动提醒，并能持续协同本地生活任务的生活伙伴型 Agent。

## 1.3 项目亮点

- Agent 架构：`life-concierge` 作为决策层，协调各执行 Skill。
- 长期记忆（Memory）：支持偏好、关系、行程和会话状态管理。
- Heartbeat：低频主动协同机制，支持 Scheduled/Conditional/Trip/Inactivity 触发。
- 本地生活整合：地点推荐、路线规划、餐厅排队、mock 打车。
- 盲盒式体验：随机灵感探索，满足偏好同时带来新鲜感。
- 陪伴式交互：温柔、克制、有边界的主动问候。

### 1.4 解决的问题

- 本地生活服务分散在不同 App 中，用户需要反复切换、搜索、比较和决策。
- 吃饭、出行、排队、天气、交通、预算等信息分散，容易造成选择疲劳。
- 普通聊天机器人通常只响应当前输入，缺少长期记忆和行程状态承接。
- 用户临时说“就这个”“怎么去”“帮我打车”“排队多久”时，传统工具往往无法理解前文上下文。
- 主动提醒系统容易变成打扰式通知，缺少边界、冷却和用户偏好控制。

### 1.5 核心价值

- 以 `life-concierge` 作为唯一决策层 Agent，统一理解用户需求并编排执行层 Skill。
- 通过 `memory_store.json` 保存长期偏好、关系边界、行程状态、Heartbeat 状态和会话上下文。
- 通过 Heartbeat 机制实现低频、温和、可冷却的主动协同。
- 通过本地生活地点、路线、排队、mock 打车能力，形成从推荐到行动的闭环。
- 通过偏好范围内的随机探索，为用户提供盲盒式惊喜体验，降低选择负担。
- 通过 Web Chat 提供可直接演示的本地交互界面，适合比赛评审和 GitHub 展示。

### 1.6 适用场景

- 找附近安静地点、咖啡馆、餐厅、图书馆、学习空间或景点。
- 不知道去哪时，让 Agent 给出盲盒式本地生活安排。
- 推荐地点后继续规划路线、比较交通方式或生成 mock 打车结果。
- 查询餐厅排队情况、等待时间和出发建议。
- 行程中根据当前状态继续规划下一段。
- 用户长时间未互动、行程中断或排队等待时，触发温和主动问候。


## 2. 系统架构

### 2.1 总体架构

```text
用户 / Web Chat
  ↓
connectors/web_chat.js
  ↓
runtime/life_concierge_runtime.js
  ├── runtime/memory_runtime.js
  ├── runtime/heartbeat_runtime.js
  ├── runtime/prompt_builder.js
  ├── runtime/llm_runtime.js
  ├── skills/local-discovery/run.js
  ├── skills/route-planner/run.js
  └── skills/restaurant-queue/run.js
        ↓
backend/places.json / backend/memory_store.json
        ↓
backend/mock_server.py（可选模拟后端）
```

### 2.2 分层说明

#### 文档层

位于 `workspace/` 和 `skills/*/SKILL.md`，用于定义人格、用户画像、记忆规则、主动触发规则、Agent / Skill 职责边界。

#### 配置层

`openclaw.json` 是项目 OpenClaw 配置入口，定义 workspace、Skill 加载目录、Skill entry、环境变量和 runtime memory path。

#### Runtime 运行层

`runtime/` 目录包含主 Agent runtime、记忆 runtime、Heartbeat runtime、Prompt Builder 和 LLM runtime。

#### Memory 记忆层

`backend/memory_store.json` 是实际运行状态文件。`memory_runtime.js` 负责加载、规范化、写入、裁剪和隐私字段拦截。

#### Mock Backend 数据层

`backend/mock_server.py` 提供 FastAPI mock 接口，`backend/places.json` 提供本地生活数据。

#### Web Chat 前端交互层

`connectors/web_chat.js` 提供 HTTP 服务，`connectors/index.html` 提供聊天界面和结构化卡片展示。

#### LLM 调用层

`runtime/llm_runtime.js` 适配 DeepSeek Chat API。没有 API Key 时，规则链路仍能运行。

#### Agent / Skill 协作层

`life-concierge` 负责理解用户、调用 Skill、整合结果和生成最终回复。执行层 Skill 只返回结构化结果，不做最终用户决策。

## 3. 文件结构说明

```text
├── openclaw.json
├── backend
│   ├── memory_store.json
│   ├── mock_server.py
│   ├── places.json
│   └── requirements.txt
├── connectors
│   ├── index.html
│   └── web_chat.js
├── runtime
│   ├── heartbeat_runtime.js
│   ├── life_concierge_runtime.js
│   ├── llm_runtime.js
│   ├── memory_runtime.js
│   └── prompt_builder.js
├── skills
│   ├── life-concierge
│   │   └── SKILL.md
│   ├── local-discovery
│   │   ├── SKILL.md
│   │   └── run.js
│   ├── restaurant-queue
│   │   ├── SKILL.md
│   │   └── run.js
│   └── route-planner
│       ├── SKILL.md
│       └── run.js
└── workspace
    ├── AGENTS.md
    ├── HEARTBEAT.md
    ├── MEMORY.md
    ├── SOUL.md
    └── USER.md
```

说明：项目中还存在 `.venv`、`__pycache__` 等本地环境或缓存目录.


## 4. 核心模块

### Life Concierge
项目主 Agent，负责理解用户需求、编排 Skill、维护上下文状态并生成最终回复。

### Memory
负责长期偏好、关系状态、行程状态和会话状态管理，为个性化推荐与主动陪伴提供支撑。

### Heartbeat
负责 Scheduled、Inactivity、Trip、Companion 四类主动触发，并通过 Trigger Handoff 将上下文交给 life-concierge。

### Local Discovery
负责地点发现、候选推荐与天气上下文获取。

### Route Planner
负责路线规划、附近交通查询和打车方案生成。

### Restaurant Queue
负责餐厅排队监控、等待时间估算和出发建议。

### Mock Backend
提供天气、路线、排队、地点推荐等本地模拟服务，用于开发与测试阶段验证。

## 5. 记忆系统

记忆系统由 MEMORY.md 定义规则，由 memory_store.json 保存状态，由 memory_runtime.js 负责管理。

包含：

- long_term_memory（长期偏好）
- relationship_memory（关系记忆）
- trip_state（行程状态）
- heartbeat_state（主动触发状态）
- memory_evolution（成长记录）
- conversation_state（会话状态）

用于支撑个性化推荐、行程承接、主动触发与长期陪伴。

## 6. Heartbeat 主动协同机制

Heartbeat 负责判断是否应主动触发，而不是直接生成最终回复。
支持：
- Scheduled Trigger
- Inactivity Trigger
- Trip Trigger
- Companion Trigger
通过 Cooldown 与 Trigger Handoff 机制避免过度打扰用户，并将上下文交给 life-concierge 完成最终决策。

## 7. 本地生活与路线规划能力

系统支持：
- 地点发现与推荐
- 天气感知
- 路线规划
- 餐厅排队监控
- Mock 打车服务
通过 life-concierge 协调 local-discovery、route-planner 和 restaurant-queue，实现推荐、路线、排队与出行的一体化体验。

### 一站式路线规划  
用户请求推荐地点后，life-concierge 协调 local-discovery 获取候选，再调用 route-planner 提供路线和打车方案，实现完整一日游或多地点规划。

### 多段式路线动态规划  
根据剩余行程时间、位置和用户偏好，自动生成下一段路线，支持用户连续承接操作（规划路线、打车、排队查询）。

### 餐厅排队监控 
restaurant-queue 提供排队人数、状态、建议出发时间和提示，支持 life-concierge 做出行动决策。

### 盲盒式探索体验

系统会在符合用户偏好、预算、时间和场景需求的候选池中进行筛选，并通过适度随机化机制提供具有新鲜感的推荐结果。
与完全随机不同，盲盒模式会综合考虑长期偏好、饮食禁忌、地点标签、排队情况、距离和营业状态，在保证匹配度的前提下创造探索体验，从而缓解选择疲劳。 随机性与灵感探索机制

### 信息整合  
整合天气、交通、餐厅、景点、活动信息，实现一站式出行与生活服务：
  - 天气：local-discovery / mock_server 提供天气信息
  - 交通：route-planner 提供步行、骑行、公共交通及打车方案
  - 餐厅/景点/活动：places.json 提供基础候选信息，供 Skill 调用


## 8. 当前完成度与局限

### 8.1 已实现内容

- OpenClaw 项目配置。
- Agent / Skill 文档体系。
- 主 Agent runtime。
- 长期记忆、关系记忆、行程状态、Heartbeat 状态和会话状态读写。
- Web Chat 本地交互页面。
- 地点推荐、路线规划、mock 打车、餐厅排队。
- DeepSeek 可选 LLM fallback。
- Heartbeat scheduled / conditional / cooldown / handoff。

### 8.2 仍在完善内容

- 完整一日游、多地点、多阶段时间表。
- 真正“到达后再揭晓”的分阶段盲盒体验。
- Companion Trigger 的独立识别和调度。
- 真实地图、天气、餐厅排队、打车 API 接入。
- 记忆摘要压缩与长期偏好权重演化。
- Web Chat 中自动启动 Heartbeat loop 或后台定时调度。

### 8.3 后续扩展方向

- 接入真实 POI、地图、天气、交通、排队和打车平台。
- 增加后台 scheduler，使 Heartbeat 真正长期运行。
- 引入向量记忆、摘要记忆和偏好权重。
- 完善多阶段盲盒路线。
- 增加多用户 profile 与 session 隔离。
- 增加单元测试、集成测试和 CI。
- 统一 mock backend 与 JS Skill 的数据访问方式。


  
  

