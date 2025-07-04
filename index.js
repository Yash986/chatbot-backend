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
    const aiResponse = await axios.post(
      "https://api.together.xyz/v1/chat/completions",
      {
        model: "meta-llama/Llama-3-8b-chat-hf", // Using LLaMA 3 8B
        messages: [
          {
            role: "system",
            content: `You are a friendly chatbot that acts as my friend. Your crucial task is to ALWAYS end your reply with an emotion tag from this list: [joy], [sadness], [anger], [fear], [surprise], [disgust], [neutral], [concern]. The tag must be the very last thing on the same line. Do not forget or skip the tag. For example: "I understand how you feel. [concern]". The tag should tell the overall emotion of your whole message.`,
          },
          {
            role: "user",
            content: "I'm feeling really down today.",
          },
          {
            role: "assistant",
            content:
              "I'm really sorry to hear that. I'm here for you and you can always talk to me. [concern]",
          },
          {
            role: "user",
            content: "I got an A on my exam!",
          },
          {
            role: "assistant",
            content:
              "That's amazing! I'm so proud of you. Great job! [joy]",
          },
          // Use the full history as requested
          ...history, // <--- Using full history as per your instruction
          // The current user message is already included as the last element in history
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

app.get("/test-key", async (req, res) => {
  try {
    const result = await axios.post(
      "https://api.together.xyz/v1/chat/completions",
      {
        model: "meta-llama/Llama-3-8b-chat-hf",
        messages: [{ role: "user", content: "Say hello [joy]" }],
        temperature: 0.7,
      },
      {
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${process.env.TOGETHER_API_KEY}`,
        },
      }
    );
    res.send(result.data);
  } catch (err) {
    console.error("Key test failed:", err.response?.data || err.message);
    res.status(500).json({ error: "Invalid key or model access" });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`✅ Server running on port ${PORT}`));
