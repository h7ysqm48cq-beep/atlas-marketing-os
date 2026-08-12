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
  assetId?: string;
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
  const [copiedMessageIndex, setCopiedMessageIndex] = useState<number | null>(
    null,
  );
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

      const loadedMessages: Message[] = [];

      for (const message of data.messages) {
        if (message.role !== "USER" && message.role !== "ASSISTANT") {
          continue;
        }

        const metadata =
          message.metadata && typeof message.metadata === "object"
            ? message.metadata
            : null;

        const imageUrl =
          metadata && "imageUrl" in metadata && metadata.imageUrl
            ? String(metadata.imageUrl)
            : undefined;

        const assetId =
          metadata && "assetId" in metadata && metadata.assetId
            ? String(metadata.assetId)
            : undefined;

        const isGeneratedImage =
          message.role === "ASSISTANT" &&
          metadata &&
          "type" in metadata &&
          metadata.type === "generated-image" &&
          Boolean(imageUrl);

        if (isGeneratedImage) {
          for (let index = loadedMessages.length - 1; index >= 0; index -= 1) {
            if (loadedMessages[index]?.role === "assistant") {
              loadedMessages[index] = {
                ...loadedMessages[index],
                imageUrl,
                assetId,
              };

              break;
            }
          }

          continue;
        }

        loadedMessages.push({
          role: message.role === "USER" ? "user" : "assistant",
          content: message.content,
          imageUrl,
          assetId,
        });
      }

      setConversationId(data.id);
      setMessages(
        loadedMessages.length > 0 ? loadedMessages : INITIAL_MESSAGES,
      );
      setCampaignId(data.campaignId || "");
      setMode(data.mode === "marketing-plan" ? "marketing-plan" : "chat");

      const restoredPlanMessage = data.messages
        .slice()
        .reverse()
        .find(
          (message) =>
            message.role === "ASSISTANT" &&
            message.metadata &&
            typeof message.metadata === "object" &&
            "type" in message.metadata &&
            message.metadata.type === "marketing-plan",
        );

      if (
        restoredPlanMessage &&
        restoredPlanMessage.metadata &&
        typeof restoredPlanMessage.metadata === "object" &&
        "plan" in restoredPlanMessage.metadata
      ) {
        setMarketingPlan(restoredPlanMessage.metadata.plan as MarketingPlan);
      } else {
        setMarketingPlan(null);
      }

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

        setMessages((current) => [
          ...current,
          {
            role: "assistant",
            content: `
Marketing Plan 已生成

Campaign:
${data.campaignName || "-"}

Objective:
${data.objective || "-"}

Audience:
${data.audience || "-"}

Hook:
${data.hook || "-"}

Key Message:
${data.keyMessage || "-"}

Content Pillars:
${Array.isArray(data.contentPillars) ? data.contentPillars.join(", ") : "-"}

你可以继续告诉我需要调整的方向，例如视觉风格、平台策略或文案版本。

You can continue refining this plan with Elena.
`,
          },
        ]);

        if (data.conversation?.id || data.conversationId) {
          setConversationId(data.conversation?.id || data.conversationId);
        }

        // Keep Marketing Plan mode active.
        // User can continue refining the generated plan naturally.

        await refreshConversations();

        setStatus("Marketing Plan generated. Continue refining with Elena.");

        setMessages((current) => [
          ...current,
          {
            role: "assistant",
            content:
              "Marketing Plan 已生成。你可以继续告诉我需要修改的方向，例如调整受众、内容风格、平台策略，我会继续优化。",
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
            messages: [
              ...next.slice(-12),
              ...(marketingPlan
                ? [
                    {
                      role: "system",
                      content: `Current Marketing Plan Context:\n${JSON.stringify(
                        marketingPlan,
                        null,
                        2,
                      )}`,
                    },
                  ]
                : []),
            ],
            attachments:
              currentAttachments.length > 0 ? currentAttachments : undefined,
          }),
        });

        const data = await response.json();

        if (!response.ok || !data.reply) {
          throw new Error(data.message || "Unable to get response.");
        }

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

  const copyMessage = async (content: string, index: number) => {
    try {
      if (
        typeof navigator !== "undefined" &&
        navigator.clipboard &&
        window.isSecureContext
      ) {
        await navigator.clipboard.writeText(content);
      } else {
        const textarea = document.createElement("textarea");

        textarea.value = content;
        textarea.setAttribute("readonly", "");
        textarea.style.position = "fixed";
        textarea.style.opacity = "0";
        textarea.style.pointerEvents = "none";

        document.body.appendChild(textarea);

        textarea.focus();
        textarea.select();

        const copied = document.execCommand("copy");

        document.body.removeChild(textarea);

        if (!copied) {
          throw new Error("Copy command was rejected.");
        }
      }

      setCopiedMessageIndex(index);
      setStatus("Copied to clipboard.");

      window.setTimeout(() => {
        setCopiedMessageIndex((current) =>
          current === index ? null : current,
        );
      }, 1600);
    } catch (error) {
      setStatus(
        error instanceof Error
          ? `Unable to copy: ${error.message}`
          : "Unable to copy response.",
      );
    }
  };

  const generateImageFromMessage = async (content: string, index: number) => {
    try {
      setStatus("Generating image...");

      const response = await fetch(`${API_URL}/copilot/image`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          content,
          platform: "Facebook post",
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.message || "Image generation failed.");
      }

      const imageUrl = data.asset?.url || data.asset?.thumbnailUrl;

      if (!imageUrl) {
        throw new Error("Image generated but no URL returned.");
      }

      setMessages((current) =>
        current.map((message, messageIndex) =>
          messageIndex === index
            ? {
                ...message,
                imageUrl,
                assetId: data.asset?.id,
              }
            : message,
        ),
      );

      if (!conversationId) {
        setStatus(
          "Image generated. Start a conversation first to save it in history.",
        );
        return;
      }

      const saveResponse = await fetch(
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

      const saveData = await saveResponse.json();

      if (!saveResponse.ok) {
        throw new Error(
          saveData.message ||
            "Image generated, but conversation history save failed.",
        );
      }

      await refreshConversations();

      setStatus("Image generated and saved to conversation history.");
    } catch (error) {
      setStatus(
        error instanceof Error ? error.message : "Image generation failed.",
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
          <div className={styles.modeSwitch}>
            <button
              type="button"
              className={
                mode === "chat" ? styles.modeActive : styles.modeButton
              }
              onClick={() => setMode("chat")}
            >
              Chat
            </button>

            <button
              type="button"
              className={
                mode === "marketing-plan"
                  ? styles.modeActive
                  : styles.modeButton
              }
              onClick={() => setMode("marketing-plan")}
            >
              Marketing Plan
            </button>
          </div>
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
                        className={styles.messageActionButton}
                        aria-label="Copy response"
                        title={
                          copiedMessageIndex === index
                            ? "Copied"
                            : "Copy response"
                        }
                        onClick={() => void copyMessage(message.content, index)}
                      >
                        {copiedMessageIndex === index ? (
                          <svg viewBox="0 0 24 24" aria-hidden="true">
                            <path d="M5 12.5 9.2 17 19 7" />
                          </svg>
                        ) : (
                          <svg viewBox="0 0 24 24" aria-hidden="true">
                            <rect x="9" y="9" width="10" height="10" rx="2" />
                            <path d="M15 9V7a2 2 0 0 0-2-2H7a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h2" />
                          </svg>
                        )}

                        <span>
                          {copiedMessageIndex === index ? "Copied" : "Copy"}
                        </span>
                      </button>

                      <button
                        type="button"
                        className={styles.messageActionButton}
                        aria-label="Generate image"
                        title="Generate image"
                        onClick={() =>
                          void generateImageFromMessage(message.content, index)
                        }
                      >
                        <svg viewBox="0 0 24 24" aria-hidden="true">
                          <rect x="3" y="4" width="18" height="16" rx="2" />
                          <circle cx="8.5" cy="9" r="1.5" />
                          <path d="m4 17 5-5 4 4 2-2 5 5" />
                        </svg>

                        <span>Image</span>
                      </button>
                    </div>
                  )}
                </div>

                <p>{message.content}</p>

                {message.imageUrl && (
                  <section className={styles.generatedImageCard}>
                    <button
                      type="button"
                      className={styles.generatedImagePreview}
                      aria-label="Open generated image in editor"
                      onClick={() => {
                        if (!message.assetId) {
                          setStatus(
                            "This image has no linked Asset Library ID yet.",
                          );
                          return;
                        }

                        const params = new URLSearchParams({
                          assetId: message.assetId,
                          source: "copilot",
                        });

                        if (conversationId) {
                          params.set("conversationId", conversationId);
                        }

                        window.location.assign(
                          `/image-editor?${params.toString()}`,
                        );
                      }}
                    >
                      <img
                        src={message.imageUrl}
                        alt="Generated visual"
                        className={styles.generatedImage}
                      />

                      <span className={styles.generatedImageHint}>
                        Open editor
                      </span>
                    </button>

                    <div className={styles.generatedImageToolbar}>
                      <button
                        type="button"
                        onClick={() => {
                          if (!message.assetId) {
                            setStatus(
                              "This image has no linked Asset Library ID yet.",
                            );
                            return;
                          }

                          const params = new URLSearchParams({
                            assetId: message.assetId,
                            source: "copilot",
                          });

                          if (conversationId) {
                            params.set("conversationId", conversationId);
                          }

                          window.location.assign(
                            `/image-editor?${params.toString()}`,
                          );
                        }}
                      >
                        <svg viewBox="0 0 24 24" aria-hidden="true">
                          <path d="M12 20h9" />
                          <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L8 18l-4 1 1-4Z" />
                        </svg>
                        <span>Edit</span>
                      </button>

                      <button
                        type="button"
                        onClick={() =>
                          void generateImageFromMessage(message.content, index)
                        }
                      >
                        <svg viewBox="0 0 24 24" aria-hidden="true">
                          <path d="M20 6v5h-5" />
                          <path d="M4 18v-5h5" />
                          <path d="M18.5 9A7 7 0 0 0 6 6.5L4 9" />
                          <path d="M5.5 15A7 7 0 0 0 18 17.5l2-2.5" />
                        </svg>
                        <span>Regenerate</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => {
                          const params = new URLSearchParams();

                          if (message.assetId) {
                            params.set("assetId", message.assetId);
                          }

                          params.set("source", "copilot");

                          if (conversationId) {
                            params.set("conversationId", conversationId);
                          }

                          window.location.assign(
                            `/assets?${params.toString()}`,
                          );
                        }}
                      >
                        <svg viewBox="0 0 24 24" aria-hidden="true">
                          <rect x="3" y="3" width="7" height="7" rx="1" />
                          <rect x="14" y="3" width="7" height="7" rx="1" />
                          <rect x="3" y="14" width="7" height="7" rx="1" />
                          <rect x="14" y="14" width="7" height="7" rx="1" />
                        </svg>
                        <span>Assets</span>
                      </button>
                    </div>
                  </section>
                )}
              </article>
            ))}

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
                        <span className={styles.scheduleDay}>
                          Day {item.day}
                        </span>

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
            <div ref={endRef} />
          </div>

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
