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

// A simple utility to trim chat history to prevent token overflow
// This keeps the full history in Firestore, but sends a recent, shorter
// version to the AI model for the current turn.
function trimHistory(history, maxTokens = 15000) {
  let currentTokens = 0;
  let trimmedHistory = [];

  // Iterate from the end of the history to keep the most recent messages
  for (let i = history.length - 1; i >= 0; i--) {
    const message = history[i];
    // Simple token estimate: count words
    const messageTokens = message.content.split(/\s+/).length;

    if (currentTokens + messageTokens < maxTokens) {
      trimmedHistory.unshift(message); // Add to the beginning of the new array
      currentTokens += messageTokens;
    } else {
      break; // Stop when the limit is reached
    }
  }

  return trimmedHistory;
}

// 🧠 Emotion detection (still used for user messages)
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
    console.error(
      "Emotion detection error:",
      err.message,
      "Status:", err.response?.status,
      "Data:", err.response?.data
    );
    return "neutral";
  }
}

// 💬 Chat handler with memory + bot emotion tag
app.post("/chat", async (req, res) => {
  const { message: userMessage, userId } = req.body;

  if (!userMessage || !userId) {
    return res.status(400).json({ error: "Missing message or userId" });
  }

  try {
    // 1. Detect user's mood
    const userMood = await detectEmotion(userMessage);

    // 2. Get full previous chat history from Firestore
    const sessionRef = sessions.doc(userId);
    const sessionDoc = await sessionRef.get();
    let history = sessionDoc.exists ? sessionDoc.data().history : []; // Use 'let' so we can modify it

    // 3. Add current user message to full history
    history.push({ role: "user", content: userMessage });

    // 4. Generate AI reply (with emotion tagging system)
    // ➡️ Use the trimHistory function here to prevent token overflow
    const trimmedHistory = trimHistory(history);

    const aiResponse = await axios.post(
      "https://api.together.xyz/v1/chat/completions",
      {
        // ➡️ Changed the model to a powerful alternative
        model: "mistralai/Mixtral-8x7B-Instruct-v0.1",
        messages: [
          {
            role: "system",
            content: `You are a friendly and concise chatbot that acts as my friend. Your crucial task is to ALWAYS end your reply with an emotion tag from this list: [joy], [sadness], [anger], [fear], [surprise], [disgust], [neutral], [concern]. The tag must be the very last thing on the same line. Do not forget or skip the tag. For example: "I understand how you feel. [concern]". The tag should tell the overall emotion of your whole message.`,
          },
          // ➡️ Use the trimmed history instead of the full history
          ...trimmedHistory,
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

    // 5. Extract [mood] from AI message OR detect it if missing
    let botMood;
    let cleanReply;

    const tagMatch = rawReply.match(/\[(\w+)\]\s*$/);

    if (tagMatch) {
      // If tag is found, extract it and clean the reply
      botMood = tagMatch[1].toLowerCase();
      cleanReply = rawReply.replace(/\[\w+\]\s*$/, "").trim();
    } else {
      // If NO tag is found by the regex, use sentiment analysis on the whole reply
      console.log("Bot forgot the tag. Detecting mood from message content...");
      botMood = await detectEmotion(rawReply); // <-- Fallback to sentiment analysis
      cleanReply = rawReply.trim(); // No tag to remove from the reply itself
    }

    console.log("Raw reply: ", rawReply);
    console.log("Tag Match: ", tagMatch); // Will be null if tag was not found
    console.log("Final Bot Mood (after fallback):", botMood); // Debug log

    // 6. Add AI reply to the full history (before saving to Firebase)
    history.push({ role: "assistant", content: cleanReply });
    // Save the full history to Firestore
    await sessionRef.set({ history });

    // 7. Send reply
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
      botMood: "neutral",
    });
  }
});


const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`✅ Server running on port ${PORT}`));

