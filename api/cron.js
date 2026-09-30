import { send } from "../lib/http.js";
import { refreshToday } from "../lib/today.js";

// Vercel calls this each weekday morning with Authorization: Bearer $CRON_SECRET
export default async function handler(req, res) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.authorization !== `Bearer ${secret}`) return send(res, 401, { error: "Not allowed" });
  try {
    const t = await refreshToday({ withBrief: true });
    return send(res, 200, { ok: true, errors: t.errors, events: t.agenda.length });
  } catch (e) {
    console.error(e);
    return send(res, 500, { error: String(e.message || e) });
  }
}
