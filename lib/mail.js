// Watches several mailboxes (read-only), filters out bulk mail, and asks Claude which new emails matter.
import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";
import { getJSON, setJSON } from "./store.js";
import { seal, open } from "./secret.js";
import { ask, hasClaude, MODELS } from "./claude.js";

export const PROVIDERS = {
  icloud: { name: "iCloud", host: "imap.mail.me.com", port: 993 },
  gmail: { name: "Gmail", host: "imap.gmail.com", port: 993 },
  imap: { name: "Email", host: "", port: 993 },
};
const MAX_ITEMS = 150;
const MAX_NEW_PER_ACCOUNT = 25;

// ---------- account storage ----------
export async function getAccounts() { return getJSON("mail:accounts", []); }
export async function saveAccounts(list) { await setJSON("mail:accounts", list); }
export function publicAccount(a, st = {}) {
  return { id: a.id, provider: a.provider, label: a.label, email: a.email, color: a.color, lastCheck: st.lastCheck || null, lastError: st.lastError || null };
}
export function newAccount({ provider, email, label, color, host, port, secret }) {
  return {
    id: "m" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    provider, email, label: label || PROVIDERS[provider]?.name || "Outlook", color,
    host: host || PROVIDERS[provider]?.host || null, port: port || 993,
    secret: seal(secret),
  };
}

// ---------- filters ----------
const BULK_FROM = /(^|[._-])(newsletter|news|marketing|promo|promotions|offers|deals|digest|mailer-daemon|postmaster)([._-]|@)/i;
export function preFilter({ headers = {}, fromAddress = "" }) {
  const h = (k) => String(headers[k] || "").toLowerCase();
  if (h("list-unsubscribe") || h("list-id")) return "mailing list";
  if (/bulk|list|junk/.test(h("precedence"))) return "bulk";
  if (h("auto-submitted") && h("auto-submitted") !== "no") return "automated";
  if (BULK_FROM.test(fromAddress)) return "bulk sender";
  return null;
}
const AUTOMATED_FROM = /no-?reply|do-?not-?reply|notifications?@|alerts?@|automated|bounce/i;

function parseHeaders(buf) {
  const out = {};
  const text = buf ? buf.toString("utf8").replace(/\r?\n[ \t]+/g, " ") : "";
  for (const line of text.split(/\r?\n/)) {
    const i = line.indexOf(":"); if (i < 1) continue;
    out[line.slice(0, i).trim().toLowerCase()] = line.slice(i + 1).trim();
  }
  return out;
}
const clean = (s, n) => String(s || "").replace(/\s+/g, " ").trim().slice(0, n);

// ---------- IMAP (iCloud, Gmail, others) ----------
export async function verifyImap({ host, port = 993, user, pass }) {
  const client = new ImapFlow({ host, port, secure: true, auth: { user, pass }, logger: false, socketTimeout: 20000 });
  try { await client.connect(); await client.logout(); }
  catch (e) {
    const m = String(e.responseText || e.message || e);
    throw new Error(/auth|login|credential|password/i.test(m) ? "The email address or app password wasn't accepted." : `Couldn't connect: ${m.slice(0, 120)}`);
  }
}

async function checkImap(acc, st) {
  const { user, pass } = open(acc.secret);
  const client = new ImapFlow({ host: acc.host, port: acc.port || 993, secure: true, auth: { user, pass }, logger: false, socketTimeout: 25000 });
  await client.connect();
  const found = [];
  try {
    const lock = await client.getMailboxLock("INBOX", { readOnly: true });
    try {
      const mb = client.mailbox;
      const top = mb.uidNext - 1;
      let uids = [];
      const gmailPrimary = acc.provider === "gmail" ? { gmraw: "{category:primary category:updates}" } : {};
      if (!st.uidValidity || String(st.uidValidity) !== String(mb.uidValidity) || !st.lastUid) {
        // first look: unread from the last 24 hours
        uids = (await client.search({ seen: false, since: new Date(Date.now() - 864e5), ...gmailPrimary }, { uid: true })) || [];
      } else if (top > st.lastUid) {
        uids = (await client.search({ uid: `${st.lastUid + 1}:*`, seen: false, ...gmailPrimary }, { uid: true })) || [];
        uids = uids.filter((u) => u > st.lastUid);
      }
      st.uidValidity = String(mb.uidValidity);
      st.lastUid = Math.max(st.lastUid || 0, top);
      uids = uids.sort((a, b) => a - b).slice(-MAX_NEW_PER_ACCOUNT);
      if (uids.length) {
        for await (const m of client.fetch(uids, {
          uid: true, envelope: true, internalDate: true, threadId: true,
          headers: ["list-unsubscribe", "list-id", "precedence", "auto-submitted"],
          source: { maxLength: 24000 },
        }, { uid: true })) {
          const from = m.envelope?.from?.[0] || {};
          let text = "";
          try { const p = await simpleParser(m.source); text = p.text || (p.html ? p.html.replace(/<[^>]+>/g, " ") : ""); } catch {}
          const msgId = m.envelope?.messageId || "";
          let link = acc.provider === "gmail" && m.threadId
            ? `https://mail.google.com/mail/u/?authuser=${encodeURIComponent(acc.email)}#all/${BigInt(m.threadId).toString(16)}`
            : acc.provider === "icloud" ? "https://www.icloud.com/mail/" : null;
          found.push({
            key: `${acc.id}:${st.uidValidity}:${m.uid}`,
            acc: acc.id,
            fromName: clean(from.name, 80), fromAddress: clean(from.address, 120),
            subject: clean(m.envelope?.subject || "(no subject)", 200),
            snippet: clean(text, 600),
            at: new Date(m.internalDate || m.envelope?.date || Date.now()).toISOString(),
            headers: parseHeaders(m.headers),
            link, mailLink: msgId ? `message://${encodeURIComponent(msgId)}` : null,
          });
        }
      }
    } finally { lock.release(); }
  } finally { await client.logout().catch(() => {}); }
  return found;
}

// ---------- Microsoft (Outlook / Microsoft 365) via Graph ----------
const MS = "https://login.microsoftonline.com/common/oauth2/v2.0";
const MS_SCOPE = "offline_access User.Read Mail.Read";
const msClient = () => {
  const id = process.env.MS_CLIENT_ID;
  if (!id) { const e = new Error("Add MS_CLIENT_ID in Vercel first (see the setup guide)."); e.status = 400; e.expose = true; throw e; }
  return id;
};
async function form(url, params) {
  const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(params) });
  return { ok: r.ok, j: await r.json().catch(() => ({})) };
}
export async function outlookStart() {
  const { ok, j } = await form(`${MS}/devicecode`, { client_id: msClient(), scope: MS_SCOPE });
  if (!ok) { const e = new Error(j.error_description?.split("\r\n")[0] || "Microsoft sign-in couldn't start."); e.status = 400; e.expose = true; throw e; }
  return j; // device_code, user_code, verification_uri, expires_in, interval
}
export async function outlookPoll(deviceCode) {
  const { ok, j } = await form(`${MS}/token`, { client_id: msClient(), grant_type: "urn:ietf:params:oauth:grant-type:device_code", device_code: deviceCode });
  if (ok) return { tokens: j };
  if (j.error === "authorization_pending" || j.error === "slow_down") return { pending: true };
  const e = new Error(j.error === "expired_token" ? "The sign-in code expired. Start again." : (j.error_description?.split("\r\n")[0] || "Microsoft sign-in failed."));
  e.status = 400; e.expose = true; throw e;
}
async function msAccessToken(acc) {
  const sec = open(acc.secret);
  if (sec.access_token && sec.expires_at > Date.now() + 60000) return { token: sec.access_token };
  const { ok, j } = await form(`${MS}/token`, { client_id: msClient(), grant_type: "refresh_token", refresh_token: sec.refresh_token, scope: MS_SCOPE });
  if (!ok) throw new Error("Outlook needs signing in again (Settings › Email).");
  const next = { refresh_token: j.refresh_token || sec.refresh_token, access_token: j.access_token, expires_at: Date.now() + (j.expires_in || 3600) * 1000 };
  return { token: j.access_token, resealed: seal(next) };
}
export async function outlookWhoAmI(accessToken) {
  const r = await fetch("https://graph.microsoft.com/v1.0/me?$select=mail,userPrincipalName", { headers: { Authorization: `Bearer ${accessToken}` } });
  const j = await r.json().catch(() => ({}));
  return j.mail || j.userPrincipalName || "Outlook";
}
async function checkOutlook(acc, st) {
  const { token, resealed } = await msAccessToken(acc);
  if (resealed) acc.secret = resealed;
  const since = st.since || new Date(Date.now() - 864e5).toISOString();
  const u = new URL("https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messages");
  u.searchParams.set("$filter", `receivedDateTime gt ${since}`);
  u.searchParams.set("$orderby", "receivedDateTime desc");
  u.searchParams.set("$top", String(MAX_NEW_PER_ACCOUNT));
  u.searchParams.set("$select", "id,subject,from,receivedDateTime,bodyPreview,webLink,isRead,inferenceClassification,internetMessageId");
  const r = await fetch(u, { headers: { Authorization: `Bearer ${token}` } });
  if (!r.ok) throw new Error(`Outlook returned ${r.status}`);
  const list = (await r.json()).value || [];
  if (list[0]) st.since = list[0].receivedDateTime;
  else if (!st.since) st.since = new Date().toISOString();
  return list.filter((m) => !m.isRead).map((m) => ({
    key: `${acc.id}:${m.id}`,
    acc: acc.id,
    fromName: clean(m.from?.emailAddress?.name, 80), fromAddress: clean(m.from?.emailAddress?.address, 120),
    subject: clean(m.subject || "(no subject)", 200), snippet: clean(m.bodyPreview, 600),
    at: m.receivedDateTime, headers: {},
    other: m.inferenceClassification === "other", // Outlook's own "Other" (not Focused) inbox
    link: m.webLink || null, mailLink: m.internetMessageId ? `message://${encodeURIComponent(m.internetMessageId)}` : null,
  }));
}

// ---------- Claude sorting ----------
const RULES = `James Moorhouse is a UK business broker (New Broad Street Business Sales), exit-readiness adviser, owner of Moose Storage Ltd (self storage) and a commercial property landlord.
An email is RELEVANT if any of these apply:
- person: a real person wrote it to James personally (not a mass mailing), including replies in a conversation.
- business: it's from or about a client, buyer, seller, tenant, solicitor, accountant, broker, lender or business contact, or about a deal, valuation, property or storage customer.
- money: invoices, payment requests or failures, bank or card security, HMRC, VAT, council or business rates, legal or contract deadlines, renewals that need action.
NOT relevant: newsletters, marketing, promotions, sales outreach from strangers, routine order or delivery receipts, social media and app notifications, automated alerts that need no action, spam.`;

export async function classify(msgs) {
  if (!msgs.length) return [];
  if (!hasClaude()) {
    return msgs.map((m) => ({ id: m.i, relevant: !AUTOMATED_FROM.test(m.fromAddress), category: "person", summary: m.subject }));
  }
  const input = msgs.map((m) => ({ id: m.i, from: `${m.fromName} <${m.fromAddress}>`, subject: m.subject, preview: m.snippet.slice(0, 400), automated_sender: AUTOMATED_FROM.test(m.fromAddress) }));
  const text = await ask({
    model: MODELS.fast, maxTokens: 1500,
    system: "You sort incoming email for a busy business owner. Be strict: only let through what he would want interrupting him for. Write summaries in British English, no dashes.",
    prompt: `${RULES}\n\nFor each email reply with a JSON array of objects: {"id": number, "relevant": boolean, "category": "person"|"business"|"money", "summary": "what it's about or what's needed, 12 words max"}. Reply with only the JSON array.\n\nEmails:\n${JSON.stringify(input)}`,
  });
  const m = text.match(/\[[\s\S]*\]/);
  try { return JSON.parse(m ? m[0] : text); } catch { return msgs.map((x) => ({ id: x.i, relevant: false })); }
}

// ---------- the check ----------
export async function checkAll() {
  const accounts = await getAccounts();
  const state = await getJSON("mail:state", {});
  const results = await Promise.allSettled(accounts.map(async (acc) => {
    const st = state[acc.id] || (state[acc.id] = {});
    try {
      const got = acc.provider === "outlook" ? await checkOutlook(acc, st) : await checkImap(acc, st);
      st.lastError = null; return got;
    } catch (e) {
      st.lastError = clean(e.message || e, 160); return [];
    } finally { st.lastCheck = new Date().toISOString(); }
  }));
  await saveAccounts(accounts); // Outlook tokens may have been refreshed
  const items = await getJSON("mail:items", []);
  const known = new Set(items.map((x) => x.key));
  const fresh = results.flatMap((r) => (r.status === "fulfilled" ? r.value : [])).filter((m) => !known.has(m.key));

  const stats = await getJSON("mail:stats", { filtered: 0 });
  const toSort = [];
  for (const m of fresh) {
    if (m.other || preFilter(m)) { stats.filtered++; continue; }
    toSort.push({ ...m, i: toSort.length });
  }
  let verdicts = [];
  try { verdicts = await classify(toSort); } catch (e) { console.error("classify failed", e); verdicts = toSort.map((m) => ({ id: m.i, relevant: true, summary: m.subject })); }
  const byId = new Map(verdicts.map((v) => [Number(v.id), v]));
  const added = [];
  for (const m of toSort) {
    const v = byId.get(m.i);
    if (!v?.relevant) { stats.filtered++; continue; }
    added.push({
      key: m.key, acc: m.acc, fromName: m.fromName || m.fromAddress, fromAddress: m.fromAddress,
      subject: m.subject, summary: clean(v.summary || "", 140), category: ["person", "business", "money"].includes(v.category) ? v.category : "person",
      at: m.at, link: m.link, mailLink: m.mailLink, seen: false,
    });
  }
  added.sort((a, b) => a.at.localeCompare(b.at));
  const next = [...added.reverse(), ...items].slice(0, MAX_ITEMS);
  await Promise.all([setJSON("mail:items", next), setJSON("mail:state", state), setJSON("mail:stats", stats)]);
  return { added, items: next, state, accounts };
}
