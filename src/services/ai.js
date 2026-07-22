import OpenAI from 'openai';

export async function generateContent({ topic, platform = 'Facebook', audience = '马来西亚21岁以上华语用户' }) {
  const fallback = {
    title: `${topic}｜你会怎么选？`,
    hook: `关于「${topic}」，很多人第一反应都不一样。`,
    body: `从马来西亚用户熟悉的生活场景切入，以轻松、自然、不硬销的方式讨论「${topic}」。内容应具体、有共鸣，并留下一个容易回答的问题。`,
    cta: '你怎么看？留言告诉我们。',
    imagePrompt: `Vertical social media visual about ${topic}, Malaysian lifestyle context, clean cinematic composition, realistic, premium, 4:5, subtle MGMBETMYR branding, no gambling symbols, no minors, no misleading claims.`,
    reelsScript: `0–2秒：提出关于${topic}的冲突问题。\n3–10秒：展示熟悉场景。\n11–18秒：给出反转或观点。\n结尾：邀请用户留言。`,
    aiScore: 8.2
  };

  if (!process.env.OPENAI_API_KEY) return fallback;

  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const response = await client.chat.completions.create({
    model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: 'You are a Malaysia social media strategist. Return valid JSON only. Avoid gambling promotion, minors, guaranteed-profit claims, or hard selling.' },
      { role: 'user', content: `Create one Chinese social post package. Topic: ${topic}. Platform: ${platform}. Audience: ${audience}. JSON keys: title, hook, body, cta, imagePrompt, reelsScript, aiScore. aiScore must be 0-10.` }
    ]
  });

  return { ...fallback, ...JSON.parse(response.choices[0].message.content || '{}') };
}
