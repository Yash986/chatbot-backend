// index.js
const express = require("express");
const cors = require("cors");
const OpenAI = require("openai");    // v4 default import
require("dotenv").config();

const app = express();
const port = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// Instantiate the v4 client directly
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

app.post("/chat", async (req, res) => {
  const { message } = req.body;
  try {
    // Use the v4-style call
    const completion = await openai.chat.completions.create({
      model: "gpt-3.5-turbo",
      messages: [
        {
          role: "system",
          content: `You are a helpful assistant. For each user message, reply with JSON:
{"reply": "...", "mood": "happy|sad|angry|confused|neutral"}`,
        },
        { role: "user", content: message },
      ],
    });

    // Parse GPT’s JSON response
    const json = completion.choices[0].message.content;
    const parsed = JSON.parse(json);
    res.json(parsed);

  } catch (err) {
    console.error(err);
    res.status(500).send("Error generating reply");
  }
});

app.listen(port, () => {
  console.log(`Server listening on port ${port}`);
});
