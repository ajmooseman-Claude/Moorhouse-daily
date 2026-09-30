// Minimal Anthropic Messages API client with a tool loop.
const API = "https://api.anthropic.com/v1/messages";
export const MODELS = {
  fast: process.env.CLAUDE_MODEL_FAST || "claude-haiku-4-5-20251001",
  write: process.env.CLAUDE_MODEL_WRITE || "claude-sonnet-5-5",
};
export const hasClaude = () => Boolean(process.env.ANTHROPIC_API_KEY);

export const STYLE =
  "Write in British English. Never use em dashes or en dashes; use commas or full stops instead. " +
  "Plain, warm, confident, human. No emojis. Avoid words like elevate, seamless, unlock, game-changer, delve, landscape, leverage.";

async function call(body) {
  const r = await fetch(API, {
    method: "POST",
    headers: {
      "x-api-key": process.env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) {
    const e = new Error(j?.error?.message || `Claude API error ${r.status}`);
    e.status = r.status === 429 ? 429 : 502; e.expose = true; throw e;
  }
  return j;
}

const textOf = (msg) => msg.content.filter((b) => b.type === "text").map((b) => b.text).join("").trim();

export async function ask({ system, prompt, model = MODELS.write, maxTokens = 800 }) {
  if (!hasClaude()) { const e = new Error("Add an ANTHROPIC_API_KEY in Vercel to use Claude."); e.status = 503; e.expose = true; throw e; }
  const msg = await call({ model, max_tokens: maxTokens, system, messages: [{ role: "user", content: prompt }] });
  return textOf(msg);
}

// tools: [{name, description, input_schema, run(input) -> result}]
export async function askWithTools({ system, prompt, tools, model = MODELS.fast, maxTokens = 700, maxRounds = 5 }) {
  if (!hasClaude()) { const e = new Error("Add an ANTHROPIC_API_KEY in Vercel to use Claude."); e.status = 503; e.expose = true; throw e; }
  const messages = [{ role: "user", content: prompt }];
  const defs = tools.map(({ name, description, input_schema }) => ({ name, description, input_schema }));
  for (let round = 0; round < maxRounds; round++) {
    const msg = await call({ model, max_tokens: maxTokens, system, messages, tools: defs });
    if (msg.stop_reason !== "tool_use") return textOf(msg);
    messages.push({ role: "assistant", content: msg.content });
    const results = [];
    for (const b of msg.content.filter((x) => x.type === "tool_use")) {
      const t = tools.find((x) => x.name === b.name);
      let content, is_error = false;
      try { content = JSON.stringify(t ? await t.run(b.input || {}) : "Unknown tool"); }
      catch (e) { content = String(e.message || e); is_error = true; }
      results.push({ type: "tool_result", tool_use_id: b.id, content, is_error });
    }
    messages.push({ role: "user", content: results });
  }
  return "Done.";
}
