// getAgendas with two calendars (one failing) using a stubbed fetch.
import { getAgendas } from "../lib/calendar.js";
const ics = (uid, title, start) => `BEGIN:VCALENDAR\nVERSION:2.0\nBEGIN:VEVENT\nUID:${uid}\nDTSTART;TZID=Europe/London:${start}\nDTEND;TZID=Europe/London:${start.slice(0,9)}235900\nSUMMARY:${title}\nEND:VEVENT\nEND:VCALENDAR`;
const d = new Date(); const ymd = new Intl.DateTimeFormat("en-CA",{timeZone:"Europe/London"}).format(d).replaceAll("-","");
globalThis.fetch = async (url) => {
  if (url.includes("work")) return new Response(ics("w1", "Client meeting", ymd + "T230000"));
  if (url.includes("home")) return new Response(ics("h1", "School run", ymd + "T231500"));
  return new Response("nope", { status: 404 });
};
const r = await getAgendas([
  { id: "w", name: "Work", url: "webcal://x/work.ics" },
  { id: "h", name: "Home", url: "https://x/home.ics" },
  { id: "b", name: "Broken", url: "https://x/missing.ics" },
]);
console.log(r.events.map(e => `${e.cal} ${e.start} ${e.title}`), r.errors);
const ok = r.events.length === 2 && r.events[0].cal === "w" && r.events[1].cal === "h" && r.errors.length === 1 && r.errors[0].startsWith("Broken:");
console.log(ok ? "MULTICAL OK" : "MULTICAL FAIL");
