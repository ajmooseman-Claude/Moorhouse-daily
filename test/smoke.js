// Smoke test against the local dev server (in-memory store, no network needed for these routes).
const BASE = process.env.BASE || "http://localhost:3000";
let cookie = "";
async function call(method, path, body) {
  const r = await fetch(BASE + path, { method, headers: { "Content-Type": "application/json", cookie }, body: body ? JSON.stringify(body) : undefined });
  const sc = r.headers.get("set-cookie"); if (sc) cookie = sc.split(";")[0];
  let j = null; try { j = await r.json(); } catch {}
  return { status: r.status, j };
}
const ok = (cond, msg) => { if (!cond) { console.error("FAIL:", msg); process.exitCode = 1; } else console.log("ok  ", msg); };

ok((await call("GET", "/api/state")).status === 401, "state needs sign-in");
ok((await call("PUT", "/api/desk", { priorities: [] })).status === 401, "desk needs sign-in");
ok((await call("POST", "/api/login", { password: "wrong" })).status === 401, "wrong password rejected");
ok((await call("POST", "/api/login", { password: "test" })).status === 200 && cookie.startsWith("md_session="), "right password signs in");

const n = await call("POST", "/api/notes", { text: "Chase the valuation report" });
ok(n.status === 200 && n.j.note?.id, "note created");
ok((await call("PATCH", `/api/notes?id=${n.j.note.id}`, { pinned: true })).status === 200, "note pinned");
const d = await call("PUT", "/api/desk", { priorities: [{ text: "Send heads of terms", done: false }], countdowns: [{ id: "c1", label: "Holiday", date: "2026-10-24" }, { label: "bad", date: "nope" }], queue: [] });
ok(d.status === 200 && d.j.desk.countdowns.length === 1, "desk saved and cleaned");
ok((await call("PUT", "/api/settings", { voice: "Samantha" })).status === 200, "voice saved");
ok((await call("GET", "/api/cron")).status === 401, "cron refuses without secret");
ok((await call("POST", "/api/ask", { question: "hi" })).status === 503, "ask explains missing API key");

const s = await call("GET", "/api/state");
ok(s.status === 200, "state loads after sign-in");
ok(s.j.notes[0]?.pinned === true && s.j.desk.priorities[0].text === "Send heads of terms", "state reflects writes");
ok(s.j.settings.voice === "Samantha", "settings round-trip");
ok((await call("DELETE", `/api/notes?id=${n.j.note.id}`)).status === 200, "note deleted");
ok((await call("POST", "/api/logout")).status === 200, "signed out");
cookie = "md_session=v1.9999999999999.forged";
ok((await call("GET", "/api/state")).status === 401, "forged session rejected");
