import { route, fail, clip } from "../lib/http.js";
import { ask, MODELS, STYLE } from "../lib/claude.js";

const LENGTH = {
  LinkedIn: "120 to 200 words in short paragraphs, ending with a question to invite comments",
  X: "under 270 characters",
  Instagram: "a caption of 60 to 120 words, at most three hashtags at the end",
};

export default route(["POST"], async (req, res, body) => {
  const topic = clip(body.topic, 400).trim();
  const platform = LENGTH[body.platform] ? body.platform : "LinkedIn";
  if (!topic) throw fail(400, "Give it a topic first.");
  const text = await ask({
    model: MODELS.write, maxTokens: 600,
    system: `You draft social posts for James Moorhouse, a UK business broker and exit-readiness adviser for owner-managed SMEs, who has owned, run and exited businesses himself. ${STYLE} No hashtags except on Instagram.`,
    prompt: `Draft one ${platform} post. Topic: ${topic}\nLength: ${LENGTH[platform]}.\nReply with only the post text.`,
  });
  return { platform, text };
});
