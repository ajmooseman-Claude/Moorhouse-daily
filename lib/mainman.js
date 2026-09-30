// The main man: morning brief, three things, and the notification feed.
// Stored in the same Upstash Redis (or local memory) as the rest of the dashboard.
import crypto from "node:crypto";
import { fail, clip, safeEqual } from "./http.js";
import { getJSON, setJSON, bump } from "./store.js";
import { londonToday } from "./calendar.js";

export const FEED_KEY = "mainman:feed";
const MAX_ITEMS = 200;

export const BUSINESSES = {
  appleton: "Appleton",
  bellgreave: "Bellgreave",
  "5pm": "5pm Theory",
  personal: "Personal",
  other: "Other",
};

const PRIORITIES = ["low", "normal", "high"];

// Constant-time check of Authorization: Bearer <MAIN_MAN_API_KEY>.
// An empty or unset key never matches, including an empty bearer token.
export function bearerMatches(header, secret) {
  const key = String(secret ?? "").trim();
  const presented = /^Bearer\s+(\S{1,256})\s*$/i.exec(String(header || ""))?.[1] || "";
  if (!key) return false;
  return safeEqual(presented, key);
}

export function authorised(req) {
  return bearerMatches(req?.headers?.authorization, process.env.MAIN_MAN_API_KEY || "");
}

export function canonBusiness(raw) {
  const s = String(raw ?? "").trim().toLowerCase().replace(/&/g, " and ").replace(/[_./-]+/g, " ").replace(/\s+/g, " ").trim();
  if (!s) return null;
  if (s.includes("appleton")) return "appleton";
  if (s.includes("bellgreave")) return "bellgreave";
  if (/(^|[^a-z0-9])5\s*pm\b/.test(s) || /\bfive\s*pm\b/.test(s)) return "5pm";
  if (/^personal\b/.test(s)) return "personal";
  if (/^other\b/.test(s)) return "other";
  return null;
}

function canonPriority(raw) {
  if (raw == null || String(raw).trim() === "") return null;
  const s = String(raw).trim().toLowerCase();
  if (!PRIORITIES.includes(s)) throw fail(400, "Priority should be low, normal or high.");
  return s;
}

function cleanLink(raw) {
  const link = clip(raw, 500).trim();
  if (!link) return null;
  if (!/^https?:\/\//i.test(link) || /\s/.test(link)) throw fail(400, "The link should start with http:// or https://");
  return link;
}

function cleanClientId(raw) {
  if (raw == null || String(raw).trim() === "") return null;
  const id = String(raw).trim();
  if (!/^[A-Za-z0-9._:-]{1,80}$/.test(id)) throw fail(400, "The id should be letters, numbers or . _ : - and at most 80 characters.");
  return id;
}

function publicItem(it) {
  return {
    id: it.id,
    kind: it.kind,
    title: it.title,
    body: it.body,
    business: it.business,
    link: it.link,
    priority: it.priority,
    at: it.at,
    seen: !!it.seen,
    dismissed: !!it.dismissed,
  };
}

export function webhookConfigured() {
  return Boolean((process.env.MAIN_MAN_WEBHOOK_URL || "").trim() && String(process.env.MAIN_MAN_WEBHOOK_KEY || "").trim());
}

export async function feedForPage() {
  const items = (await getJSON(FEED_KEY, [])).filter((i) => !i.dismissed).slice(0, 80).map(publicItem);
  return {
    items,
    canMessage: webhookConfigured(),
    unread: items.filter((i) => i.kind === "notice" && !i.seen).length,
  };
}

function trimFeed(items) {
  const keep = items.slice();
  const pull = (pred) => {
    for (let i = keep.length - 1; i >= 0 && keep.length > MAX_ITEMS; i--) {
      if (pred(keep[i])) keep.splice(i, 1);
    }
  };
  pull((i) => i.dismissed);
  pull((i) => i.seen && i.kind === "sent");
  pull((i) => i.seen);
  return keep.slice(0, MAX_ITEMS);
}

export function validateBrief(text) {
  if (typeof text !== "string") throw fail(400, "The brief should be text.");
  const t = clip(text, 4000).trim();
  if (!t) throw fail(400, "The brief is empty.");
  return t;
}

export async function setBrief(text) {
  const t = validateBrief(text);
  const today = londonToday();
  const prev = (await getJSON("today", null)) || {};
  const updatedAt = new Date().toISOString();
  const doc = { ...prev, brief: t, briefDate: today, briefFrom: "main-man", updatedAt };
  await setJSON("today", doc);
  return { text: t, date: today, updatedAt, from: "main-man" };
}

function priorityText(p) {
  if (typeof p === "string") return clip(p, 200).trim();
  if (p && typeof p === "object") return clip(p.text, 200).trim();
  return "";
}

export function validatePriorities(items) {
  if (!Array.isArray(items)) throw fail(400, "Send the three things as a list.");
  if (items.length > 3) throw fail(400, "Send up to three items.");
  const texts = items.map(priorityText);
  if (!texts.some(Boolean)) throw fail(400, "Send at least one item.");
  while (texts.length < 3) texts.push("");
  return texts;
}

export async function setPriorities(items) {
  const texts = validatePriorities(items);
  const desk = (await getJSON("desk", null)) || { priorities: [], countdowns: [], queue: [] };
  const prev = Array.isArray(desk.priorities) ? desk.priorities : [];
  desk.priorities = [0, 1, 2].map((i) => {
    const text = texts[i] || "";
    const old = prev[i] || {};
    return { text, done: Boolean(text) && old.text === text && !!old.done };
  });
  if (!Array.isArray(desk.countdowns)) desk.countdowns = [];
  if (!Array.isArray(desk.queue)) desk.queue = [];
  await setJSON("desk", desk);
  return { date: londonToday(), items: desk.priorities };
}

export function validateNotification(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw fail(400, "Send the notification as an object.");
  const title = clip(input.title, 160).trim();
  if (!title) throw fail(400, "Give the notification a title.");
  const business = canonBusiness(input.business);
  if (!business) throw fail(400, "Choose a business: Appleton, Bellgreave, 5pm Theory, Personal or Other.");
  const body = clip(input.body, 2000).trim();
  return {
    id: cleanClientId(input.id) || crypto.randomUUID(),
    clientId: cleanClientId(input.id),
    kind: "notice",
    title,
    body,
    business,
    link: cleanLink(input.link),
    priority: canonPriority(input.priority),
    at: new Date().toISOString(),
    seen: false,
    dismissed: false,
  };
}

export async function addNotification(input) {
  const built = validateNotification(input);
  const { clientId, ...item } = built;
  const items = await getJSON(FEED_KEY, []);
  if (clientId) {
    const existing = items.find((i) => i.id === clientId);
    if (existing) return { notification: publicItem(existing), duplicate: true };
  }
  items.unshift(item);
  await setJSON(FEED_KEY, trimFeed(items));
  return { notification: publicItem(item), duplicate: false };
}

async function mutate(body, fn) {
  const items = await getJSON(FEED_KEY, []);
  const ids = new Set(Array.isArray(body?.ids) ? body.ids.map((id) => String(id)) : []);
  if (!body?.all && !ids.size) return feedForPage();
  for (const it of items) {
    if (body.all || ids.has(it.id)) fn(it);
  }
  await setJSON(FEED_KEY, items);
  return feedForPage();
}

export function markRead(body) {
  return mutate(body, (it) => { it.seen = true; });
}

export function dismiss(body) {
  if (body?.all) throw fail(400, "Say which ones to dismiss.");
  return mutate(body, (it) => { it.dismissed = true; });
}

function webhookHeader() {
  const name = (process.env.MAIN_MAN_WEBHOOK_KEY_HEADER || "Authorization").trim() || "Authorization";
  const key = String(process.env.MAIN_MAN_WEBHOOK_KEY || "").trim();
  if (/[\r\n]/.test(key) || /[\r\n]/.test(name)) throw fail(500, "The webhook key isn't valid.");
  if (!/^[A-Za-z0-9-]{1,80}$/.test(name)) throw fail(500, "The webhook header name isn't valid.");
  const blocked = ["host", "content-type", "content-length", "transfer-encoding", "connection", "cookie"];
  if (blocked.includes(name.toLowerCase())) throw fail(500, "That webhook header name isn't allowed.");
  const value = name.toLowerCase() === "authorization" ? `Bearer ${key}` : key;
  return { name, value };
}

export async function deliverMessage(message) {
  const url = (process.env.MAIN_MAN_WEBHOOK_URL || "").trim();
  const key = String(process.env.MAIN_MAN_WEBHOOK_KEY || "").trim();
  if (!url || !key) throw fail(503, "The main man isn't connected yet. Add the webhook address and key in Vercel.");
  let parsed;
  try { parsed = new URL(url); } catch { throw fail(503, "The webhook address isn't a valid URL."); }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") throw fail(503, "The webhook address must be an http or https URL.");
  if (process.env.VERCEL && parsed.protocol !== "https:") throw fail(503, "The webhook address must start with https.");
  const header = webhookHeader();
  const sent_at = new Date().toISOString();
  const payload = { message, sent_at, source: "moorhouse-daily" };
  let r;
  try {
    r = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json", [header.name]: header.value },
      body: JSON.stringify(payload),
      redirect: "manual",
      signal: AbortSignal.timeout(15000),
    });
  } catch (e) {
    console.error("main man webhook failed", e?.name || "error");
    throw fail(502, "The main man didn't answer. Try again in a moment.");
  }
  await r.arrayBuffer().catch(() => {});
  if (r.status >= 300 && r.status < 400) throw fail(502, "The webhook address redirected. The message was not sent.");
  if (!r.ok) throw fail(502, `The main man returned ${r.status}. The message was not sent.`);
  return payload;
}

export async function sendMessage(body) {
  const raw = body?.message;
  if (typeof raw !== "string") throw fail(400, "Send the message as text.");
  if (raw.length > 2000) throw fail(400, "That message is too long.");
  const message = raw.trim();
  if (!message) throw fail(400, "The message is empty.");
  if ((await bump("mainman:out", 600)) > 30) throw fail(429, "That's a lot of messages. Wait a few minutes and try again.");
  const payload = await deliverMessage(message);
  const item = {
    id: crypto.randomUUID(),
    kind: "sent",
    title: "Sent",
    body: message,
    business: null,
    link: null,
    priority: null,
    at: payload.sent_at,
    seen: true,
    dismissed: false,
  };
  const items = await getJSON(FEED_KEY, []);
  items.unshift(item);
  await setJSON(FEED_KEY, trimFeed(items));
  return { ...(await feedForPage()), item: publicItem(item) };
}
