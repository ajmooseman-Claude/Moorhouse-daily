import { route, fail, clip } from "../lib/http.js";
import { setJSON } from "../lib/store.js";
import { getSettings, refreshToday, CAL_COLOURS } from "../lib/today.js";

const HEX = /^#[0-9a-f]{6}$/i;
function cleanCalendars(list) {
  if (!Array.isArray(list)) throw fail(400, "Calendars should be a list.");
  if (list.length > 10) throw fail(400, "Up to 10 calendars, please.");
  return list.map((c, i) => {
    const url = clip(c?.url, 1000).trim();
    if (url && !/^(webcal|https):\/\//i.test(url)) throw fail(400, `The link for ${c?.name || "calendar " + (i + 1)} should start with webcal:// or https://`);
    return {
      id: /^[a-z0-9_-]{1,20}$/i.test(c?.id || "") ? c.id : "cal" + Date.now().toString(36) + i,
      name: clip(c?.name, 40).trim() || `Calendar ${i + 1}`,
      url,
      color: HEX.test(c?.color || "") ? c.color : CAL_COLOURS[i % CAL_COLOURS.length],
    };
  }).filter((c) => c.url);
}

export default route(["PUT"], async (req, res, body) => {
  const prev = await getSettings();
  const next = {
    place: "place" in body ? clip(body.place, 80).trim() || "Manchester" : prev.place,
    voice: "voice" in body ? clip(body.voice, 80) : prev.voice,
    calendars: "calendars" in body ? cleanCalendars(body.calendars) : prev.calendars,
  };
  await setJSON("settings", next);
  const urls = (s) => JSON.stringify(s.calendars.map((c) => c.url));
  let today = null;
  if (next.place !== prev.place || urls(next) !== urls(prev)) today = await refreshToday({ withBrief: false });
  return { ok: true, settings: next, today };
});
