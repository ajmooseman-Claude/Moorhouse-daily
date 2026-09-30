import { route } from "../lib/http.js";
import { getJSON } from "../lib/store.js";
import { currentToday, refreshToday, getSettings } from "../lib/today.js";
import { hasClaude } from "../lib/claude.js";
import { feedForPage } from "../lib/mainman.js";

// Everything the page needs in one call. ?refresh=1 rebuilds the brief now.
export default route(["GET"], async (req) => {
  const force = new URL(req.url, "http://x").searchParams.get("refresh") === "1";
  const [today, desk, notes, settings, mainman] = await Promise.all([
    force ? refreshToday({ withBrief: true, replaceBrief: true }) : currentToday(),
    getJSON("desk", { priorities: [], countdowns: [], queue: [] }),
    getJSON("notes", []),
    getSettings(),
    feedForPage(),
  ]);
  return { today, desk, notes, settings, claude: hasClaude(), mainman };
});
