import { route, sessionCookie } from "../lib/http.js";
export default route(["POST"], async (req, res) => {
  res.setHeader("Set-Cookie", sessionCookie("", 0));
  return { ok: true };
}, { auth: false });
