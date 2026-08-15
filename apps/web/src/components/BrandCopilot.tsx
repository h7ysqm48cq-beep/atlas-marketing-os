"use client";

import { ChangeEvent, FormEvent, useEffect, useRef, useState } from "react";
import styles from "./BrandCopilot.module.css";
import { CopilotStudioResultCard } from "./CopilotStudioResultCard";
import { API_URL } from "@/lib/api";

type Campaign = {
  id: string;
  name: string;
};

type CopilotStudioResult = {
  facebook: string;
  telegram: string;
  reels: string;
  imagePrompt: string;
};

function getMessageContentSections(content: string) {
  const labelPattern =
    /^(facebook(?:\s+caption)?|fb(?:\s+caption)?|telegram(?:\s+caption)?|instagram(?:\s+caption)?|ig(?:\s+caption)?|caption|文案|正文|标题|headline|hook|cta|call to action|hashtag|hashtags|image prompt|图片 prompt|图片指令|视觉指令|visual prompt|reels?|小红书|xiaohongshu)\s*[:：]?$/i;

  const lines = content.split("\n");
  const sections: Array<{
    label: string;
    content: string;
  }> = [];

  let currentLabel = "";
  let currentLines: string[] = [];

  const flush = () => {
    const sectionContent = currentLines.join("\n").trim();

    if (currentLabel && sectionContent) {
      sections.push({
        label: currentLabel,
        content: sectionContent,
      });
    }

    currentLines = [];
  };

  for (const line of lines) {
    const trimmed = line.trim();

    if (labelPattern.test(trimmed)) {
      flush();
      currentLabel = trimmed.replace(/[:：]$/, "");
      continue;
    }

    if (currentLabel) {
      currentLines.push(line);
    }
  }

  flush();

  return sections;
}

function renderInlineText(text: string) {
  const parts = text.split(/(\*\*[^*]+\*\*|__[^_]+__)/g);

  return parts.map((part, index) => {
    const isAsteriskBold = part.startsWith("**") && part.endsWith("**");

    const isUnderscoreBold = part.startsWith("__") && part.endsWith("__");

    if (isAsteriskBold || isUnderscoreBold) {
      return <strong key={index}>{part.slice(2, -2)}</strong>;
    }

    return part;
  });
}

type Message = {
  role: "user" | "assistant";
  content: string;
  imageUrl?: string;
  assetId?: string;
  studioResult?: CopilotStudioResult;
  error?: boolean;
  retryText?: string;
  retryAttachments?: CopilotAttachment[];
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
  hasMarketingPlan?: boolean;
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

type WorkspaceDraftTarget = "facebook" | "telegram" | "reels" | "imagePrompt";

type WorkspaceSettingTarget = "topic" | "style" | "language";

type SchedulePlatform = "FACEBOOK" | "TELEGRAM";

type WorkspaceAtomicAction =
  | {
      type: "replace";
      target: WorkspaceDraftTarget;
      content: string;
    }
  | {
      type: "set";
      target: WorkspaceSettingTarget;
      value: string;
    }
  | {
      type: "generate";
      target: "content" | "image";
    }
  | {
      type: "schedule";
      platforms: SchedulePlatform[];
      date: string;
      time: string;
      timezone?: string;
    }
  | {
      type: "restore";
      historyId: string;
    };

type WorkspaceAction =
  | WorkspaceAtomicAction
  | {
      type: "batch";
      actions: WorkspaceAtomicAction[];
    };

function isAtomicWorkspaceAction(
  input: unknown,
): input is WorkspaceAtomicAction {
  if (!input || typeof input !== "object") {
    return false;
  }

  const value = input as Record<string, unknown>;

  if (value.type === "replace") {
    return (
      ["facebook", "telegram", "reels", "imagePrompt"].includes(
        String(value.target),
      ) &&
      typeof value.content === "string" &&
      Boolean(value.content.trim())
    );
  }

  if (value.type === "set") {
    return (
      ["topic", "style", "language"].includes(String(value.target)) &&
      typeof value.value === "string" &&
      Boolean(value.value.trim())
    );
  }

  if (value.type === "generate") {
    return ["content", "image"].includes(String(value.target));
  }

  if (value.type === "schedule") {
    if (!Array.isArray(value.platforms) || !value.platforms.length) {
      return false;
    }

    const validPlatforms = value.platforms.every(
      (platform) => platform === "FACEBOOK" || platform === "TELEGRAM",
    );

    return (
      validPlatforms &&
      typeof value.date === "string" &&
      /^\d{4}-\d{2}-\d{2}$/.test(value.date) &&
      typeof value.time === "string" &&
      /^\d{2}:\d{2}$/.test(value.time)
    );
  }

  if (value.type === "restore") {
    return (
      typeof value.historyId === "string" && Boolean(value.historyId.trim())
    );
  }

  return false;
}

function studioResultFromWorkspaceAction(
  action: WorkspaceAction,
  base: CopilotStudioResult,
): CopilotStudioResult | null {
  const actions = action.type === "batch" ? action.actions : [action];

  let changed = false;

  const result: CopilotStudioResult = {
    ...base,
  };

  for (const item of actions) {
    if (item.type !== "replace") {
      continue;
    }

    result[item.target] = item.content;

    changed = true;
  }

  return changed ? result : null;
}

function parseWorkspaceAction(rawReply: string): {
  visibleReply: string;
  action: WorkspaceAction | null;
} {
  const pattern =
    /<ATLAS_WORKSPACE_ACTION>\s*([\s\S]*?)\s*<\/ATLAS_WORKSPACE_ACTION>/i;

  const match = rawReply.match(pattern);

  if (!match) {
    return {
      visibleReply: rawReply.trim(),

      action: null,
    };
  }

  const visibleReply = rawReply.replace(pattern, "").trim();

  try {
    const parsed = JSON.parse(match[1].trim()) as unknown;

    if (isAtomicWorkspaceAction(parsed)) {
      return {
        visibleReply,
        action: parsed,
      };
    }

    if (parsed && typeof parsed === "object") {
      const value = parsed as {
        type?: unknown;
        actions?: unknown;
      };

      if (value.type === "batch" && Array.isArray(value.actions)) {
        const actions = value.actions.filter(isAtomicWorkspaceAction);

        if (actions.length === value.actions.length && actions.length > 0) {
          return {
            visibleReply,
            action: {
              type: "batch",
              actions,
            },
          };
        }
      }
    }

    return {
      visibleReply,
      action: null,
    };
  } catch {
    return {
      visibleReply,
      action: null,
    };
  }
}

const INITIAL_MESSAGES: Message[] = [];

export function BrandCopilot() {
  const messagesContainerRef = useRef<HTMLDivElement | null>(null);
  const shouldFollowMessagesRef = useRef(true);
  const [showScrollToBottom, setShowScrollToBottom] = useState(false);

  const [studioDraft, setStudioDraft] = useState({
    facebook: "",
    telegram: "",
    reels: "",
    imagePrompt: "",
  });

  const [studioTopic, setStudioTopic] = useState("");

  const [studioStyle, setStudioStyle] = useState("");

  const [studioLanguage, setStudioLanguage] = useState("zh");

  const [editingStudioResultIndex, setEditingStudioResultIndex] = useState<
    number | null
  >(null);

  const [generatingImageIndex, setGeneratingImageIndex] = useState<
    number | null
  >(null);

  const [conversationId, setConversationId] = useState<string | null>(null);

  const [campaignId, setCampaignId] = useState<string | null>(null);

  const [historyId, setHistoryId] = useState<string | null>(null);

  const [ideaId, setIdeaId] = useState<string | null>(null);

  function scrollToLatestMessage() {
    const container = messagesContainerRef.current;

    if (!container) {
      return;
    }

    shouldFollowMessagesRef.current = true;
    setShowScrollToBottom(false);

    container.scrollTo({
      top: container.scrollHeight,
      behavior: "smooth",
    });
  }

  function handleMessagesScroll() {
    const container = messagesContainerRef.current;

    if (!container) {
      return;
    }

    const distanceFromBottom =
      container.scrollHeight - container.scrollTop - container.clientHeight;

    const nearBottom = distanceFromBottom < 120;

    shouldFollowMessagesRef.current = nearBottom;
    setShowScrollToBottom(!nearBottom);
  }

  async function getActiveBrandId() {
    const response = await fetch(`${API_URL}/brands`, {
      cache: "no-store",
    });

    if (!response.ok) {
      throw new Error("Unable to load active brand.");
    }

    const brands = (await response.json()) as Array<{
      id: string;
      status?: string;
    }>;

    const brand = brands.find((item) => item.status === "ACTIVE") ?? brands[0];

    if (!brand?.id) {
      throw new Error("No active brand found.");
    }

    return brand.id;
  }

  function postingDayFromDate(
    date: string,
  ): "SUN" | "MON" | "TUE" | "WED" | "THU" | "FRI" | "SAT" {
    const days = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"] as const;

    const value = new Date(`${date}T00:00:00Z`);

    return days[value.getUTCDay()];
  }

  async function resolveScheduleChannelId(
    brandId: string,
    platform: SchedulePlatform,
  ): Promise<string> {
    const response = await fetch(`${API_URL}/automation/channels`, {
      cache: "no-store",
    });

    if (!response.ok) {
      throw new Error(`Unable to load ${platform} channels.`);
    }

    const raw = await response.json();

    const channels = (
      Array.isArray(raw)
        ? raw
        : Array.isArray(raw?.channels)
          ? raw.channels
          : Array.isArray(raw?.items)
            ? raw.items
            : []
    ).filter(
      (channel: {
        id?: string;
        brandId?: string;
        platform?: string;
        name?: string;
        status?: string;
      }) =>
        channel?.id &&
        channel.brandId === brandId &&
        channel.platform === platform &&
        channel.status === "CONNECTED",
    );

    if (!channels.length) {
      throw new Error(`No connected ${platform} channel found.`);
    }

    if (channels.length === 1) {
      return channels[0].id;
    }

    const options = channels
      .map(
        (
          channel: {
            name?: string;
          },
          index: number,
        ) => `${index + 1}. ${channel.name || `${platform} Channel`}`,
      )
      .join("\n");

    const selection = window.prompt(
      `请选择要发布到哪个 ${
        platform === "FACEBOOK" ? "Facebook Page" : "Telegram Channel"
      }：\n\n${options}\n\n请输入编号：`,
    );

    if (selection === null) {
      throw new Error("Scheduling cancelled.");
    }

    const selectedIndex = Number(selection.trim()) - 1;

    if (
      !Number.isInteger(selectedIndex) ||
      selectedIndex < 0 ||
      selectedIndex >= channels.length
    ) {
      throw new Error("Invalid channel selection.");
    }

    return channels[selectedIndex].id;
  }

  async function scheduleWorkspaceAction(
    action: Extract<WorkspaceAtomicAction, { type: "schedule" }>,
    draftOverride?: CopilotStudioResult,
  ) {
    let draftForSchedule: CopilotStudioResult = {
      ...(draftOverride ?? studioDraft),
    };

    /*
     * SCHEDULE_PERSISTED_DRAFT_FALLBACK
     *
     * Scheduling must not depend entirely on volatile React state.
     * If the requested platform draft is missing locally, recover the
     * latest persisted studioResult directly from this conversation.
     */
    const facebookMissing =
      action.platforms.includes("FACEBOOK") &&
      !draftForSchedule.facebook?.trim();

    const telegramMissing =
      action.platforms.includes("TELEGRAM") &&
      !draftForSchedule.telegram?.trim();

    if ((facebookMissing || telegramMissing) && conversationId) {
      const conversationResponse = await fetch(
        `${API_URL}/copilot/conversations/${conversationId}`,
        {
          cache: "no-store",
        },
      );

      if (conversationResponse.ok) {
        const conversationData = (await conversationResponse.json()) as {
          messages?: Array<{
            role?: string;
            metadata?: unknown;
          }>;
        };

        const persistedDraft = [...(conversationData.messages ?? [])]
          .reverse()
          .map((message) => {
            if (
              message.role !== "ASSISTANT" ||
              !message.metadata ||
              typeof message.metadata !== "object"
            ) {
              return null;
            }

            const metadata = message.metadata as Record<string, unknown>;

            if (
              !metadata.studioResult ||
              typeof metadata.studioResult !== "object"
            ) {
              return null;
            }

            const candidate = metadata.studioResult as Record<string, unknown>;

            return {
              facebook:
                typeof candidate.facebook === "string"
                  ? candidate.facebook
                  : "",
              telegram:
                typeof candidate.telegram === "string"
                  ? candidate.telegram
                  : "",
              reels: typeof candidate.reels === "string" ? candidate.reels : "",
              imagePrompt:
                typeof candidate.imagePrompt === "string"
                  ? candidate.imagePrompt
                  : "",
            } satisfies CopilotStudioResult;
          })
          .find(
            (candidate) =>
              candidate &&
              (candidate.facebook.trim() ||
                candidate.telegram.trim() ||
                candidate.reels.trim() ||
                candidate.imagePrompt.trim()),
          );

        if (persistedDraft) {
          draftForSchedule = {
            facebook:
              draftForSchedule.facebook?.trim() || persistedDraft.facebook,
            telegram:
              draftForSchedule.telegram?.trim() || persistedDraft.telegram,
            reels: draftForSchedule.reels?.trim() || persistedDraft.reels,
            imagePrompt:
              draftForSchedule.imagePrompt?.trim() ||
              persistedDraft.imagePrompt,
          };

          setStudioDraft(draftForSchedule);
        }
      }
    }

    const brandId = await getActiveBrandId();

    const contents: Partial<Record<SchedulePlatform, string>> = {};

    const channelIds: Partial<Record<SchedulePlatform, string>> = {};

    for (const platform of action.platforms) {
      channelIds[platform] = await resolveScheduleChannelId(brandId, platform);
    }

    if (action.platforms.includes("FACEBOOK")) {
      if (!draftForSchedule.facebook?.trim()) {
        throw new Error(
          "Facebook draft is unavailable even after conversation recovery.",
        );
      }

      contents.FACEBOOK = draftForSchedule.facebook;
    }

    if (action.platforms.includes("TELEGRAM")) {
      if (!draftForSchedule.telegram?.trim()) {
        throw new Error(
          "Telegram draft is unavailable even after conversation recovery.",
        );
      }

      contents.TELEGRAM = draftForSchedule.telegram;
    }

    const response = await fetch(`${API_URL}/workflow/auto-queue`, {
      method: "POST",

      headers: {
        "Content-Type": "application/json",
      },

      body: JSON.stringify({
        brandId,

        platforms: action.platforms,

        channelIds,

        items: [
          {
            title: studioTopic.trim() || "AI Workspace Content",

            campaignId: campaignId || undefined,

            historyId: historyId || undefined,

            contents,
          },
        ],

        startDate: action.date,

        postingDays: [postingDayFromDate(action.date)],

        postingTime: action.time,

        timezone: action.timezone || "Asia/Kuala_Lumpur",

        queueImmediately: false,
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data?.message || "Unable to schedule content.");
    }

    return data;
  }

  async function applyWorkspaceAction(
    action: WorkspaceAction,
    baseDraft?: CopilotStudioResult,
  ) {
    const actions = action.type === "batch" ? action.actions : [action];

    let draftSnapshot: CopilotStudioResult = {
      ...(baseDraft ?? studioDraft),
    };

    for (const item of actions) {
      if (item.type === "replace") {
        draftSnapshot = {
          ...draftSnapshot,
          [item.target]: item.content,
        };

        setStudioDraft((current) => ({
          ...current,
          [item.target]: item.content,
        }));

        setStatus(`Updated ${item.target}.`);
        continue;
      }

      if (item.type === "set") {
        if (item.target === "topic") {
          setStudioTopic(item.value);
        }

        if (item.target === "style") {
          setStudioStyle(item.value);
        }

        if (item.target === "language") {
          setStudioLanguage(item.value);
        }

        setStatus(`Updated ${item.target}.`);
        continue;
      }

      if (item.type === "generate") {
        setStatus(
          item.target === "image"
            ? "Generating image..."
            : "Generating content...",
        );

        continue;
      }

      if (item.type === "restore") {
        setHistoryId(item.historyId);
        setStatus("Restoring previous work...");
        continue;
      }

      if (item.type === "schedule") {
        try {
          const scheduleResult = await scheduleWorkspaceAction(
            item,
            draftSnapshot,
          );

          const scheduledItems = Array.isArray(scheduleResult?.scheduledItems)
            ? scheduleResult.scheduledItems
            : [];

          type ScheduledPostResult = {
            id?: string;
            platform?: string;
            scheduledAt?: string;
            channel?: {
              name?: string;
            };
          };

          const posts: ScheduledPostResult[] = scheduledItems.flatMap(
            (entry: { posts?: ScheduledPostResult[] }) =>
              Array.isArray(entry.posts) ? entry.posts : [],
          );

          const postCount =
            typeof scheduleResult?.postCount === "number"
              ? scheduleResult.postCount
              : posts.length;

          const details = posts.length
            ? posts
                .map((post) => {
                  const platform = post.platform || "UNKNOWN";
                  const when = post.scheduledAt || `${item.date} ${item.time}`;
                  const channel = post.channel?.name
                    ? ` · ${post.channel.name}`
                    : "";

                  return `${platform} · ${when}${channel}`;
                })
                .join("\n")
            : `${item.platforms.join(" + ")} · ${item.date} · ${item.time} · ${
                item.timezone || "Asia/Kuala_Lumpur"
              }`;

          setStatus(
            postCount === 1
              ? `Scheduled successfully: ${details}`
              : `${postCount} ScheduledPosts created: ${details}`,
          );
        } catch (error) {
          const message =
            error instanceof Error
              ? error.message
              : "Unable to schedule content.";

          setStatus(message);
          throw error;
        }

        continue;
      }
    }
  }

  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [mode, setMode] = useState<CopilotMode>("chat");
  const [messages, setMessages] = useState<Message[]>(INITIAL_MESSAGES);
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [loadingConversations, setLoadingConversations] = useState(true);
  const [input, setInput] = useState("");
  const [attachments, setAttachments] = useState<CopilotAttachment[]>([]);
  const [uploadingAttachment, setUploadingAttachment] = useState(false);
  const attachmentInputRef = useRef<HTMLInputElement | null>(null);
  const composerTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!shouldFollowMessagesRef.current) {
      return;
    }

    const container = messagesContainerRef.current;

    if (!container) {
      return;
    }

    window.requestAnimationFrame(() => {
      container.scrollTo({
        top: container.scrollHeight,
        behavior: "smooth",
      });
    });
  }, [messages, busy, generatingImageIndex]);

  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [marketingPlan, setMarketingPlan] = useState<MarketingPlan | null>(
    null,
  );
  const [marketingPlanExpanded, setMarketingPlanExpanded] = useState(false);

  const marketingPlanRef = useRef<HTMLElement | null>(null);
  const [status, setStatus] = useState("Brand Brain is active.");
  const [copiedMessageIndex, setCopiedMessageIndex] = useState<number | null>(
    null,
  );

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
    const savedConversationId = localStorage.getItem(
      "atlas-copilot-last-conversation",
    );

    if (!savedConversationId) {
      return;
    }

    void openConversation(savedConversationId);
  }, []);

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

    localStorage.removeItem("atlas-copilot-last-conversation");
    setMessages(INITIAL_MESSAGES);

    setStudioDraft({
      facebook: "",
      telegram: "",
      reels: "",
      imagePrompt: "",
    });

    setStudioTopic("");
    setStudioStyle("");
    setHistoryId(null);
    setIdeaId(null);

    setMarketingPlan(null);
    setMarketingPlanExpanded(false);
    setInput("");

    if (composerTextareaRef.current) {
      composerTextareaRef.current.style.height = "auto";
    }
    setAttachments([]);
    setCampaignId("");
    setMode("chat");
    setStatus("New conversation.");
    setMobileSidebarOpen(false);
  }

  async function openConversation(id: string) {
    if (busy) {
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

      let restoredDraftSnapshot: CopilotStudioResult = {
        facebook: "",
        telegram: "",
        reels: "",
        imagePrompt: "",
      };

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

        const sourceMessageIndex =
          metadata &&
          "sourceMessageIndex" in metadata &&
          typeof metadata.sourceMessageIndex === "number"
            ? metadata.sourceMessageIndex
            : undefined;

        const studioResultCandidate =
          metadata &&
          "studioResult" in metadata &&
          metadata.studioResult &&
          typeof metadata.studioResult === "object"
            ? (metadata.studioResult as Record<string, unknown>)
            : null;

        const restoredStudioResult: CopilotStudioResult | undefined =
          studioResultCandidate
            ? {
                facebook:
                  typeof studioResultCandidate.facebook === "string"
                    ? studioResultCandidate.facebook
                    : "",
                telegram:
                  typeof studioResultCandidate.telegram === "string"
                    ? studioResultCandidate.telegram
                    : "",
                reels:
                  typeof studioResultCandidate.reels === "string"
                    ? studioResultCandidate.reels
                    : "",
                imagePrompt:
                  typeof studioResultCandidate.imagePrompt === "string"
                    ? studioResultCandidate.imagePrompt
                    : "",
              }
            : undefined;

        /*
         * LEGACY_STUDIO_RESULT_RECOVERY
         *
         * Older Copilot messages may predate metadata.studioResult,
         * while still containing the original ATLAS_WORKSPACE_ACTION
         * replace/batch payload in message.content.
         *
         * Replay that action against the draft snapshot so old
         * conversations remain schedulable without asking the user
         * to paste the copy again.
         */
        const parsedStoredReply =
          message.role === "ASSISTANT"
            ? parseWorkspaceAction(message.content)
            : {
                visibleReply: message.content,
                action: null,
              };

        const legacyStudioResult =
          message.role === "ASSISTANT" && parsedStoredReply.action
            ? studioResultFromWorkspaceAction(
                parsedStoredReply.action,
                restoredDraftSnapshot,
              )
            : null;

        const effectiveRestoredStudioResult =
          restoredStudioResult || legacyStudioResult || undefined;

        if (effectiveRestoredStudioResult) {
          restoredDraftSnapshot = {
            ...effectiveRestoredStudioResult,
          };
        }

        const isGeneratedImage =
          message.role === "ASSISTANT" &&
          metadata &&
          "type" in metadata &&
          metadata.type === "generated-image" &&
          Boolean(imageUrl);

        if (isGeneratedImage) {
          let targetIndex = -1;

          if (
            typeof sourceMessageIndex === "number" &&
            sourceMessageIndex >= 0 &&
            sourceMessageIndex < loadedMessages.length &&
            loadedMessages[sourceMessageIndex]?.role === "assistant"
          ) {
            targetIndex = sourceMessageIndex;
          }

          if (targetIndex < 0) {
            for (
              let index = loadedMessages.length - 1;
              index >= 0;
              index -= 1
            ) {
              if (loadedMessages[index]?.role === "assistant") {
                targetIndex = index;
                break;
              }
            }
          }

          if (targetIndex >= 0) {
            loadedMessages[targetIndex] = {
              ...loadedMessages[targetIndex],
              imageUrl,
              assetId,
            };
          } else {
            loadedMessages.push({
              role: "assistant",
              content: "Generated image",
              imageUrl,
              assetId,
            });
          }

          continue;
        }

        const restoredContent =
          message.role === "ASSISTANT"
            ? parsedStoredReply.visibleReply || message.content
            : message.content;

        loadedMessages.push({
          role: message.role === "USER" ? "user" : "assistant",
          content: restoredContent,
          imageUrl,
          assetId,
          studioResult:
            message.role === "ASSISTANT"
              ? effectiveRestoredStudioResult
              : undefined,
        });
      }

      setConversationId(data.id);

      localStorage.setItem("atlas-copilot-last-conversation", data.id);
      setMessages(
        loadedMessages.length > 0 ? loadedMessages : INITIAL_MESSAGES,
      );

      // RESTORE_LATEST_STUDIO_RESULT_TO_DRAFT
      const latestRestoredStudioResult = [...loadedMessages]
        .reverse()
        .find(
          (message) =>
            message.role === "assistant" &&
            message.studioResult &&
            (message.studioResult.facebook?.trim() ||
              message.studioResult.telegram?.trim() ||
              message.studioResult.reels?.trim() ||
              message.studioResult.imagePrompt?.trim()),
        )?.studioResult;

      if (latestRestoredStudioResult) {
        setStudioDraft({
          facebook: latestRestoredStudioResult.facebook || "",
          telegram: latestRestoredStudioResult.telegram || "",
          reels: latestRestoredStudioResult.reels || "",
          imagePrompt: latestRestoredStudioResult.imagePrompt || "",
        });
      } else {
        setStudioDraft({
          facebook: "",
          telegram: "",
          reels: "",
          imagePrompt: "",
        });
      }
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

      let restoredMarketingPlan: MarketingPlan | null = null;

      if (
        restoredPlanMessage &&
        restoredPlanMessage.metadata &&
        typeof restoredPlanMessage.metadata === "object"
      ) {
        const metadata = restoredPlanMessage.metadata;

        const candidate =
          ("marketingPlan" in metadata && metadata.marketingPlan) ||
          ("plan" in metadata && metadata.plan);

        if (
          candidate &&
          typeof candidate === "object" &&
          "campaignName" in candidate &&
          "contentIdeas" in candidate
        ) {
          restoredMarketingPlan = candidate as MarketingPlan;
        }
      }

      // Backward compatibility:
      // older Marketing Plan messages may only contain JSON in content.
      if (!restoredMarketingPlan) {
        const legacyPlanMessage = data.messages
          .slice()
          .reverse()
          .find(
            (message) =>
              message.role === "ASSISTANT" &&
              typeof message.content === "string" &&
              message.content.includes('"campaignName"'),
          );

        if (legacyPlanMessage) {
          try {
            const candidate = JSON.parse(legacyPlanMessage.content) as unknown;

            if (
              candidate &&
              typeof candidate === "object" &&
              "campaignName" in candidate &&
              "contentIdeas" in candidate
            ) {
              restoredMarketingPlan = candidate as MarketingPlan;
            }
          } catch {
            // Ignore malformed legacy Marketing Plan content.
          }
        }
      }

      setMarketingPlan(restoredMarketingPlan);

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

  useEffect(() => {
    setEditingStudioResultIndex(null);
  }, [conversationId]);

  const pendingPlanScrollRef = useRef(false);

  useEffect(() => {
    if (
      pendingPlanScrollRef.current &&
      marketingPlan &&
      marketingPlanRef.current
    ) {
      pendingPlanScrollRef.current = false;

      setTimeout(() => {
        marketingPlanRef.current?.scrollIntoView({
          behavior: "smooth",
          block: "start",
        });
      }, 100);
    }
  }, [marketingPlan]);

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

  async function send(
    event?: FormEvent,
    retry?: {
      text: string;
      attachments: CopilotAttachment[];
      replaceError?: boolean;
    },
  ) {
    event?.preventDefault();

    shouldFollowMessagesRef.current = true;

    const rawText = retry ? retry.text.trim() : input.trim();

    const currentAttachments = retry
      ? [...retry.attachments]
      : [...attachments];

    if (
      (!rawText && currentAttachments.length === 0) ||
      busy ||
      uploadingAttachment
    ) {
      return;
    }

    const text =
      rawText ||
      (currentAttachments.some((attachment) => attachment.kind === "image")
        ? "请分析我上传的图片。"
        : "请参考我上传的文件回答。");

    const baseMessages =
      retry?.replaceError && messages.at(-1)?.error
        ? messages.slice(0, -1)
        : messages;

    const next: Message[] = retry?.replaceError
      ? baseMessages
      : [
          ...baseMessages,
          {
            role: "user",
            content: text,
          },
        ];

    setMessages(next);

    if (!retry) {
      setInput("");
      setAttachments([]);
    }
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
            content:
              "Marketing Plan 已生成。完整方案已经整理好，你可以继续告诉我需要修改的方向。",
          },
        ]);

        if (data.conversation?.id || data.conversationId) {
          setConversationId(data.conversation?.id || data.conversationId);
        }

        // Keep Marketing Plan mode active.
        // User can continue refining the generated plan naturally.

        await refreshConversations();

        setStatus("Marketing Plan generated. Continue refining with Elena.");
      } else {
        const latestMessageStudioResult = [...messages]
          .reverse()
          .find(
            (message) => message.role === "assistant" && message.studioResult,
          )?.studioResult;

        const effectiveStudioDraft: CopilotStudioResult = {
          facebook:
            studioDraft.facebook.trim() ||
            latestMessageStudioResult?.facebook?.trim() ||
            "",
          telegram:
            studioDraft.telegram.trim() ||
            latestMessageStudioResult?.telegram?.trim() ||
            "",
          reels:
            studioDraft.reels.trim() ||
            latestMessageStudioResult?.reels?.trim() ||
            "",
          imagePrompt:
            studioDraft.imagePrompt.trim() ||
            latestMessageStudioResult?.imagePrompt?.trim() ||
            "",
        };

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

            workspaceContext: {
              activeView: "copilot",

              historyId: historyId || undefined,
              campaignId: campaignId || undefined,
              ideaId: ideaId || undefined,

              topic: studioTopic || undefined,
              style: studioStyle || undefined,
              language: studioLanguage || undefined,

              assetIds: undefined,

              draft: {
                facebook: effectiveStudioDraft.facebook || undefined,
                telegram: effectiveStudioDraft.telegram || undefined,
                reels: effectiveStudioDraft.reels || undefined,
                imagePrompt: effectiveStudioDraft.imagePrompt || undefined,
              },
            },
          }),
        });

        const data = await response.json();

        if (!response.ok || !data.reply) {
          throw new Error(data.message || "Unable to get response.");
        }

        if (data.marketingPlan) {
          setMarketingPlan(data.marketingPlan);
        }

        if (data.conversation?.id) {
          setConversationId(data.conversation.id);
        }

        const parsedReply = parseWorkspaceAction(data.reply);

        /*
         * BACKEND_RECOVERED_EXECUTION_DRAFT
         *
         * If browser Studio state is empty, CopilotService may recover
         * persisted draft content from the conversation database.
         * Use that recovered draft for local workspace actions too.
         */
        const recoveredWorkspaceDraft =
          data.workspaceDraft && typeof data.workspaceDraft === "object"
            ? (data.workspaceDraft as Partial<CopilotStudioResult>)
            : null;

        const executionDraft: CopilotStudioResult = {
          facebook:
            typeof recoveredWorkspaceDraft?.facebook === "string" &&
            recoveredWorkspaceDraft.facebook.trim()
              ? recoveredWorkspaceDraft.facebook
              : effectiveStudioDraft.facebook,

          telegram:
            typeof recoveredWorkspaceDraft?.telegram === "string" &&
            recoveredWorkspaceDraft.telegram.trim()
              ? recoveredWorkspaceDraft.telegram
              : effectiveStudioDraft.telegram,

          reels:
            typeof recoveredWorkspaceDraft?.reels === "string" &&
            recoveredWorkspaceDraft.reels.trim()
              ? recoveredWorkspaceDraft.reels
              : effectiveStudioDraft.reels,

          imagePrompt:
            typeof recoveredWorkspaceDraft?.imagePrompt === "string" &&
            recoveredWorkspaceDraft.imagePrompt.trim()
              ? recoveredWorkspaceDraft.imagePrompt
              : effectiveStudioDraft.imagePrompt,
        };

        if (
          executionDraft.facebook.trim() ||
          executionDraft.telegram.trim() ||
          executionDraft.reels.trim() ||
          executionDraft.imagePrompt.trim()
        ) {
          setStudioDraft(executionDraft);
        }

        const assistantStudioResult = parsedReply.action
          ? studioResultFromWorkspaceAction(parsedReply.action, executionDraft)
          : null;

        if (parsedReply.action) {
          await applyWorkspaceAction(parsedReply.action, executionDraft);

          setStatus("Elena updated AI Workspace.");
        }

        setMessages((current) => [
          ...current,
          {
            role: "assistant",
            content: parsedReply.visibleReply || data.reply,
            studioResult: assistantStudioResult || undefined,
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
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";

      setMessages((current) => [
        ...current,
        {
          role: "assistant",
          content: `Elena couldn’t complete this request. ${errorMessage}`,
          error: true,
          retryText: text,
          retryAttachments: currentAttachments,
        },
      ]);

      setStatus("Request failed.");
    } finally {
      setBusy(false);
    }
  }

  const copyContentSection = async (content: string) => {
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

      setStatus("Section copied to clipboard.");
    } catch (error) {
      setStatus(
        error instanceof Error
          ? `Unable to copy: ${error.message}`
          : "Unable to copy section.",
      );
    }
  };

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
    setGeneratingImageIndex(index);

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

      setGeneratingImageIndex(null);

      window.setTimeout(() => {
        const imageCard = document.querySelector(
          `[data-copilot-image-index="${index}"]`,
        );

        imageCard?.scrollIntoView({
          behavior: "smooth",
          block: "nearest",
        });
      }, 80);

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
            sourceMessageIndex: index,
            prompt: content,
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
      setGeneratingImageIndex(null);

      setStatus(
        error instanceof Error ? error.message : "Image generation failed.",
      );
    }
  };

  function requestStudioRegeneration(
    source: CopilotStudioResult = studioDraft,
  ) {
    const sections = [
      source.facebook.trim() ? `Facebook:\n${source.facebook.trim()}` : "",
      source.telegram.trim() ? `Telegram:\n${source.telegram.trim()}` : "",
      source.reels.trim() ? `Reels:\n${source.reels.trim()}` : "",
      source.imagePrompt.trim()
        ? `Image Prompt:\n${source.imagePrompt.trim()}`
        : "",
    ]
      .filter(Boolean)
      .join("\n\n");

    setMode("chat");

    setInput(
      [
        "请重新生成并优化当前内容。",
        studioTopic.trim() ? `主题：${studioTopic.trim()}` : "",
        studioStyle.trim() ? `风格：${studioStyle.trim()}` : "",
        studioLanguage.trim() ? `语言：${studioLanguage.trim()}` : "",
        "",
        sections,
        "",
        "请直接更新 Facebook、Telegram、Reels 和 Image Prompt。",
      ]
        .filter(Boolean)
        .join("\n"),
    );

    setStatus("Regeneration request ready. Press Send when ready.");
  }

  async function scheduleCurrentStudioResult(
    source: CopilotStudioResult = studioDraft,
  ) {
    const platforms: SchedulePlatform[] = [];

    if (source.facebook.trim()) {
      platforms.push("FACEBOOK");
    }

    if (source.telegram.trim()) {
      platforms.push("TELEGRAM");
    }

    if (!platforms.length) {
      setStatus("Facebook or Telegram content is required before scheduling.");
      return;
    }

    const defaultDate = new Date().toISOString().slice(0, 10);

    const date = window.prompt("Schedule date (YYYY-MM-DD)", defaultDate);

    if (!date) {
      return;
    }

    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      setStatus("Invalid date. Use YYYY-MM-DD.");
      return;
    }

    const time = window.prompt("Schedule time (HH:MM, MYT)", "20:00");

    if (!time) {
      return;
    }

    if (!/^\d{2}:\d{2}$/.test(time)) {
      setStatus("Invalid time. Use HH:MM.");
      return;
    }

    setStatus("Scheduling content...");

    try {
      await scheduleWorkspaceAction(
        {
          type: "schedule",
          platforms,
          date,
          time,
          timezone: "Asia/Kuala_Lumpur",
        },
        source,
      );
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unable to schedule content.";

      setStatus(message);
      throw error;
    }
  }

  function updateMessageStudioResult(
    messageIndex: number,
    target: WorkspaceDraftTarget,
    value: string,
  ) {
    setMessages((current) =>
      current.map((message, index) => {
        if (index !== messageIndex || !message.studioResult) {
          return message;
        }

        return {
          ...message,
          studioResult: {
            ...message.studioResult,
            [target]: value,
          },
        };
      }),
    );

    setStudioDraft((current) => ({
      ...current,
      [target]: value,
    }));
  }

  async function generateImageFromMessageStudioResult(
    result: CopilotStudioResult,
    messageIndex: number,
  ) {
    const prompt =
      result.imagePrompt.trim() ||
      result.facebook.trim() ||
      result.telegram.trim() ||
      result.reels.trim();

    if (!prompt) {
      setStatus("This Studio Result has no content for image generation.");
      return;
    }

    await generateImageFromMessage(prompt, messageIndex);
  }

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

      <header className={styles.chatTopbar}>
        <button
          type="button"
          className={styles.chatTopbarMenu}
          onClick={() => setMobileSidebarOpen(true)}
          aria-label="Open conversations"
          title="Conversations"
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M4 6h16" />
            <path d="M4 12h16" />
            <path d="M4 18h16" />
          </svg>
        </button>
        <button
          type="button"
          className={styles.desktopSidebarToggle}
          onClick={() => setSidebarCollapsed((current) => !current)}
          aria-label={
            sidebarCollapsed ? "Show conversations" : "Hide conversations"
          }
          aria-pressed={sidebarCollapsed}
          title={sidebarCollapsed ? "Show conversations" : "Hide conversations"}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <rect x="3.5" y="4" width="17" height="16" rx="2" />
            <path d="M9 4v16" />
          </svg>
        </button>

        <div className={styles.chatTopbarIdentity}>
          <div className={styles.elenaAvatar}>E</div>

          <div>
            <strong>Elena</strong>
            <span>AI Marketing Strategist</span>
          </div>
        </div>

        <div className={styles.chatTopbarControls}>
          <label>
            <span>Mode</span>
            <select
              value={mode}
              onChange={(event) => setMode(event.target.value as CopilotMode)}
              aria-label="Elena working mode"
            >
              <option value="chat">Chat</option>
              <option value="marketing-plan">Marketing Plan</option>
            </select>
          </label>

          <label>
            <span>Context</span>
            <select
              value={campaignId ?? ""}
              onChange={(event) => setCampaignId(event.target.value || null)}
              aria-label="Campaign context"
            >
              <option value="">Brand Brain</option>

              {campaigns.map((campaign) => (
                <option key={campaign.id} value={campaign.id}>
                  {campaign.name}
                </option>
              ))}
            </select>
          </label>
        </div>

        {status && <small className={styles.chatTopbarStatus}>{status}</small>}
      </header>

      <section
        className={`${styles.layout}${
          sidebarCollapsed ? ` ${styles.layoutSidebarCollapsed}` : ""
        }`}
      >
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

                  {conversation.hasMarketingPlan && (
                    <button
                      className={styles.planShortcut}
                      type="button"
                      title="View Marketing Plan"
                      aria-label="View Marketing Plan"
                      onClick={async () => {
                        pendingPlanScrollRef.current = true;
                        setMarketingPlanExpanded(true);
                        await openConversation(conversation.id);
                      }}
                    >
                      <svg viewBox="0 0 24 24" aria-hidden="true">
                        <path d="M6 3h9l3 3v15H6z" />
                        <path d="M15 3v4h4" />
                        <path d="M9 12h6" />
                        <path d="M9 16h6" />
                      </svg>
                    </button>
                  )}

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
        </aside>

        <section className={styles.chat}>
          <div
            ref={messagesContainerRef}
            className={styles.messages}
            onScroll={handleMessagesScroll}
          >
            {messages.length === 0 && (
              <section className={styles.emptyChatState}>
                <div className={styles.emptyChatLogo}>E</div>

                <div className={styles.emptyChatIntro}>
                  <h2>想做什么？</h2>
                  <p>和 Elena 讨论创意、优化内容，或直接开始一个营销任务。</p>
                </div>

                <div className={styles.emptyChatActions}>
                  <button
                    type="button"
                    onClick={() =>
                      setInput("帮我优化这段文案，让它更自然、更有吸引力。")
                    }
                  >
                    <span>✎</span>
                    <div>
                      <strong>优化文案</strong>
                      <small>Rewrite & improve</small>
                    </div>
                  </button>

                  <button
                    type="button"
                    onClick={() =>
                      setInput("帮我为这个主题想几个更有讨论度的内容创意。")
                    }
                  >
                    <span>＋</span>
                    <div>
                      <strong>内容创意</strong>
                      <small>Ideas & hooks</small>
                    </div>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setMode("marketing-plan");
                      setInput("帮我为这个主题制作完整营销方案。");
                    }}
                  >
                    <span>▦</span>
                    <div>
                      <strong>营销方案</strong>
                      <small>Full campaign plan</small>
                    </div>
                  </button>

                  <button
                    type="button"
                    onClick={() =>
                      setInput(
                        "帮我构思一张适合这个主题的社交媒体视觉，并写出图片生成指令。",
                      )
                    }
                  >
                    <span>◇</span>
                    <div>
                      <strong>图片视觉</strong>
                      <small>Visual direction</small>
                    </div>
                  </button>
                </div>
              </section>
            )}

            {busy && messages.length > 0 && (
              <div
                className={styles.elenaThinking}
                role="status"
                aria-live="polite"
              >
                <div className={styles.elenaThinkingAvatar}>E</div>

                <div className={styles.elenaThinkingBody}>
                  <span>Elena is thinking</span>

                  <div className={styles.elenaThinkingDots} aria-hidden="true">
                    <i />
                    <i />
                    <i />
                  </div>
                </div>
              </div>
            )}

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

                <div className={styles.messageContent}>
                  {message.content.split("\n").map((line, lineIndex) => {
                    const trimmed = line.trim();

                    if (!trimmed) {
                      return (
                        <div
                          className={styles.messageSpacer}
                          key={`spacer-${lineIndex}`}
                          aria-hidden="true"
                        />
                      );
                    }

                    const markdownHeading = trimmed.match(/^(#{1,3})\s+(.+)$/);

                    if (markdownHeading) {
                      return (
                        <h3
                          className={styles.messageHeading}
                          key={`heading-${lineIndex}`}
                        >
                          {renderInlineText(markdownHeading[2])}
                        </h3>
                      );
                    }

                    const contentLabel = trimmed.match(
                      /^(facebook(?:\s+caption)?|fb(?:\s+caption)?|telegram(?:\s+caption)?|instagram(?:\s+caption)?|ig(?:\s+caption)?|caption|文案|正文|标题|headline|hook|cta|call to action|hashtag|hashtags|image prompt|图片 prompt|图片指令|视觉指令|visual prompt|reels?|小红书|xiaohongshu)\s*[:：]?$/i,
                    );

                    if (contentLabel) {
                      const normalizedLabel = trimmed.replace(/[:：]$/, "");

                      const section = getMessageContentSections(
                        message.content,
                      ).find(
                        (candidate) =>
                          candidate.label.toLowerCase() ===
                          normalizedLabel.toLowerCase(),
                      );

                      return (
                        <div
                          className={styles.messageContentLabel}
                          key={`label-${lineIndex}`}
                        >
                          <span>{renderInlineText(normalizedLabel)}</span>

                          {section?.content && (
                            <button
                              type="button"
                              className={styles.sectionCopyButton}
                              onClick={() =>
                                void copyContentSection(section.content)
                              }
                              aria-label={`Copy ${normalizedLabel}`}
                              title={`Copy ${normalizedLabel}`}
                            >
                              <svg viewBox="0 0 24 24" aria-hidden="true">
                                <rect
                                  x="9"
                                  y="9"
                                  width="10"
                                  height="10"
                                  rx="2"
                                />
                                <path d="M15 9V7a2 2 0 0 0-2-2H7a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h2" />
                              </svg>

                              <span>Copy</span>
                            </button>
                          )}
                        </div>
                      );
                    }

                    const sectionHeading = trimmed.match(
                      /^(\d{1,2})\s*[｜|、]\s*(.+)$/,
                    );

                    if (sectionHeading) {
                      return (
                        <h4
                          className={styles.messageSectionHeading}
                          key={`section-${lineIndex}`}
                        >
                          <span>{sectionHeading[1]}</span>
                          {renderInlineText(sectionHeading[2])}
                        </h4>
                      );
                    }

                    const numberedItem = trimmed.match(/^(\d+)[.)、]\s+(.+)$/);

                    if (numberedItem) {
                      return (
                        <div
                          className={styles.messageListItem}
                          key={`numbered-${lineIndex}`}
                        >
                          <span className={styles.messageListMarker}>
                            {numberedItem[1]}.
                          </span>
                          <span>{renderInlineText(numberedItem[2])}</span>
                        </div>
                      );
                    }

                    const bulletItem = trimmed.match(/^[-•]\s+(.+)$/);

                    if (bulletItem) {
                      return (
                        <div
                          className={styles.messageListItem}
                          key={`bullet-${lineIndex}`}
                        >
                          <span className={styles.messageListMarker}>•</span>
                          <span>{renderInlineText(bulletItem[1])}</span>
                        </div>
                      );
                    }

                    return (
                      <p key={`text-${lineIndex}`}>{renderInlineText(line)}</p>
                    );
                  })}
                </div>

                {message.error && message.retryText && (
                  <div className={styles.messageRetry}>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() =>
                        void send(undefined, {
                          text: message.retryText!,
                          attachments: message.retryAttachments ?? [],
                          replaceError: true,
                        })
                      }
                    >
                      <svg viewBox="0 0 24 24" aria-hidden="true">
                        <path d="M20 11a8 8 0 1 0-2.3 5.7" />
                        <path d="M20 4v7h-7" />
                      </svg>
                      Retry
                    </button>
                  </div>
                )}

                {/* MESSAGE_STUDIO_RESULT_CARD */}
                {message.role === "assistant" && message.studioResult && (
                  <CopilotStudioResultCard
                    draft={message.studioResult}
                    editing={editingStudioResultIndex === index}
                    onToggleEdit={() => {
                      setEditingStudioResultIndex((current) =>
                        current === index ? null : index,
                      );
                    }}
                    onChange={(target, value) =>
                      updateMessageStudioResult(index, target, value)
                    }
                    onRegenerate={() =>
                      requestStudioRegeneration(message.studioResult!)
                    }
                    onGenerateImage={() =>
                      void generateImageFromMessageStudioResult(
                        message.studioResult!,
                        index,
                      )
                    }
                    onSchedule={() =>
                      void scheduleCurrentStudioResult(message.studioResult!)
                    }
                  />
                )}

                {generatingImageIndex === index && !message.imageUrl && (
                  <section
                    className={styles.generatingImageCard}
                    aria-live="polite"
                  >
                    <div className={styles.generatingImageSpinner} />

                    <div>
                      <strong>Generating image</strong>
                      <span>Elena is creating your visual…</span>
                    </div>
                  </section>
                )}

                {message.imageUrl && (
                  <section
                    className={styles.generatedImageCard}
                    data-copilot-image-index={index}
                  >
                    <div
                      className={styles.generatedImagePreview}
                      aria-label="Generated image preview"
                    >
                      <img
                        src={message.imageUrl}
                        alt="Generated visual"
                        className={styles.generatedImage}
                      />

                      {generatingImageIndex === index && (
                        <div
                          className={styles.regeneratingImageOverlay}
                          aria-live="polite"
                        >
                          <div className={styles.generatingImageSpinner} />
                          <span>Regenerating…</span>
                        </div>
                      )}
                    </div>

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
                        disabled={generatingImageIndex === index}
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
              <section ref={marketingPlanRef} className={styles.marketingPlan}>
                <header className={styles.planHeader}>
                  <div>
                    <p className={styles.eyebrow}>Marketing Plan</p>
                    <h2>{marketingPlan.campaignName}</h2>
                    <span className={styles.planBadge}>AI generated</span>
                  </div>

                  <button
                    type="button"
                    className={styles.planToggle}
                    aria-expanded={marketingPlanExpanded}
                    onClick={() =>
                      setMarketingPlanExpanded((current) => !current)
                    }
                  >
                    {marketingPlanExpanded ? "Hide Plan" : "View Plan"}

                    <svg viewBox="0 0 24 24" aria-hidden="true">
                      <path
                        d={
                          marketingPlanExpanded
                            ? "m6 15 6-6 6 6"
                            : "m6 9 6 6 6-6"
                        }
                      />
                    </svg>
                  </button>
                </header>

                {marketingPlanExpanded && (
                  <div className={styles.planExpandedContent}>
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
                                onClick={() =>
                                  navigator.clipboard.writeText(item)
                                }
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
                  </div>
                )}
              </section>
            )}
          </div>

          {showScrollToBottom && (
            <button
              type="button"
              className={styles.scrollToBottomButton}
              onClick={scrollToLatestMessage}
              aria-label="Scroll to latest message"
              title="回到最新消息"
            >
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M12 5v14" />
                <path d="m6 13 6 6 6-6" />
              </svg>
            </button>
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
                  <div key={attachment.id} className={styles.attachmentChip}>
                    {attachment.kind === "image" ? (
                      <img
                        src={attachment.url}
                        alt=""
                        className={styles.attachmentThumbnail}
                      />
                    ) : (
                      <div className={styles.attachmentFileIcon}>
                        {attachment.name.toLowerCase().endsWith(".pdf")
                          ? "PDF"
                          : "DOC"}
                      </div>
                    )}

                    <div className={styles.attachmentChipText}>
                      <strong>{attachment.name}</strong>
                      <span>{formatFileSize(attachment.size)}</span>
                    </div>

                    <button
                      type="button"
                      className={styles.attachmentRemove}
                      aria-label={`Remove ${attachment.name}`}
                      onClick={() => removeAttachment(attachment.id)}
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
            ) : null}

            <textarea
              ref={composerTextareaRef}
              value={input}
              rows={1}
              onChange={(event) => {
                setInput(event.target.value);

                event.currentTarget.style.height = "auto";
                event.currentTarget.style.height = `${Math.min(
                  event.currentTarget.scrollHeight,
                  220,
                )}px`;
              }}
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

            <div className={styles.composerBottomBar}>
              <div className={styles.composerTools}>
                <button
                  className={styles.attachButton}
                  type="button"
                  disabled={busy || uploadingAttachment}
                  onClick={() => attachmentInputRef.current?.click()}
                  aria-label="Attach files"
                  title="Attach files"
                >
                  <svg viewBox="0 0 24 24" aria-hidden="true">
                    <path d="M12 5v14" />
                    <path d="M5 12h14" />
                  </svg>
                </button>
              </div>

              <button
                className={styles.composerSendButton}
                type="submit"
                aria-label={busy ? "Elena is thinking" : "Send message"}
                title={busy ? "Elena is thinking..." : "Send"}
                disabled={
                  busy ||
                  uploadingAttachment ||
                  (!input.trim() && attachments.length === 0)
                }
              >
                {busy ? (
                  <span className={styles.composerThinkingDot} />
                ) : (
                  <svg viewBox="0 0 24 24" aria-hidden="true">
                    <path d="M12 19V5" />
                    <path d="m6 11 6-6 6 6" />
                  </svg>
                )}
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
