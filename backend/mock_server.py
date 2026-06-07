from __future__ import annotations

import hashlib
import json
import math
import random
from datetime import datetime
from pathlib import Path
from typing import Any

from fastapi import FastAPI, Query, Request
from fastapi.responses import JSONResponse


app = FastAPI(title="OpenClaw Mock Backend", version="0.1.0")

BASE_DIR = Path(__file__).resolve().parent
PLACES_PATH = BASE_DIR / "places.json"
QUEUE_STATE: dict[str, int] = {}


def load_places() -> list[dict[str, Any]]:
    with PLACES_PATH.open("r", encoding="utf-8") as file:
        data = json.load(file)
    if isinstance(data, list):
        return data
    return data.get("places", [])


PLACES = load_places()


def stable_int(*parts: object, modulo: int = 1000) -> int:
    key = "|".join(str(part).strip().lower() for part in parts)
    digest = hashlib.sha256(key.encode("utf-8")).hexdigest()
    return int(digest[:12], 16) % modulo


def parse_hour(time_value: str | None) -> int:
    if not time_value:
        return datetime.now().hour

    clean_value = time_value.strip()
    try:
        return datetime.fromisoformat(clean_value).hour
    except ValueError:
        pass

    for fmt in ("%H:%M", "%H:%M:%S", "%Y-%m-%d %H:%M", "%Y-%m-%d %H:%M:%S"):
        try:
            return datetime.strptime(clean_value, fmt).hour
        except ValueError:
            continue

    return datetime.now().hour


def congestion_multiplier(hour: int) -> float:
    if 7 <= hour <= 9:
        return 1.35
    if 17 <= hour <= 19:
        return 1.5
    if 12 <= hour <= 13:
        return 1.15
    return 1.0


def congestion_label(score: float) -> str:
    if score >= 1.7:
        return "severe"
    if score >= 1.45:
        return "high"
    if score >= 1.2:
        return "medium"
    return "low"


def split_tags(tags: str | None) -> list[str]:
    if not tags:
        return []
    return [tag.strip().lower() for tag in tags.replace("，", ",").split(",") if tag.strip()]


def searchable_terms(place: dict[str, Any]) -> set[str]:
    terms = set()
    for key in ("tags", "recommended_for"):
        for value in place.get(key, []):
            terms.add(str(value).strip().lower())
    terms.add(str(place.get("category", "")).strip().lower())
    terms.add(str(place.get("name", "")).strip().lower())
    return terms


def offset_coordinate(lat: float, lng: float, distance_m: int, angle_deg: float) -> tuple[float, float]:
    angle = math.radians(angle_deg)
    delta_lat = math.cos(angle) * distance_m / 111_000
    delta_lng = math.sin(angle) * distance_m / (111_000 * math.cos(math.radians(lat)))
    return round(lat + delta_lat, 6), round(lng + delta_lng, 6)


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/weather")
def weather() -> dict[str, Any]:
    weather_options = [
        ("sunny", 27, ""),
        ("cloudy", 24, ""),
        ("light_rain", 21, "建议携带雨伞"),
        ("windy", 22, "户外活动注意防风"),
        ("hot", 33, "注意防晒和补水"),
        ("overcast", 23, ""),
    ]
    weather_name, base_temperature, warning = random.choice(weather_options)
    return {
        "weather": weather_name,
        "temperature": base_temperature + random.randint(-2, 2),
        "warning": warning,
    }


@app.get("/route")
def route(origin: str, destination: str, time: str | None = None) -> dict[str, Any]:
    pair_key = "::".join(sorted([origin.strip().lower(), destination.strip().lower()]))
    base_distance = 0.8 + stable_int(pair_key, "distance", modulo=1720) / 100
    distance = round(base_distance, 1)

    hour = parse_hour(time)
    peak = congestion_multiplier(hour)
    route_pressure = stable_int(pair_key, "pressure", modulo=30) / 100
    congestion_score = peak + route_pressure

    walk_duration = max(5, round(distance / 4.8 * 60))
    bike_duration = max(4, round(distance / 12 * 60))
    subway_duration = max(8, round(distance / 28 * 60 + 8 + (peak - 1) * 6))
    taxi_duration = max(5, round((distance / 24 * 60 + 5) * congestion_score))

    return {
        "distance": distance,
        "walk_duration": walk_duration,
        "bike_duration": bike_duration,
        "subway_duration": subway_duration,
        "taxi_duration": taxi_duration,
        "congestion_level": congestion_label(congestion_score),
    }


@app.get("/queue")
def queue(restaurant_name: str) -> dict[str, int]:
    key = restaurant_name.strip().lower()
    if key not in QUEUE_STATE:
        QUEUE_STATE[key] = 3 + stable_int(key, "queue", modulo=24)

    QUEUE_STATE[key] = max(0, QUEUE_STATE[key] + random.randint(-3, 4))
    queue_people = QUEUE_STATE[key]
    wait_minutes = queue_people * random.randint(3, 5) + random.randint(0, 6)

    return {
        "queue_people": queue_people,
        "wait_minutes": wait_minutes,
    }


@app.get("/destinations")
def destinations(category: str | None = Query(default=None)) -> list[dict[str, Any]]:
    if not category:
        return PLACES

    category_key = category.strip().lower()
    return [
        place
        for place in PLACES
        if str(place.get("category", "")).strip().lower() == category_key
    ]


@app.get("/nearby")
def nearby(lat: float, lng: float) -> dict[str, list[dict[str, Any]]]:
    subway_count = random.randint(1, 3)
    bus_count = random.randint(2, 5)
    bike_count = random.randint(2, 4)

    subway_stations = []
    for index in range(subway_count):
        distance = random.randint(180, 1200)
        point_lat, point_lng = offset_coordinate(lat, lng, distance, random.randint(0, 359))
        subway_stations.append({
            "name": f"生活圈地铁站 {index + 1}",
            "distance_m": distance,
            "lat": point_lat,
            "lng": point_lng,
        })

    bus_stops = []
    for index in range(bus_count):
        distance = random.randint(80, 900)
        point_lat, point_lng = offset_coordinate(lat, lng, distance, random.randint(0, 359))
        bus_stops.append({
            "name": f"社区公交站 {index + 1}",
            "distance_m": distance,
            "lat": point_lat,
            "lng": point_lng,
        })

    shared_bikes = []
    for index in range(bike_count):
        distance = random.randint(30, 500)
        point_lat, point_lng = offset_coordinate(lat, lng, distance, random.randint(0, 359))
        shared_bikes.append({
            "name": f"共享单车点 {index + 1}",
            "distance_m": distance,
            "available_bikes": random.randint(2, 28),
            "lat": point_lat,
            "lng": point_lng,
        })

    return {
        "地铁站": subway_stations,
        "公交站": bus_stops,
        "共享单车": shared_bikes,
    }


@app.get("/recommend")
def recommend(
    category: str | None = Query(default=None),
    budget: float | None = Query(default=None),
    tags: str | None = Query(default=None),
) -> list[dict[str, Any]]:
    requested_tags = split_tags(tags)
    results = PLACES

    if category:
        category_key = category.strip().lower()
        results = [
            place
            for place in results
            if str(place.get("category", "")).strip().lower() == category_key
        ]

    if budget is not None:
        results = [
            place
            for place in results
            if float(place.get("average_cost", 0)) <= budget
        ]

    if requested_tags:
        results = [
            place
            for place in results
            if all(tag in searchable_terms(place) for tag in requested_tags)
        ]

    return sorted(
        results,
        key=lambda place: (
            float(place.get("rating", 0)),
            float(place.get("environment_score", 0)),
            float(place.get("service_score", 0)),
        ),
        reverse=True,
    )


@app.post("/order_taxi")
async def order_taxi(request: Request) -> JSONResponse:
    try:
        data = await request.json()
    except json.JSONDecodeError:
        return JSONResponse({"error": "invalid_json"}, status_code=400)

    origin = data.get("起点") or data.get("origin")
    destination = data.get("终点") or data.get("destination")
    car_type = data.get("车型") or data.get("vehicle_type") or "comfort"

    if not origin or not destination:
        return JSONResponse({"error": "origin_and_destination_required"}, status_code=400)

    order_id = f"TX{datetime.now().strftime('%Y%m%d%H%M%S')}{random.randint(100, 999)}"

    if random.random() < 0.08:
        return JSONResponse({
            "order_id": order_id,
            "driver_name": None,
            "vehicle": None,
            "eta": None,
            "status": "failed",
        })

    driver_names = ["陈师傅", "李师傅", "王师傅", "周师傅", "林师傅", "赵师傅"]
    vehicle_models = {
        "economy": ["大众朗逸", "丰田卡罗拉", "日产轩逸"],
        "comfort": ["本田雅阁", "丰田凯美瑞", "别克君威"],
        "premium": ["奥迪A4L", "宝马3系", "奔驰C级"],
        "商务": ["别克GL8", "传祺M8"],
        "舒适": ["本田雅阁", "丰田凯美瑞", "别克君威"],
        "经济": ["大众朗逸", "丰田卡罗拉", "日产轩逸"],
    }
    model_pool = vehicle_models.get(str(car_type), vehicle_models["comfort"])

    return JSONResponse({
        "order_id": order_id,
        "driver_name": random.choice(driver_names),
        "vehicle": random.choice(model_pool),
        "eta": random.randint(3, 14),
        "status": "accepted",
    })
