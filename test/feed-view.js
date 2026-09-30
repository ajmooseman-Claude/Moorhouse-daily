// Renders the main-man feed the same way the page does.
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { BUSINESSES } from "../lib/mainman.js";

const code = readFileSync(new URL("../public/js/feed.js", import.meta.url), "utf8");
const context = vm.createContext({ console });
vm.runInContext(code, context);
const MDFeed = context.MDFeed;
const ok = (c, m) => { console.log((c ? "ok   " : "FAIL ") + m); if (!c) process.exitCode = 1; };

ok(MDFeed && typeof MDFeed.renderFeed === "function", "feed renderer loaded");
for (const [key, label] of Object.entries(BUSINESSES)) {
  ok(MDFeed.business(key).label === label, `business label ${label}`);
}

const now = new Date("2026-09-30T15:00:00.000Z");
ok(MDFeed.londonWhen("2026-09-30T11:35:00.000Z", now) === "12:35", "London time in summer, same day: " + MDFeed.londonWhen("2026-09-30T11:35:00.000Z", now));
const winter = MDFeed.londonWhen("2026-12-01T11:35:00.000Z", now);
ok(winter.includes("11:35") && winter.includes("Dec"), "London time in winter, another day: " + winter);

const items = [
  { id: "old", kind: "notice", title: "Letter to deal with", body: "The council wrote about the roof.", business: "bellgreave", at: "2026-09-30T08:00:00.000Z", seen: true, priority: "normal" },
  { id: "new", kind: "notice", title: "Prospect replied", body: "Helen answered the teaser.", business: "appleton", at: "2026-09-30T11:35:00.000Z", seen: false, priority: "high", link: "https://example.com/thread/42" },
  { id: "sale", kind: "notice", title: "Ebook sold", body: "One copy of the guide.", business: "5pm", at: "2026-09-30T10:00:00.000Z", seen: false },
  { id: "sent1", kind: "sent", title: "Sent", body: "Please chase the Bellgreave letter.", at: "2026-09-30T11:40:00.000Z", seen: true },
  { id: "gone", kind: "notice", title: "Dismissed", body: "Hidden.", business: "other", at: "2026-09-30T11:50:00.000Z", seen: false, dismissed: true },
];
const html = MDFeed.renderFeed(items, now);
ok(html.indexOf("Please chase the Bellgreave letter.") < html.indexOf("Prospect replied"), "newest first, sent message included");
ok(html.indexOf("Prospect replied") < html.indexOf("Ebook sold") && html.indexOf("Ebook sold") < html.indexOf("Letter to deal with"), "notices follow time, newest first");
ok(!html.includes("Dismissed"), "dismissed items stay out of the feed");
ok(html.includes("The main man") && html.includes("Appleton") && html.includes("Bellgreave") && html.includes("5pm Theory"), "business tags and The main man label");
ok(html.includes("12:35") && html.includes("Unread") && html.includes("High") && html.includes('data-act="read"'), "unread row shows London time, unread state and mark read");
ok(html.includes('data-act="dismiss"'), "rows can be dismissed");
ok((html.match(/data-act="read"/g) || []).length === 2, "only unread notices offer mark read");
ok(html.includes("https://example.com/thread/42"), "optional link is kept");
ok(html.includes(">Sent<") && html.includes("Please chase the Bellgreave letter."), "sent messages show as sent");
const readOnly = MDFeed.renderItem(items[0], now);
ok(readOnly.includes("seen") && !readOnly.includes("Mark read") && !readOnly.includes("Unread"), "a read item is marked read and cannot be marked again");

const nasty = MDFeed.renderFeed([{ id: "x", kind: "notice", title: `<script>alert(1)</script>`, body: `a&b "quote"`, business: "personal", at: "2026-09-30T11:35:00.000Z", seen: false, link: "javascript:alert(1)" }], now);
ok(!nasty.includes("<script>") && nasty.includes("&lt;script&gt;") && nasty.includes("a&amp;b"), "titles and bodies are escaped");
ok(!nasty.includes("javascript:"), "a javascript link is not rendered");
ok(nasty.includes("Personal"), "personal tag");

const pop = MDFeed.renderPopup({ title: "Prospect replied", body: "Helen answered.", business: "appleton", priority: "high" });
ok(pop.includes("The main man") && pop.includes("Appleton") && pop.includes("Prospect replied") && !/email/i.test(pop), "popup is labelled The main man, not email");

const page = readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
ok(page.includes('id="mmList"') && page.includes("From The main man") && page.includes("Message The main man") && page.includes('src="/js/feed.js"'), "the page mounts the feed and the message box");
ok(page.includes("Waiting for the first run"), "the morning brief slot is still there");
const fresh = page.slice(page.indexOf("From The main man"), page.indexOf("From The main man") + 900);
ok(!fresh.includes("!") && !fresh.includes("~"), "new feed copy has no exclamation marks or tildes");
