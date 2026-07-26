'use client';

import {
  FormEvent,
  useEffect,
  useRef,
  useState,
} from 'react';
import styles from './BrandCopilot.module.css';

type Campaign = {
  id: string;
  name: string;
};

type Message = {
  role: 'user' | 'assistant';
  content: string;
};

type CopilotMode = 'chat' | 'marketing-plan';

const API =
  process.env.NEXT_PUBLIC_API_URL ||
  'http://localhost:3001';

export function BrandCopilot() {
  const [campaigns, setCampaigns] =
    useState<Campaign[]>([]);
  const [campaignId, setCampaignId] = useState('');
  const [mode, setMode] =
    useState<CopilotMode>('chat');
  const [messages, setMessages] = useState<Message[]>([
    {
      role: 'assistant',
      content:
        '我是 Elena，你的 AI Marketing Strategist。你可以和我讨论创意、改文案，或切换到 Marketing Plan 模式让我一次生成完整营销方案。',
    },
  ]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState(
    'Brand Brain is active.',
  );
  const endRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    void fetch(`${API}/campaigns`)
      .then((response) => response.json())
      .then((data) => {
        if (Array.isArray(data)) {
          setCampaigns(data);
        }
      })
      .catch(() => {
        setStatus('Unable to load campaigns.');
      });
  }, []);

  useEffect(() => {
    endRef.current?.scrollIntoView({
      behavior: 'smooth',
    });
  }, [messages]);

  async function send(event?: FormEvent) {
    event?.preventDefault();

    const text = input.trim();

    if (!text || busy) {
      return;
    }

    const next: Message[] = [
      ...messages,
      {
        role: 'user',
        content: text,
      },
    ];

    setMessages(next);
    setInput('');
    setBusy(true);
    setStatus('Elena is thinking...');

    try {
      const response = await fetch(
        `${API}/copilot/chat`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            campaignId:
              campaignId || undefined,
            mode,
            messages: next.slice(-12),
          }),
        },
      );

      const data = await response.json();

      if (!response.ok || !data.reply) {
        throw new Error(
          data.message ||
            'Unable to get response.',
        );
      }

      setMessages((current) => [
        ...current,
        {
          role: 'assistant',
          content: data.reply,
        },
      ]);

      setStatus(
        data.campaign
          ? `Using ${data.campaign.name} · ${
              mode === 'marketing-plan'
                ? 'Marketing Plan'
                : 'Chat'
            }`
          : `Using Brand Brain · ${
              mode === 'marketing-plan'
                ? 'Marketing Plan'
                : 'Chat'
            }`,
      );
    } catch (error) {
      setMessages((current) => [
        ...current,
        {
          role: 'assistant',
          content: `发生错误：${
            error instanceof Error
              ? error.message
              : 'Unknown error'
          }`,
        },
      ]);

      setStatus('Request failed.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={styles.page}>
      <section className={styles.hero}>
        <div>
          <p className={styles.eyebrow}>
            Elena Brand Copilot
          </p>
          <h1>
            Work with Elena like an always-on
            marketing strategist.
          </h1>
          <p>
            连续优化创意，或一次生成完整营销方案。
          </p>
        </div>

        <div className={styles.context}>
          <span>Working mode</span>

          <select
            value={mode}
            onChange={(event) =>
              setMode(
                event.target.value as CopilotMode,
              )
            }
          >
            <option value="chat">
              Chat mode
            </option>
            <option value="marketing-plan">
              Marketing Plan
            </option>
          </select>

          <span>Campaign context</span>

          <select
            value={campaignId}
            onChange={(event) =>
              setCampaignId(event.target.value)
            }
          >
            <option value="">
              Brand Brain only
            </option>

            {campaigns.map((campaign) => (
              <option
                key={campaign.id}
                value={campaign.id}
              >
                {campaign.name}
              </option>
            ))}
          </select>

          <small>{status}</small>
        </div>
      </section>

      <section className={styles.layout}>
        <aside className={styles.quick}>
          <p className={styles.eyebrow}>
            Quick directions
          </p>

          {[
            '帮我想10个更容易引起讨论的港剧怀旧话题。',
            '把这段文案改得更自然、更像马来西亚华人口吻。',
            '为这个主题生成完整 Facebook、Telegram 和 Reels 营销方案。',
            '分析为什么这段内容不够吸引人，并直接优化。',
            '给我一个包含文案、CTA、Hashtags 和图片 Prompt 的完整方案。',
          ].map((text) => (
            <button
              key={text}
              onClick={() => setInput(text)}
            >
              {text}
            </button>
          ))}

          <button
            className={styles.clear}
            onClick={() =>
              setMessages([
                {
                  role: 'assistant',
                  content:
                    '对话已清空。接下来想让 Elena 帮你做什么？',
                },
              ])
            }
          >
            Clear conversation
          </button>
        </aside>

        <section className={styles.chat}>
          <div className={styles.messages}>
            {messages.map((message, index) => (
              <article
                className={
                  message.role === 'user'
                    ? styles.user
                    : styles.assistant
                }
                key={index}
              >
                <div>
                  <strong>
                    {message.role === 'user'
                      ? 'You'
                      : 'Elena'}
                  </strong>

                  {message.role ===
                    'assistant' && (
                    <button
                      onClick={() =>
                        navigator.clipboard.writeText(
                          message.content,
                        )
                      }
                    >
                      Copy
                    </button>
                  )}
                </div>

                <p>{message.content}</p>
              </article>
            ))}

            <div ref={endRef} />
          </div>

          <form
            className={styles.composer}
            onSubmit={send}
          >
            <textarea
              value={input}
              onChange={(event) =>
                setInput(event.target.value)
              }
              placeholder={
                mode === 'marketing-plan'
                  ? '例如：为世界杯怀旧主题生成完整营销方案……'
                  : '例如：把刚才第3个改得更幽默，并给我Facebook和Telegram版本……'
              }
              onKeyDown={(event) => {
                if (
                  event.key === 'Enter' &&
                  !event.shiftKey &&
                  !event.nativeEvent.isComposing
                ) {
                  event.preventDefault();
                  void send();
                }
              }}
            />

            <div>
              <small>
                Enter 发送 · Shift + Enter 换行
              </small>

              <button
                disabled={
                  busy || !input.trim()
                }
              >
                {busy
                  ? 'Elena is thinking...'
                  : 'Send to Elena'}
              </button>
            </div>
          </form>
        </section>
      </section>
    </div>
  );
}
