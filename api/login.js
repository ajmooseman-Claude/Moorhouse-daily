import { route, fail, makeSession, sessionCookie, safeEqual } from "../lib/http.js";
import { bump } from "../lib/store.js";

export default route(["POST"], async (req, res, body) => {
  const pw = process.env.DASHBOARD_PASSWORD;
  if (!pw) throw fail(500, "DASHBOARD_PASSWORD isn't set in Vercel yet.");
  const ip = String(req.headers["x-forwarded-for"] || "local").split(",")[0].trim();
  if ((await bump(`login:${ip}`, 600)) > 8) throw fail(429, "Too many attempts. Wait ten minutes and try again.");
  if (!safeEqual(body.password || "", pw)) throw fail(401, "That password isn't right.");
  res.setHeader("Set-Cookie", sessionCookie(makeSession()));
  return { ok: true };
}, { auth: false });
