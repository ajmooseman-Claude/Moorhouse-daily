// API auth, storage and the message webhook. In-memory store, no Redis.
process.env.SESSION_SECRET = "0123456789abcdef0123456789";
process.env.DASHBOARD_PASSWORD = "test";
process.env.MAIN_MAN_API_KEY = "test-main-man-key";
delete process.env.KV_REST_API_URL;
delete process.env.KV_REST_API_TOKEN;
delete process.env.UPSTASH_REDIS_REST_URL;
delete process.env.UPSTASH_REDIS_REST_TOKEN;
delete process.env.MAIN_MAN_WEBHOOK_URL;
delete process.env.MAIN_MAN_WEBHOOK_KEY;
delete process.env.MAIN_MAN_WEBHOOK_KEY_HEADER;
delete process.env.VERCEL;

const { hasRedis, getJSON, setJSON } = await import("../lib/store.js");
const { default: mainMan } = await import("../api/main-man.js");
const { default: feed } = await import("../api/feed.js");
const { default: login } = await import("../api/login.js");
const { assistantBriefStands } = await import("../lib/today.js");
const { bearerMatches } = await import("../lib/mainman.js");
import http from "node:http";

if (hasRedis) { console.error("Refusing to run against Redis"); process.exit(1); }
globalThis.__mdMem.clear();

const ok = (c, m) => { console.log((c ? "ok   " : "FAIL ") + m); if (!c) process.exitCode = 1; };

function mockRes() {
  return {
    statusCode: 200, headers: {}, writableEnded: false,
    setHeader(k, v) { this.headers[k.toLowerCase()] = v; },
    end(b) { this.body = b; this.writableEnded = true; },
  };
}
async function call(handler, { method = "POST", url = "/", headers = {}, body = {}, cookie } = {}) {
  const req = { method, url, headers: { ...headers }, body };
  if (method !== "GET" && method !== "DELETE" && !req.headers["content-type"]) req.headers["content-type"] = "application/json";
  if (cookie) req.headers.cookie = cookie;
  const res = mockRes();
  await handler(req, res);
  let j = null; try { j = JSON.parse(res.body || "null"); } catch { j = res.body; }
  const set = String(res.headers["set-cookie"] || "");
  return { status: res.statusCode, j, cookie: set.split(";")[0] };
}

ok(bearerMatches(undefined, "secret") === false, "missing header does not match");
ok(bearerMatches("Bearer wrong", "secret") === false, "wrong token does not match");
ok(bearerMatches("Bearer secret", "secret") === true, "right token matches");
ok(bearerMatches("bearer secret", "secret") === true, "bearer scheme is case-insensitive");
ok(bearerMatches("Bearer secret", "") === false, "an unset key never matches");
ok(bearerMatches("Bearer ", "secret") === false, "an empty bearer token does not match");
ok(bearerMatches("Bearer " + "x".repeat(300), "secret") === false, "an overlong token does not match");

let r = await call(mainMan, { body: { brief: "Good morning." } });
ok(r.status === 401 && r.j.error === "Not allowed", "401 without the token");

r = await call(mainMan, { headers: { authorization: "Bearer wrong" }, body: { brief: "Good morning." } });
ok(r.status === 401, "401 with the wrong token");

const savedKey = process.env.MAIN_MAN_API_KEY;
delete process.env.MAIN_MAN_API_KEY;
r = await call(mainMan, { headers: { authorization: "Bearer " + savedKey }, body: { brief: "Good morning." } });
ok(r.status === 401, "401 when MAIN_MAN_API_KEY is unset");
process.env.MAIN_MAN_API_KEY = savedKey;

const signed = await call(login, { body: { password: "test" } });
ok(signed.status === 200 && signed.cookie.startsWith("md_session="), "dashboard sign-in still works");
r = await call(mainMan, { cookie: signed.cookie, body: { brief: "Should not land." } });
ok(r.status === 401, "the dashboard session is not enough");
ok((await getJSON("today", null)) == null, "a rejected call stores nothing");

r = await call(feed, { method: "GET", url: "/api/feed" });
ok(r.status === 401, "the feed needs the dashboard password");
r = await call(feed, { method: "POST", url: "/api/feed?action=message", body: { message: "Hello" } });
ok(r.status === 401, "the message box needs the dashboard password");

r = await call(mainMan, { headers: { authorization: "Bearer " + savedKey, "content-type": "text/plain" }, body: { brief: "x" } });
ok(r.status === 415, "the assistant must send JSON");

r = await call(mainMan, { headers: { authorization: "Bearer " + savedKey }, body: {} });
ok(r.status === 400, "an empty body is rejected");

r = await call(mainMan, { headers: { authorization: "Bearer " + savedKey }, body: { notification: { title: "Hi", business: "Space" } } });
ok(r.status === 400 && /Appleton/.test(r.j.error), "an unknown business is rejected");

await setJSON("desk", { priorities: [{ text: "Keep me", done: true }], countdowns: [{ id: "c1", label: "Holiday", date: "2026-12-01" }], queue: [{ id: "q1", platform: "X", text: "draft" }] });
r = await call(mainMan, { headers: { authorization: "Bearer " + savedKey }, body: { priorities: ["a", "b", "c", "d"] } });
ok(r.status === 400, "more than three priorities is rejected");
ok((await getJSON("desk")).priorities[0].text === "Keep me", "a rejected list does not change the three things");

const auth = { authorization: "Bearer " + savedKey };
r = await call(mainMan, { headers: auth, body: {
  brief: "Two meetings today. Send the heads of terms before lunch.",
  priorities: ["Send the heads of terms", "Call the surveyor"],
  notification: { id: "appleton-reply-42", title: "Prospect replied", body: "Helen answered the teaser.", business: "Appleton Strategic", link: "https://example.com/thread/42", priority: "high" },
} });
ok(r.status === 200 && r.j.ok === true && r.j.brief.from === "main-man" && r.j.brief.text.startsWith("Two meetings"), "success with the token sets the brief: " + r.status + " " + JSON.stringify(r.j?.error || ""));
ok(r.j.priorities.items[0].text === "Send the heads of terms" && r.j.priorities.items[2].text === "" && r.j.priorities.items.length === 3, "up to three things, spare slots cleared");
ok(r.j.notification.business === "appleton" && r.j.duplicate === false, "notification stored with the business tag");

const today = await getJSON("today");
ok(today.brief.startsWith("Two meetings") && today.briefFrom === "main-man" && today.briefDate, "the brief fills today's morning brief slot");
const desk = await getJSON("desk");
ok(desk.countdowns[0].label === "Holiday" && desk.queue[0].text === "draft", "priorities do not wipe the rest of the desk");

r = await call(mainMan, { headers: auth, body: { priorities: ["Send the heads of terms", "Call the surveyor"] } });
ok(r.status === 200 && (await getJSON("desk")).priorities[0].done === false, "a new priority starts not done");
await setJSON("desk", { ...(await getJSON("desk")), priorities: [{ text: "Send the heads of terms", done: true }, { text: "Call the surveyor", done: false }, { text: "", done: false }] });
r = await call(mainMan, { headers: auth, body: { priorities: ["Send the heads of terms", "Call the surveyor"] } });
ok(r.j.priorities.items[0].done === true && r.j.priorities.items[1].done === false, "sending the same item again keeps its tick");

r = await call(mainMan, { headers: auth, body: { notification: { id: "appleton-reply-42", title: "Different title", body: "nope", business: "Appleton" } } });
ok(r.status === 200 && r.j.duplicate === true && r.j.notification.title === "Prospect replied", "the same id is idempotent");
const feed1 = await call(feed, { method: "GET", url: "/api/feed", cookie: signed.cookie });
ok(feed1.status === 200 && feed1.j.items.length === 1 && feed1.j.items[0].id === "appleton-reply-42", "the feed lists the notification for the page");

r = await call(feed, { method: "POST", url: "/api/feed?action=seen", cookie: signed.cookie, body: { ids: ["appleton-reply-42"] } });
ok(r.status === 200 && r.j.items[0].seen === true && r.j.unread === 0, "mark read");
r = await call(mainMan, { headers: auth, body: { notification: { id: "appleton-reply-42", title: "Prospect replied", body: "Helen answered the teaser.", business: "appleton" } } });
ok(r.j.duplicate === true && r.j.notification.seen === true, "a repeat does not mark it unread again");

r = await call(feed, { method: "POST", url: "/api/feed?action=dismiss", cookie: signed.cookie, body: { ids: ["appleton-reply-42"] } });
ok(r.status === 200 && r.j.items.length === 0, "dismiss hides it");
r = await call(mainMan, { headers: auth, body: { notification: { id: "appleton-reply-42", title: "Prospect replied", body: "back", business: "Appleton" } } });
ok(r.j.duplicate === true && r.j.notification.dismissed === true, "a repeat does not bring a dismissed item back");

r = await call(mainMan, { headers: auth, body: { notification: { title: "Ebook sold", body: "One copy.", business: "The 5pm Theory", priority: "low" } } });
ok(r.status === 200 && r.j.notification.business === "5pm", "5pm Theory is accepted");
r = await call(mainMan, { headers: auth, body: { notification: { title: "Note", body: "Dentist.", business: "Personal" } } });
ok(r.status === 200 && r.j.notification.business === "personal", "Personal is accepted");

r = await call(feed, { method: "POST", url: "/api/feed?action=message", cookie: signed.cookie, body: { message: "Please check the letter." } });
ok(r.status === 503 && /isn't connected/.test(r.j.error) && !/!|~/.test(r.j.error), "a missing webhook is a clear error: " + r.j.error);
ok((await call(feed, { method: "GET", url: "/api/feed", cookie: signed.cookie })).j.items.every(i => i.kind !== "sent"), "a failed send is not shown as sent");

const received = [];
const hook = http.createServer((req, res) => {
  let raw = "";
  req.on("data", (c) => { raw += c; });
  req.on("end", () => {
    received.push({ url: req.url, headers: req.headers, raw });
    if (req.url === "/redirect") { res.writeHead(302, { Location: "http://127.0.0.1/nope" }); res.end(); return; }
    if (req.url === "/fail") { res.statusCode = 500; res.end("no"); return; }
    res.statusCode = 204; res.end();
  });
});
await new Promise((resolve) => hook.listen(0, "127.0.0.1", resolve));
const port = hook.address().port;
process.env.MAIN_MAN_WEBHOOK_URL = `http://127.0.0.1:${port}/hook`;
process.env.MAIN_MAN_WEBHOOK_KEY = "secret-key";

r = await call(feed, { method: "POST", url: "/api/feed?action=message", cookie: signed.cookie, body: { message: "Please check the letter." } });
ok(r.status === 200 && r.j.item.kind === "sent" && r.j.items.some(i => i.body === "Please check the letter."), "a sent message shows in the feed: " + r.status + " " + (r.j.error || ""));
const hit = received.find((x) => x.url === "/hook");
const payload = JSON.parse(hit.raw);
ok(payload.message === "Please check the letter." && payload.source === "moorhouse-daily" && /^\d{4}-\d{2}-\d{2}T/.test(payload.sent_at), "webhook JSON shape");
ok(hit.headers.authorization === "Bearer secret-key", "default header is Authorization: Bearer");
ok(Object.keys(payload).join(",") === "message,sent_at,source", "payload keys");

process.env.MAIN_MAN_WEBHOOK_KEY_HEADER = "X-Api-Key";
r = await call(feed, { method: "POST", url: "/api/feed?action=message", cookie: signed.cookie, body: { message: "Second note." } });
ok(r.status === 200 && received.at(-1).headers["x-api-key"] === "secret-key" && !received.at(-1).headers.authorization, "the webhook header name is configurable");

process.env.MAIN_MAN_WEBHOOK_URL = `http://127.0.0.1:${port}/fail`;
process.env.MAIN_MAN_WEBHOOK_KEY_HEADER = "";
const before = (await call(feed, { method: "GET", url: "/api/feed", cookie: signed.cookie })).j.items.length;
r = await call(feed, { method: "POST", url: "/api/feed?action=message", cookie: signed.cookie, body: { message: "This one fails." } });
ok(r.status === 502 && /not sent/.test(r.j.error), "a webhook error is shown: " + r.j.error);
ok((await call(feed, { method: "GET", url: "/api/feed", cookie: signed.cookie })).j.items.length === before, "a failed webhook does not add a sent row");

process.env.MAIN_MAN_WEBHOOK_URL = `http://127.0.0.1:${port}/redirect`;
r = await call(feed, { method: "POST", url: "/api/feed?action=message", cookie: signed.cookie, body: { message: "Redirected." } });
ok(r.status === 502 && /redirected/i.test(r.j.error), "a redirect is not treated as sent");

hook.close();
process.env.MAIN_MAN_WEBHOOK_URL = "http://127.0.0.1:9/hook";
r = await call(feed, { method: "POST", url: "/api/feed?action=message", cookie: signed.cookie, body: { message: "Nobody home." } });
ok(r.status === 502 && /didn't answer/.test(r.j.error), "an unreachable webhook is a clear error");

const day = "2026-09-30";
ok(assistantBriefStands({ briefFrom: "main-man", briefDate: day, brief: "Hello" }, day) === true, "an assistant brief stands for today");
ok(assistantBriefStands({ briefFrom: "main-man", briefDate: day, brief: "Hello" }, day, true) === false, "Refresh may replace it");
ok(assistantBriefStands({ briefFrom: "daily", briefDate: day, brief: "Hello" }, day) === false, "a generated brief can be rewritten");
ok(assistantBriefStands({ briefFrom: "main-man", briefDate: "2026-09-29", brief: "Hello" }, day) === false, "yesterday's brief does not stand");

if (process.exitCode) process.exit(process.exitCode);
