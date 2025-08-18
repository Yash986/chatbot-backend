const express = require("express");
const cors = require("cors");
const bodyParser = require("body-parser");
const axios = require("axios");
const admin = require("firebase-admin");
const serviceAccount = JSON.parse(process.env.FIREBASE_CONFIG);
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});
const db = admin.firestore();
const sessions = db.collection("sessions");
const app = express();
app.use(cors());
app.use(bodyParser.json());
function trimHistory(history, maxTokens = 15000) {
  let currentTokens = 0;
  let trimmedHistory = [];
  for (let i = history.length - 1; i >= 0; i--) {
    const message = history[i];
    const messageTokens = message.content.split(/\s+/).length;
    if (currentTokens + messageTokens < maxTokens) {
      trimmedHistory.unshift(message);
      currentTokens += messageTokens;
    } else {
      break;
    }
  }
  return trimmedHistory;
}
async function detectEmotion(message) {
  try {
    const response = await axios.post(
      "https://api-inference.huggingface.co/models/j-hartmann/emotion-english-distilroberta-base",
      { inputs: message },
      {
        headers: {
          Authorization: `Bearer ${process.env.HUGGINGFACE_API_KEY}`,
        },
      }
    );
    const predictions = response.data[0];
    const top = predictions.reduce((prev, curr) =>
      prev.score > curr.score ? prev : curr
    );
    return top.label.toLowerCase();
  } catch (err) {
    console.error(
      "Emotion detection error:",
      err.message,
      "Status:", err.response?.status,
      "Data:", err.response?.data
    );
    return "neutral";
  }
}
app.post("/chat", async (req, res) => {
  const { message: userMessage, userId, region } = req.body;

  if (!userMessage || !userId) {
    return res.status(400).json({ error: "Missing message or userId" });
  }

  try {
    const userMood = await detectEmotion(userMessage);
    const sessionRef = sessions.doc(userId);
    const sessionDoc = await sessionRef.get();
    let history = sessionDoc.exists ? sessionDoc.data().history : [];

    history.push({ role: "user", content: userMessage });

    const trimmedHistory = trimHistory(history);

    const combinedPrompt = `
[INSTRUCTIONS]
You are a friendly and concise chatbot that acts as my friend.
Your replies should be brief and to the point.

[RULES]
Your crucial task is to ALWAYS end your reply with an emotion tag.
The tag MUST be one from this list: [joy], [sadness], [anger], [fear], [surprise], [disgust], [neutral], [concern].
The tag MUST be the very last thing of the message with nothing after it.
Only ONE tag should be present in the entire message.
Do not forget or skip the tag.

[CHAT HISTORY]
${trimmedHistory.map(m => `${m.role}: ${m.content}`).join('\n')}

[USER MESSAGE]
${userMessage}
`;
    const aiResponse = await axios.post(
      "https://api.together.xyz/v1/chat/completions",
      {
        model: "mistralai/Mixtral-8x7B-Instruct-v0.1",
        messages: [
          {
            role: "user",
            content: combinedPrompt,
          },
        ],
        temperature: 0.7,
        max_tokens: 250,
      },
      {
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${process.env.TOGETHER_API_KEY}`,
        },
      }
    );

    const rawReply = aiResponse.data.choices[0].message.content;
    let botMood;
    let cleanReply;
    const tagMatch = rawReply.match(/\[(\w+)\]\s*$/);

    if (tagMatch) {
      botMood = tagMatch[1].toLowerCase();
      cleanReply = rawReply.replace(/\[\w+\]\s*$/, '').trim();
    } else {
      console.log("Bot forgot the tag. Detecting mood from message content...");
      botMood = await detectEmotion(rawReply);
      cleanReply = rawReply.trim();
    }
    console.log("Raw reply:", rawReply);
    console.log("Tag Match:", tagMatch);
    console.log("Final Bot Mood (after fallback):", botMood);

    history.push({ role: "assistant", content: cleanReply });
    await sessionRef.set({ history });

    res.json({ reply: cleanReply, userMood, botMood });
  } catch (err) {
    console.error(
      "Chat error:",
      err.message,
      "Status:", err.response?.status,
      "Data:", err.response?.data
    );
    res.status(500).json({
      reply: "Sorry, I couldn’t reach my brain right now 😞",
      userMood: "neutral",
      botMood: "sadness",
    });
  }
});
// --- Server Startup ---
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`✅ Server running on port ${PORT}`));



