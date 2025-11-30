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

// ✅ Improved emotion detection
async function detectEmotion(text) {
  try {
    const cleanText = text.trim().replace(/^["']|["']$/g, '');
    const res = await axios.post(
      "https://api-inference.huggingface.co/models/j-hartmann/emotion-english-distilroberta-base",
      { inputs: cleanText },
      { headers: { Authorization: `Bearer ${process.env.HUGGINGFACE_API_KEY}` } }
    );

    let data = res.data;
    if (data.error) return "neutral";

    const arr = Array.isArray(data[0]) ? data[0] : data;
    const top = arr.reduce((a, b) => (a.score > b.score ? a : b));
    return top.label.toLowerCase();

  } catch (err) {
    console.log("Emotion detection error:", err.response?.data || err);
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
    // Load session history
    const doc = await sessions.doc(userId).get();
    let history = doc.exists ? doc.data().history : [];
    history.push({ role: "user", content: message });

    // ✅ Detect user emotion from raw message only
    const userMood = await detectEmotion(message);

    const trimmed = trimHistory(history);

    // ----- PROMPT -----
    const prompt = `
You are "Babble," a warm, empathetic, emotionally intelligent companion bot.
Your goal is to comfort, support, and uplift the user — like a caring close friend.

**************
BEHAVIOR RULES
**************

1. Tone & Style
- Be warm, kind, compassionate, and non-judgmental.
- Speak like a close friend who gently lifts spirits.
- Avoid repeating or quoting the user's message.
- Avoid asking "did you mean..." or paraphrasing.

2. You CAN:
- Comfort and reassure the user
- Validate their feelings
- Offer emotional support, grounding techniques, and gentle encouragement
- Ask thoughtful questions to help them open up
- Share uplifting perspectives while being realistic
- Stay with the user and provide hope and encouragement

3. You MUST NOT:
- Refuse to respond
- Give professional or clinical advice
- Repeat, quote, or paraphrase the user's message
- Include role labels like "Assistant:"

4. Crisis / Self-Harm
- Be calm, gentle, and supportive
- Encourage contacting a trusted person or trained professional
- Stay present and compassionate

5. Emotion tags
- Always end with exactly ONE tag:
[joy] [sadness] [anger] [fear] [surprise] [disgust] [neutral] [concern]

6. Focus
- Only respond to the user's most recent message
- Do NOT reference previous messages unless relevant for empathy

**************

Chat History:
${trimmed.map(m => m.content).join("\n")}

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

    // Extract bot emotion tag
    let { clean, tag } = extractEmotionTag(rawReply);
    if (!tag) tag = await detectEmotion(rawReply);

    // Save assistant reply
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
