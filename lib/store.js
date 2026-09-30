// Tiny JSON store on Upstash Redis (REST). Falls back to memory for local development.
const URL_ = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
const mem = globalThis.__mdMem || (globalThis.__mdMem = new Map());

export const hasRedis = Boolean(URL_ && TOKEN);

async function redis(cmd) {
  const r = await fetch(URL_, {
    method: "POST",
    headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify(cmd),
  });
  if (!r.ok) throw new Error(`Storage error ${r.status}`);
  const j = await r.json();
  if (j.error) throw new Error(`Storage error: ${j.error}`);
  return j.result;
}

const K = (k) => `md:${k}`;

export async function getJSON(key, fallback = null) {
  if (!hasRedis) return mem.has(K(key)) ? structuredClone(mem.get(K(key))) : fallback;
  const v = await redis(["GET", K(key)]);
  if (v == null) return fallback;
  try { return JSON.parse(v); } catch { return fallback; }
}

export async function setJSON(key, value) {
  if (!hasRedis) { mem.set(K(key), structuredClone(value)); return; }
  await redis(["SET", K(key), JSON.stringify(value)]);
}

// Counter with expiry, used for login rate limiting.
export async function bump(key, ttlSeconds) {
  if (!hasRedis) {
    const e = mem.get(K(key));
    const now = Date.now();
    const cur = e && e.exp > now ? e : { n: 0, exp: now + ttlSeconds * 1000 };
    cur.n += 1; mem.set(K(key), cur); return cur.n;
  }
  const n = await redis(["INCR", K(key)]);
  if (n === 1) await redis(["EXPIRE", K(key), ttlSeconds]);
  return n;
}
