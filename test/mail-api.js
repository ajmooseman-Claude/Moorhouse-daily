const BASE = process.env.BASE || "http://localhost:3000";
let cookie = "";
async function call(method, path, body) {
  const r = await fetch(BASE + path, { method, headers: { "Content-Type": "application/json", cookie }, body: body ? JSON.stringify(body) : undefined });
  const sc = r.headers.get("set-cookie"); if (sc) cookie = sc.split(";")[0];
  let j = null; try { j = await r.json(); } catch {}
  return { status: r.status, j };
}
const ok = (c, m) => { console.log((c ? "ok   " : "FAIL ") + m); if (!c) process.exitCode = 1; };
ok((await call("GET", "/api/mail?action=list")).status === 401, "mail needs sign-in");
await call("POST", "/api/login", { password: "test" });
const l = await call("GET", "/api/mail?action=list");
ok(l.status === 200 && Array.isArray(l.j.accounts) && l.j.outlookReady === false, "list works; Outlook reports it needs MS_CLIENT_ID");
const c = await call("POST", "/api/mail?action=check", {});
ok(c.status === 200 && c.j.added.length === 0, "check with no accounts is a no-op");
const bad = await call("POST", "/api/mail?action=add-imap", { provider: "imap", email: "a@b.com", password: "x", host: "127.0.0.1" });
ok(bad.status === 400 && /connect|accepted/i.test(bad.j.error), "a mailbox that can't be reached gives a clear error: " + bad.j.error);
const ms = await call("POST", "/api/mail?action=outlook-start", {});
ok(ms.status === 400 && /MS_CLIENT_ID/.test(ms.j.error), "Outlook explains the missing Microsoft app ID");
const seen = await call("POST", "/api/mail?action=seen", { all: true });
ok(seen.status === 200, "mark all read works");
