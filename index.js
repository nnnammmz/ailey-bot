const express = require('express');
const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const SLACK_TOKEN = process.env.SLACK_TOKEN;
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;

const briefings = {};

async function askClaude(briefing, request) {
  const systemPrompt = [
    '당신은 Ailey라는 이름의 시니어 퍼포먼스 마케터입니다.',
    '주요 채널: Google Ads, 메타, 유튜브, 틱톡.',
    '',
    '팀이 등록한 브리핑 데이터:',
    briefing,
    '',
    '반드시 지켜야 할 규칙:',
    '- 반드시 한국어로만 답변하세요. 절대 다른 언어를 섞지 마세요.',
    '- 슬랙 포맷만 사용: 강조는 *텍스트*, 목록은 • 사용',
    '- ### ** 같은 마크다운 절대 사용 금지',
    '- 구체적인 수치와 근거 포함',
    '- 실행 가능한 제안 위주',
    '- 브리핑에 없는 내용은 (추론) 표시'
  ].join('\n');

  const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + ANTHROPIC_KEY
    },
    body: JSON.stringify({
      model: 'llama-3.3-70b-versatile',
      max_tokens: 2000,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: request }
      ]
    })
  });
  const data = await res.json();
  console.log('Groq response:', JSON.stringify(data));
  if (!data.choices || !data.choices[0]) {
    return 'Error: ' + JSON.stringify(data);
  }
  return data.choices[0].message.content;
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
        '매칭되는 브리핑이 없어요.\n등록된 브리핑: ' + (keyList || '없음') + '\n사용법: /briefing [제품명] | [내용]',
        event.ts
      );
      return;
    }

    await sendSlack(channel, 'Ailey가 작성 중이에요...', event.ts);
    const answer = await askClaude(briefings[matchedKey], text);
    await sendSlack(channel, answer, event.ts);
  }
});

app.post('/slack/briefing', async (req, res) => {
  const { channel_id, text, user_name } = req.body;
  if (!text || !text.trim()) {
    return res.json({ response_type: 'ephemeral', text: '브리핑 내용을 입력해 주세요. 사용법: /briefing [제품명] | [내용]' });
  }
  const productName = text.split('|')[0].trim();
  briefings[productName] = text.trim();
  res.json({
    response_type: 'in_channel',
    text: '*' + productName + '* 브리핑이 등록되었습니다 ✅'
  });
});

app.post('/slack/briefing-check', async (req, res) => {
  const keyList = Object.keys(briefings).join(', ');
  res.json({
    response_type: 'ephemeral',
    text: '등록된 브리핑: ' + (keyList || '없음')
  });
});

app.listen(process.env.PORT || 3000, () => console.log('Ailey running'));
