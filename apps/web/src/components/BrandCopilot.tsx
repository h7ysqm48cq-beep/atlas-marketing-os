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

type ConversationSummary = {
  id: string;
  campaignId: string | null;
  title: string;
  mode: string;
  updatedAt: string;
  _count?: {
    messages: number;
  };
};

type ConversationDetail = {
  id: string;
  campaignId: string | null;
  title: string;
  mode: string;
  messages: Array<{
    id: string;
    role: 'USER' | 'ASSISTANT' | 'SYSTEM';
    content: string;
    createdAt: string;
  }>;
};

type MarketingPlan = {
  campaignName: string;
  objective: string;
  audience: string;
  hook: string;
  keyMessage: string;
  contentPillars: string[];
  contentIdeas: string[];
  facebook: string[];
  telegram: string[];
  reels: string[];
  imagePrompts: string[];
  schedule: Array<{
    day: number;
    platform: string;
    contentType: string;
    topic: string;
  }>;
};

type CopilotMode = 'chat' | 'marketing-plan';

const API =
  process.env.NEXT_PUBLIC_API_URL ||
  'http://localhost:3001';

const INITIAL_MESSAGES: Message[] = [
  {
    role: 'assistant',
    content:
      '我是 Elena，你的 AI Marketing Strategist。你可以和我讨论创意、改文案，或切换到 Marketing Plan 模式让我一次生成完整营销方案。',
  },
];

export function BrandCopilot() {
  const [campaigns, setCampaigns] =
    useState<Campaign[]>([]);
  const [campaignId, setCampaignId] = useState('');
  const [mode, setMode] =
    useState<CopilotMode>('chat');
  const [messages, setMessages] =
    useState<Message[]>(INITIAL_MESSAGES);
  const [conversationId, setConversationId] =
    useState('');
  const [conversations, setConversations] =
    useState<ConversationSummary[]>([]);
  const [
    loadingConversations,
    setLoadingConversations,
  ] = useState(true);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [marketingPlan, setMarketingPlan] =
    useState<MarketingPlan | null>(null);
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
    void refreshConversations();
  }, []);

  useEffect(() => {
    endRef.current?.scrollIntoView({
      behavior: 'smooth',
    });
  }, [messages]);

  async function refreshConversations() {
    try {
      const response = await fetch(
        `${API}/copilot/conversations`,
      );

      if (!response.ok) {
        throw new Error(
          'Unable to load conversations.',
        );
      }

      const data = await response.json();

      setConversations(
        Array.isArray(data) ? data : [],
      );
    } catch {
      setStatus(
        'Unable to load conversation history.',
      );
    } finally {
      setLoadingConversations(false);
    }
  }

  function newChat() {
    setConversationId('');
    setMessages(INITIAL_MESSAGES);
    setMarketingPlan(null);
    setInput('');
    setCampaignId('');
    setMode('chat');
    setStatus('New conversation.');
  }

  async function openConversation(id: string) {
    if (busy || id === conversationId) {
      return;
    }

    setBusy(true);
    setStatus('Loading conversation...');

    try {
      const response = await fetch(
        `${API}/copilot/conversations/${id}`,
      );

      const data =
        (await response.json()) as ConversationDetail;

      if (!response.ok) {
        throw new Error(
          'Unable to load conversation.',
        );
      }

      const loadedMessages: Message[] =
        data.messages
          .filter(
            (message) =>
              message.role === 'USER' ||
              message.role === 'ASSISTANT',
          )
          .map((message) => ({
            role:
              message.role === 'USER'
                ? 'user'
                : 'assistant',
            content: message.content,
          }));

      setConversationId(data.id);
      setMessages(
        loadedMessages.length > 0
          ? loadedMessages
          : INITIAL_MESSAGES,
      );
      setCampaignId(data.campaignId || '');
      setMode(
        data.mode === 'marketing-plan'
          ? 'marketing-plan'
          : 'chat',
      );
      setMarketingPlan(null);
      setStatus(`Loaded: ${data.title}`);
    } catch (error) {
      setStatus(
        error instanceof Error
          ? error.message
          : 'Unable to load conversation.',
      );
    } finally {
      setBusy(false);
    }
  }

  async function renameConversation(
    conversation: ConversationSummary,
  ) {
    const title = window.prompt(
      'Rename conversation',
      conversation.title,
    );

    if (title === null) {
      return;
    }

    const cleanTitle = title
      .replace(/\s+/g, ' ')
      .trim();

    if (!cleanTitle) {
      setStatus(
        'Conversation title cannot be empty.',
      );
      return;
    }

    if (cleanTitle.length > 80) {
      setStatus(
        'Conversation title cannot exceed 80 characters.',
      );
      return;
    }

    if (cleanTitle === conversation.title) {
      return;
    }

    try {
      const response = await fetch(
        `${API}/copilot/conversations/${conversation.id}`,
        {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            title: cleanTitle,
          }),
        },
      );

      const data = await response.json();

      if (!response.ok) {
        throw new Error(
          data.message ||
            'Unable to rename conversation.',
        );
      }

      setConversations((current) =>
        current.map((item) =>
          item.id === conversation.id
            ? {
                ...item,
                title: data.title,
                updatedAt: data.updatedAt,
              }
            : item,
        ),
      );

      setStatus(
        `Conversation renamed: ${data.title}`,
      );
    } catch (error) {
      setStatus(
        error instanceof Error
          ? error.message
          : 'Unable to rename conversation.',
      );
    }
  }

  async function deleteConversation(
    id: string,
  ) {
    const confirmed = window.confirm(
      'Delete this conversation permanently?',
    );

    if (!confirmed) {
      return;
    }

    try {
      const response = await fetch(
        `${API}/copilot/conversations/${id}`,
        {
          method: 'DELETE',
        },
      );

      if (!response.ok) {
        throw new Error(
          'Unable to delete conversation.',
        );
      }

      if (conversationId === id) {
        newChat();
      }

      await refreshConversations();
      setStatus('Conversation deleted.');
    } catch (error) {
      setStatus(
        error instanceof Error
          ? error.message
          : 'Unable to delete conversation.',
      );
    }
  }

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
      if (mode === 'marketing-plan') {
        const response = await fetch(
          `${API}/copilot/marketing-plan`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              prompt: text,
              campaignId:
                campaignId || undefined,
            }),
          },
        );

        const data = await response.json();

        if (!response.ok) {
          throw new Error(
            data.message ||
              'Unable to generate marketing plan.',
          );
        }

        setMarketingPlan(data);
        setStatus('Marketing Plan generated.');

        setMessages((current) => [
          ...current,
          {
            role: 'assistant',
            content:
              'Marketing Plan 已生成，请查看下方结构化方案。',
          },
        ]);
      } else {
        const response = await fetch(
          `${API}/copilot/chat`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              conversationId:
                conversationId || undefined,
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

        setMarketingPlan(null);

        if (data.conversation?.id) {
          setConversationId(
            data.conversation.id,
          );
        }

        setMessages((current) => [
          ...current,
          {
            role: 'assistant',
            content: data.reply,
          },
        ]);

        await refreshConversations();

        setStatus(
          data.campaign
            ? `Using ${data.campaign.name} · Chat`
            : 'Using Brand Brain · Chat',
        );
      }
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
        <aside className={styles.sidebar}>
          <button
            className={styles.newChat}
            onClick={newChat}
            type="button"
          >
            <span>＋</span>
            New Chat
          </button>

          <section
            className={styles.conversationSection}
          >
            <div
              className={styles.sidebarHeading}
            >
              <p className={styles.eyebrow}>
                Conversations
              </p>

              <button
                type="button"
                onClick={() =>
                  void refreshConversations()
                }
                aria-label="Refresh conversations"
              >
                ↻
              </button>
            </div>

            <div
              className={styles.conversationList}
            >
              {loadingConversations && (
                <p
                  className={
                    styles.emptyConversations
                  }
                >
                  Loading history...
                </p>
              )}

              {!loadingConversations &&
                conversations.length === 0 && (
                  <p
                    className={
                      styles.emptyConversations
                    }
                  >
                    No conversations yet.
                  </p>
                )}

              {conversations.map(
                (conversation) => (
                  <div
                    className={`${styles.conversationItem} ${
                      conversation.id ===
                      conversationId
                        ? styles.activeConversation
                        : ''
                    }`}
                    key={conversation.id}
                  >
                    <button
                      className={
                        styles.conversationOpen
                      }
                      type="button"
                      onClick={() =>
                        void openConversation(
                          conversation.id,
                        )
                      }
                    >
                      <strong>
                        {conversation.title}
                      </strong>

                      <small>
                        {conversation._count
                          ?.messages || 0}{' '}
                        messages
                      </small>
                    </button>

                    <div
                      className={
                        styles.conversationActions
                      }
                    >
                      <button
                        className={
                          styles.renameConversation
                        }
                        type="button"
                        aria-label={`Rename ${conversation.title}`}
                        onClick={() =>
                          void renameConversation(
                            conversation,
                          )
                        }
                      >
                        ✎
                      </button>

                      <button
                        className={
                          styles.deleteConversation
                        }
                        type="button"
                        aria-label={`Delete ${conversation.title}`}
                        onClick={() =>
                          void deleteConversation(
                            conversation.id,
                          )
                        }
                      >
                        ×
                      </button>
                    </div>
                  </div>
                ),
              )}
            </div>
          </section>

          <section
            className={styles.quickDirections}
          >
            <p className={styles.eyebrow}>
              Quick directions
            </p>

            {[
              '帮我想10个更容易引起讨论的港剧怀旧话题。',
              '把这段文案改得更自然、更像马来西亚华人口吻。',
              '为这个主题生成完整 Facebook、Telegram 和 Reels 营销方案。',
              '分析为什么这段内容不够吸引人，并直接优化。',
            ].map((text) => (
              <button
                key={text}
                type="button"
                onClick={() => setInput(text)}
              >
                {text}
              </button>
            ))}
          </section>
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

          {marketingPlan && (
            <section
              style={{
                margin: '16px',
                padding: '20px',
                border: '1px solid rgba(255,255,255,0.12)',
                borderRadius: '16px',
                background: 'rgba(255,255,255,0.03)',
              }}
            >
              <p className={styles.eyebrow}>
                Marketing Plan
              </p>

              <h2>{marketingPlan.campaignName}</h2>

              <h3>Objective</h3>
              <p>{marketingPlan.objective}</p>

              <h3>Audience</h3>
              <p>{marketingPlan.audience}</p>

              <h3>Hook</h3>
              <p>{marketingPlan.hook}</p>

              <h3>Key Message</h3>
              <p>{marketingPlan.keyMessage}</p>

              <h3>Content Pillars</h3>
              <ul>
                {marketingPlan.contentPillars.map(
                  (item) => (
                    <li key={item}>{item}</li>
                  ),
                )}
              </ul>

              <h3>Content Ideas</h3>
              <ol>
                {marketingPlan.contentIdeas.map(
                  (item) => (
                    <li key={item}>{item}</li>
                  ),
                )}
              </ol>

              <h3>Facebook</h3>
              {marketingPlan.facebook.map((item) => (
                <p key={item}>{item}</p>
              ))}

              <h3>Telegram</h3>
              {marketingPlan.telegram.map((item) => (
                <p key={item}>{item}</p>
              ))}

              <h3>Reels</h3>
              {marketingPlan.reels.map((item) => (
                <p key={item}>{item}</p>
              ))}

              <h3>Image Prompts</h3>
              {marketingPlan.imagePrompts.map(
                (item) => (
                  <p key={item}>{item}</p>
                ),
              )}

              <h3>Schedule</h3>
              <ul>
                {marketingPlan.schedule.map(
                  (item) => (
                    <li
                      key={`${item.day}-${item.platform}`}
                    >
                      Day {item.day} · {item.platform} ·{' '}
                      {item.contentType} · {item.topic}
                    </li>
                  ),
                )}
              </ul>
            </section>
          )}

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
