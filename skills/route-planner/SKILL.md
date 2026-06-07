---
name: route-planner
description: Route planning skill for route calculation, transportation suggestions and taxi ordering.
version: 0.1.0
metadata.openclaw:
  requires.config:
    - MOCK_BACKEND_URL
---

# Route Planner Skill

## 功能概述

route-planner 是路线规划工具 Skill，负责路线、距离、交通方式、ETA、附近交通设施和模拟叫车相关能力。

它既可以被用户直接调用，也可以被 `life-concierge` 调用。路线决策统一由 `life-concierge` 管理，route-planner 只提供路线与交通工具结果。

## 适用场景

用户可以直接触发 route-planner：

- 用户说“从这里到外滩怎么走”。
- 用户说“帮我看看打车要多久”。
- 用户说“附近有没有地铁站或共享单车”。
- 用户说“现在堵不堵，适合坐地铁还是打车”。
- 用户说“给我步行和骑行时间对比”。
- 用户说“帮我打车去这里”。
- 用户说“帮我叫辆车”。
- 用户说“司机还有多久到”。
- 用户说“帮我看看订单状态”。

`life-concierge` 可以调用 route-planner：

- 盲盒路线中的阶段路线计算。
- 一站式路线规划中的交通方案评估。
- 多段式路线规划中的下一段路线计算。
- 天气变化或交通拥堵时的替代路线评估。
- 用户需要从当前地点前往下一站时的模拟叫车。
- 用户询问司机到达时间或订单状态时的打车状态查询。

## 输入输出约定

### 通用输入

route-planner 接收统一事件对象：

```json
{
  "intent": "route",
  "params": {}
}
```

同时兼容：

- 直接传入 params。
- `event.params`。
- `event.input`。
- `event.raw_text`。

支持的 intent：

- `route`：查询两点路线。
- `nearby`：查询附近交通设施。
- `taxi`：模拟叫车。
- `taxi_status`：订单状态查询占位。

### route 输入

- `origin`：起点。
- `destination`：终点。
- `time`：出发时间，可选。

### route 输出

- `success`。
- `intent`。
- `distance`。
- `walk_duration`。
- `bike_duration`。
- `subway_duration`。
- `taxi_duration`。
- `congestion_level`。

### nearby 输入

- `lat`：纬度。
- `lng`：经度。

### nearby 输出

- `success`。
- `intent`。
- `地铁站`。
- `公交站`。
- `共享单车`。

### taxi 输入

- `origin`：起点。
- `destination`：终点。
- `vehicle_type`：车型，可选，默认 `comfort`。

### taxi 输出

- `success`。
- `intent`。
- `order_id`。
- `driver_name`。
- `vehicle`。
- `eta`。
- `status`。

### taxi_status 输入

- `order_id`：订单号。

### taxi_status 输出

- `success`。
- `intent`。
- `order_id`。
- `status`。
- `message`。

当前 Mock Backend 尚未提供独立订单状态查询接口，因此 `taxi_status` 返回 `not_implemented` 占位响应。

### 失败输出

失败时统一返回：

```json
{
  "success": false,
  "error": "明确错误信息"
}
```

当 Mock Backend 返回额外错误信息时，可包含 `details` 字段。

## Mock Backend 依赖

默认地址：

```text
process.env.MOCK_BACKEND_URL || "http://localhost:8000"
```

依赖接口：

- `GET /route`：获取两地间距离、步行耗时、骑行耗时、地铁耗时、打车耗时与拥堵等级。
- `GET /nearby`：获取附近地铁站、公交站和共享单车信息。
- `POST /order_taxi`：模拟叫车，返回订单状态、司机、车辆和预计到达时间。

本阶段不修改 backend，不接入高德 API，不接入真实打车平台。

## 使用示例

### 查询路线

```json
{
  "intent": "route",
  "params": {
    "origin": "人民广场",
    "destination": "外滩",
    "time": "18:30"
  }
}
```

### 查询附近交通设施

```json
{
  "intent": "nearby",
  "params": {
    "lat": 31.2304,
    "lng": 121.4737
  }
}
```

### 模拟叫车

```json
{
  "intent": "taxi",
  "params": {
    "origin": "人民广场",
    "destination": "外滩",
    "vehicle_type": "comfort"
  }
}
```

### 查询订单状态占位

```json
{
  "intent": "taxi_status",
  "params": {
    "order_id": "TX123"
  }
}
```

## 职责边界

负责：

- 路线计算。
- 距离计算。
- 步行方案。
- 骑行方案。
- 公交方案。
- 地铁方案。
- 打车方案。
- ETA 估算。
- 附近交通设施查询。
- 模拟叫车。
- 订单状态查询（占位）。

不负责：

- 景点推荐。
- 餐厅推荐。
- 行程规划。
- 主动提醒。
- 用户偏好决策。

说明：

- 主动提醒统一由 `HEARTBEAT.md` 管理。
- 路线决策统一由 `life-concierge` 管理。
- route-planner 不反向调用 `life-concierge` 或 `restaurant-queue`。

## 后续实现备注

- 后续可将 `MOCK_BACKEND_URL` 写入统一配置。
- 后续可接入高德地图 API。
- 后续可补充真实订单状态查询接口。
- 后续可与 `life-concierge` 联动。
