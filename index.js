const express = require("express");
const cors = require("cors");
const bodyParser = require("body-parser");
const axios = require("axios");
const admin = require("firebase-admin");

const serviceAccount = JSON.parse(process.env.FIREBASE_CONFIG); // ✅ Use ENV

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();
const sessions = db.collection("sessions");

const app = express();
app.use(cors());
app.use(bodyParser.json());

// 🧠 Emotion detection
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

    return top.label.toLowerCase(); // e.g. joy, anger
  } catch (err) {
    console.error("Emotion detection error:", err.message);
    return "neutral";
  }
}

// 💬 Chat handler with memory
app.post("/chat", async (req, res) => {
  const { message: userMessage, userId } = req.body;

  if (!userMessage || !userId) {
    return res.status(400).json({ error: "Missing message or userId" });
  }

  try {
    // 1. Detect user's mood
    const userMood = await detectEmotion(userMessage);

    // 2. Get previous chat history from Firestore
    const sessionRef = sessions.doc(userId);
    const sessionDoc = await sessionRef.get();
    const history = sessionDoc.exists ? sessionDoc.data().history : [];

    // 3. Add user message to history
    history.push({ role: "user", content: userMessage });

    // 4. Generate AI reply
    const aiResponse = await axios.post(
      "https://api.together.xyz/v1/chat/completions",
      {
        model: "meta-llama/Llama-3-8b-chat-hf",
        messages: [
          {
            role: "system",
            content:
              "You are a friendly chatbot that acts like a friend to the user. At the end of each response, add a one-word emotion tag in brackets, such as [joy], [anger], [sadness], [concern], [neutral], etc. Never omit the tag.",
          },
          ...history,
        ],
        temperature: 0.7,
      },
      {
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${process.env.TOGETHER_API_KEY}`,
        },
      }
    );

    const rawReply = aiResponse.data.choices[0].message.content;

    // 5. Extract emotion from bot reply
    const tagMatch = rawReply.match(/\[(\w+)\]\s*$/);
    const botMood = tagMatch ? tagMatch[1].toLowerCase() : "neutral";
    const cleanReply = tagMatch ? rawReply.replace(/\[\w+\]$/, "").trim() : rawReply;
    console.log("Bot raw reply:", rawReply);
    console.log("Bot mood match:", tagMatch);

    // 6. Add bot reply to history and save it
    history.push({ role: "assistant", content: cleanReply });
    await sessionRef.set({ history });

    // 7. Send reply
    res.json({ reply: cleanReply, userMood, botMood });
  } catch (err) {
    console.error("Chat error:", err.message);
    res.status(500).json({
      reply: "Sorry, I couldn’t reach my brain right now 😞",
      userMood: "neutral",
      botMood: "neutral",
    });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`✅ Server running on port ${PORT}`));
