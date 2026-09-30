process.env.SESSION_SECRET ||= "0123456789abcdef0123456789";
const { preFilter, classify } = await import("../lib/mail.js");
const { seal, open } = await import("../lib/secret.js");
const ok = (c, m) => { console.log((c ? "ok   " : "FAIL ") + m); if (!c) process.exitCode = 1; };

ok(preFilter({ headers: { "list-unsubscribe": "<mailto:x>" }, fromAddress: "hello@shop.com" }) === "mailing list", "newsletter with unsubscribe header filtered");
ok(preFilter({ headers: { precedence: "bulk" }, fromAddress: "a@b.com" }) === "bulk", "bulk precedence filtered");
ok(preFilter({ headers: { "auto-submitted": "auto-replied" }, fromAddress: "a@b.com" }) === "automated", "auto-replies filtered");
ok(preFilter({ headers: {}, fromAddress: "marketing@brand.co.uk" }) === "bulk sender", "marketing@ filtered");
ok(preFilter({ headers: {}, fromAddress: "sarah@smithsolicitors.co.uk" }) === null, "a solicitor gets through to Claude");
ok(preFilter({ headers: {}, fromAddress: "noreply@hmrc.gov.uk" }) === null, "HMRC noreply still goes to Claude (money and deadlines)");

const v = await classify([{ i: 0, fromName: "Sarah", fromAddress: "sarah@x.co.uk", subject: "Heads of terms", snippet: "" }, { i: 1, fromName: "App", fromAddress: "no-reply@app.com", subject: "Your weekly stats", snippet: "" }]);
ok(v[0].relevant === true && v[1].relevant === false, "without an API key, people pass and no-reply senders don't");

const s = seal({ user: "a@me.com", pass: "abcd-efgh" });
ok(!s.includes("abcd") && open(s).pass === "abcd-efgh", "passwords are encrypted at rest and decrypt correctly");
let tampered = false; try { open(s.slice(0, -2) + "xx"); } catch { tampered = true; }
ok(tampered, "tampered secrets are rejected");
