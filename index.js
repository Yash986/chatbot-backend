// --- Imports and Firebase Setup ---
const express = require("express");
const cors = require("cors");
const bodyParser = require("body-parser");
const axios = require("axios");
const admin = require("firebase-admin");

// Initialize Firebase Admin SDK using a service account from environment variables
const serviceAccount = JSON.parse(process.env.FIREBASE_CONFIG);
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

// Firestore database and collection references
const db = admin.firestore();
const sessions = db.collection("sessions");

// Express app setup
const app = express();
app.use(cors());
app.use(bodyParser.json());

// --- Utility Functions ---

/**
 * Trims the chat history to a specified token limit.
 * This is crucial to prevent API token overflow errors on long conversations.
 * The full history is still saved to Firestore, but only the recent
 * part is sent to the AI model for the current response.
 * @param {Array} history - The full chat history array.
 * @param {number} maxTokens - The maximum number of tokens to include in the trimmed history.
 * @returns {Array} - The trimmed chat history.
 */
function trimHistory(history, maxTokens = 15000) {
  let currentTokens = 0;
  let trimmedHistory = [];

  // Iterate from the end of the history to keep the most recent messages
  for (let i = history.length - 1; i >= 0; i--) {
    const message = history[i];
    // Simple token estimate: count words. A more accurate method could be used,
    // but this is often sufficient for a hard limit.
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

/**
 * Detects the emotion of a given message using a Hugging Face model.
 * This is used for the chatbot's fallback mechanism and user mood detection.
 * @param {string} message - The text message to analyze.
 * @returns {string} - The detected emotion label (e.g., 'joy', 'anger').
 */
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
    return "neutral"; // Fallback to 'neutral' if the API fails
  }
}

// --- Main Chat Handler Route ---
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

    const systemPrompt = `You are a friendly and concise chatbot that acts as my friend. Your replies should be brief and to the point. Your crucial task is to ALWAYS end your reply with an emotion tag from this list: [joy], [sadness], [anger], [fear], [surprise], [disgust], [neutral], [concern]. The tag must be the very last thing on the same line. Do not forget or skip the tag. For example: "I understand how you feel. [concern]". The tag should tell the overall emotion of your whole message.
    
    When providing helpline or resource information, ensure it is relevant to the user's specified region: ${region || 'global'}.`;

    const aiResponse = await axios.post(
      "https://api.together.xyz/v1/chat/completions",
      {
        model: "mistralai/Mixtral-8x7B-Instruct-v0.1",
        messages: [
          {
            role: "system",
            content: systemPrompt,
          },
          // Use the trimmed history
          ...trimmedHistory,
          // ➡️ The new, final instruction to reinforce the prompt ➡️
          {
            role: "assistant",
            content: "Remember to end your reply with an emotion tag from the list.",
          }
        ],
        temperature: 0.7,
        max_tokens: 100,
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
      cleanReply = rawReply.replace(/\[\w+\]\s*$/).trim();
    } else {
      console.log("Bot forgot the tag. Detecting mood from message content...");
      botMood = await detectEmotion(rawReply);
      cleanReply = rawReply.trim();
    }

    console.log("Raw reply: ", rawReply);
    console.log("Tag Match: ", tagMatch);
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
      botMood: "neutral",
    });
  }
});

// --- Server Startup ---
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`✅ Server running on port ${PORT}`));



