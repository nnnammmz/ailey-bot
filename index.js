const express = require('express');
const app = express();
app.use(express.json());

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
      system: `당신은 Ailey라는 이름의 시니어 퍼포먼스 마케터입니다.
주요 채널: 구글 Ads, 메타(페이스북/인스타), 유튜브, 틱톡

아래는 팀이 등록한 브리핑 데이터입니다.
이 데이터를 기반으로 마케팅 요청에 답변하세요.

[브리핑 데이터]
${briefing}

답변 규칙:
- 슬랙 마크다운 사용 (*볼드*, • 글머리)
- 수치/근거 기반의 구체적인 내용
- 실행 가능한 제안 위주
- 브리핑에 없는 내용은 합리적으로 추론하되 (추론) 표시`,
      messages: [{ role: 'user', content: request }]
    })
  });
  const data = await res.json();
  return data.content[0].text;
}

async function sendSlack(channel, text, thread_ts = null) {
  await fetch('https://slack.com/api/chat.postMessage', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${SLACK_TOKEN}`
    },
    body: JSON.stringify({
      channel,
      text,
      ...(thread_ts && { thread_ts })
    })
  });
}

app.post('/slack/events', async (req, res) => {
  const { type, challenge, event } = req.body;
  if (type === 'url_verification') return res.json({ challenge });
  res.sendStatus(200);

  if (!event || event.bot_id) return;

  const channel = event.channel;
  const text = event.text?.replace(/<@[^>]+>/g, '').trim() || '';

  if (event.type === 'app_mention') {
    const briefing = briefings[channel];

    if (!briefing) {
      await sendSlack(channel,
        '📋 브리핑 데이터가 없어요!\n`/브리핑` 커맨드로 제품/캠페인 정보를 먼저 등록해 주세요.',
        event.ts
      );
      return;
    }

    await sendSlack(channel, '⏳ Ailey가 작성 중이에요...', event.ts);
    const answer = await askClaude(briefing, text);
    await sendSlack(channel, answer, event.ts);
  }
});

app.post('/slack/briefing', async (req, res) => {
  const { channel_id, text, user_name } = req.body;

  if (!text || text.trim() === '') {
    return res.json({
      response_type: 'ephemeral',
      text: '❌ 브리핑 내용을 입력해 주세요.\n사용법: `/브
