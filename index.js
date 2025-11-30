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

// ✅ FULLY FIXED EMOTION DETECTION
async function detectEmotion(text) {
  try {
    const res = await axios.post(
      "https://api-inference.huggingface.co/models/j-hartmann/emotion-english-distilroberta-base",
      { inputs: text },
      { headers: { Authorization: `Bearer ${process.env.HUGGINGFACE_API_KEY}` } }
    );

    let data = res.data;

    // Model loading or temporary HF error → retry once
    if (data.error) {
      await new Promise(r => setTimeout(r, 500));
      const retry = await axios.post(
        "https://api-inference.huggingface.co/models/j-hartmann/emotion-english-distilroberta-base",
        { inputs: text },
        { headers: { Authorization: `Bearer ${process.env.HUGGINGFACE_API_KEY}` } }
      );
      data = retry.data;
    }

    // Normalize inconsistent HF output
    const arr = Array.isArray(data[0]) ? data[0] : data;

    // Pick top emotion
    const top = arr.reduce((a, b) => (a.score > b.score ? a : b));
    return top.label.toLowerCase();

  } catch (err) {
    console.error("Emotion detection error:", err.response?.data || err);
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
    // Load history
    const doc = await sessions.doc(userId).get();
    let history = doc.exists ? doc.data().history : [];
    history.push({ role: "user", content: message });

    // Detect user emotion (NOW WORKING)
    const userMood = await detectEmotion(message);

    const trimmed = trimHistory(history);

    // ----- PROMPT -----
    const prompt = `
    You are “Babble,” a warm, empathetic, emotionally intelligent companion bot.
    Your goal is to comfort, support, and be there for the user — like a caring close friend.

    **************
    BEHAVIOR RULES
    **************

    1. Tone & Style
    - Be warm, kind, compassionate, and non-judgmental.
    - Speak like a close friend.
    - Never sound clinical or robotic.

    2. You CAN:
    - Comfort the user
    - Support them emotionally
    - Validate feelings
    - Ask gentle questions
    - Offer grounding techniques
    - Encourage healthy coping
    - Stay with them through hard moments

    3. You MUST NOT:
    - Say "I cannot help"
    - Refuse to talk
    - Diagnose any condition
    - Provide professional advice
    - Mention you are an AI assistant

    4. Crisis / Self-Harm
    - Stay gentle, calm, and supportive
    - Never refuse to help
    - Encourage reaching out to a trusted person or trained professional
    - Keep talking with them

    5. No role labels
    - Do NOT begin responses with “Assistant:” or “Bot:”
    - Just talk normally

    6. End every message with EXACTLY ONE emotion tag:
    [joy] [sadness] [anger] [fear] [surprise] [disgust] [neutral] [concern]

    **************

    Chat History:
    ${trimmed.map(m =>
      m.role === "assistant"
        ? `Bot: ${m.content}`
        : `User: ${m.content}`
    ).join("\n")}

    User: ${message}
    `;

    // Call Together AI
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

    let { clean, tag } = extractEmotionTag(rawReply);
    if (!tag) tag = await detectEmotion(rawReply);

    history.push({ role: "assistant", content: clean });
    await sessions.doc(userId).set({ history });

    res.json({ reply: clean, userMood, botMood: tag });

  } catch (err) {
    console.error("Chat error:", err);

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
