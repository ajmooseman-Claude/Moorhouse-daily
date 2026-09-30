import { route, fail, clip } from "../lib/http.js";
import { getJSON, setJSON } from "../lib/store.js";
import crypto from "node:crypto";

export async function addNote(text, via) {
  const t = clip(text, 5000).trim();
  if (!t) throw fail(400, "The note is empty.");
  const notes = await getJSON("notes", []);
  const n = { id: crypto.randomUUID(), text: t, created: new Date().toISOString(), pinned: false, ...(via ? { via: clip(via, 40) } : {}) };
  notes.unshift(n);
  await setJSON("notes", notes.slice(0, 1000));
  return n;
}

export default route(["POST", "PATCH", "DELETE"], async (req, res, body) => {
  const id = new URL(req.url, "http://x").searchParams.get("id");
  if (req.method === "POST") return { note: await addNote(body.text, body.via) };
  const notes = await getJSON("notes", []);
  const i = notes.findIndex((n) => n.id === id);
  if (i < 0) throw fail(404, "That note no longer exists.");
  if (req.method === "DELETE") notes.splice(i, 1);
  else {
    if ("pinned" in body) notes[i].pinned = !!body.pinned;
    if ("text" in body) notes[i].text = clip(body.text, 5000);
  }
  await setJSON("notes", notes);
  return { ok: true };
});
