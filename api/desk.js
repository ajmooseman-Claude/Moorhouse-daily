import { route, fail, clip } from "../lib/http.js";
import { setJSON } from "../lib/store.js";

const day = /^\d{4}-\d{2}-\d{2}$/;
export function cleanDesk(d = {}) {
  return {
    priorities: (Array.isArray(d.priorities) ? d.priorities : []).slice(0, 3).map((p) => ({ text: clip(p?.text, 200), done: !!p?.done })),
    countdowns: (Array.isArray(d.countdowns) ? d.countdowns : []).filter((c) => day.test(c?.date)).slice(0, 30)
      .map((c) => ({ id: clip(c.id, 40) || "c" + Date.now().toString(36), label: clip(c.label, 120), date: c.date })),
    queue: (Array.isArray(d.queue) ? d.queue : []).slice(-12)
      .map((q) => ({ id: clip(q?.id, 40), platform: clip(q?.platform, 20), text: clip(q?.text, 3000), created: clip(q?.created, 40) })),
  };
}

export default route(["PUT"], async (req, res, body) => {
  if (!body || typeof body !== "object") throw fail(400, "Send the desk as JSON.");
  const desk = cleanDesk(body);
  await setJSON("desk", desk);
  return { ok: true, desk };
});
