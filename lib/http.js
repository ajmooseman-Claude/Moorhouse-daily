import crypto from "node:crypto";

const COOKIE = "md_session";
const DAYS = 90;

function secret() {
  const s = process.env.SESSION_SECRET;
  if (!s || s.length < 16) throw new Error("SESSION_SECRET is not set (use 32+ random characters)");
  return s;
}

function sign(payload) {
  return crypto.createHmac("sha256", secret()).update(payload).digest("base64url");
}

export function makeSession() {
  const exp = Date.now() + DAYS * 864e5;
  const payload = `v1.${exp}`;
  return `${payload}.${sign(payload)}`;
}

export function sessionCookie(value, maxAgeSeconds = DAYS * 86400) {
  const secure = process.env.VERCEL ? "; Secure" : "";
  return `${COOKIE}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSeconds}${secure}`;
}

function readCookie(req, name) {
  const raw = req.headers.cookie || "";
  for (const part of raw.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return v.join("=");
  }
  return null;
}

export function isAuthed(req) {
  const v = readCookie(req, COOKIE);
  if (!v) return false;
  const i = v.lastIndexOf(".");
  if (i < 0) return false;
  const payload = v.slice(0, i), mac = v.slice(i + 1);
  let good;
  try { good = sign(payload); } catch { return false; }
  const a = Buffer.from(mac), b = Buffer.from(good);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return false;
  const exp = Number(payload.split(".")[1]);
  return Number.isFinite(exp) && exp > Date.now();
}

export function safeEqual(a, b) {
  const x = crypto.createHash("sha256").update(String(a)).digest();
  const y = crypto.createHash("sha256").update(String(b)).digest();
  return crypto.timingSafeEqual(x, y);
}

export function send(res, status, body) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(body));
}

// Wraps a handler: auth check, method check, JSON errors.
export function route(methods, handler, { auth = true } = {}) {
  return async (req, res) => {
    try {
      if (!methods.includes(req.method)) return send(res, 405, { error: "Method not allowed" });
      if (auth && !isAuthed(req)) return send(res, 401, { error: "Sign in required" });
      if (req.method !== "GET" && req.method !== "DELETE" && req.headers["content-type"]?.includes("application/json") === false)
        return send(res, 415, { error: "Send JSON" });
      const body = typeof req.body === "string" ? safeParse(req.body) : (req.body || {});
      const out = await handler(req, res, body);
      if (!res.writableEnded) send(res, 200, out ?? { ok: true });
    } catch (e) {
      if (!e.expose) console.error(e);
      if (!res.writableEnded) send(res, e.status || 500, { error: e.expose ? e.message : "Something went wrong on the server." });
    }
  };
}

export function fail(status, message) {
  const e = new Error(message); e.status = status; e.expose = true; return e;
}

function safeParse(s) { try { return JSON.parse(s); } catch { return {}; } }

export const clip = (s, n) => String(s ?? "").slice(0, n);
