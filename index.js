const express = require("express");
const cors = require("cors");
const bodyParser = require("body-parser");
const axios = require("axios");

const app = express();
app.use(cors());
app.use(bodyParser.json());

// Sentiment analysis using Hugging Face
async function detectEmotion(message) {
  try {
    const response = await axios.post(
      "https://api-inference.huggingface.co/models/j-hartmann/emotion-english-distilroberta-base",
      {
        inputs: message,
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.HUGGINGFACE_API_KEY}`,
        },
      }
    );

    const predictions = response.data[0];
    const topPrediction = predictions.reduce((prev, current) =>
      prev.score > current.score ? prev : current
    );

    return topPrediction.label.toLowerCase(); // e.g. "joy", "anger", "sadness"
  } catch (error) {
    console.error("Emotion detection error:", error.message);
    return "neutral";
  }
}

app.post("/chat", async (req, res) => {
  const userMessage = req.body.message;

  try {
    // 1. Detect emotion in user's message
    const userMood = await detectEmotion(userMessage);

    // 2. Get AI reply using Together.ai
    const aiResponse = await axios.post(
      "https://api.together.xyz/v1/chat/completions",
      {
        model: "meta-llama/Llama-3-8b-chat-hf",
        messages: [
          { role: "system", content: "You are a friendly chatbot that understands emotional tone and responds accordingly." },
          { role: "user", content: userMessage },
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

    const aiReply = aiResponse.data.choices[0].message.content;

    // 3. Detect emotion in AI's reply instead of user message
    const botMood = await detectEmotion(aiReply);

    // 4. Send both reply and bot's mood
    res.json({ reply: aiReply, mood: botMood });

  } catch (error) {
    console.error("Error generating reply:", error.message);
    res.status(500).json({ reply: "Sorry, I couldn’t reach my brain right now 😞", mood: "neutral" });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
