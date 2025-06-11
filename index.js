const express = require("express");
const cors = require("cors");
const bodyParser = require("body-parser");
const axios = require("axios");

const app = express();
app.use(cors());
app.use(bodyParser.json());

// Sentiment analysis using Together.ai and Hugging Face model
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

    return topPrediction.label.toLowerCase(); // e.g. "joy", "anger"
  } catch (error) {
    console.error("Emotion detection error:", error.message);
    return "neutral";
  }
}


app.post("/chat", async (req, res) => {
  const userMessage = req.body.message;

  try {
    // Detect emotion from message
    const mood = await detectEmotion(userMessage);

    // Get AI reply using Together.ai (LLaMA 3)
    const aiResponse = await axios.post(
      "https://api.together.xyz/v1/chat/completions",
      {
        model: "meta-llama/Llama-3-8b-chat-hf",
        messages: [
          { role: "system", content: "You are a friendly chatbot that helps users and understands their mood." },
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
    res.json({ reply: aiReply, mood });

  } catch (error) {
    console.error("Error generating reply:", error.message);
    res.status(500).json({ reply: "Sorry, I couldn’t reach my brain right now 😞", mood: "neutral" });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
