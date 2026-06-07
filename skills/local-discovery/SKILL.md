---
name: local-discovery
description: Local discovery skill for places, recommendations and weather context.
version: 0.1.0
metadata:
  openclaw:
    requires:
      config:
        - MOCK_BACKEND_URL
---

# Local Discovery Skill

## 功能概述

local-discovery 是本地生活候选数据获取 Skill，属于执行层 Skill。

它只作为 `life-concierge` 的内部数据发现工具 Skill，为 `life-concierge` 获取候选地点、推荐候选和天气上下文。

用户的自然语言请求仍由 `life-concierge` 接收和决策。local-discovery 只返回结构化候选数据，不直接面向用户输出推荐结果，不负责最终行程决策、路线规划、排队查询或用户话术生成。

## 适用场景

`life-concierge` 可以调用 local-discovery：

- 盲盒路线生成前获取候选地点。
- 一站式路线规划获取景点、餐厅、活动候选。
- 多段式规划获取下一段候选。
- 根据天气调整室内外活动。
- 根据预算筛选候选。
- 根据用户偏好筛选候选。
- 根据 `category` / `budget` / `tags` 获取推荐候选。

## 输入输出约定

### 统一输入

Skill 接收统一事件格式：

```json
{
  "intent": "destinations",
  "params": {}
}
```

后续 `run.js` 需兼容：

- `event.params`。
- `event.input`。
- `event.raw_text`。
- 直接传入参数对象。

### 支持 Intent

#### 1. destinations

作用：

- 获取地点列表。

对应 Mock Backend：

- `GET /destinations`。

输入：

- `category`：可选。

补充说明：

- `category` 不传时，返回全部候选地点，主要供 `life-concierge` 进行候选筛选与路线编排。
- 无匹配结果时返回空数组，不视为错误。

无匹配结果输出：

```json
{
  "success": true,
  "intent": "destinations",
  "data": []
}
```

`category` 支持：

- 景点。
- 餐厅。
- 咖啡馆。
- 活动。
- 手作体验。
- 书店。
- 电影院。

输出：

- 地点列表。

地点字段包含：

- `name`。
- `category`。
- `address`。
- `lat`。
- `lng`。
- `rating`。
- `average_cost`。
- `tags`。
- `recommended_for`。
- `estimate_visit_minutes`。

#### 2. recommend

作用：

- 获取推荐候选。

对应 Mock Backend：

- `GET /recommend`。

输入：

- `category`：可选。
- `budget`：可选。
- `tags`：可选。

补充说明：

- `tags` 支持字符串或数组。
- 后续 `run.js` 需要把数组转换为 Mock Backend 接受的逗号分隔字符串。
- `recommend` 应尽量保留 Mock Backend 返回结果。
- local-discovery 不负责二次决策排序。
- 最终候选选择由 `life-concierge` 完成。
- 无匹配结果时返回空数组，不视为错误。

无匹配结果输出：

```json
{
  "success": true,
  "intent": "recommend",
  "data": []
}
```

输出：

- 推荐候选列表。

保留字段：

- `rating`。
- `average_cost`。
- `environment`。
- `service`。
- `tags`。
- `recommended_for`。

#### 3. weather

作用：

- 获取天气。

对应 Mock Backend：

- `GET /weather`。

输入：

- 无。

输出：

- `weather`。
- `temperature`。
- `warning`。

### 统一输出

成功：

```json
{
  "success": true,
  "intent": "...",
  "data": {}
}
```

失败：

```json
{
  "success": false,
  "intent": "...",
  "error": "明确错误信息"
}
```

## Mock Backend 依赖

默认地址：

```text
process.env.MOCK_BACKEND_URL || "http://localhost:8000"
```

后续 `run.js` 仅调用：

- `GET /destinations`。
- `GET /recommend`。
- `GET /weather`。

不新增其它接口。

## 使用示例

### 获取地点列表

```json
{
  "intent": "destinations",
  "params": {
    "category": "咖啡馆"
  }
}
```

### 获取推荐候选

```json
{
  "intent": "recommend",
  "params": {
    "category": "活动",
    "budget": 100,
    "tags": ["安静", "独处友好"]
  }
}
```

### 获取天气

```json
{
  "intent": "weather",
  "params": {}
}
```

## 职责边界

负责：

- 获取本地生活候选地点。
- 获取推荐候选。
- 获取天气信息。
- 返回结构化数据给 `life-concierge`。

不负责：

- 不接收用户最终请求。
- 不生成最终用户回复。
- 不做最终行程决策。
- 不决定去哪、吃什么、玩什么、顺序是什么。
- 不做路线规划。
- 不做 ETA 计算。
- 不做附近交通设施查询。
- 不做打车。
- 不做排队查询。
- 不触发 `HEARTBEAT`。
- 不更新 `MEMORY`。

## 调用关系

允许：

- `life-concierge` → local-discovery。
- local-discovery → Mock Backend。

禁止：

- 用户 → local-discovery。
- local-discovery → `route-planner`。
- local-discovery → `restaurant-queue`。
- local-discovery → `life-concierge`。

说明：

- 用户所有“去哪、玩什么、吃什么、怎么安排”的请求都应由 `life-concierge` 接收。
- local-discovery 只返回候选数据，不直接面向用户输出推荐结果。

## 后续实现备注

- 后续 `run.js` 仅调用 `GET /destinations`、`GET /recommend`、`GET /weather`。
- 后续 `run.js` 不新增其它接口。
- 后续 `run.js` 应兼容 `event.params`、`event.input`、`event.raw_text` 和直接传入参数对象。
- 后续 `run.js` 应将数组形式的 `tags` 转换为 Mock Backend 接受的逗号分隔字符串。
- local-discovery 应保持执行层定位，只提供候选数据与天气上下文。
