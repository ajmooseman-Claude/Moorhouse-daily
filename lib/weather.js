// Weather from Open-Meteo (free, no key). Place names are geocoded once and cached.
import { getJSON, setJSON } from "./store.js";

const WMO = {
  0: "Clear", 1: "Mostly sunny", 2: "Sunny intervals", 3: "Cloudy",
  45: "Fog", 48: "Freezing fog",
  51: "Light drizzle", 53: "Drizzle", 55: "Heavy drizzle", 56: "Freezing drizzle", 57: "Freezing drizzle",
  61: "Light rain", 63: "Rain", 65: "Heavy rain", 66: "Freezing rain", 67: "Freezing rain",
  71: "Light snow", 73: "Snow", 75: "Heavy snow", 77: "Snow grains",
  80: "Light showers", 81: "Showers", 82: "Heavy showers", 85: "Snow showers", 86: "Heavy snow showers",
  95: "Thunderstorms", 96: "Thunderstorms with hail", 99: "Thunderstorms with hail",
};
const COMPASS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];

async function geocode(place) {
  const cache = await getJSON("geo", {});
  const key = place.toLowerCase().trim();
  if (cache[key]) return cache[key];
  const u = new URL("https://geocoding-api.open-meteo.com/v1/search");
  u.searchParams.set("name", place); u.searchParams.set("count", "1"); u.searchParams.set("language", "en");
  const r = await fetch(u); if (!r.ok) throw new Error("Geocoding failed");
  const hit = (await r.json()).results?.[0];
  if (!hit) throw new Error(`Couldn't find a place called ${place}`);
  const g = { lat: hit.latitude, lon: hit.longitude, name: hit.name };
  cache[key] = g; await setJSON("geo", cache);
  return g;
}

const hm = (iso) => (iso ? iso.slice(11, 16) : null);

export async function getWeather(place = "Manchester") {
  const g = await geocode(place);
  const u = new URL("https://api.open-meteo.com/v1/forecast");
  const p = {
    latitude: g.lat, longitude: g.lon, timezone: "Europe/London", forecast_days: "6", wind_speed_unit: "mph",
    current: "temperature_2m,weather_code,wind_speed_10m,wind_direction_10m,is_day",
    daily: "weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,sunrise,sunset",
  };
  for (const [k, v] of Object.entries(p)) u.searchParams.set(k, v);
  const r = await fetch(u); if (!r.ok) throw new Error("Forecast failed");
  const j = await r.json();
  const d = j.daily;
  const days = d.time.map((date, i) => ({
    date, cond: WMO[d.weather_code[i]] || "Mixed",
    hi: Math.round(d.temperature_2m_max[i]), lo: Math.round(d.temperature_2m_min[i]),
    rain: d.precipitation_probability_max?.[i] ?? null,
  }));
  const c = j.current;
  return {
    place: g.name, source: "Open-Meteo",
    now: Math.round(c.temperature_2m), cond: WMO[c.weather_code] || days[0].cond, isDay: !!c.is_day,
    hi: days[0].hi, lo: days[0].lo, rain: days[0].rain,
    wind: `${Math.round(c.wind_speed_10m)} mph ${COMPASS[Math.round(c.wind_direction_10m / 45) % 8]}`,
    sunrise: hm(d.sunrise[0]), sunset: hm(d.sunset[0]), days,
  };
}
