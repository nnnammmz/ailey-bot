const express = require('express');
const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true })); //

const SLACK_TOKEN = process.env.SLACK_TOKEN;
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;

const briefings = {};

async function askClaude(briefing, request) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': ANTHROPIC_KEY,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 2000,
      system: 'You are Ailey, a senior performance marketer. Channels: Google Ads, Meta, YouTube, TikTok.\n\nBriefing data from the team:\n' + briefing + '\n\nRules:\n- Use Slack markdown (*bold*, bullet points)\n- Be specific with numbers and rationale\n- Give actionable suggestions\n- Mark assumptions with (추론)',
      messages: [{ role: 'user', content: request }]
    })
  });
  const data = await res.json();
  return data.content[0].text;
}

async function sendSlack(channel, text, thread_ts) {
  const body = { channel, text };
  if (thread_ts) body.thread_ts = thread_ts;
  await fetch('https://slack.com/api/chat.postMessage', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + SLACK_TOKEN
    },
    body: JSON.stringify(body)
  });
}

app.post('/slack/events', async (req, res) => {
  const { type, challenge, event } = req.body;
  if (type === 'url_verification') return res.json({ challenge });
  res.sendStatus(200);

  if (!event || event.bot_id) return;

  const channel = event.channel;
  const text = (event.text || '').replace(/<@[^>]+>/g, '').trim();

  if (event.type === 'app_mention') {
    const briefing = briefings[channel];
    if (!briefing) {
      await sendSlack(channel, 'No briefing found. Please use /briefing to register your campaign info first.', event.ts);
      return;
    }
    await sendSlack(channel, 'Ailey is working on it...', event.ts);
    const answer = await askClaude(briefing, text);
    await sendSlack(channel, answer, event.ts);
  }
});

app.post('/slack/briefing', async (req, res) => {
  const { channel_id, text, user_name } = req.body;
  console.log('briefing text received:', JSON.stringify(req.body));
if (!text || !text.trim()) {
    return res.json({ response_type: 'ephemeral', text: 'Please provide briefing content. Usage: /briefing [content]' });
  }
  briefings[channel_id] = text.trim();
  res.json({
    response_type: 'in_channel',
    text: '*' + user_name + '* registered a briefing!\n\n*Briefing:*\n' + text.trim() + '\n\nNow mention @Ailey with your request!'
  });
});

app.post('/slack/briefing-check', async (req, res) => {
  const { channel_id } = req.body;
  const briefing = briefings[channel_id];
  if (!briefing) {
    return res.json({ response_type: 'ephemeral', text: 'No briefing registered. Use /briefing first.' });
  }
  res.json({ response_type: 'ephemeral', text: '*Current briefing:*\n' + briefing });
});

app.listen(process.env.PORT || 3000, () => console.log('Ailey running'));
