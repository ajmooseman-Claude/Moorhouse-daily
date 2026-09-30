// Reads a public iCloud (or any iCal) calendar link and returns the next 7 days of events.
import ical from "node-ical";

const TZ = "Europe/London";
const dateFmt = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" });
const timeFmt = new Intl.DateTimeFormat("en-GB", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
const text = (v) => (v && typeof v === "object" && "val" in v ? v.val : v) ?? "";

export function londonToday(d = new Date()) { return dateFmt.format(d); }

export async function getAgenda(icalUrl, days = 7) {
  if (!icalUrl) return [];
  const url = icalUrl.trim().replace(/^webcal:\/\//i, "https://");
  if (!/^https:\/\//i.test(url)) throw new Error("The calendar link should start with webcal:// or https://");
  const r = await fetch(url, { headers: { "User-Agent": "MoorhouseDaily/1.0" } });
  if (!r.ok) throw new Error(`Calendar link returned ${r.status}`);
  return parseAgenda(await r.text(), days);
}

export function parseAgenda(icsText, days = 7, nowDate = new Date()) {
  const data = ical.sync.parseICS(icsText);

  const today = londonToday(nowDate);
  const from = new Date(nowDate.getTime() - 12 * 3600e3);
  const to = new Date(nowDate.getTime() + (days + 1) * 864e5);
  const out = [];
  for (const ev of Object.values(data)) {
    if (ev.type !== "VEVENT" || ev.recurrenceid) continue; // overrides are applied by expansion
    let instances = [];
    try { instances = ical.expandRecurringEvent(ev, { from, to, expandOngoing: true }); }
    catch { continue; }
    for (const inst of instances) {
      const s = new Date(inst.start), e = inst.end ? new Date(inst.end) : null;
      if (e && e < from) continue;
      let date = dateFmt.format(s);
      if (date < today) date = today; // ongoing multi-day event
      const lastDay = new Date(Date.parse(today) + days * 864e5).toISOString().slice(0, 10);
      if (date > lastDay) continue;
      if (String(ev.status || "").toUpperCase() === "CANCELLED") continue;
      out.push({
        date,
        allDay: !!inst.isFullDay,
        start: inst.isFullDay ? null : timeFmt.format(s),
        end: inst.isFullDay || !e ? null : timeFmt.format(e),
        title: String(text(inst.summary) || "Busy").slice(0, 200),
        where: String(text(inst.event?.location || ev.location) || "").slice(0, 200),
      });
    }
  }
  const seen = new Set();
  return out
    .filter((e) => { const k = e.date + e.start + e.title; if (seen.has(k)) return false; seen.add(k); return true; })
    .sort((a, b) => (a.date + (a.allDay ? "00:00" : a.start)).localeCompare(b.date + (b.allDay ? "00:00" : b.start)))
    .slice(0, 80);
}
