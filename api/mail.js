import { route, fail, clip } from "../lib/http.js";
import { getJSON, setJSON, setNX, del } from "../lib/store.js";
import { seal } from "../lib/secret.js";
import {
  PROVIDERS, getAccounts, saveAccounts, publicAccount, newAccount, verifyImap,
  outlookStart, outlookPoll, outlookWhoAmI, checkAll,
} from "../lib/mail.js";

const HEX = /^#[0-9a-f]{6}$/i;
const THROTTLE_S = 60;

async function view(extra = {}) {
  const [accounts, state, items, stats] = await Promise.all([getAccounts(), getJSON("mail:state", {}), getJSON("mail:items", []), getJSON("mail:stats", { filtered: 0 })]);
  return { accounts: accounts.map((a) => publicAccount(a, state[a.id])), items, filtered: stats.filtered || 0, outlookReady: Boolean(process.env.MS_CLIENT_ID), ...extra };
}

export default route(["GET", "POST"], async (req, res, body) => {
  const action = new URL(req.url, "http://x").searchParams.get("action") || "list";

  if (action === "list") return view();

  if (action === "check") {
    const accounts = await getAccounts();
    if (!accounts.length) return view({ added: [] });
    const last = await getJSON("mail:lastRun", 0);
    if (!body.force && Date.now() - last < THROTTLE_S * 1000) return view({ added: [] });
    if (!(await setNX("mail:lock", 1, 55))) return view({ added: [] }); // another device is checking
    try {
      await setJSON("mail:lastRun", Date.now());
      const { added } = await checkAll();
      return view({ added });
    } finally { await del("mail:lock"); }
  }

  if (action === "add-imap") {
    const provider = PROVIDERS[body.provider] ? body.provider : null;
    if (!provider) throw fail(400, "Choose iCloud, Gmail or Other.");
    const email = clip(body.email, 120).trim(), pass = provider === "gmail" ? clip(body.password, 200).replace(/\s+/g, "") : clip(body.password, 200).trim();
    if (!email || !pass) throw fail(400, "Enter the email address and app password.");
    const host = provider === "imap" ? clip(body.host, 120).trim() : PROVIDERS[provider].host;
    if (!host) throw fail(400, "Enter the IMAP server, e.g. imap.yourprovider.com");
    // iCloud logs in with the part before @ for icloud/me/mac addresses; the full address also works
    try { await verifyImap({ host, user: email, pass }); } catch (e) { throw fail(400, e.message); }
    const accounts = await getAccounts();
    if (accounts.some((a) => a.email.toLowerCase() === email.toLowerCase())) throw fail(400, "That account is already added.");
    const color = HEX.test(body.color || "") ? body.color : "#3A9BF0";
    accounts.push(newAccount({ provider, email, label: clip(body.label, 30).trim() || PROVIDERS[provider].name, color, host, secret: { user: email, pass } }));
    await saveAccounts(accounts);
    return view();
  }

  if (action === "outlook-start") {
    const d = await outlookStart();
    await setJSON("mail:pending", {
      device_code: d.device_code, interval: d.interval || 5, expiresAt: Date.now() + (d.expires_in || 900) * 1000,
      label: clip(body.label, 30).trim() || "Outlook", color: HEX.test(body.color || "") ? body.color : "#3A9BF0",
    });
    return { user_code: d.user_code, verification_uri: d.verification_uri, expires_in: d.expires_in, interval: d.interval || 5 };
  }

  if (action === "outlook-poll") {
    const p = await getJSON("mail:pending", null);
    if (!p) throw fail(400, "No Outlook sign-in in progress.");
    if (Date.now() > p.expiresAt) { await del("mail:pending"); throw fail(400, "The sign-in code expired. Start again."); }
    const r = await outlookPoll(p.device_code);
    if (r.pending) return { pending: true };
    const t = r.tokens;
    const email = await outlookWhoAmI(t.access_token);
    const accounts = await getAccounts();
    const secret = { refresh_token: t.refresh_token, access_token: t.access_token, expires_at: Date.now() + (t.expires_in || 3600) * 1000 };
    const existing = accounts.find((a) => a.provider === "outlook" && a.email.toLowerCase() === String(email).toLowerCase());
    if (existing) existing.secret = seal(secret);
    else accounts.push(newAccount({ provider: "outlook", email, label: p.label, color: p.color, secret }));
    await saveAccounts(accounts);
    await del("mail:pending");
    return view({ connected: email });
  }

  if (action === "update") {
    const accounts = await getAccounts();
    const a = accounts.find((x) => x.id === body.id);
    if (!a) throw fail(404, "That account no longer exists.");
    if ("label" in body) a.label = clip(body.label, 30).trim() || a.label;
    if (HEX.test(body.color || "")) a.color = body.color;
    await saveAccounts(accounts);
    return view();
  }

  if (action === "remove") {
    const accounts = (await getAccounts()).filter((x) => x.id !== body.id);
    const state = await getJSON("mail:state", {}); delete state[body.id];
    const items = (await getJSON("mail:items", [])).filter((x) => x.acc !== body.id);
    await Promise.all([saveAccounts(accounts), setJSON("mail:state", state), setJSON("mail:items", items)]);
    return view();
  }

  if (action === "seen") {
    const items = await getJSON("mail:items", []);
    const keys = new Set(Array.isArray(body.keys) ? body.keys : []);
    for (const it of items) if (body.all || keys.has(it.key)) it.seen = true;
    await setJSON("mail:items", items);
    return view();
  }

  if (action === "clear") {
    await setJSON("mail:items", (await getJSON("mail:items", [])).filter((x) => !x.seen));
    return view();
  }

  throw fail(400, "Unknown action.");
});
