// Feed markup for The main man. Shared by the page and the tests.
globalThis.MDFeed = (() => {
  const BUSINESSES = {
    appleton: { label: "Appleton", color: "#FF6B4A" },
    bellgreave: { label: "Bellgreave", color: "#14B8A6" },
    "5pm": { label: "5pm Theory", color: "#8B6BFF" },
    personal: { label: "Personal", color: "#3A9BF0" },
    other: { label: "Other", color: "#7A8699" },
  };

  function esc(s) {
    return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  function business(key) {
    return BUSINESSES[key] || { label: "Other", color: "#7A8699" };
  }

  function londonWhen(iso, now = new Date()) {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "";
    const opt = { timeZone: "Europe/London" };
    const time = new Intl.DateTimeFormat("en-GB", { ...opt, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(d);
    const dayKey = (x) => new Intl.DateTimeFormat("en-CA", { ...opt, year: "numeric", month: "2-digit", day: "2-digit" }).format(x);
    if (dayKey(d) === dayKey(now)) return time;
    const date = new Intl.DateTimeFormat("en-GB", { ...opt, day: "numeric", month: "short" }).format(d);
    return `${date}, ${time}`;
  }

  function sorted(items) {
    return (Array.isArray(items) ? items : [])
      .filter((i) => i && !i.dismissed)
      .slice()
      .sort((a, b) => String(b.at || "").localeCompare(String(a.at || "")) || String(b.id || "").localeCompare(String(a.id || "")));
  }

  function renderItem(it, now) {
    const sent = it.kind === "sent";
    const biz = sent ? null : business(it.business);
    const color = biz ? biz.color : "#7A8699";
    const unread = !sent && !it.seen;
    const link = /^https?:\/\//i.test(it.link || "") ? it.link : "";
    const tags = [
      sent ? `<span class="cat">Sent</span>` : `<span class="acc">The main man</span>`,
      biz ? `<span class="cat">${esc(biz.label)}</span>` : "",
      it.priority === "high" ? `<span class="cat high">High</span>` : "",
      unread ? `<span class="cat unread">Unread</span>` : "",
    ].filter(Boolean).join("");
    const acts = [
      link ? `<a class="btn sm" href="${esc(link)}" target="_blank" rel="noopener noreferrer">Open</a>` : "",
      unread ? `<button type="button" class="btn sm" data-act="read">Mark read</button>` : "",
      `<button type="button" class="btn sm plain" data-act="dismiss">Dismiss</button>`,
    ].join("");
    return `<article class="ti${sent ? " sent" : ""}${it.seen ? " seen" : ""}${unread ? " unread" : ""}" data-id="${esc(it.id)}" data-kind="${sent ? "sent" : "notice"}" style="--c:${esc(color)}">
      <div class="ti-top"><span class="dot"></span>${tags}<span class="when">${esc(londonWhen(it.at, now))}</span></div>
      ${sent ? "" : `<div class="from">${esc(it.title)}</div>`}
      ${it.body ? `<div class="sum">${esc(it.body)}</div>` : ""}
      <div class="ti-acts">${acts}</div>
    </article>`;
  }

  function renderFeed(items, now) {
    const list = sorted(items);
    if (!list.length) return `<div class="empty"><strong>Nothing from The main man yet.</strong>Alerts and the messages you send will show up here.</div>`;
    return list.map((it) => renderItem(it, now)).join("");
  }

  function renderPopup(it) {
    const biz = business(it.business);
    const high = it.priority === "high" ? `<span class="cat high">High</span>` : "";
    return `<div class="pop-top"><span class="dot"></span><span class="acc">The main man</span><span class="cat">${esc(biz.label)}</span>${high}<span class="when">now</span><button type="button" class="ib x" aria-label="Close"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M6 6l12 12M18 6 6 18"/></svg></button></div><div class="from">${esc(it.title)}</div>${it.body ? `<div class="sum">${esc(it.body)}</div>` : ""}`;
  }

  return { BUSINESSES, business, esc, londonWhen, sorted, renderItem, renderFeed, renderPopup };
})();
