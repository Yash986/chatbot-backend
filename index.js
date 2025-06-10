const express = require("express");
const cors = require("cors");
const { Configuration, OpenAIApi } = require("openai");
require("dotenv").config();

const app = express();
const port = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

const configuration = new Configuration({
  apiKey: process.env.OPENAI_API_KEY,
});
const openai = new OpenAIApi(configuration);

app.post("/chat", async (req, res) => {
  const { message } = req.body;
  try {
    const completion = await openai.createChatCompletion({
      model: "gpt-3.5-turbo",
      messages: [
        {
          role: "system",
          content: `You are a helpful assistant. For each user message, reply with JSON:
{ "reply": "...", "mood": "happy|sad|angry|confused|neutral" }`
        },
        { role: "user", content: message }
      ]
    });
    const json = completion.data.choices[0].message.content;
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
