// Builds the "today" document: weather, diary and the morning brief.
import { getJSON, setJSON } from "./store.js";
import { getWeather } from "./weather.js";
import { getAgendas, londonToday } from "./calendar.js";
import { ask, hasClaude, MODELS, STYLE } from "./claude.js";

const LIVE_MINUTES = 30; // weather + diary refresh at most this often when the page is open

export const CAL_COLOURS = ["#FF6B4A", "#8B6BFF", "#14B8A6", "#3A9BF0", "#F5A524", "#EC4F8B", "#6BBF3A", "#7A8699"];

export async function getSettings() {
  const s = { place: "Manchester", voice: "Samantha", calendars: [], ...(await getJSON("settings", {})) };
  // older single-link setting becomes the first calendar
  if (s.icalUrl && !s.calendars.length) s.calendars = [{ id: "cal1", name: "iCloud", url: s.icalUrl, color: CAL_COLOURS[0] }];
  delete s.icalUrl;
  return s;
}

function templateBrief(w, agenda, today) {
  const todays = agenda.filter((e) => e.date === today);
  const timed = todays.filter((e) => !e.allDay);
  const parts = [];
  if (!todays.length) parts.push("Nothing in the diary today, so the day is yours.");
  else {
    const first = timed[0];
    parts.push(`${todays.length} ${todays.length === 1 ? "thing" : "things"} in the diary today${first ? `, starting with ${first.title} at ${first.start}` : ""}.`);
  }
  if (w) parts.push(`${w.cond} in ${w.place}, ${w.lo} to ${w.hi} degrees${w.rain != null ? ` with a ${w.rain}% chance of rain` : ""}.`);
  return parts.join(" ");
}

async function writeBrief(w, agenda, today, desk) {
  if (!hasClaude()) return templateBrief(w, agenda, today);
  const data = JSON.stringify({ today, weather: w, diary_next_7_days: agenda, calendars: (await getSettings()).calendars.map((c) => ({ id: c.id, name: c.name })), priorities: desk?.priorities || [], countdowns: desk?.countdowns || [] });
  try {
    return await ask({
      model: MODELS.write, maxTokens: 400,
      system: `You write James Moorhouse's morning brief. He reads it or hears it read aloud over breakfast. ${STYLE}`,
      prompt: `Write 2 to 4 short sentences. Cover how today's diary is shaped (first commitment, busiest stretch, anything tomorrow worth preparing for), what the weather means in practice, and one sensible first job if the diary or priorities suggest one. Don't list every event. Don't invent anything that isn't in the data.\n\nData:\n${data}\n\nReply with only the brief.`,
    });
  } catch (e) {
    console.error("brief failed", e);
    return templateBrief(w, agenda, today);
  }
}

export async function refreshToday({ withBrief = true } = {}) {
  const s = await getSettings();
  const prev = (await getJSON("today", null)) || {};
  const errors = [];
  let weather = prev.weather || null, agenda = prev.agenda || [];
  try { weather = await getWeather(s.place || "Manchester"); } catch (e) { errors.push(`Weather: ${e.message}`); }
  if (s.calendars.length) {
    const r = await getAgendas(s.calendars);
    errors.push(...r.errors);
    // keep the last good events for a calendar whose link failed this time
    const failed = new Set(s.calendars.filter((c) => r.errors.some((m) => m.startsWith((c.name || "Calendar") + ":"))).map((c) => c.id));
    agenda = [...r.events, ...(prev.agenda || []).filter((e) => failed.has(e.cal))];
  } else agenda = [];
  const today = londonToday();
  const doc = { ...prev, weather, agenda, liveAt: new Date().toISOString(), errors };
  if (withBrief) {
    const desk = await getJSON("desk", {});
    doc.brief = await writeBrief(weather, agenda, today, desk);
    doc.briefDate = today;
    doc.updatedAt = new Date().toISOString();
  }
  await setJSON("today", doc);
  return doc;
}

// Called whenever the page loads: keep things fresh without spending API calls needlessly.
export async function currentToday() {
  const t = await getJSON("today", null);
  const today = londonToday();
  if (!t || t.briefDate !== today) return refreshToday({ withBrief: true });
  const age = (Date.now() - Date.parse(t.liveAt || 0)) / 6e4;
  if (age > LIVE_MINUTES) return refreshToday({ withBrief: false });
  return t;
}
