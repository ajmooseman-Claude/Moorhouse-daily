import { route, fail } from "../lib/http.js";
import { authorised, setPriorities, addNotification, validatePriorities, validateNotification } from "../lib/mainman.js";

// The morning brief belongs to the dashboard (Claude). A "brief" field is ignored.
const BRIEF_NOTE = "The morning brief is written by the dashboard, so it was ignored.";

// The assistant calls this with Authorization: Bearer $MAIN_MAN_API_KEY.
// The dashboard password is not accepted here.
export default route(["POST"], async (req, res, body) => {
  if (!authorised(req)) throw fail(401, "Not allowed");
  if (!body || typeof body !== "object" || Array.isArray(body)) throw fail(400, "Send JSON.");
  const hasBrief = Object.prototype.hasOwnProperty.call(body, "brief");
  const hasPri = Object.prototype.hasOwnProperty.call(body, "priorities");
  const hasNote = Object.prototype.hasOwnProperty.call(body, "notification");
  if (!hasPri && !hasNote) throw fail(400, hasBrief ? BRIEF_NOTE + " Send the three things or a notification." : "Send the three things or a notification.");

  if (hasPri) validatePriorities(body.priorities);
  if (hasNote) validateNotification(body.notification);

  const out = { ok: true };
  if (hasBrief) { out.brief = "ignored"; out.note = BRIEF_NOTE; }
  if (hasPri) out.priorities = await setPriorities(body.priorities);
  if (hasNote) {
    const note = await addNotification(body.notification);
    out.notification = note.notification;
    out.duplicate = note.duplicate;
  }
  return out;
}, { auth: false });
