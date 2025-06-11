const express = require("express");
const cors = require("cors");
const bodyParser = require("body-parser");
const axios = require("axios");

const app = express();
app.use(cors());
app.use(bodyParser.json());

app.post("/chat", async (req, res) => {
  const userMessage = req.body.message;

  try {
    // Get AI response from Together.ai (LLaMA 3)
    const response = await axios.post(
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

    const aiReply = response.data.choices[0].message.content;

    // Basic mood detection based on user input (you can improve this later with sentiment models)
    let mood = "neutral";
    const lowerMsg = userMessage.toLowerCase();

    if (lowerMsg.includes("happy") || lowerMsg.includes("excited") || lowerMsg.includes("great")) {
      mood = "happy";
    } else if (lowerMsg.includes("sad") || lowerMsg.includes("tired") || lowerMsg.includes("unhappy")) {
      mood = "sad";
    } else if (lowerMsg.includes("angry") || lowerMsg.includes("frustrated") || lowerMsg.includes("mad")) {
      mood = "angry";
    }

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
