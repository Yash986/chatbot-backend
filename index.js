const express = require("express");
const cors = require("cors");
const bodyParser = require("body-parser");
const axios = require("axios");
const admin = require("firebase-admin");

admin.initializeApp({
  credential: admin.credential.cert(JSON.parse(process.env.FIREBASE_CONFIG)),
});

const db = admin.firestore();
const sessions = db.collection("sessions");

const app = express();
app.use(cors());
app.use(bodyParser.json());

/* ------------------------- UTIL FUNCTIONS ------------------------- */

function trimHistory(history, maxTokens = 15000) {
  let tokens = 0;
  const trimmed = [];

  for (let i = history.length - 1; i >= 0; i--) {
    const t = history[i].content.split(/\s+/).length;
    if (tokens + t > maxTokens) break;
    trimmed.unshift(history[i]);
    tokens += t;
  }

  return trimmed;
}

async function detectEmotion(text) {
  try {
    const res = await axios.post(
      "https://api-inference.huggingface.co/models/j-hartmann/emotion-english-distilroberta-base",
      { inputs: text },
      { headers: { Authorization: `Bearer ${process.env.HUGGINGFACE_API_KEY}` } }
    );

    const top = res.data[0].reduce((a, b) => (a.score > b.score ? a : b));
    return top.label.toLowerCase();
  } catch {
    return "neutral";
  }
}

function extractEmotionTag(raw) {
  const match = raw.match(/\[(\w+)\]\s*$/);
  if (!match) return { clean: raw.trim(), tag: null };

  const tag = match[1].toLowerCase();
  const clean = raw.replace(/\[\w+\]\s*$/, "").trim();

  return { clean, tag };
}

/* ----------------------------- ROUTE ------------------------------ */

app.post("/chat", async (req, res) => {
  const { userId, message } = req.body;
  if (!userId || !message)
    return res.status(400).json({ error: "Missing message or userId" });

  try {
    // Load + update history
    const doc = await sessions.doc(userId).get();
    let history = doc.exists ? doc.data().history : [];
    history.push({ role: "user", content: message });

    // Emotion detection for user
    const userMood = await detectEmotion(message);

    // Trim history
    const trimmed = trimHistory(history);

    // Build prompt
    const prompt = `
You are a friendly and concise chatbot friend.
Always end your reply with ONE emotion tag:
[joy] [sadness] [anger] [fear] [surprise] [disgust] [neutral] [concern]

Chat History:
${trimmed.map(m =>
  m.role === "assistant"
    ? `Bot: ${m.content}`
    : `User: ${m.content}`
).join("\n")}

User: ${message}
`;

    // Call Together API
    const ai = await axios.post(
      "https://api.together.xyz/v1/chat/completions",
      {
        model: "mistralai/Mixtral-8x7B-Instruct-v0.1",
        messages: [{ role: "user", content: prompt }],
        temperature: 0.7,
        max_tokens: 250,
      },
      { headers: { Authorization: `Bearer ${process.env.TOGETHER_API_KEY}` } }
    );

    const rawReply = ai.data.choices[0].message.content;

    // Extract tag
    let { clean, tag } = extractEmotionTag(rawReply);

    // Fallback if missing
    if (!tag) tag = await detectEmotion(rawReply);

    // Save assistant reply (cleaned)
    history.push({ role: "assistant", content: clean });
    await sessions.doc(userId).set({ history });

    res.json({ reply: clean, userMood, botMood: tag });
  } catch (err) {
    res.status(500).json({
      reply: "Sorry, I ran into an issue 😞",
      userMood: "neutral",
      botMood: "sadness",
    });
  }
});

/* ----------------------------- SERVER ----------------------------- */
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on ${PORT}`));

