import { route, fail, clip } from "../lib/http.js";
import { askWithTools, STYLE } from "../lib/claude.js";
import { getJSON, setJSON } from "../lib/store.js";
import { addNote } from "./notes.js";
import { cleanDesk } from "./desk.js";
import { getSettings } from "../lib/today.js";

const now = () => new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", weekday: "long", day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date());

export default route(["POST"], async (req, res, body) => {
  const q = clip(body.question, 2000).trim();
  if (!q) throw fail(400, "Ask something first.");
  const did = [];
  const [today, notes, settings] = await Promise.all([getJSON("today", {}), getJSON("notes", []), getSettings()]);
  const calName = Object.fromEntries(settings.calendars.map((c) => [c.id, c.name]));
  let desk = await getJSON("desk", { priorities: [], countdowns: [], queue: [] });
  const saveDesk = async () => { desk = cleanDesk(desk); await setJSON("desk", desk); };

  const tools = [
    { name: "add_note", description: "Save a note to James's notebook.", input_schema: { type: "object", properties: { text: { type: "string" } }, required: ["text"] },
      run: async ({ text }) => { await addNote(text, "via Claude"); did.push("Note saved"); return "saved"; } },
    { name: "set_priority", description: "Put an item into one of the three daily priority slots (1 to 3). Omit slot to use the first empty one.", input_schema: { type: "object", properties: { text: { type: "string" }, slot: { type: "integer", minimum: 1, maximum: 3 } }, required: ["text"] },
      run: async ({ text, slot }) => {
        const pr = [0, 1, 2].map((k) => desk.priorities?.[k] || { text: "", done: false });
        let i = slot ? Math.min(3, Math.max(1, +slot)) - 1 : pr.findIndex((p) => !p.text); if (i < 0) i = 2;
        pr[i] = { text: String(text), done: false }; desk.priorities = pr; await saveDesk(); did.push(`Priority ${i + 1} set`); return `slot ${i + 1}`; } },
    { name: "complete_priority", description: "Tick off one of the three priorities (slot 1 to 3).", input_schema: { type: "object", properties: { slot: { type: "integer", minimum: 1, maximum: 3 } }, required: ["slot"] },
      run: async ({ slot }) => { const i = +slot - 1; if (!desk.priorities?.[i]?.text) throw new Error("That slot is empty"); desk.priorities[i].done = true; await saveDesk(); did.push(`Priority ${slot} done`); return "ticked"; } },
    { name: "add_countdown", description: "Add a countdown to a date (YYYY-MM-DD).", input_schema: { type: "object", properties: { label: { type: "string" }, date: { type: "string" } }, required: ["label", "date"] },
      run: async ({ label, date }) => { if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date))) throw new Error("date must be YYYY-MM-DD"); desk.countdowns = [...(desk.countdowns || []), { id: "c" + Date.now().toString(36), label: String(label), date: String(date) }]; await saveDesk(); did.push("Countdown added"); return "added"; } },
  ];

  const context = JSON.stringify({
    now: now(), weather: today.weather || null, diary: (today.agenda || []).slice(0, 60).map(({ cal, ...e }) => ({ ...e, calendar: calName[cal] || "" })), brief: today.brief || null,
    priorities: desk.priorities, countdowns: desk.countdowns, recent_notes: notes.slice(0, 20).map((n) => ({ text: n.text, created: n.created, pinned: n.pinned })),
  });
  const text = await askWithTools({
    system: `You are the assistant built into James Moorhouse's personal dashboard. He often speaks to you, so allow for speech-to-text slips, and your reply may be read aloud: keep it to two to four sentences with no lists or markdown. ${STYLE} Use the tools when he asks you to note, remember, prioritise, tick off or count down to something, then confirm in one short sentence. If something isn't in the dashboard data, say so plainly.`,
    prompt: `Dashboard data (JSON):\n${context}\n\nJames says: ${q}`,
    tools,
  });
  return { text, did, desk };
});
