---
name: restaurant-queue
description: Restaurant queue monitoring skill for queue status, waiting time, turn estimation and departure advice.
version: 0.1.0
metadata.openclaw:
  requires.config:
    - MOCK_BACKEND_URL
---

# Restaurant Queue Skill

## 功能概述

restaurant-queue 是餐厅排队监控工具 Skill，负责围绕具体餐厅查询和跟踪排队人数、预计等待时间、取号状态、排队状态、排队状态变化、预计轮到时间、最佳出发时间、到店提醒依据和排队提醒依据。

它既可以被用户直接调用，也可以被 `life-concierge` 调用。restaurant-queue 只提供排队相关状态与判断依据，不生成最终面向用户的温柔陪伴话术。

最终主动提醒话术由 `life-concierge` 根据 `SOUL.md` 生成。排队提醒之后如需打车，由 `life-concierge` 调用 `route-planner`。

## 适用场景

用户可以直接触发 restaurant-queue：

- 用户说“帮我看看这家餐厅排多久”。
- 用户说“现在前面还有多少人”。
- 用户说“快轮到我了吗”。
- 用户说“等位时间太久了吗”。
- 用户说“帮我盯一下排队情况”。
- 用户说“我什么时候出发比较合适”。
- 用户说“预计几点能吃上饭”。
- 用户说“帮我盯一下排队进度”。

`life-concierge` 可以调用 restaurant-queue：

- 一站式路线规划中的餐厅排队评估。
- 多段式路线规划中的用餐阶段状态判断。
- 餐厅排队即将结束时提供提醒依据。
- 餐厅等待过久时为 `life-concierge` 提供备选决策依据。
- 到店提醒的判断依据。

主动协同能力：

- restaurant-queue 不直接承担主动陪伴职责。
- restaurant-queue 可为“餐厅排队即将结束提醒”和“到店提醒”提供判断依据。
- 相关主动表达与最终行程决策仍由 `life-concierge` 负责。

## 输入输出约定

### 通用输入

restaurant-queue 接收统一事件对象：

```json
{
  "intent": "queue",
  "params": {}
}
```

同时兼容：

- 直接传入 params。
- `event.params`。
- `event.input`。
- `event.raw_text`。

支持的 intent：

- `queue`：查询餐厅基础排队信息。
- `queue_status`：查询排队信息并生成排队状态。
- `departure_advice`：生成预计轮到时间与最佳出发时间。
- `reminder_hint`：生成排队提醒依据。

### queue 输入

- `restaurant_name`：餐厅名称。

### queue 输出

- `success`。
- `intent`。
- `data.restaurant_name`。
- `data.queue_people`。
- `data.wait_minutes`。

### queue_status 输入

- `restaurant_name`：餐厅名称。

### queue_status 输出

- `success`。
- `intent`。
- `data.restaurant_name`。
- `data.queue_people`。
- `data.wait_minutes`。
- `data.queue_status`。

queue_status 判断规则：

- `wait_minutes <= 15`：`short`。
- `15 < wait_minutes <= 45`：`medium`。
- `wait_minutes > 45`：`long`。

### departure_advice 输入

- `restaurant_name`：餐厅名称。
- `current_time`：当前时间，可选。
- `travel_minutes`：用户预计到店交通耗时，可选。
- `departure_buffer_minutes`：出发缓冲时间，可选。

### departure_advice 输出

- `success`。
- `intent`。
- `data.restaurant_name`。
- `data.queue_people`。
- `data.wait_minutes`。
- `data.queue_status`。
- `data.estimated_turn_time`。
- `data.recommended_departure_time`。
- `data.needs_transport_check`。
- `data.suggestion_key`。
- `data.hint`。

### reminder_hint 输入

- `restaurant_name`：餐厅名称。

### reminder_hint 输出

- `success`。
- `intent`。
- `data.restaurant_name`。
- `data.queue_people`。
- `data.wait_minutes`。
- `data.queue_status`。
- `data.needs_transport_check`。
- `data.suggestion_key`。
- `data.hint`。

### 失败输出

失败时统一返回：

```json
{
  "success": false,
  "intent": "queue",
  "error": "明确错误信息"
}
```

## Mock Backend 依赖

默认地址：

```text
process.env.MOCK_BACKEND_URL || "http://localhost:8000"
```

依赖接口：

- `GET /queue`：根据餐厅名称查询当前排队人数和预计等待时间。

本阶段不修改 backend，不接入真实 API，不调用 `route-planner` 或 `life-concierge`。

## 使用示例

### 查询基础排队

```json
{
  "intent": "queue",
  "params": {
    "restaurant_name": "禾木家常菜"
  }
}
```

### 查询排队状态

```json
{
  "intent": "queue_status",
  "params": {
    "restaurant_name": "禾木家常菜"
  }
}
```

### 获取出发建议依据

```json
{
  "intent": "departure_advice",
  "params": {
    "restaurant_name": "禾木家常菜",
    "current_time": "18:00",
    "travel_minutes": 20
  }
}
```

### 获取提醒依据

```json
{
  "intent": "reminder_hint",
  "params": {
    "restaurant_name": "禾木家常菜"
  }
}
```

## 职责边界

负责：

- 查询排队人数。
- 预计等待时间。
- 取号状态。
- 排队状态。
- 排队状态变化监控。
- 排队结束预测。
- 预计轮到时间。
- 最佳出发时间。
- 到店提醒依据生成。
- 排队提醒依据生成。

不负责：

- 餐厅推荐。
- 路线规划。
- 打车。
- 行程规划。
- 主动陪伴。
- 最终用户话术。
- 用户偏好决策。

说明：

- restaurant-queue 返回 `hint`、`suggestion_key`、`needs_transport_check` 等提醒依据。
- restaurant-queue 不生成最终面向用户的温柔陪伴话术。
- 最终话术由 `life-concierge` 根据 `SOUL.md` 生成。
- 排队提醒之后如需打车，由 `life-concierge` 调用 `route-planner`。
- restaurant-queue 不反向调用 `life-concierge` 或 `route-planner`。

禁止调用关系：

- `restaurant-queue` → `route-planner`。
- `restaurant-queue` → `life-concierge`。

## 后续实现备注

- 后续实现应只承担餐厅排队监控职责，不做餐厅推荐或路线规划。
- 后续实现应将排队状态返回给用户或 `life-concierge`。
- 后续实现应避免越权触发行程决策或主动陪伴。
- 后续实现可提供预计轮到时间、最佳出发时间和排队结束预测，作为上游提醒依据。
- 后续实现不得反向调用 `life-concierge` 或 `route-planner`。
