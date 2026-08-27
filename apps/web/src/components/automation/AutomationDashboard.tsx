"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { RuntimeImage } from "@/components/RuntimeImage";
import styles from "./AutomationDashboard.module.css";
import { usePreferences } from "@/components/preferences";

import { API_URL } from "@/lib/api";

const DEFAULT_BROWSER_RUNTIME_API_URL =
  "https://api-production-7f7d.up.railway.app";

function getBrowserRuntimeApiUrl() {
  const configured = process.env.NEXT_PUBLIC_BROWSER_RUNTIME_API_URL?.trim();

  if (configured) {
    return configured.replace(/\/+$/, "");
  }

  if (
    typeof window !== "undefined" &&
    (window.location.hostname === "localhost" ||
      window.location.hostname === "127.0.0.1")
  ) {
    return DEFAULT_BROWSER_RUNTIME_API_URL;
  }

  return API_URL.replace(/\/+$/, "");
}

function buildBrowserViewUrl(viewerToken: string) {
  const configured =
    process.env.NEXT_PUBLIC_BROWSER_VIEW_URL?.trim() ||
    "https://browser-worker-production-536a.up.railway.app/vnc.html";

  try {
    const url = new URL(configured);

    url.searchParams.set("autoconnect", "1");

    url.searchParams.set("resize", "scale");

    url.searchParams.set(
      "path",
      `websockify?token=${encodeURIComponent(viewerToken)}`,
    );

    url.searchParams.set("reconnect", "1");

    url.searchParams.set("reconnect_delay", "1000");

    return url.toString();
  } catch {
    return configured;
  }
}

type Channel = {
  id: string;
  platform: "FACEBOOK" | "TELEGRAM" | "INSTAGRAM";
  name: string;
  username: string | null;
  status: "DISCONNECTED" | "CONNECTED" | "EXPIRED" | "ERROR";
  lastConnectedAt: string | null;
  lastError: string | null;
  _count: {
    scheduledPosts: number;
  };
};

type ScheduledPost = {
  id: string;
  platform: "FACEBOOK" | "TELEGRAM" | "INSTAGRAM";
  title: string | null;
  content: string;
  status: string;
  scheduledAt: string;
  channel: {
    id: string;
    name: string;
  };
  brand: {
    id: string;
    name: string;
  };
  campaign: {
    id: string;
    name: string;
  } | null;
};

type DashboardResponse = {
  channels: Channel[];
  statusCounts: Record<string, number>;
  upcoming: ScheduledPost[];
  recentAttempts: unknown[];
};

type BrowserStatusResponse = {
  running: boolean;
  browserProfileKey?: string;
  session?: {
    browserProfileKey: string;
    currentUrl: string | null;
    openedAt: string;
  };
};

type BrowserActionTraceItem = {
  id: string;
  browserActionId: string;
  stepKey: string;
  stepName: string;
  stepOrder: number;
  status: "PENDING" | "SUCCESS" | "FAILED" | "SKIPPED";
  metadata: unknown;
  errorMessage: string | null;
  screenshotPath: string | null;
  startedAt: string;
  completedAt: string | null;
  durationMs: number | null;
  createdAt: string;
};

type BrowserActionHistoryItem = {
  id: string;
  flowId: string | null;
  traces?: BrowserActionTraceItem[];
  action: "PREPARE" | "PUBLISH" | "DISCARD";
  status: "PENDING" | "SUCCESS" | "FAILED";
  browserProfileKey: string | null;
  caption: string | null;
  imagePath: string | null;
  errorMessage: string | null;
  responsePayload: {
    published?: boolean;
    composerClosed?: boolean;
    screenshot?: {
      mimeType?: string;
      absolutePath?: string;
      relativePath?: string;
      filename?: string;
    };
    screenshots?: {
      before?: {
        mimeType?: string;
        absolutePath?: string;
        relativePath?: string;
        filename?: string;
      };
      after?: {
        mimeType?: string;
        absolutePath?: string;
        relativePath?: string;
        filename?: string;
      };
    };
    verification?: {
      status?: "CONFIRMED" | "COMPOSER_CLOSED" | "UNCONFIRMED" | "FAILED";
      waitedMs?: number;
      timeoutMs?: number;
      composerClosed?: boolean;
      successSignal?: boolean;
      errorSignal?: boolean;
      alertTexts?: string[];
    };
    [key: string]: unknown;
  } | null;

  startedAt: string;
  completedAt: string | null;
  durationMs: number | null;
  createdAt: string;
  channel: {
    id: string;
    name: string;
    platform: string;
    username: string | null;
  };
};

type BrowserDraftResponse = {
  success: boolean;
  browserProfileKey?: string;
  composerOpened?: boolean;
  captionFilled?: boolean;
  imageAttached?: boolean;
  readyForReview?: boolean;
  published?: boolean;
  preparedAt?: string;
  message?: string;
  screenshot?: {
    mimeType: string;
    base64?: string;
  };
};

type Settings = {
  timezone: string;
  approvalRequired: boolean;
  autoPublishEnabled: boolean;
  retryLimit: number;
  retryDelayMinutes: number;
  defaultFacebookTime: string;
  defaultTelegramTime: string;
};

function formatDate(value: string, locale: string) {
  return new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

type BrowserTraceDiagnostic = {
  severity: "CRITICAL" | "WARNING" | "INFO" | "HEALTHY";
  title: string;
  message: string;
  stepKey?: string;
};

function analyzeBrowserTrace(
  traces: BrowserActionTraceItem[],
): BrowserTraceDiagnostic[] {
  if (!traces.length) {
    return [];
  }

  const diagnostics: BrowserTraceDiagnostic[] = [];

  const failedSteps = traces.filter((trace) => trace.status === "FAILED");

  for (const trace of failedSteps) {
    diagnostics.push({
      severity: "CRITICAL",
      title: `${trace.stepName} failed`,
      message:
        trace.errorMessage || "The browser step did not complete successfully.",
      stepKey: trace.stepKey,
    });
  }

  const verySlowSteps = traces.filter(
    (trace) => trace.status === "SUCCESS" && (trace.durationMs || 0) >= 5000,
  );

  for (const trace of verySlowSteps) {
    diagnostics.push({
      severity: "WARNING",
      title: `${trace.stepName} was very slow`,
      message: `This step took ${formatTraceDuration(
        trace.durationMs,
      )}. Check browser responsiveness, network latency, or page state.`,
      stepKey: trace.stepKey,
    });
  }

  const slowSteps = traces.filter(
    (trace) =>
      trace.status === "SUCCESS" &&
      (trace.durationMs || 0) >= 2000 &&
      (trace.durationMs || 0) < 5000,
  );

  for (const trace of slowSteps) {
    diagnostics.push({
      severity: "INFO",
      title: `${trace.stepName} was slower than usual`,
      message: `This step took ${formatTraceDuration(trace.durationMs)}.`,
      stepKey: trace.stepKey,
    });
  }

  const skippedSteps = traces.filter((trace) => trace.status === "SKIPPED");

  for (const trace of skippedSteps) {
    diagnostics.push({
      severity: "INFO",
      title: `${trace.stepName} was skipped`,
      message: trace.errorMessage || "This optional step was not required.",
      stepKey: trace.stepKey,
    });
  }

  if (!diagnostics.length) {
    diagnostics.push({
      severity: "HEALTHY",
      title: "Execution completed normally",
      message: "No failed or unusually slow browser steps were detected.",
    });
  }

  return diagnostics;
}

function formatTraceDuration(durationMs: number | null) {
  if (durationMs === null) {
    return "-";
  }

  if (durationMs < 1000) {
    return `${durationMs}ms`;
  }

  return `${(durationMs / 1000).toFixed(2)}s`;
}

function platformLabel(platform: string) {
  return platform === "FACEBOOK" ? "Facebook" : platform === "TELEGRAM" ? "Telegram" : "Instagram";
}

function browserActionScreenshotUrl(
  actionId: string,
  variant?: "before" | "after",
) {
  const base = `${getBrowserRuntimeApiUrl()}/automation/browser-actions/${actionId}/screenshot`;

  return variant ? `${base}?variant=${variant}` : base;
}

type BrowserActionTimelineGroup = {
  id: string;
  flowId: string | null;
  items: BrowserActionHistoryItem[];
  createdAt: string;
};

function groupBrowserActionsByFlow(
  items: BrowserActionHistoryItem[],
): BrowserActionTimelineGroup[] {
  const grouped = new Map<string, BrowserActionTimelineGroup>();

  for (const item of items) {
    const key = item.flowId ? `flow:${item.flowId}` : `single:${item.id}`;

    const existing = grouped.get(key);

    if (existing) {
      existing.items.push(item);

      if (
        new Date(item.createdAt).getTime() <
        new Date(existing.createdAt).getTime()
      ) {
        existing.createdAt = item.createdAt;
      }

      continue;
    }

    grouped.set(key, {
      id: key,
      flowId: item.flowId,
      items: [item],
      createdAt: item.createdAt,
    });
  }

  return Array.from(grouped.values())
    .map((group) => ({
      ...group,
      items: [...group.items].sort(
        (left, right) =>
          new Date(left.createdAt).getTime() -
          new Date(right.createdAt).getTime(),
      ),
    }))
    .sort(
      (left, right) =>
        new Date(right.createdAt).getTime() -
        new Date(left.createdAt).getTime(),
    );
}

function summarizeBrowserFlow(group: BrowserActionTimelineGroup) {
  const terminal =
    [...group.items]
      .reverse()
      .find((item) => item.action === "PUBLISH" || item.action === "DISCARD") ||
    group.items.at(-1);

  const hasFailed = group.items.some((item) => item.status === "FAILED");

  const totalDurationMs = group.items.reduce(
    (total, item) => total + (item.durationMs || 0),
    0,
  );

  const verificationStatus = terminal?.responsePayload?.verification?.status;

  return {
    terminal,
    hasFailed,
    totalDurationMs,
    verificationStatus,
    status: hasFailed ? "FAILED" : terminal?.status || "PENDING",
  };
}

export function AutomationDashboard({
  requestedBrowserChannelId,
  requestedViewerOpen = false,
}: {
  requestedBrowserChannelId?: string | null;
  requestedViewerOpen?: boolean;
}) {
  const { language } = usePreferences();

  const copy =
    language === "zh"
      ? {
          loading: "正在加载自动化仪表板……",
          unavailable: "暂无自动化数据。",
          tryAgain: "重试",
          loadFailed: "无法加载自动化仪表板。",
          publishing: "发布管理",
          title: "社交平台自动化",
          description: "管理 Facebook、Telegram 与 Instagram 渠道、发布队列和排程帖子。",
          refreshing: "刷新中……",
          refresh: "刷新",
          scheduled: "已排程",
          scheduledHint: "等待发布时间",
          queue: "队列",
          queueHint: "等待处理",
          published: "已发布",
          publishedHint: "成功完成",
          failed: "失败",
          failedHint: "需要处理",
          channels: "渠道",
          connectedPlatforms: "已连接平台",
          noUsername: "未设置用户名",
          posts: "个帖子",
          automation: "自动化",
          publishingSettings: "发布设置",
          timezone: "时区",
          approvalRequired: "需要审批",
          yes: "是",
          no: "否",
          autoPublish: "自动发布",
          enabled: "已启用",
          disabled: "已停用",
          retryPolicy: "重试规则",
          attempts: "次",
          minutes: "分钟",
          facebookTime: "Facebook 默认时间",
          telegramTime: "Telegram 默认时间",
          schedule: "排程",
          upcomingPosts: "即将发布",
          platform: "平台",
          content: "内容",
          campaign: "营销活动",
          status: "状态",
          scheduledTime: "排程时间",
          untitled: "未命名帖子",
          noScheduled: "尚未排程任何帖子。",
          connected: "已连接",
          disconnected: "未连接",
          browserDraft: "社交平台浏览器草稿",
          browserDraftDescription:
            "在你的 Mac 浏览器中准备 Facebook 或 Instagram 文案与图片，停在发布前供人工确认。",
          facebookChannel: "Facebook 渠道",
          captionLabel: "文案",
          captionPlaceholder: "输入要放入 Facebook 帖子的文案……",
          imagePathLabel: "Mac 图片路径",
          imagePathPlaceholder: "/Users/your-name/Downloads/image.png",
          openBrowser: "打开浏览器",
          openingBrowser: "正在打开……",
          checkStatus: "检查状态",
          checkingStatus: "检查中……",
          closeBrowser: "关闭浏览器",
          closingBrowser: "正在关闭……",
          prepareDraft: "准备浏览器草稿",
          preparingDraft: "正在准备草稿……",
          browserRunning: "浏览器运行中",
          browserStopped: "浏览器未运行",
          draftReady: "草稿已准备完成，请在浏览器中检查。",
          browserDraftFailed: "无法准备浏览器草稿。",
          noFacebookChannel: "没有可用的 Facebook 或 Instagram 渠道。",
          screenshotPreview: "草稿预览",
          localPathHint:
            "当前版本使用 Browser Worker 所在 Mac 的本地文件路径。",
          publishPost: "发布帖子",
          publishingPost: "正在发布……",
          publishConfirmTitle: "确认发布 Facebook 帖子？",
          publishConfirmText: "这会真实点击 Facebook 的 Post 按钮并立即发布。",
          cancelPublish: "取消",
          confirmPublish: "确认发布",
          publishedSuccessfully: "Facebook 帖子已成功发布。",
          publishFailed: "无法发布 Facebook 帖子。",
          discardDraft: "取消草稿",
          discardingDraft: "正在取消……",
          discardConfirmTitle: "确认取消当前草稿？",
          discardConfirmText: "当前 Facebook Composer 中的文案和图片将被清除。",
          confirmDiscard: "确认取消",
          discardedSuccessfully: "Facebook 草稿已取消。",
          discardFailed: "无法取消 Facebook 草稿。",
          recentBrowserActions: "最近 Browser Agent 操作",
          browserActionsDescription: "查看草稿准备、发布、取消与失败记录。",
          noBrowserActions: "暂时没有 Browser Agent 操作记录。",
          actionPrepare: "准备草稿",
          actionPublish: "发布帖子",
          actionDiscard: "取消草稿",
          actionPending: "处理中",
          actionSuccess: "成功",
          actionFailed: "失败",
          retryAction: "重新尝试",
          retryingAction: "正在重试……",
          retrySucceeded: "失败操作已重新准备为草稿，请检查浏览器。",
          retryFailed: "无法重新尝试这个 Browser Agent 操作。",
          openBrowserBeforeRetry: "请先打开对应的浏览器，再重新尝试。",
          duration: "耗时",
          viewCaption: "文案",
          imagePath: "图片路径",
          verificationConfirmed: "发布已确认",
          verificationComposerClosed: "Composer 已关闭",
          verificationUnconfirmed: "发布状态未确认",
          verificationFailed: "发布验证失败",
          verificationWaited: "验证耗时",
          viewScreenshot: "查看截图",
          viewBeforeScreenshot: "发布前截图",
          viewAfterScreenshot: "发布后截图",
          filterAll: "全部",
          filterAction: "操作类型",
          filterStatus: "状态",
          showDetails: "查看详情",
          hideDetails: "收起详情",
          historyDetailsTitle: "Browser Agent 操作详情",
          closeDetails: "关闭",
          actionId: "操作 ID",
          channelName: "渠道",
          actionType: "操作",
          resultStatus: "结果",
          browserFlow: "Browser 流程",
          flowSteps: "个步骤",
          flowTotalDuration: "总耗时",
          flowCompleted: "流程完成",
          flowFailed: "流程失败",
          flowInProgress: "流程进行中",
          startedAt: "开始时间",
          completedAt: "完成时间",
          browserProfile: "浏览器 Profile",
          errorDetails: "错误详情",
          responseDetails: "响应详情",
        }
      : {
          loading: "Loading automation dashboard...",
          unavailable: "No automation data available.",
          tryAgain: "Try again",
          loadFailed: "Unable to load automation dashboard.",
          publishing: "Publishing",
          title: "Social Automation",
          description:
            "Manage Facebook, Telegram and Instagram channels, publishing queue and scheduled posts.",
          refreshing: "Refreshing...",
          refresh: "Refresh",
          scheduled: "Scheduled",
          scheduledHint: "Waiting for publish time",
          queue: "Queue",
          queueHint: "Ready for processing",
          published: "Published",
          publishedHint: "Successfully completed",
          failed: "Failed",
          failedHint: "Needs attention",
          channels: "Channels",
          connectedPlatforms: "Connected platforms",
          noUsername: "No username",
          posts: "posts",
          automation: "Automation",
          publishingSettings: "Publishing settings",
          timezone: "Timezone",
          approvalRequired: "Approval required",
          yes: "Yes",
          no: "No",
          autoPublish: "Auto publish",
          enabled: "Enabled",
          disabled: "Disabled",
          retryPolicy: "Retry policy",
          attempts: "attempts",
          minutes: "min",
          facebookTime: "Facebook time",
          telegramTime: "Telegram time",
          schedule: "Schedule",
          upcomingPosts: "Upcoming posts",
          platform: "Platform",
          content: "Content",
          campaign: "Campaign",
          status: "Status",
          scheduledTime: "Scheduled",
          untitled: "Untitled post",
          noScheduled: "No posts scheduled yet.",
          connected: "Connected",
          disconnected: "Disconnected",
          browserDraft: "Social Browser Draft",
          browserDraftDescription:
            "Prepare Facebook or Instagram content in your Mac browser, then stop before publishing for manual review.",
          facebookChannel: "Facebook channel",
          captionLabel: "Caption",
          captionPlaceholder: "Enter the Facebook post caption...",
          imagePathLabel: "Mac image path",
          imagePathPlaceholder: "/Users/your-name/Downloads/image.png",
          openBrowser: "Open browser",
          openingBrowser: "Opening...",
          checkStatus: "Check status",
          checkingStatus: "Checking...",
          closeBrowser: "Close browser",
          closingBrowser: "Closing...",
          prepareDraft: "Prepare browser draft",
          preparingDraft: "Preparing draft...",
          browserRunning: "Browser running",
          browserStopped: "Browser stopped",
          draftReady: "Draft is ready. Review it in the browser.",
          browserDraftFailed: "Unable to prepare browser draft.",
          noFacebookChannel: "No Facebook or Instagram channel is available.",
          screenshotPreview: "Draft preview",
          localPathHint:
            "This version uses a local file path on the Mac running Browser Worker.",
          publishPost: "Publish post",
          publishingPost: "Publishing...",
          publishConfirmTitle: "Publish this Facebook post?",
          publishConfirmText:
            "This will click Facebook's Post button and publish the post immediately.",
          cancelPublish: "Cancel",
          confirmPublish: "Confirm publish",
          publishedSuccessfully: "Facebook post published successfully.",
          publishFailed: "Unable to publish Facebook post.",
          discardDraft: "Discard draft",
          discardingDraft: "Discarding...",
          discardConfirmTitle: "Discard the current draft?",
          discardConfirmText:
            "The caption and image in the Facebook Composer will be cleared.",
          confirmDiscard: "Confirm discard",
          discardedSuccessfully: "Facebook draft discarded.",
          discardFailed: "Unable to discard Facebook draft.",
          recentBrowserActions: "Recent Browser Agent actions",
          browserActionsDescription:
            "Review draft preparation, publishing, discard and failure records.",
          noBrowserActions: "No Browser Agent actions yet.",
          actionPrepare: "Prepare draft",
          actionPublish: "Publish post",
          actionDiscard: "Discard draft",
          actionPending: "Pending",
          actionSuccess: "Success",
          actionFailed: "Failed",
          retryAction: "Retry",
          retryingAction: "Retrying...",
          retrySucceeded:
            "The failed action was prepared again. Review it in the browser.",
          retryFailed: "Unable to retry this Browser Agent action.",
          openBrowserBeforeRetry:
            "Open the corresponding browser before retrying.",
          duration: "Duration",
          viewCaption: "Caption",
          imagePath: "Image path",
          verificationConfirmed: "Publish confirmed",
          verificationComposerClosed: "Composer closed",
          verificationUnconfirmed: "Publish unconfirmed",
          verificationFailed: "Verification failed",
          verificationWaited: "Verification time",
          viewScreenshot: "View screenshot",
          viewBeforeScreenshot: "Before publish",
          viewAfterScreenshot: "After publish",
          filterAll: "All",
          filterAction: "Action",
          filterStatus: "Status",
          showDetails: "Show details",
          hideDetails: "Hide details",
          historyDetailsTitle: "Browser Agent action details",
          closeDetails: "Close",
          actionId: "Action ID",
          channelName: "Channel",
          actionType: "Action",
          resultStatus: "Result",
          browserFlow: "Browser flow",
          flowSteps: "steps",
          flowTotalDuration: "Total duration",
          flowCompleted: "Flow completed",
          flowFailed: "Flow failed",
          flowInProgress: "Flow in progress",
          startedAt: "Started",
          completedAt: "Completed",
          browserProfile: "Browser profile",
          errorDetails: "Error details",
          responseDetails: "Response details",
        };

  const locale = language === "zh" ? "zh-CN" : "en-MY";

  const [replayingBrowserActionId, setReplayingBrowserActionId] = useState<
    string | null
  >(null);

  const [dashboard, setDashboard] = useState<DashboardResponse | null>(null);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [selectedBrowserChannelId, setSelectedBrowserChannelId] =
    useState("");

  const [browserCaption, setBrowserCaption] = useState("");

  const [browserImagePath, setBrowserImagePath] = useState("");

  const [browserRunning, setBrowserRunning] = useState(false);

  const [browserViewerKey, setBrowserViewerKey] = useState(0);

  const [browserViewerUrl, setBrowserViewerUrl] = useState<string | null>(null);

  const browserPreviewRef = useRef<HTMLDivElement | null>(null);

  const automaticViewerRequestedRef = useRef(false);

  const [browserAction, setBrowserAction] = useState<
    | "open"
    | "status"
    | "close"
    | "prepare"
    | "publish"
    | "discard"
    | "retry"
    | null
  >(null);

  const [browserMessage, setBrowserMessage] = useState("");

  const [browserError, setBrowserError] = useState("");

  const [draftScreenshot, setDraftScreenshot] = useState<string | null>(null);

  const [draftReady, setDraftReady] = useState(false);

  const [publishConfirmOpen, setPublishConfirmOpen] = useState(false);

  const selectedBrowserChannel = dashboard?.channels.find(
    (channel) => channel.id === selectedBrowserChannelId,
  );
  const selectedBrowserPlatform = selectedBrowserChannel?.platform ?? "FACEBOOK";
  const isInstagramBrowser = selectedBrowserPlatform === "INSTAGRAM";

  const [discardConfirmOpen, setDiscardConfirmOpen] = useState(false);

  const [browserActions, setBrowserActions] = useState<
    BrowserActionHistoryItem[]
  >([]);

  const [browserActionsLoading, setBrowserActionsLoading] = useState(false);

  const [retryingBrowserActionId, setRetryingBrowserActionId] = useState<
    string | null
  >(null);

  const [browserActionFilter, setBrowserActionFilter] = useState<
    "ALL" | "PREPARE" | "PUBLISH" | "DISCARD"
  >("ALL");

  const [browserStatusFilter, setBrowserStatusFilter] = useState<
    "ALL" | "PENDING" | "SUCCESS" | "FAILED"
  >("ALL");

  const [selectedBrowserHistoryItem, setSelectedBrowserHistoryItem] =
    useState<BrowserActionHistoryItem | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");

    try {
      const [dashboardResponse, settingsResponse] = await Promise.all([
        fetch(`${API_URL}/automation/dashboard`, { cache: "no-store" }),
        fetch(`${API_URL}/automation/settings`, { cache: "no-store" }),
      ]);

      if (!dashboardResponse.ok || !settingsResponse.ok) {
        throw new Error(copy.loadFailed);
      }

      const [dashboardData, settingsData] = await Promise.all([
        dashboardResponse.json() as Promise<DashboardResponse>,
        settingsResponse.json() as Promise<Settings>,
      ]);

      setDashboard(dashboardData);
      setSettings(settingsData);
      void loadBrowserActions();
    } catch (loadError) {
      setError(
        loadError instanceof Error ? loadError.message : copy.loadFailed,
      );
    } finally {
      setLoading(false);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps -- Dashboard loader identity is fixed for this mount; locale changes do not trigger network reloads.

  async function replayBrowserAction(actionId: string) {
    if (replayingBrowserActionId) {
      return;
    }

    setReplayingBrowserActionId(actionId);

    try {
      const apiOrigin = getBrowserRuntimeApiUrl();

      const response = await fetch(
        `${apiOrigin}/automation/browser-actions/${actionId}/replay`,
        {
          method: "POST",
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json",
          },
        },
      );

      const responseText = await response.text();

      let payload: Record<string, unknown> | null = null;

      if (responseText) {
        try {
          payload = JSON.parse(responseText) as Record<string, unknown>;
        } catch {
          payload = null;
        }
      }

      if (!response.ok) {
        const message =
          typeof payload?.message === "string"
            ? payload.message
            : typeof payload?.error === "string"
              ? payload.error
              : responseText || `Replay failed with HTTP ${response.status}.`;

        throw new Error(message);
      }

      await loadBrowserActions();

      setSelectedBrowserHistoryItem(null);
    } catch (error) {
      console.error("Browser Action replay failed:", error);

      window.alert(
        error instanceof Error
          ? error.message
          : "Unable to replay browser action.",
      );
    } finally {
      setReplayingBrowserActionId(null);
    }
  }

  async function loadBrowserActions() {
    setBrowserActionsLoading(true);

    try {
      const response = await fetch(
        `${getBrowserRuntimeApiUrl()}/automation/browser-actions?limit=20`,
        {
          cache: "no-store",
        },
      );

      if (!response.ok) {
        throw new Error(copy.loadFailed);
      }

      const body = (await response.json()) as BrowserActionHistoryItem[];

      setBrowserActions(body);
    } catch (loadError) {
      console.error("Unable to load Browser Agent history:", loadError);
      setBrowserActions([]);
    } finally {
      setBrowserActionsLoading(false);
    }
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- Fetch remote automation state when the dashboard mounts.
    void load();
    void loadBrowserActions();
  }, [load]); // eslint-disable-line react-hooks/exhaustive-deps -- Browser actions are already loaded by the dashboard loader.

  useEffect(() => {
    if (selectedBrowserChannelId || !dashboard) {
      return;
    }

    const requestedChannel = requestedBrowserChannelId
      ? dashboard.channels.find(
          (channel) => channel.id === requestedBrowserChannelId,
        )
      : null;

    const browserChannel =
      requestedChannel ||
      dashboard.channels.find(
        (channel) =>
          channel.platform === "FACEBOOK" ||
          channel.platform === "INSTAGRAM",
      );

    if (browserChannel) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- Select the first available Facebook channel after remote data arrives.
      setSelectedBrowserChannelId(browserChannel.id);
    }
  }, [dashboard, requestedBrowserChannelId, selectedBrowserChannelId]);

  useEffect(() => {
    if (
      !requestedViewerOpen ||
      !selectedBrowserChannelId ||
      automaticViewerRequestedRef.current
    ) {
      return;
    }

    automaticViewerRequestedRef.current = true;
    void openBrowser();
  }, [requestedViewerOpen, selectedBrowserChannelId]);

  async function connectSecureBrowserViewer() {
    const response = await fetch("/api/browser-viewer/session", {
      method: "POST",
      cache: "no-store",
      headers: {
        Accept: "application/json",
      },
    });

    const body = (await response.json()) as {
      token?: string;
      expiresAt?: string;
      message?: string;
    };

    if (!response.ok || !body.token) {
      throw new Error(body.message || "Unable to authorize Live Browser.");
    }

    const nextUrl = buildBrowserViewUrl(body.token);

    setBrowserViewerUrl(nextUrl);

    return nextUrl;
  }

  function revealBrowserViewer() {
    setBrowserViewerKey((current) => current + 1);

    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        browserPreviewRef.current?.scrollIntoView({
          behavior: "smooth",
          block: "start",
        });
      });
    });
  }

  async function openBrowser() {
    if (!selectedBrowserChannelId) {
      setBrowserError(copy.noFacebookChannel);
      return;
    }

    setBrowserAction("open");
    setBrowserError("");
    setBrowserMessage("");

    try {
      const response = await fetch(
        `${getBrowserRuntimeApiUrl()}/automation/channels/${selectedBrowserChannelId}/browser/open`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            headless: false,
            startUrl: isInstagramBrowser ? "https://www.instagram.com/" : "https://www.facebook.com/",
          }),
        },
      );

      const body = (await response.json()) as {
        opened?: boolean;
        alreadyRunning?: boolean;
        message?: string;
      };

      if (!response.ok) {
        throw new Error(body.message || copy.browserDraftFailed);
      }

      setBrowserRunning(true);

      await connectSecureBrowserViewer();

      setBrowserMessage(copy.browserRunning);

      revealBrowserViewer();
    } catch (actionError) {
      setBrowserError(
        actionError instanceof Error
          ? actionError.message
          : copy.browserDraftFailed,
      );
    } finally {
      setBrowserAction(null);
    }
  }

  async function checkBrowserStatus() {
    if (!selectedBrowserChannelId) {
      return;
    }

    setBrowserAction("status");
    setBrowserError("");

    try {
      const response = await fetch(
        `${getBrowserRuntimeApiUrl()}/automation/channels/${selectedBrowserChannelId}/browser/status`,
        {
          cache: "no-store",
        },
      );

      const body = (await response.json()) as BrowserStatusResponse;

      if (!response.ok) {
        throw new Error(copy.browserDraftFailed);
      }

      setBrowserRunning(Boolean(body.running));

      if (body.running) {
        await connectSecureBrowserViewer();
        revealBrowserViewer();
      } else {
        setBrowserViewerUrl(null);
      }

      setBrowserMessage(
        body.running ? copy.browserRunning : copy.browserStopped,
      );
    } catch (actionError) {
      setBrowserError(
        actionError instanceof Error
          ? actionError.message
          : copy.browserDraftFailed,
      );
    } finally {
      setBrowserAction(null);
    }
  }

  async function closeBrowser() {
    if (!selectedBrowserChannelId) {
      return;
    }

    setBrowserAction("close");
    setBrowserError("");
    setBrowserMessage("");

    try {
      const response = await fetch(
        `${getBrowserRuntimeApiUrl()}/automation/channels/${selectedBrowserChannelId}/browser/close`,
        {
          method: "POST",
        },
      );

      const body = (await response.json()) as {
        message?: string;
      };

      if (!response.ok) {
        throw new Error(body.message || copy.browserDraftFailed);
      }

      setBrowserRunning(false);

      setBrowserViewerUrl(null);

      setBrowserMessage(copy.browserStopped);
    } catch (actionError) {
      setBrowserError(
        actionError instanceof Error
          ? actionError.message
          : copy.browserDraftFailed,
      );
    } finally {
      setBrowserAction(null);
    }
  }

  async function retryBrowserAction(item: BrowserActionHistoryItem) {
    if (item.status !== "FAILED" || item.action !== "PREPARE") {
      return;
    }

    setBrowserAction("retry");
    setRetryingBrowserActionId(item.id);
    setBrowserError("");
    setBrowserMessage("");
    setDraftReady(false);

    try {
      const response = await fetch(
        `${getBrowserRuntimeApiUrl()}/automation/browser-actions/${item.id}/retry`,
        {
          method: "POST",
        },
      );

      const body = (await response.json()) as {
        success?: boolean;
        retried?: boolean;
        message?: string;
        result?: BrowserDraftResponse;
      };

      if (!response.ok || !body.success || !body.retried) {
        if (body.message === "Browser profile is not running.") {
          throw new Error(copy.openBrowserBeforeRetry);
        }

        throw new Error(body.message || copy.retryFailed);
      }

      const result = body.result;

      if (result?.screenshot?.base64 && result.screenshot.mimeType) {
        setDraftScreenshot(
          `data:${result.screenshot.mimeType};base64,${result.screenshot.base64}`,
        );
      }

      setSelectedBrowserChannelId(item.channel.id);

      setBrowserCaption(item.caption || "");

      setBrowserImagePath(item.imagePath || "");

      setBrowserRunning(true);
      setDraftReady(true);

      setBrowserMessage(copy.retrySucceeded);
    } catch (actionError) {
      setBrowserError(
        actionError instanceof Error ? actionError.message : copy.retryFailed,
      );
    } finally {
      setBrowserAction(null);
      setRetryingBrowserActionId(null);
      void loadBrowserActions();
    }
  }

  async function prepareBrowserDraft() {
    if (!selectedBrowserChannelId || !browserCaption.trim()) {
      setBrowserError(copy.browserDraftFailed);
      return;
    }

    setBrowserAction("prepare");
    setBrowserError("");
    setBrowserMessage("");
    setDraftScreenshot(null);
    setDraftReady(false);

    try {
      const response = await fetch(
        `${getBrowserRuntimeApiUrl()}/automation/channels/${selectedBrowserChannelId}/browser/${isInstagramBrowser ? "instagram" : "facebook"}/prepare-post`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            caption: browserCaption.trim(),
            ...(isInstagramBrowser && /^https?:\/\//i.test(browserImagePath.trim())
              ? { imageUrl: browserImagePath.trim() }
              : { imagePath: browserImagePath.trim() || null }),
          }),
        },
      );

      const body = (await response.json()) as BrowserDraftResponse;

      if (!response.ok || !body.success) {
        throw new Error(body.message || copy.browserDraftFailed);
      }

      const encoded = body.screenshot?.base64;

      if (encoded && body.screenshot?.mimeType) {
        setDraftScreenshot(
          `data:${body.screenshot.mimeType};base64,${encoded}`,
        );
      }

      setBrowserRunning(true);
      setBrowserMessage(copy.draftReady);

      setDraftReady(true);
    } catch (actionError) {
      setBrowserError(
        actionError instanceof Error
          ? actionError.message
          : copy.browserDraftFailed,
      );
    } finally {
      setBrowserAction(null);
      void loadBrowserActions();
    }
  }

  async function discardBrowserDraft() {
    if (!selectedBrowserChannelId || !draftReady) {
      return;
    }

    setBrowserAction("discard");
    setBrowserError("");
    setBrowserMessage("");
    setDiscardConfirmOpen(false);

    try {
      const response = await fetch(
        `${getBrowserRuntimeApiUrl()}/automation/channels/${selectedBrowserChannelId}/browser/${isInstagramBrowser ? "instagram" : "facebook"}/discard-post`,
        {
          method: "POST",
        },
      );

      const body = (await response.json()) as {
        success?: boolean;
        discarded?: boolean;
        message?: string;
        screenshot?: {
          mimeType?: string;
          base64?: string;
        };
      };

      if (!response.ok || !body.success) {
        throw new Error(body.message || copy.discardFailed);
      }

      if (body.screenshot?.base64 && body.screenshot.mimeType) {
        setDraftScreenshot(
          `data:${body.screenshot.mimeType};base64,${body.screenshot.base64}`,
        );
      }

      setDraftReady(false);
      setBrowserCaption("");
      setBrowserImagePath("");

      setBrowserMessage(copy.discardedSuccessfully);
    } catch (actionError) {
      setBrowserError(
        actionError instanceof Error ? actionError.message : copy.discardFailed,
      );
    } finally {
      setBrowserAction(null);
      void loadBrowserActions();
    }
  }

  async function publishBrowserDraft() {
    if (!selectedBrowserChannelId || !draftReady) {
      return;
    }

    setBrowserAction("publish");
    setBrowserError("");
    setBrowserMessage("");
    setPublishConfirmOpen(false);

    try {
      const response = await fetch(
        `${getBrowserRuntimeApiUrl()}/automation/channels/${selectedBrowserChannelId}/browser/${isInstagramBrowser ? "instagram" : "facebook"}/publish-post`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            confirmation: "PUBLISH",
          }),
        },
      );

      const body = (await response.json()) as {
        success?: boolean;
        published?: boolean;
        message?: string;
        screenshots?: {
          after?: {
            mimeType?: string;
            base64?: string;
          };
        };
      };

      if (!response.ok || !body.success || !body.published) {
        throw new Error(body.message || copy.publishFailed);
      }

      const after = body.screenshots?.after;

      if (after?.base64 && after.mimeType) {
        setDraftScreenshot(`data:${after.mimeType};base64,${after.base64}`);
      }

      setDraftReady(false);
      setBrowserMessage(copy.publishedSuccessfully);
    } catch (actionError) {
      setBrowserError(
        actionError instanceof Error ? actionError.message : copy.publishFailed,
      );
    } finally {
      setBrowserAction(null);
      void loadBrowserActions();
    }
  }

  const filteredBrowserActions = browserActions.filter((item) => {
    const actionMatches =
      browserActionFilter === "ALL" || item.action === browserActionFilter;

    const statusMatches =
      browserStatusFilter === "ALL" || item.status === browserStatusFilter;

    return actionMatches && statusMatches;
  });

  if (loading && !dashboard) {
    return (
      <section className={styles.state}>
        Loading automation dashboard...
      </section>
    );
  }

  if (!dashboard) {
    return (
      <section className={styles.state}>
        <p>{error || copy.unavailable}</p>

        <button
          onClick={() => {
            void load();
            void loadBrowserActions();
          }}
        >
          Try again
        </button>
      </section>
    );
  }

  const counts = dashboard.statusCounts;

  return (
    <div className={styles.dashboard}>
      <section className={styles.hero}>
        <div>
          <p className={styles.eyebrow}>Publishing</p>

          <h1>{copy.title}</h1>

          <p>{copy.description}</p>
        </div>

        <button
          className={styles.refreshButton}
          onClick={() => void load()}
          disabled={loading}
        >
          {loading ? copy.refreshing : copy.refresh}
        </button>
      </section>

      {error ? <div className={styles.error}>{error}</div> : null}

      <section className={styles.kpiGrid}>
        <a className={styles.kpiAction} href="#upcoming-posts">
          <span>{copy.scheduled}</span>
          <strong>{counts.SCHEDULED ?? 0}</strong>
          <small>{copy.scheduledHint}</small>
          <i aria-hidden="true">→</i>
        </a>

        <a className={styles.kpiAction} href="#upcoming-posts">
          <span>{copy.queue}</span>
          <strong>{counts.QUEUED ?? 0}</strong>
          <small>{copy.queueHint}</small>
          <i aria-hidden="true">→</i>
        </a>

        <a
          className={styles.kpiAction}
          href="#browser-history"
          onClick={() => setBrowserStatusFilter("SUCCESS")}
        >
          <span>{copy.published}</span>
          <strong>{counts.PUBLISHED ?? 0}</strong>
          <small>{copy.publishedHint}</small>
          <i aria-hidden="true">→</i>
        </a>

        <a
          className={styles.kpiAction}
          href="#browser-history"
          onClick={() => setBrowserStatusFilter("FAILED")}
        >
          <span>{copy.failed}</span>
          <strong>{counts.FAILED ?? 0}</strong>
          <small>{copy.failedHint}</small>
          <i aria-hidden="true">→</i>
        </a>
      </section>

      <section className={styles.contentGrid}>
        <article id="connected-platforms" className={styles.panel}>
          <header>
            <div>
              <p className={styles.eyebrow}>Channels</p>
              <h2>{copy.connectedPlatforms}</h2>
            </div>

            <strong>{dashboard.channels.length}</strong>
          </header>

          <div className={styles.channelTableShell}>
            <div className={styles.channelTableToolbar}>
              <span>
                {dashboard.channels.length} {copy.channels}
              </span>

              <a
                className={styles.manageAccountsLink}
                href="/automation/browser-accounts"
              >
                Manage accounts & details →
              </a>
            </div>

            <div className={styles.channelTableWrap}>
              <div
                className={styles.channelTable}
                role="table"
                aria-label={copy.connectedPlatforms}
              >
                <div className={styles.channelTableHeader} role="row">
                  <span role="columnheader">Platform</span>
                  <span role="columnheader">Account</span>
                  <span role="columnheader">Username</span>
                  <span role="columnheader">Status</span>
                  <span role="columnheader">Posts</span>
                  <span role="columnheader">Details</span>
                </div>

                {dashboard.channels.map((channel) => {
                  const detailsHref =
                    channel.platform === "FACEBOOK"
                      ? `/automation/browser-accounts?channelId=${encodeURIComponent(
                          channel.id,
                        )}`
                      : `/settings?channelId=${encodeURIComponent(channel.id)}`;

                  return (
                    <a
                      className={styles.channelTableRow}
                      href={detailsHref}
                      key={channel.id}
                      role="row"
                    >
                      <span className={styles.channelPlatformCell} role="cell">
                        <span
                          className={`${styles.channelTableIcon} ${
                            channel.platform === "FACEBOOK"
                              ? styles.facebook
                              : channel.platform === "TELEGRAM"
                                ? styles.telegram
                                : styles.instagram
                          }`}
                        >
                          {channel.platform === "FACEBOOK" ? "f" : channel.platform === "TELEGRAM" ? "✈" : "◎"}
                        </span>

                        <small>{channel.platform}</small>
                      </span>

                      <strong className={styles.channelNameCell} role="cell">
                        {channel.name}
                      </strong>

                      <span className={styles.channelUsernameCell} role="cell">
                        {channel.username
                          ? `@${channel.username}`
                          : copy.noUsername}
                      </span>

                      <span role="cell">
                        <span
                          className={`${styles.statusBadge} ${
                            channel.status === "CONNECTED"
                              ? styles.connected
                              : styles.disconnected
                          }`}
                        >
                          {channel.status}
                        </span>
                      </span>

                      <span className={styles.channelPostsCell} role="cell">
                        {channel._count.scheduledPosts}
                      </span>

                      <span className={styles.channelDetailsCell} role="cell">
                        View →
                      </span>
                    </a>
                  );
                })}
              </div>
            </div>
          </div>
        </article>

        <article id="publishing" className={styles.panel}>
          <header>
            <div>
              <p className={styles.eyebrow}>Automation</p>
              <h2>{copy.publishingSettings}</h2>
            </div>
          </header>

          {settings ? (
            <div className={styles.settingsList}>
              <div>
                <span>{copy.timezone}</span>
                <strong>{settings.timezone}</strong>
              </div>

              <div>
                <span>{copy.approvalRequired}</span>
                <strong>
                  {settings.approvalRequired ? copy.yes : copy.no}
                </strong>
              </div>

              <div>
                <span>{copy.autoPublish}</span>
                <strong>
                  {settings.autoPublishEnabled ? copy.enabled : copy.disabled}
                </strong>
              </div>

              <div>
                <span>{copy.retryPolicy}</span>
                <strong>
                  {settings.retryLimit} {copy.attempts} ·{" "}
                  {settings.retryDelayMinutes} {copy.minutes}
                </strong>
              </div>

              <div>
                <span>{copy.facebookTime}</span>
                <strong>{settings.defaultFacebookTime}</strong>
              </div>

              <div>
                <span>{copy.telegramTime}</span>
                <strong>{settings.defaultTelegramTime}</strong>
              </div>
            </div>
          ) : null}
        </article>
      </section>

      <section
        id="browser-tools"
        className={`${styles.panel} ${styles.browserDraftPanel}`}
      >
        <header>
          <div>
            <p className={styles.eyebrow}>Browser Agent</p>

            <h2>{copy.browserDraft}</h2>

            <p className={styles.panelDescription}>
              {copy.browserDraftDescription}
            </p>
          </div>

          <span
            className={`${styles.browserStatus} ${
              browserRunning ? styles.browserOnline : styles.browserOffline
            }`}
          >
            {browserRunning ? copy.browserRunning : copy.browserStopped}
          </span>
        </header>

        <div className={styles.browserDraftGrid}>
          <div className={styles.browserDraftForm}>
            <label>
              <span>{isInstagramBrowser ? "Instagram channel" : copy.facebookChannel}</span>

              <select
                value={selectedBrowserChannelId}
                onChange={(event) => {
                  setSelectedBrowserChannelId(event.target.value);
                  setBrowserMessage("");
                  setBrowserError("");
                  setDraftScreenshot(null);
                }}
              >
                {dashboard.channels
                  .filter((channel) => channel.platform === "FACEBOOK" || channel.platform === "INSTAGRAM")
                  .map((channel) => (
                    <option key={channel.id} value={channel.id}>
                      {channel.name}
                    </option>
                  ))}
              </select>
            </label>

            <label>
              <span>{copy.captionLabel}</span>

              <textarea
                value={browserCaption}
                onChange={(event) => setBrowserCaption(event.target.value)}
                placeholder={copy.captionPlaceholder}
                rows={7}
              />

              <small>{browserCaption.length} / 10000</small>
            </label>

            <label>
              <span>{isInstagramBrowser ? "Image path or URL" : copy.imagePathLabel}</span>

              <input
                type="text"
                value={browserImagePath}
                onChange={(event) => setBrowserImagePath(event.target.value)}
                placeholder={isInstagramBrowser ? "https://... or /path/to/image.jpg" : copy.imagePathPlaceholder}
              />

              <small>{isInstagramBrowser ? "Instagram supports a local path or one remote image URL." : copy.localPathHint}</small>
            </label>

            <div className={styles.browserActions}>
              <button
                type="button"
                onClick={() => void openBrowser()}
                disabled={browserAction !== null || !selectedBrowserChannelId}
              >
                {browserAction === "open"
                  ? copy.openingBrowser
                  : copy.openBrowser}
              </button>

              <button
                type="button"
                className={styles.secondaryButton}
                onClick={() => void checkBrowserStatus()}
                disabled={browserAction !== null || !selectedBrowserChannelId}
              >
                {browserAction === "status"
                  ? copy.checkingStatus
                  : copy.checkStatus}
              </button>

              <button
                type="button"
                className={styles.secondaryButton}
                onClick={() => void closeBrowser()}
                disabled={browserAction !== null || !selectedBrowserChannelId}
              >
                {browserAction === "close"
                  ? copy.closingBrowser
                  : copy.closeBrowser}
              </button>
            </div>

            <button
              type="button"
              className={styles.prepareDraftButton}
              onClick={() => void prepareBrowserDraft()}
              disabled={
                browserAction !== null ||
                !selectedBrowserChannelId ||
                !browserCaption.trim()
              }
            >
              {browserAction === "prepare"
                ? copy.preparingDraft
                : copy.prepareDraft}
            </button>

            <button
              type="button"
              className={styles.discardDraftButton}
              onClick={() => setDiscardConfirmOpen(true)}
              disabled={browserAction !== null || !draftReady}
            >
              {browserAction === "discard"
                ? copy.discardingDraft
                : copy.discardDraft}
            </button>

            <button
              type="button"
              className={styles.publishDraftButton}
              onClick={() => setPublishConfirmOpen(true)}
              disabled={browserAction !== null || !draftReady}
            >
              {browserAction === "prepare" && draftReady
                ? copy.publishingPost
                : copy.publishPost}
            </button>

            {browserMessage ? (
              <div className={styles.browserSuccess}>{browserMessage}</div>
            ) : null}

            {browserError ? (
              <div className={styles.browserError}>{browserError}</div>
            ) : null}
          </div>

          <div ref={browserPreviewRef} className={styles.browserPreview}>
            <div className={styles.previewHeader}>
              <strong>
                {browserRunning ? "Live Browser" : copy.screenshotPreview}
              </strong>
            </div>

            {browserRunning && browserViewerUrl ? (
              <iframe
                key={browserViewerKey}
                className={styles.liveBrowserFrame}
                src={browserViewerUrl}
                title="Atlas Live Browser"
                allow="clipboard-read; clipboard-write; fullscreen"
              />
            ) : browserRunning ? (
              <div className={styles.previewEmpty}>
                <span>Connecting Live Browser…</span>
                <small>Authorizing secure viewer session.</small>
              </div>
            ) : draftScreenshot ? (
              <RuntimeImage
                src={draftScreenshot}
                alt={copy.screenshotPreview}
              />
            ) : (
              <div className={styles.previewEmpty}>
                <span>{selectedBrowserPlatform === "INSTAGRAM" ? "Instagram" : "Facebook"}</span>
                <small>{copy.browserDraftDescription}</small>
              </div>
            )}
          </div>
        </div>
      </section>

      <section className={styles.panel} id="browser-history">
        <header>
          <div>
            <p className={styles.eyebrow}>Browser History</p>

            <h2>{copy.recentBrowserActions}</h2>

            <p className={styles.panelDescription}>
              {copy.browserActionsDescription}
            </p>
          </div>

          <strong>{browserActions.length}</strong>
        </header>

        <div className={styles.historyFilters}>
          <label>
            <span>{copy.filterAction}</span>

            <select
              value={browserActionFilter}
              onChange={(event) =>
                setBrowserActionFilter(
                  event.target.value as
                    "ALL" | "PREPARE" | "PUBLISH" | "DISCARD",
                )
              }
            >
              <option value="ALL">{copy.filterAll}</option>

              <option value="PREPARE">{copy.actionPrepare}</option>

              <option value="PUBLISH">{copy.actionPublish}</option>

              <option value="DISCARD">{copy.actionDiscard}</option>
            </select>
          </label>

          <label>
            <span>{copy.filterStatus}</span>

            <select
              value={browserStatusFilter}
              onChange={(event) =>
                setBrowserStatusFilter(
                  event.target.value as
                    "ALL" | "PENDING" | "SUCCESS" | "FAILED",
                )
              }
            >
              <option value="ALL">{copy.filterAll}</option>

              <option value="PENDING">{copy.actionPending}</option>

              <option value="SUCCESS">{copy.actionSuccess}</option>

              <option value="FAILED">{copy.actionFailed}</option>
            </select>
          </label>
        </div>

        <div className={styles.browserHistoryList}>
          {groupBrowserActionsByFlow(filteredBrowserActions).flatMap(
            (group) => {
              const flowSummary = summarizeBrowserFlow(group);

              return group.items.map((item, itemIndex) => {
                const actionLabel =
                  item.action === "PREPARE"
                    ? copy.actionPrepare
                    : item.action === "PUBLISH"
                      ? copy.actionPublish
                      : copy.actionDiscard;

                const statusLabel =
                  item.status === "SUCCESS"
                    ? copy.actionSuccess
                    : item.status === "FAILED"
                      ? copy.actionFailed
                      : copy.actionPending;

                return (
                  <div key={item.id} className={styles.timelineStepWrapper}>
                    {group.flowId && itemIndex === 0 ? (
                      <div className={styles.timelineFlowHeader}>
                        <div>
                          <strong>{copy.browserFlow}</strong>

                          <small>{group.flowId.slice(0, 8)}</small>
                        </div>

                        <div className={styles.timelineFlowSummary}>
                          <span>
                            {group.items.length} {copy.flowSteps}
                          </span>

                          <span>
                            {copy.flowTotalDuration}:{" "}
                            {(flowSummary.totalDurationMs / 1000).toFixed(1)}s
                          </span>

                          <strong>
                            {flowSummary.status === "FAILED"
                              ? copy.flowFailed
                              : flowSummary.status === "SUCCESS"
                                ? copy.flowCompleted
                                : copy.flowInProgress}
                          </strong>

                          {flowSummary.verificationStatus === "CONFIRMED" ? (
                            <em>{copy.verificationConfirmed}</em>
                          ) : null}
                        </div>
                      </div>
                    ) : null}

                    {group.flowId && itemIndex > 0 ? (
                      <div
                        className={styles.timelineConnector}
                        aria-hidden="true"
                      >
                        <span>↓</span>
                      </div>
                    ) : null}

                    <article className={styles.browserHistoryItem}>
                      <div
                        className={`${styles.historyStatusDot} ${
                          item.status === "SUCCESS"
                            ? styles.historySuccess
                            : item.status === "FAILED"
                              ? styles.historyFailed
                              : styles.historyPending
                        }`}
                      />

                      <div className={styles.historyMain}>
                        <div className={styles.historyTitleRow}>
                          <strong>{actionLabel}</strong>

                          <span>{item.channel.name}</span>
                        </div>

                        <div className={styles.historyMeta}>
                          <span>{statusLabel}</span>

                          <span>{formatDate(item.createdAt, locale)}</span>

                          {item.durationMs !== null ? (
                            <span>
                              {copy.duration}:{" "}
                              {(item.durationMs / 1000).toFixed(1)}s
                            </span>
                          ) : null}
                        </div>

                        <button
                          type="button"
                          className={styles.historyDetailsButton}
                          onClick={() => setSelectedBrowserHistoryItem(item)}
                        >
                          {copy.showDetails}
                        </button>

                        {item.status === "FAILED" &&
                        item.action === "PREPARE" ? (
                          <button
                            type="button"
                            className={styles.retryHistoryButton}
                            onClick={() => void retryBrowserAction(item)}
                            disabled={browserAction !== null}
                          >
                            {retryingBrowserActionId === item.id
                              ? copy.retryingAction
                              : copy.retryAction}
                          </button>
                        ) : null}

                        {item.action === "PUBLISH" &&
                        item.responsePayload?.verification?.status ? (
                          <div className={styles.publishVerificationRow}>
                            <span
                              className={`${styles.publishVerificationBadge} ${
                                item.responsePayload.verification.status ===
                                "CONFIRMED"
                                  ? styles.verificationConfirmed
                                  : item.responsePayload.verification.status ===
                                      "COMPOSER_CLOSED"
                                    ? styles.verificationComposerClosed
                                    : item.responsePayload.verification
                                          .status === "FAILED"
                                      ? styles.verificationFailed
                                      : styles.verificationUnconfirmed
                              }`}
                            >
                              {item.responsePayload.verification.status ===
                              "CONFIRMED"
                                ? copy.verificationConfirmed
                                : item.responsePayload.verification.status ===
                                    "COMPOSER_CLOSED"
                                  ? copy.verificationComposerClosed
                                  : item.responsePayload.verification.status ===
                                      "FAILED"
                                    ? copy.verificationFailed
                                    : copy.verificationUnconfirmed}
                            </span>

                            {typeof item.responsePayload.verification
                              .waitedMs === "number" ? (
                              <small>
                                {copy.verificationWaited}:{" "}
                                {(
                                  item.responsePayload.verification.waitedMs /
                                  1000
                                ).toFixed(1)}
                                s
                              </small>
                            ) : null}
                          </div>
                        ) : null}

                        {item.responsePayload?.screenshot?.absolutePath ||
                        item.responsePayload?.screenshots?.before
                          ?.absolutePath ||
                        item.responsePayload?.screenshots?.after
                          ?.absolutePath ? (
                          <div className={styles.historyScreenshotActions}>
                            {item.responsePayload?.screenshot?.absolutePath ? (
                              <a
                                href={browserActionScreenshotUrl(item.id)}
                                target="_blank"
                                rel="noreferrer"
                              >
                                {copy.viewScreenshot}
                              </a>
                            ) : null}

                            {item.responsePayload?.screenshots?.before
                              ?.absolutePath ? (
                              <a
                                href={browserActionScreenshotUrl(
                                  item.id,
                                  "before",
                                )}
                                target="_blank"
                                rel="noreferrer"
                              >
                                {copy.viewBeforeScreenshot}
                              </a>
                            ) : null}

                            {item.responsePayload?.screenshots?.after
                              ?.absolutePath ? (
                              <a
                                href={browserActionScreenshotUrl(
                                  item.id,
                                  "after",
                                )}
                                target="_blank"
                                rel="noreferrer"
                              >
                                {copy.viewAfterScreenshot}
                              </a>
                            ) : null}
                          </div>
                        ) : null}

                        {item.caption ? (
                          <p className={styles.historyCaption}>
                            {item.caption}
                          </p>
                        ) : null}

                        {item.imagePath ? (
                          <small className={styles.historyPath}>
                            {copy.imagePath}: {item.imagePath}
                          </small>
                        ) : null}

                        {item.errorMessage ? (
                          <small className={styles.historyError}>
                            {item.errorMessage}
                          </small>
                        ) : null}
                      </div>
                    </article>
                  </div>
                );
              });
            },
          )}

          {!filteredBrowserActions.length && !browserActionsLoading ? (
            <div className={styles.historyEmpty}>{copy.noBrowserActions}</div>
          ) : null}

          {browserActionsLoading ? (
            <div className={styles.historyEmpty}>{copy.loading}</div>
          ) : null}
        </div>
      </section>

      {selectedBrowserHistoryItem ? (
        <div
          className={styles.historyModalOverlay}
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              setSelectedBrowserHistoryItem(null);
            }
          }}
        >
          <div
            className={styles.historyModal}
            role="dialog"
            aria-modal="true"
            aria-labelledby="browser-history-dialog-title"
          >
            <header className={styles.historyModalHeader}>
              <div>
                <p className={styles.eyebrow}>Browser History</p>

                <h3 id="browser-history-dialog-title">
                  {copy.historyDetailsTitle}
                </h3>
              </div>

              <button
                type="button"
                className={styles.historyModalClose}
                onClick={() => setSelectedBrowserHistoryItem(null)}
                aria-label={copy.closeDetails}
              >
                ×
              </button>
            </header>

            <div className={styles.historyModalSummary}>
              <dl>
                <div>
                  <dt>{copy.actionId}</dt>
                  <dd>{selectedBrowserHistoryItem.id}</dd>
                </div>

                <div>
                  <dt>{copy.channelName}</dt>
                  <dd>{selectedBrowserHistoryItem.channel.name}</dd>
                </div>

                <div>
                  <dt>{copy.actionType}</dt>
                  <dd>{selectedBrowserHistoryItem.action}</dd>
                </div>

                <div>
                  <dt>{copy.resultStatus}</dt>
                  <dd>{selectedBrowserHistoryItem.status}</dd>
                </div>

                <div>
                  <dt>{copy.startedAt}</dt>
                  <dd>
                    {formatDate(selectedBrowserHistoryItem.startedAt, locale)}
                  </dd>
                </div>

                <div>
                  <dt>{copy.completedAt}</dt>
                  <dd>
                    {selectedBrowserHistoryItem.completedAt
                      ? formatDate(
                          selectedBrowserHistoryItem.completedAt,
                          locale,
                        )
                      : "-"}
                  </dd>
                </div>

                <div>
                  <dt>{copy.duration}</dt>
                  <dd>
                    {selectedBrowserHistoryItem.durationMs !== null
                      ? `${(
                          selectedBrowserHistoryItem.durationMs / 1000
                        ).toFixed(1)}s`
                      : "-"}
                  </dd>
                </div>

                <div>
                  <dt>{copy.browserProfile}</dt>
                  <dd>{selectedBrowserHistoryItem.browserProfileKey || "-"}</dd>
                </div>
              </dl>
            </div>

            {selectedBrowserHistoryItem.caption ? (
              <section className={styles.historyModalSection}>
                <strong>{copy.viewCaption}</strong>
                <p>{selectedBrowserHistoryItem.caption}</p>
              </section>
            ) : null}

            {selectedBrowserHistoryItem.errorMessage ? (
              <section className={styles.historyModalSection}>
                <strong>{copy.errorDetails}</strong>
                <p className={styles.historyModalError}>
                  {selectedBrowserHistoryItem.errorMessage}
                </p>
              </section>
            ) : null}

            {selectedBrowserHistoryItem.action === "PREPARE" ? (
              <button
                type="button"
                className={styles.replayBrowserActionButton}
                disabled={
                  replayingBrowserActionId === selectedBrowserHistoryItem.id
                }
                onClick={() =>
                  void replayBrowserAction(selectedBrowserHistoryItem.id)
                }
              >
                {replayingBrowserActionId === selectedBrowserHistoryItem.id
                  ? "Replaying..."
                  : "Replay PREPARE"}
              </button>
            ) : null}

            {(selectedBrowserHistoryItem.traces || []).length ? (
              <section className={styles.historyModalSection}>
                <div className={styles.traceDiagnostics}>
                  <div className={styles.traceDiagnosticsHeader}>
                    <strong>Trace Diagnostics</strong>

                    <span>
                      {
                        analyzeBrowserTrace(
                          selectedBrowserHistoryItem.traces || [],
                        ).length
                      }{" "}
                      findings
                    </span>
                  </div>

                  <div className={styles.traceDiagnosticsList}>
                    {analyzeBrowserTrace(
                      selectedBrowserHistoryItem.traces || [],
                    ).map((diagnostic, diagnosticIndex) => (
                      <div
                        key={`${diagnostic.stepKey || "flow"}-${diagnosticIndex}`}
                        className={`${styles.traceDiagnosticItem} ${
                          diagnostic.severity === "CRITICAL"
                            ? styles.traceDiagnosticCritical
                            : diagnostic.severity === "WARNING"
                              ? styles.traceDiagnosticWarning
                              : diagnostic.severity === "HEALTHY"
                                ? styles.traceDiagnosticHealthy
                                : styles.traceDiagnosticInfo
                        }`}
                      >
                        <span
                          className={styles.traceDiagnosticIcon}
                          aria-hidden="true"
                        >
                          {diagnostic.severity === "CRITICAL"
                            ? "×"
                            : diagnostic.severity === "WARNING"
                              ? "!"
                              : diagnostic.severity === "HEALTHY"
                                ? "✓"
                                : "i"}
                        </span>

                        <div>
                          <strong>{diagnostic.title}</strong>

                          <p>{diagnostic.message}</p>

                          {diagnostic.stepKey ? (
                            <code>{diagnostic.stepKey}</code>
                          ) : null}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                <div className={styles.executionTraceHeader}>
                  <strong>Execution Trace</strong>

                  <span>{selectedBrowserHistoryItem.traces?.length} steps</span>
                </div>

                <div className={styles.executionTraceList}>
                  {(selectedBrowserHistoryItem.traces || []).map((trace) => (
                    <div key={trace.id} className={styles.executionTraceStep}>
                      <div className={styles.executionTraceRail}>
                        <span
                          className={
                            trace.status === "SUCCESS"
                              ? styles.executionTraceSuccess
                              : trace.status === "FAILED"
                                ? styles.executionTraceFailed
                                : trace.status === "SKIPPED"
                                  ? styles.executionTraceSkipped
                                  : styles.executionTracePending
                          }
                        >
                          {trace.status === "SUCCESS"
                            ? "✓"
                            : trace.status === "FAILED"
                              ? "×"
                              : trace.status === "SKIPPED"
                                ? "–"
                                : "•"}
                        </span>
                      </div>

                      <div className={styles.executionTraceContent}>
                        <div className={styles.executionTraceTitle}>
                          <div>
                            <strong>{trace.stepName}</strong>

                            <code>{trace.stepKey}</code>
                          </div>

                          <span>{formatTraceDuration(trace.durationMs)}</span>
                        </div>

                        <div className={styles.executionTraceMeta}>
                          <span>Step {trace.stepOrder}</span>

                          <span>{trace.status}</span>
                        </div>

                        {trace.errorMessage ? (
                          <p className={styles.executionTraceError}>
                            {trace.errorMessage}
                          </p>
                        ) : null}
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            ) : null}

            {selectedBrowserHistoryItem.responsePayload?.screenshot
              ?.absolutePath ||
            selectedBrowserHistoryItem.responsePayload?.screenshots?.before
              ?.absolutePath ||
            selectedBrowserHistoryItem.responsePayload?.screenshots?.after
              ?.absolutePath ? (
              <section className={styles.historyModalSection}>
                <strong>{copy.screenshotPreview}</strong>

                <div className={styles.historyModalScreenshots}>
                  {selectedBrowserHistoryItem.responsePayload?.screenshot
                    ?.absolutePath ? (
                    <a
                      href={browserActionScreenshotUrl(
                        selectedBrowserHistoryItem.id,
                      )}
                      target="_blank"
                      rel="noreferrer"
                    >
                      <RuntimeImage
                        src={browserActionScreenshotUrl(
                          selectedBrowserHistoryItem.id,
                        )}
                        alt={copy.viewScreenshot}
                      />
                      <span>{copy.viewScreenshot}</span>
                    </a>
                  ) : null}

                  {selectedBrowserHistoryItem.responsePayload?.screenshots
                    ?.before?.absolutePath ? (
                    <a
                      href={browserActionScreenshotUrl(
                        selectedBrowserHistoryItem.id,
                        "before",
                      )}
                      target="_blank"
                      rel="noreferrer"
                    >
                      <RuntimeImage
                        src={browserActionScreenshotUrl(
                          selectedBrowserHistoryItem.id,
                          "before",
                        )}
                        alt={copy.viewBeforeScreenshot}
                      />
                      <span>{copy.viewBeforeScreenshot}</span>
                    </a>
                  ) : null}

                  {selectedBrowserHistoryItem.responsePayload?.screenshots
                    ?.after?.absolutePath ? (
                    <a
                      href={browserActionScreenshotUrl(
                        selectedBrowserHistoryItem.id,
                        "after",
                      )}
                      target="_blank"
                      rel="noreferrer"
                    >
                      <RuntimeImage
                        src={browserActionScreenshotUrl(
                          selectedBrowserHistoryItem.id,
                          "after",
                        )}
                        alt={copy.viewAfterScreenshot}
                      />
                      <span>{copy.viewAfterScreenshot}</span>
                    </a>
                  ) : null}
                </div>
              </section>
            ) : null}

            {selectedBrowserHistoryItem.responsePayload ? (
              <section className={styles.historyModalSection}>
                <strong>{copy.responseDetails}</strong>

                <pre className={styles.historyModalPayload}>
                  {JSON.stringify(
                    selectedBrowserHistoryItem.responsePayload,
                    null,
                    2,
                  )}
                </pre>
              </section>
            ) : null}

            <footer className={styles.historyModalFooter}>
              <button
                type="button"
                className={styles.secondaryButton}
                onClick={() => setSelectedBrowserHistoryItem(null)}
              >
                {copy.closeDetails}
              </button>
            </footer>
          </div>
        </div>
      ) : null}

      {discardConfirmOpen ? (
        <div className={styles.confirmOverlay} role="presentation">
          <div className={styles.confirmDialog} role="dialog" aria-modal="true">
            <h3>{copy.discardConfirmTitle}</h3>

            <p>{copy.discardConfirmText}</p>

            <div className={styles.confirmActions}>
              <button
                type="button"
                className={styles.secondaryButton}
                onClick={() => setDiscardConfirmOpen(false)}
              >
                {copy.cancelPublish}
              </button>

              <button
                type="button"
                className={styles.confirmDiscardButton}
                onClick={() => void discardBrowserDraft()}
              >
                {copy.confirmDiscard}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {publishConfirmOpen ? (
        <div className={styles.confirmOverlay} role="presentation">
          <div className={styles.confirmDialog} role="dialog" aria-modal="true">
            <h3>{copy.publishConfirmTitle}</h3>

            <p>{copy.publishConfirmText}</p>

            <div className={styles.confirmActions}>
              <button
                type="button"
                className={styles.secondaryButton}
                onClick={() => setPublishConfirmOpen(false)}
              >
                {copy.cancelPublish}
              </button>

              <button
                type="button"
                className={styles.confirmPublishButton}
                onClick={() => void publishBrowserDraft()}
              >
                {copy.confirmPublish}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <section className={styles.panel} id="upcoming-posts">
        <header>
          <div>
            <p className={styles.eyebrow}>Schedule</p>
            <h2>{copy.upcomingPosts}</h2>
          </div>

          <strong>{dashboard.upcoming.length}</strong>
        </header>

        <div className={styles.tableWrap}>
          <table>
            <thead>
              <tr>
                <th>{copy.platform}</th>
                <th>{copy.content}</th>
                <th>{copy.campaign}</th>
                <th>{copy.status}</th>
                <th>{copy.scheduledTime}</th>
              </tr>
            </thead>

            <tbody>
              {dashboard.upcoming.map((post) => (
                <tr key={post.id}>
                  <td data-label={copy.platform}>
                    <span className={styles.platformBadge}>
                      {platformLabel(post.platform)}
                    </span>
                  </td>

                  <td data-label={copy.content}>
                    <div className={styles.contentCell}>
                      <strong>{post.title || copy.untitled}</strong>
                      <span>{post.content}</span>
                    </div>
                  </td>

                  <td data-label={copy.campaign}>
                    {post.campaign?.name || "—"}
                  </td>

                  <td data-label={copy.status}>{post.status}</td>

                  <td data-label={copy.scheduledTime}>
                    {formatDate(post.scheduledAt, locale)}
                  </td>
                </tr>
              ))}

              {!dashboard.upcoming.length ? (
                <tr>
                  <td colSpan={5} className={styles.empty}>
                    No posts scheduled yet.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
