import { route, fail } from "../lib/http.js";
import { feedForPage, markRead, dismiss, sendMessage } from "../lib/mainman.js";

// Signed-in dashboard only. The assistant does not use this route.
export default route(["GET", "POST"], async (req, res, body) => {
  const action = new URL(req.url || "/", "http://x").searchParams.get("action") || (req.method === "GET" ? "list" : "");
  if (action === "list") return feedForPage();
  if (action === "seen") return markRead(body);
  if (action === "dismiss") return dismiss(body);
  if (action === "message") return sendMessage(body);
  throw fail(400, "Unknown action.");
});
