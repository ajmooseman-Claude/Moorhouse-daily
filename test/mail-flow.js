process.env.SESSION_SECRET ||= "0123456789abcdef0123456789";
process.env.MS_CLIENT_ID = "test-client";
delete process.env.ANTHROPIC_API_KEY;
const { saveAccounts, newAccount, checkAll } = await import("../lib/mail.js");
const ok = (c, m) => { console.log((c ? "ok   " : "FAIL ") + m); if (!c) process.exitCode = 1; };
let inbox = [
  { id: "a1", subject: "Offer on the Bolton unit", from: { emailAddress: { name: "Dave Hughes", address: "dave@hughesproperty.co.uk" } }, receivedDateTime: "2026-09-30T10:00:00Z", bodyPreview: "We'd like to offer...", webLink: "https://outlook.office.com/a1", isRead: false, inferenceClassification: "focused", internetMessageId: "<a1@x>" },
  { id: "a2", subject: "50% off this weekend", from: { emailAddress: { name: "Shop", address: "deals@shop.com" } }, receivedDateTime: "2026-09-30T10:01:00Z", bodyPreview: "", isRead: false, inferenceClassification: "other" },
  { id: "a3", subject: "Your password was changed", from: { emailAddress: { name: "Service", address: "no-reply@service.com" } }, receivedDateTime: "2026-09-30T10:02:00Z", bodyPreview: "", isRead: false, inferenceClassification: "focused" },
  { id: "a4", subject: "Already read", from: { emailAddress: { name: "Ann", address: "ann@x.com" } }, receivedDateTime: "2026-09-30T10:03:00Z", bodyPreview: "", isRead: true, inferenceClassification: "focused" },
];
let tokenCalls = 0;
globalThis.fetch = async (url) => {
  url = String(url);
  if (url.includes("/token")) { tokenCalls++; return new Response(JSON.stringify({ access_token: "AT", refresh_token: "RT2", expires_in: 3600 })); }
  if (url.includes("graph.microsoft.com")) return new Response(JSON.stringify({ value: [...inbox].reverse() }));
  return new Response("{}", { status: 404 });
};
await saveAccounts([newAccount({ provider: "outlook", email: "james@work.com", label: "Work", color: "#8B6BFF", secret: { refresh_token: "RT1" } })]);
const r1 = await checkAll();
ok(r1.added.length === 1 && r1.added[0].subject === "Offer on the Bolton unit", "only the real person's unread email pops up");
ok(r1.added[0].link === "https://outlook.office.com/a1" && r1.added[0].mailLink.startsWith("message://"), "links back to Outlook and Apple Mail");
ok(tokenCalls === 1, "access token refreshed once");
const r2 = await checkAll();
ok(r2.added.length === 0 && r2.items.length === 1, "the same email isn't shown twice");
ok(tokenCalls === 1, "cached access token reused on the next check");
inbox.push({ id: "a5", subject: "Invoice overdue", from: { emailAddress: { name: "Karen Price", address: "karen@accountants.co.uk" } }, receivedDateTime: "2026-09-30T10:05:00Z", bodyPreview: "", isRead: false, inferenceClassification: "focused" });
const r3 = await checkAll();
ok(r3.added.length === 1 && r3.items[0].subject === "Invoice overdue", "a newer email is added at the top");
