import { route } from "../lib/http.js";
import { getJSON } from "../lib/store.js";
import { currentToday, refreshToday, getSettings } from "../lib/today.js";
import { hasClaude } from "../lib/claude.js";

// Everything the page needs in one call. ?refresh=1 rebuilds the brief now.
export default route(["GET"], async (req) => {
  const force = new URL(req.url, "http://x").searchParams.get("refresh") === "1";
  const [today, desk, notes, settings] = await Promise.all([
    force ? refreshToday({ withBrief: true }) : currentToday(),
    getJSON("desk", { priorities: [], countdowns: [], queue: [] }),
    getJSON("notes", []),
    getSettings(),
  ]);
  return { today, desk, notes, settings, claude: hasClaude() };
});
