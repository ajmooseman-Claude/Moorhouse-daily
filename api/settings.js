import { route, clip } from "../lib/http.js";
import { setJSON } from "../lib/store.js";
import { getSettings, refreshToday } from "../lib/today.js";

export default route(["PUT"], async (req, res, body) => {
  const prev = await getSettings();
  const next = {
    place: "place" in body ? clip(body.place, 80).trim() || "Manchester" : prev.place,
    icalUrl: "icalUrl" in body ? clip(body.icalUrl, 1000).trim() : prev.icalUrl,
    voice: "voice" in body ? clip(body.voice, 80) : prev.voice,
  };
  await setJSON("settings", next);
  let today = null;
  if (next.place !== prev.place || next.icalUrl !== prev.icalUrl) today = await refreshToday({ withBrief: false });
  return { ok: true, settings: next, today };
});
