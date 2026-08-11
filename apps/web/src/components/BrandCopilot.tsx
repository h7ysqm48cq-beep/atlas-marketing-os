"use client";

import { ChangeEvent, FormEvent, useEffect, useRef, useState } from "react";
import styles from "./BrandCopilot.module.css";
import { API_URL } from "@/lib/api";

type Campaign = {
  id: string;
  name: string;
};

type Message = {
  role: "user" | "assistant";
  content: string;
  imageUrl?: string;
};

type CopilotAttachment = {
  id: string;
  kind: "image" | "document";
  name: string;
  mimeType: string;
  size: number;
  url: string;
  storageProvider?: string;
  storagePath?: string;
  documentId?: string;
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
    role: "USER" | "ASSISTANT" | "SYSTEM";
    content: string;
    createdAt: string;
    metadata?: Record<string, unknown> | null;
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

type CopilotMode = "chat" | "marketing-plan";

const INITIAL_MESSAGES: Message[] = [
  {
    role: "assistant",
    content:
      "我是 Elena，你的 AI Marketing Strategist。你可以和我讨论创意、改文案，或切换到 Marketing Plan 模式让我一次生成完整营销方案。",
  },
];

export function BrandCopilot() {
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [campaignId, setCampaignId] = useState("");
  const [mode, setMode] = useState<CopilotMode>("chat");
  const [messages, setMessages] = useState<Message[]>(INITIAL_MESSAGES);
  const [conversationId, setConversationId] = useState("");
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [loadingConversations, setLoadingConversations] = useState(true);
  const [input, setInput] = useState("");
  const [attachments, setAttachments] = useState<CopilotAttachment[]>([]);
  const [uploadingAttachment, setUploadingAttachment] = useState(false);
  const attachmentInputRef = useRef<HTMLInputElement | null>(null);
  const [busy, setBusy] = useState(false);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [marketingPlan, setMarketingPlan] = useState<MarketingPlan | null>(
    null,
  );
  const [status, setStatus] = useState("Brand Brain is active.");
  const endRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    void fetch(`${API_URL}/campaigns`)
      .then((response) => response.json())
      .then((data) => {
        if (Array.isArray(data)) {
          setCampaigns(data);
        }
      })
      .catch(() => {
        setStatus("Unable to load campaigns.");
      });
  }, []);

  useEffect(() => {
    void refreshConversations();
  }, []);

  useEffect(() => {
    endRef.current?.scrollIntoView({
      behavior: "smooth",
    });
  }, [messages]);

  useEffect(() => {
    document.body.classList.toggle(
      "copilot-mobile-drawer-open",
      mobileSidebarOpen,
    );

    return () => {
      document.body.classList.remove("copilot-mobile-drawer-open");
    };
  }, [mobileSidebarOpen]);

  async function refreshConversations() {
    try {
      const response = await fetch(`${API_URL}/copilot/conversations`);

      if (!response.ok) {
        throw new Error("Unable to load conversations.");
      }

      const data = await response.json();

      setConversations(Array.isArray(data) ? data : []);
    } catch {
      setStatus("Unable to load conversation history.");
    } finally {
      setLoadingConversations(false);
    }
  }

  function newChat() {
    setConversationId("");
    setMessages(INITIAL_MESSAGES);
    setMarketingPlan(null);
    setInput("");
    setAttachments([]);
    setCampaignId("");
    setMode("chat");
    setStatus("New conversation.");
    setMobileSidebarOpen(false);
  }

  async function openConversation(id: string) {
    if (busy || id === conversationId) {
      return;
    }

    setBusy(true);
    setStatus("Loading conversation...");

    try {
      const response = await fetch(`${API_URL}/copilot/conversations/${id}`);

      const data = (await response.json()) as ConversationDetail;

      if (!response.ok) {
        throw new Error("Unable to load conversation.");
      }

      const loadedMessages: Message[] = data.messages
        .filter(
          (message) => message.role === "USER" || message.role === "ASSISTANT",
        )
        .map((message) => ({
          role: message.role === "USER" ? "user" : "assistant",
          content: message.content,
          imageUrl:
            message.metadata &&
            typeof message.metadata === "object" &&
            "imageUrl" in message.metadata
              ? String(message.metadata.imageUrl)
              : undefined,
        }));

      setConversationId(data.id);
      setMessages(
        loadedMessages.length > 0 ? loadedMessages : INITIAL_MESSAGES,
      );
      setCampaignId(data.campaignId || "");
      setMode(data.mode === "marketing-plan" ? "marketing-plan" : "chat");
      setMarketingPlan(null);
      setStatus(`Loaded: ${data.title}`);
      setMobileSidebarOpen(false);
    } catch (error) {
      setStatus(
        error instanceof Error ? error.message : "Unable to load conversation.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function renameConversation(conversation: ConversationSummary) {
    const title = window.prompt("Rename conversation", conversation.title);

    if (title === null) {
      return;
    }

    const cleanTitle = title.replace(/\s+/g, " ").trim();

    if (!cleanTitle) {
      setStatus("Conversation title cannot be empty.");
      return;
    }

    if (cleanTitle.length > 80) {
      setStatus("Conversation title cannot exceed 80 characters.");
      return;
    }

    if (cleanTitle === conversation.title) {
      return;
    }

    try {
      const response = await fetch(
        `${API_URL}/copilot/conversations/${conversation.id}`,
        {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            title: cleanTitle,
          }),
        },
      );

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.message || "Unable to rename conversation.");
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

      setStatus(`Conversation renamed: ${data.title}`);
    } catch (error) {
      setStatus(
        error instanceof Error
          ? error.message
          : "Unable to rename conversation.",
      );
    }
  }

  async function deleteConversation(id: string) {
    const confirmed = window.confirm("Delete this conversation permanently?");

    if (!confirmed) {
      return;
    }

    try {
      const response = await fetch(`${API_URL}/copilot/conversations/${id}`, {
        method: "DELETE",
      });

      if (!response.ok) {
        throw new Error("Unable to delete conversation.");
      }

      if (conversationId === id) {
        newChat();
      }

      await refreshConversations();
      setStatus("Conversation deleted.");
    } catch (error) {
      setStatus(
        error instanceof Error
          ? error.message
          : "Unable to delete conversation.",
      );
    }
  }

  async function handleAttachmentSelection(
    event: ChangeEvent<HTMLInputElement>,
  ) {
    const files = Array.from(event.target.files || []);

    if (!files.length) {
      return;
    }

    setUploadingAttachment(true);
    setStatus(
      files.length === 1
        ? `Uploading ${files[0]?.name || "attachment"}...`
        : `Uploading ${files.length} attachments...`,
    );

    try {
      for (const file of files) {
        if (file.size > 10 * 1024 * 1024) {
          throw new Error(`${file.name} exceeds the 10 MB limit.`);
        }

        if (file.type.startsWith("image/")) {
          const formData = new FormData();
          formData.append("file", file);

          const response = await fetch(`${API_URL}/copilot/attachments/image`, {
            method: "POST",
            body: formData,
          });

          const data = (await response.json()) as
            CopilotAttachment | { message?: string };

          if (!response.ok || !("url" in data)) {
            throw new Error(
              "message" in data && data.message
                ? data.message
                : `Unable to upload ${file.name}.`,
            );
          }

          setAttachments((current) => [...current, data]);

          continue;
        }

        const lowerName = file.name.toLowerCase();

        const documentSupported = [
          ".pdf",
          ".docx",
          ".txt",
          ".md",
          ".markdown",
        ].some((extension) => lowerName.endsWith(extension));

        if (!documentSupported) {
          throw new Error(`${file.name} is not a supported attachment.`);
        }

        const formData = new FormData();
        formData.append("file", file);
        formData.append("category", "Copilot Attachment");
        formData.append("tags", "Copilot,Attachment,Imported");

        const response = await fetch(`${API_URL}/knowledge/upload`, {
          method: "POST",
          body: formData,
        });

        const data = (await response.json()) as {
          document?: {
            id?: string;
            sourceUrl?: string | null;
          };
          upload?: {
            url?: string;
            originalName?: string;
            mimeType?: string;
            size?: number;
            storageProvider?: string;
            storagePath?: string;
          };
          message?: string;
        };

        if (!response.ok || !data.document?.id) {
          throw new Error(data.message || `Unable to upload ${file.name}.`);
        }

        const url = data.upload?.url || data.document.sourceUrl || "";

        setAttachments((current) => [
          ...current,
          {
            id: data.document?.id || crypto.randomUUID(),
            kind: "document",
            name: data.upload?.originalName || file.name,
            mimeType:
              data.upload?.mimeType || file.type || "application/octet-stream",
            size: data.upload?.size || file.size,
            url,
            storageProvider: data.upload?.storageProvider,
            storagePath: data.upload?.storagePath,
            documentId: data.document?.id,
          },
        ]);
      }

      setStatus("Attachment ready. Add your instruction and send.");
    } catch (error) {
      setStatus(
        error instanceof Error ? error.message : "Unable to upload attachment.",
      );
    } finally {
      setUploadingAttachment(false);

      if (attachmentInputRef.current) {
        attachmentInputRef.current.value = "";
      }
    }
  }

  function removeAttachment(id: string) {
    setAttachments((current) =>
      current.filter((attachment) => attachment.id !== id),
    );
  }

  function buildAttachmentContext() {
    if (!attachments.length) {
      return "";
    }

    const lines = attachments.map((attachment, index) => {
      const parts = [
        `${index + 1}. ${attachment.name}`,
        `Type: ${attachment.mimeType}`,
        attachment.url ? `URL: ${attachment.url}` : "",
        attachment.documentId
          ? `Knowledge document ID: ${attachment.documentId}`
          : "",
      ].filter(Boolean);

      return parts.join("\n");
    });

    return [
      "",
      "",
      "[Attached files]",
      ...lines,
      "",
      "Use these attached files as context for this request.",
    ].join("\n");
  }

  async function send(event?: FormEvent) {
    event?.preventDefault();

    const rawText = input.trim();

    if ((!rawText && attachments.length === 0) || busy || uploadingAttachment) {
      return;
    }

    const currentAttachments = [...attachments];

    const text =
      rawText ||
      (currentAttachments.some((attachment) => attachment.kind === "image")
        ? "请分析我上传的图片。"
        : "请参考我上传的文件回答。");

    const next: Message[] = [
      ...messages,
      {
        role: "user",
        content: text,
      },
    ];

    setMessages(next);
    setInput("");
    setAttachments([]);
    setBusy(true);
    setStatus("Elena is thinking...");

    try {
      if (mode === "marketing-plan") {
        const response = await fetch(`${API_URL}/copilot/marketing-plan`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            prompt: text,
            campaignId: campaignId || undefined,
            conversationId: conversationId || undefined,
          }),
        });

        const data = await response.json();

        if (!response.ok) {
          throw new Error(data.message || "Unable to generate marketing plan.");
        }

        setMarketingPlan(data);

        if (data.conversation?.id) {
          setConversationId(data.conversation.id);
        }

        await refreshConversations();

        setStatus("Marketing Plan generated.");

        setMessages((current) => [
          ...current,
          {
            role: "assistant",
            content: "Marketing Plan 已生成，请查看下方结构化方案。",
          },
        ]);
      } else {
        const response = await fetch(`${API_URL}/copilot/chat`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            conversationId: conversationId || undefined,
            campaignId: campaignId || undefined,
            mode,
            messages: next.slice(-12),
            attachments:
              currentAttachments.length > 0 ? currentAttachments : undefined,
          }),
        });

        const data = await response.json();

        if (!response.ok || !data.reply) {
          throw new Error(data.message || "Unable to get response.");
        }

        setMarketingPlan(null);

        if (data.conversation?.id) {
          setConversationId(data.conversation.id);
        }

        setMessages((current) => [
          ...current,
          {
            role: "assistant",
            content: data.reply,
          },
        ]);

        await refreshConversations();

        setStatus(
          data.campaign
            ? `Using ${data.campaign.name} · Chat`
            : "Using Brand Brain · Chat",
        );
      }
    } catch (error) {
      setMessages((current) => [
        ...current,
        {
          role: "assistant",
          content: `发生错误：${
            error instanceof Error ? error.message : "Unknown error"
          }`,
        },
      ]);

      setStatus("Request failed.");
    } finally {
      setBusy(false);
    }
  }

  const copyMessage = async (content: string) => {
    await navigator.clipboard.writeText(content);
  };


  
const generateImageFromMessage = async (
  content: string,
  index: number,
) => {
  try {
    setStatus("Generating image...");

    const response = await fetch(
      `${API_URL}/asset-images/generate`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name: "copilot-generated-image",
          prompt: content,
          platform: "Facebook",
          size: "1024x1536",
          quality: "medium",
        }),
      },
    );

    const data = await response.json();

    if (!response.ok) {
      throw new Error(
        data.message || "Image generation failed.",
      );
    }

    const imageUrl =
      data.asset?.url ||
      data.asset?.thumbnailUrl;

    if (!imageUrl) {
      throw new Error(
        "Image generated but no URL returned.",
      );
    }

    setMessages((current) =>
      current.map((message, messageIndex) =>
        messageIndex === index
          ? {
              ...message,
              imageUrl,
            }
          : message,
      ),
    );

    if (conversationId) {
      await fetch(
        `${API_URL}/copilot/conversations/${conversationId}/image`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            imageUrl,
            assetId: data.asset?.id,
          }),
        },
      );
    }

    setStatus("Image generated.");
  } catch (error) {
    setStatus(
      error instanceof Error
        ? error.message
        : "Image generation failed.",
    );
  }
};



  return (
    <div className={styles.page}>
      <button
        type="button"
        className={`${styles.mobileConversationOverlay}${
          mobileSidebarOpen ? ` ${styles.visible}` : ""
        }`}
        aria-label="Close conversations"
        onClick={() => setMobileSidebarOpen(false)}
      />

      <section className={styles.mobileCopilotBar}>
        <div className={styles.mobileCopilotIdentity}>
          <span>Elena</span>
          <strong>
            {mode === "marketing-plan" ? "Marketing Plan" : "Chat"}
          </strong>
        </div>

        <button type="button" onClick={() => setMobileSidebarOpen(true)}>
          Conversations
        </button>
      </section>

      <section className={styles.mobileControls}>
        <label>
          <span>Mode</span>
          <select
            value={mode}
            onChange={(event) => setMode(event.target.value as CopilotMode)}
          >
            <option value="chat">Chat mode</option>
            <option value="marketing-plan">Marketing Plan</option>
          </select>
        </label>

        <label>
          <span>Context</span>
          <select
            value={campaignId}
            onChange={(event) => setCampaignId(event.target.value)}
          >
            <option value="">Brand Brain only</option>

            {campaigns.map((campaign) => (
              <option key={campaign.id} value={campaign.id}>
                {campaign.name}
              </option>
            ))}
          </select>
        </label>

        <small>{status}</small>
      </section>

      <section className={styles.hero}>
        <div>
          <p className={styles.eyebrow}>Elena Brand Copilot</p>
          <h1>Work with Elena like an always-on marketing strategist.</h1>
          <p>连续优化创意，或一次生成完整营销方案。</p>
        </div>

        <div className={styles.context}>
          <span>Working mode</span>

          <select
            value={mode}
            onChange={(event) => setMode(event.target.value as CopilotMode)}
          >
            <option value="chat">Chat mode</option>
            <option value="marketing-plan">Marketing Plan</option>
          </select>

          <span>Campaign context</span>

          <select
            value={campaignId}
            onChange={(event) => setCampaignId(event.target.value)}
          >
            <option value="">Brand Brain only</option>

            {campaigns.map((campaign) => (
              <option key={campaign.id} value={campaign.id}>
                {campaign.name}
              </option>
            ))}
          </select>

          <small>{status}</small>
        </div>
      </section>

      <section className={styles.layout}>
        <aside
          className={`${styles.sidebar}${
            mobileSidebarOpen ? ` ${styles.mobileSidebarOpen}` : ""
          }`}
        >
          <div className={styles.mobileSidebarHeader}>
            <div>
              <span>Elena</span>
              <strong>Conversations</strong>
            </div>

            <button
              type="button"
              aria-label="Close conversations"
              onClick={() => setMobileSidebarOpen(false)}
            >
              ×
            </button>
          </div>
          <button className={styles.newChat} onClick={newChat} type="button">
            <span>＋</span>
            New Chat
          </button>

          <section className={styles.conversationSection}>
            <div className={styles.sidebarHeading}>
              <p className={styles.eyebrow}>Conversations</p>

              <button
                type="button"
                onClick={() => void refreshConversations()}
                aria-label="Refresh conversations"
              >
                ↻
              </button>
            </div>

            <div className={styles.conversationList}>
              {loadingConversations && (
                <p className={styles.emptyConversations}>Loading history...</p>
              )}

              {!loadingConversations && conversations.length === 0 && (
                <p className={styles.emptyConversations}>
                  No conversations yet.
                </p>
              )}

              {conversations.map((conversation) => (
                <div
                  className={`${styles.conversationItem} ${
                    conversation.id === conversationId
                      ? styles.activeConversation
                      : ""
                  }`}
                  key={conversation.id}
                >
                  <button
                    className={styles.conversationOpen}
                    type="button"
                    onClick={() => void openConversation(conversation.id)}
                  >
                    <strong>{conversation.title}</strong>

                    <small>{conversation._count?.messages || 0} messages</small>
                  </button>

                  <div className={styles.conversationActions}>
                    <button
                      className={styles.renameConversation}
                      type="button"
                      aria-label={`Rename ${conversation.title}`}
                      onClick={() => void renameConversation(conversation)}
                    >
                      ✎
                    </button>

                    <button
                      className={styles.deleteConversation}
                      type="button"
                      aria-label={`Delete ${conversation.title}`}
                      onClick={() => void deleteConversation(conversation.id)}
                    >
                      ×
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </section>

          <section className={styles.quickDirections}>
            <p className={styles.eyebrow}>Quick directions</p>

            {[
              "帮我想10个更容易引起讨论的港剧怀旧话题。",
              "把这段文案改得更自然、更像马来西亚华人口吻。",
              "为这个主题生成完整 Facebook、Telegram 和 Reels 营销方案。",
              "分析为什么这段内容不够吸引人，并直接优化。",
            ].map((text) => (
              <button key={text} type="button" onClick={() => setInput(text)}>
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
                  message.role === "user" ? styles.user : styles.assistant
                }
                key={index}
              >
                <div>
                  <strong>{message.role === "user" ? "You" : "Elena"}</strong>

                  
{message.role === "assistant" && (
  <div className={styles.messageActions}>
    <button
      type="button"
      aria-label="Copy response"
      onClick={() =>
        copyMessage(message.content)
      }
    >
      📋
    </button>

    <button
      type="button"
      aria-label="Generate image"
      onClick={() =>
        generateImageFromMessage(
          message.content,
          index,
        )
      }
    >
      🖼
    </button>
  </div>
)}

                </div>

                <p>{message.content}</p>

                {message.imageUrl && (
                  <img
                    src={message.imageUrl}
                    alt="Generated visual"
                    className={styles.generatedImage}
                  />
                )}

                {message.imageUrl && (
                  <img
                    src={message.imageUrl}
                    alt="Generated visual"
                    className={styles.generatedImage}
                  />
                )}
              </article>
            ))}

            <div ref={endRef} />
          </div>

          {marketingPlan && (
            <section className={styles.marketingPlan}>
              <header className={styles.planHeader}>
                <div>
                  <p className={styles.eyebrow}>Marketing Plan</p>
                  <h2>{marketingPlan.campaignName}</h2>
                </div>

                <span className={styles.planBadge}>AI generated</span>
              </header>

              <div className={styles.planSummaryGrid}>
                {[
                  ["Objective", marketingPlan.objective],
                  ["Audience", marketingPlan.audience],
                  ["Hook", marketingPlan.hook],
                  ["Key Message", marketingPlan.keyMessage],
                ].map(([label, value]) => (
                  <article className={styles.planSummaryCard} key={label}>
                    <span>{label}</span>
                    <p>{value}</p>
                  </article>
                ))}
              </div>

              <section className={styles.planSection}>
                <div className={styles.planSectionHeader}>
                  <div>
                    <span>Strategy</span>
                    <h3>Content Pillars</h3>
                  </div>
                </div>

                <div className={styles.pillarList}>
                  {marketingPlan.contentPillars.map((item) => (
                    <span key={item}>{item}</span>
                  ))}
                </div>
              </section>

              <section className={styles.planSection}>
                <div className={styles.planSectionHeader}>
                  <div>
                    <span>Ideas</span>
                    <h3>Content Directions</h3>
                  </div>
                </div>

                <ol className={styles.ideaList}>
                  {marketingPlan.contentIdeas.map((item, index) => (
                    <li key={item}>
                      <span>{index + 1}</span>
                      <p>{item}</p>
                    </li>
                  ))}
                </ol>
              </section>

              <section className={styles.planSection}>
                <div className={styles.planSectionHeader}>
                  <div>
                    <span>Channels</span>
                    <h3>Platform Content</h3>
                  </div>
                </div>

                <div className={styles.platformPlanGrid}>
                  {[
                    ["Facebook", marketingPlan.facebook],
                    ["Telegram", marketingPlan.telegram],
                    ["Reels", marketingPlan.reels],
                  ].map(([platform, items]) => (
                    <article
                      className={styles.platformPlanCard}
                      key={platform as string}
                    >
                      <header>
                        <strong>{platform as string}</strong>
                        <span>{(items as string[]).length} drafts</span>
                      </header>

                      <div>
                        {(items as string[]).map((item, index) => (
                          <section key={item}>
                            <span>
                              {(platform as string).slice(0, 2)}
                              {index + 1}
                            </span>
                            <p>{item}</p>
                          </section>
                        ))}
                      </div>
                    </article>
                  ))}
                </div>
              </section>

              <section className={styles.planSection}>
                <div className={styles.planSectionHeader}>
                  <div>
                    <span>Creative</span>
                    <h3>Image Prompts</h3>
                  </div>
                </div>

                <div className={styles.imagePromptList}>
                  {marketingPlan.imagePrompts.map((item, index) => (
                    <article key={item}>
                      <div>
                        <span>Prompt {index + 1}</span>
                        <button
                          type="button"
                          onClick={() => navigator.clipboard.writeText(item)}
                        >
                          Copy
                        </button>
                      </div>
                      <p>{item}</p>
                    </article>
                  ))}
                </div>
              </section>

              <section className={styles.planSection}>
                <div className={styles.planSectionHeader}>
                  <div>
                    <span>Execution</span>
                    <h3>Publishing Schedule</h3>
                  </div>
                </div>

                <div className={styles.scheduleTimeline}>
                  {marketingPlan.schedule.map((item) => (
                    <article key={`${item.day}-${item.platform}`}>
                      <span className={styles.scheduleDay}>Day {item.day}</span>

                      <div>
                        <div>
                          <strong>{item.platform}</strong>
                          <span>{item.contentType}</span>
                        </div>
                        <p>{item.topic}</p>
                      </div>
                    </article>
                  ))}
                </div>
              </section>
            </section>
          )}

          <form className={styles.composer} onSubmit={send}>
            <input
              ref={attachmentInputRef}
              className={styles.attachmentInput}
              type="file"
              multiple
              accept="image/png,image/jpeg,image/webp,image/gif,.pdf,.docx,.txt,.md,.markdown"
              onChange={handleAttachmentSelection}
            />

            {attachments.length > 0 ? (
              <div className={styles.attachmentTray}>
                {attachments.map((attachment) => (
                  <article
                    key={attachment.id}
                    className={styles.attachmentCard}
                  >
                    {attachment.kind === "image" ? (
                      <img src={attachment.url} alt={attachment.name} />
                    ) : (
                      <div className={styles.documentAttachmentIcon}>DOC</div>
                    )}

                    <div>
                      <strong>{attachment.name}</strong>
                      <span>{formatFileSize(attachment.size)}</span>
                    </div>

                    <button
                      type="button"
                      aria-label={`Remove ${attachment.name}`}
                      onClick={() => removeAttachment(attachment.id)}
                    >
                      ×
                    </button>
                  </article>
                ))}
              </div>
            ) : null}

            <textarea
              value={input}
              onChange={(event) => setInput(event.target.value)}
              placeholder={
                mode === "marketing-plan"
                  ? "例如：为世界杯怀旧主题生成完整营销方案……"
                  : "例如：把刚才第3个改得更幽默，并给我Facebook和Telegram版本……"
              }
              onKeyDown={(event) => {
                if (
                  event.key === "Enter" &&
                  !event.shiftKey &&
                  !event.nativeEvent.isComposing
                ) {
                  event.preventDefault();
                  void send();
                }
              }}
            />

            <div>
              <div className={styles.composerTools}>
                <button
                  className={styles.attachButton}
                  type="button"
                  disabled={busy || uploadingAttachment}
                  onClick={() => attachmentInputRef.current?.click()}
                  aria-label="Attach files"
                >
                  📎
                  <span>{uploadingAttachment ? "Uploading..." : "Attach"}</span>
                </button>

                <small>Enter 发送 · Shift + Enter 换行</small>
              </div>

              <button
                disabled={
                  busy ||
                  uploadingAttachment ||
                  (!input.trim() && attachments.length === 0)
                }
              >
                {busy ? "Elena is thinking..." : "Send to Elena"}
              </button>
            </div>
          </form>
        </section>
      </section>
    </div>
  );
}

function formatFileSize(value: number) {
  if (!Number.isFinite(value) || value <= 0) {
    return "Unknown size";
  }

  if (value < 1024) {
    return `${value} B`;
  }

  if (value < 1024 * 1024) {
    return `${Math.round(value / 1024)} KB`;
  }

  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}
