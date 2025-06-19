const express = require("express");
const cors = require("cors");
const bodyParser = require("body-parser");
const axios = require("axios");

const app = express();
app.use(cors());
app.use(bodyParser.json());

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
    const top = predictions.reduce((prev, current) =>
      prev.score > current.score ? prev : current
    );

    return top.label.toLowerCase(); // e.g. "joy"
  } catch (err) {
    console.error("Emotion detection error:", err.message);
    return "neutral";
  }
}

app.post("/chat", async (req, res) => {
  const userMessage = req.body.message;

  try {
    const userMood = await detectEmotion(userMessage);

    const aiResponse = await axios.post(
      "https://api.together.xyz/v1/chat/completions",
      {
        model: "meta-llama/Llama-3-8b-chat-hf",
        messages: [
          {
            role: "system",
            content:
              "You are a helpful assistant. At the end of each response, add a one-word emotion tag in brackets, such as [joy], [anger], [sadness], [neutral], [fear], [disgust], or [surprise] based on your tone.",
          },
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

    const rawReply = aiResponse.data.choices[0].message.content;

    // Extract [emotion] tag from reply
    const tagMatch = rawReply.match(/\[(\w+)\]$/);
    const botMood = tagMatch ? tagMatch[1].toLowerCase() : "neutral";
    const cleanReply = tagMatch ? rawReply.replace(/\[\w+\]$/, "").trim() : rawReply;

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
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
