const express = require('express');
const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

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
      model: 'claude-sonnet-4-5',
      max_tokens: 2000,
      system: 'You are Ailey, a senior performance marketer. Channels: Google Ads, Meta, YouTube, TikTok.\n\nBriefing data from the team:\n' + briefing + '\n\nRules:\n- Use Slack markdown (*bold*, bullet points)\n- Be specific with numbers and rationale\n- Give actionable suggestions\n- Mark assumptions with (추론)',
      messages: [{ role: 'user', content: request }]
    })
  });
  const data = await res.json();
  console.log('Claude response:', JSON.stringify(data));
  if (!data.content || !data.content[0]) {
    return 'Error: ' + JSON.stringify(data);
  }
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
    const matchedKey = Object.keys(briefings).find(name =>
      text.toLowerCase().includes(name.toLowerCase())
    );

    if (!matchedKey) {
      const keyList = Object.keys(briefings).join(', ');
      await sendSlack(channel,
        'No matching briefing found.\nRegistered: ' + (keyList || 'none') + '\nUsage: /briefing [제품명] | [내용]',
        event.ts
      );
      return;
    }

    await sendSlack(channel, 'Ailey is working on it...', event.ts);
    const answer = await askClaude(briefings[matchedKey], text);
    await sendSlack(channel, answer, event.ts);
  }
});

app.post('/slack/briefing', async (req, res) => {
  const { channel_id, text, user_name } = req.body;
  console.log('briefing received:', JSON.stringify(req.body));
  if (!text || !text.trim()) {
    return res.json({ response_type: 'ephemeral', text: 'Please provide briefing content. Usage: /briefing [제품명] | [내용]' });
  }
  const productName = text.split('|')[0].trim();
  briefings[productName] = text.trim();
  res.json({
    response_type: 'in_channel',
    text: '*' + productName + '* 브리핑이 등록되었습니다 ✅'
  });
});

app.post('/slack/briefing-check', async (req, res) => {
  const { channel_id } = req.body;
  const keyList = Object.keys(briefings).join(', ');
  res.json({
    response_type: 'ephemeral',
    text: '등록된 브리핑: ' + (keyList || '없음')
  });
});

app.listen(process.env.PORT || 3000, () => console.log('Ailey running'));
