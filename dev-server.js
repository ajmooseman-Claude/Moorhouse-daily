// Local stand-in for Vercel: serves /public and runs /api/*.js handlers.
// Usage: DASHBOARD_PASSWORD=test SESSION_SECRET=0123456789abcdef0123 node dev-server.js
import http from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";

const PORT = Number(process.env.PORT || 3000);
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".svg": "image/svg+xml", ".png": "image/png", ".webmanifest": "application/manifest+json", ".json": "application/json" };

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  if (url.pathname.startsWith("/api/")) {
    const name = url.pathname.slice(5).replace(/[^a-z-]/gi, "");
    try {
      const mod = await import(`./api/${name}.js`);
      let raw = ""; for await (const c of req) raw += c;
      try { req.body = raw ? JSON.parse(raw) : {}; } catch { req.body = raw; }
      return await mod.default(req, res);
    } catch (e) {
      if (e.code === "ERR_MODULE_NOT_FOUND") { res.statusCode = 404; return res.end("Not found"); }
      console.error(e); res.statusCode = 500; return res.end("Server error");
    }
  }
  const p = normalize(url.pathname === "/" ? "/index.html" : url.pathname).replace(/^(\.\.[/\\])+/, "");
  try {
    const body = await readFile(join("public", p));
    res.setHeader("Content-Type", TYPES[extname(p)] || "application/octet-stream");
    res.end(body);
  } catch { res.statusCode = 404; res.end("Not found"); }
});
server.listen(PORT, () => console.log(`Moorhouse Daily on http://localhost:${PORT}`));
