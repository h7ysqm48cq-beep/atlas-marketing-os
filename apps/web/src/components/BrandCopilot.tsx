'use client';

import { FormEvent, useEffect, useRef, useState } from 'react';
import styles from './BrandCopilot.module.css';

type Campaign = { id: string; name: string };
type Message = { role: 'user' | 'assistant'; content: string };
const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

export function BrandCopilot() {
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [campaignId, setCampaignId] = useState('');
  const [messages, setMessages] = useState<Message[]>([
    { role: 'assistant', content: '我是 Atlas Brand Copilot。你可以让我想话题、改文案、调整语气或拆分平台版本。' },
  ]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('Brand Brain is active.');
  const endRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    fetch(`${API}/campaigns`).then((r) => r.json()).then((d) => Array.isArray(d) && setCampaigns(d)).catch(() => setStatus('Unable to load campaigns.'));
  }, []);

  useEffect(() => endRef.current?.scrollIntoView({ behavior: 'smooth' }), [messages]);

  async function send(event?: FormEvent) {
    event?.preventDefault();
    const text = input.trim();
    if (!text || busy) return;

    const next: Message[] = [...messages, { role: 'user', content: text }];
    setMessages(next);
    setInput('');
    setBusy(true);
    setStatus('Atlas is thinking...');

    try {
      const response = await fetch(`${API}/copilot/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ campaignId: campaignId || undefined, messages: next.slice(-12) }),
      });
      const data = await response.json();
      if (!response.ok || !data.reply) throw new Error(data.message || 'Unable to get response.');
      setMessages((current) => [...current, { role: 'assistant', content: data.reply }]);
      setStatus(data.campaign ? `Using ${data.campaign.name}` : 'Using Brand Brain');
    } catch (error) {
      setMessages((current) => [...current, { role: 'assistant', content: `发生错误：${error instanceof Error ? error.message : 'Unknown error'}` }]);
      setStatus('Request failed.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={styles.page}>
      <section className={styles.hero}>
        <div>
          <p className={styles.eyebrow}>Brand Copilot</p>
          <h1>Work with Atlas like an always-on marketing strategist.</h1>
          <p>连续优化想法，不需要每次重新填写 Prompt。</p>
        </div>
        <div className={styles.context}>
          <span>Campaign context</span>
          <select value={campaignId} onChange={(e) => setCampaignId(e.target.value)}>
            <option value="">Brand Brain only</option>
            {campaigns.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <small>{status}</small>
        </div>
      </section>

      <section className={styles.layout}>
        <aside className={styles.quick}>
          <p className={styles.eyebrow}>Quick directions</p>
          {[
            '帮我想10个更容易引起讨论的港剧怀旧话题。',
            '把这段文案改得更自然、更像马来西亚华人口吻。',
            '分别改成 Facebook、Telegram 和 Reels 版本。',
            '分析为什么不够吸引人，并直接优化。',
          ].map((text) => <button key={text} onClick={() => setInput(text)}>{text}</button>)}
          <button className={styles.clear} onClick={() => setMessages([{ role: 'assistant', content: '对话已清空。接下来想优化什么？' }])}>Clear conversation</button>
        </aside>

        <section className={styles.chat}>
          <div className={styles.messages}>
            {messages.map((message, index) => (
              <article className={message.role === 'user' ? styles.user : styles.assistant} key={index}>
                <div><strong>{message.role === 'user' ? 'You' : 'Atlas'}</strong>
                  {message.role === 'assistant' && <button onClick={() => navigator.clipboard.writeText(message.content)}>Copy</button>}
                </div>
                <p>{message.content}</p>
              </article>
            ))}
            <div ref={endRef} />
          </div>

          <form className={styles.composer} onSubmit={send}>
            <textarea value={input} onChange={(e) => setInput(e.target.value)}
              placeholder="例如：把刚才第3个改得更幽默，并给我Facebook和Telegram版本……"
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  void send();
                }
              }} />
            <div><small>Enter 发送 · Shift + Enter 换行</small><button disabled={busy || !input.trim()}>{busy ? 'Thinking...' : 'Send to Atlas'}</button></div>
          </form>
        </section>
      </section>
    </div>
  );
}
