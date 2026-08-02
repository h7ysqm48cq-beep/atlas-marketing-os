"use client";

import { useCallback, useEffect, useState } from "react";
import styles from "./AutomationDashboard.module.css";
import { usePreferences } from "@/components/preferences";

import { API_URL } from "@/lib/api";
type Channel = {
  id: string;
  platform: "FACEBOOK" | "TELEGRAM";
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
  platform: "FACEBOOK" | "TELEGRAM";
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

type BrowserActionHistoryItem = {
  id: string;
  flowId: string | null;
  action:
    | "PREPARE"
    | "PUBLISH"
    | "DISCARD";
  status:
    | "PENDING"
    | "SUCCESS"
    | "FAILED";
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
      status?:
        | "CONFIRMED"
        | "COMPOSER_CLOSED"
        | "UNCONFIRMED"
        | "FAILED";
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

function platformLabel(platform: string) {
  return platform === "FACEBOOK" ? "Facebook" : "Telegram";
}

function browserActionScreenshotUrl(
  actionId: string,
  variant?:
    | "before"
    | "after",
) {
  const base =
    `${API_URL}/automation/browser-actions/${actionId}/screenshot`;

  return variant
    ? `${base}?variant=${variant}`
    : base;
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
  const grouped =
    new Map<
      string,
      BrowserActionTimelineGroup
    >();

  for (const item of items) {
    const key =
      item.flowId
        ? `flow:${item.flowId}`
        : `single:${item.id}`;

    const existing =
      grouped.get(key);

    if (existing) {
      existing.items.push(item);

      if (
        new Date(item.createdAt).getTime() <
        new Date(
          existing.createdAt,
        ).getTime()
      ) {
        existing.createdAt =
          item.createdAt;
      }

      continue;
    }

    grouped.set(key, {
      id: key,
      flowId:
        item.flowId,
      items: [item],
      createdAt:
        item.createdAt,
    });
  }

  return Array.from(
    grouped.values(),
  )
    .map((group) => ({
      ...group,
      items: [...group.items].sort(
        (left, right) =>
          new Date(
            left.createdAt,
          ).getTime() -
          new Date(
            right.createdAt,
          ).getTime(),
      ),
    }))
    .sort(
      (left, right) =>
        new Date(
          right.createdAt,
        ).getTime() -
        new Date(
          left.createdAt,
        ).getTime(),
    );
}

export function AutomationDashboard() {
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
          description: "管理 Facebook 与 Telegram 渠道、发布队列和排程帖子。",
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
          browserDraft: "Facebook 浏览器草稿",
          browserDraftDescription:
            "在你的 Mac 浏览器中准备文案与图片，停在发布前供人工确认。",
          facebookChannel: "Facebook 渠道",
          captionLabel: "文案",
          captionPlaceholder: "输入要放入 Facebook 帖子的文案……",
          imagePathLabel: "Mac 图片路径",
          imagePathPlaceholder:
            "/Users/your-name/Downloads/image.png",
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
          noFacebookChannel: "没有可用的 Facebook 渠道。",
          screenshotPreview: "草稿预览",
          localPathHint:
            "当前版本使用 Browser Worker 所在 Mac 的本地文件路径。",
          publishPost: "发布帖子",
          publishingPost: "正在发布……",
          publishConfirmTitle: "确认发布 Facebook 帖子？",
          publishConfirmText:
            "这会真实点击 Facebook 的 Post 按钮并立即发布。",
          cancelPublish: "取消",
          confirmPublish: "确认发布",
          publishedSuccessfully: "Facebook 帖子已成功发布。",
          publishFailed: "无法发布 Facebook 帖子。",
          discardDraft: "取消草稿",
          discardingDraft: "正在取消……",
          discardConfirmTitle: "确认取消当前草稿？",
          discardConfirmText:
            "当前 Facebook Composer 中的文案和图片将被清除。",
          confirmDiscard: "确认取消",
          discardedSuccessfully: "Facebook 草稿已取消。",
          discardFailed: "无法取消 Facebook 草稿。",
          recentBrowserActions: "最近 Browser Agent 操作",
          browserActionsDescription:
            "查看草稿准备、发布、取消与失败记录。",
          noBrowserActions: "暂时没有 Browser Agent 操作记录。",
          actionPrepare: "准备草稿",
          actionPublish: "发布帖子",
          actionDiscard: "取消草稿",
          actionPending: "处理中",
          actionSuccess: "成功",
          actionFailed: "失败",
          retryAction: "重新尝试",
          retryingAction: "正在重试……",
          retrySucceeded:
            "失败操作已重新准备为草稿，请检查浏览器。",
          retryFailed:
            "无法重新尝试这个 Browser Agent 操作。",
          openBrowserBeforeRetry:
            "请先打开对应的浏览器，再重新尝试。",
          duration: "耗时",
          viewCaption: "文案",
          imagePath: "图片路径",
          verificationConfirmed: "发布已确认",
          verificationComposerClosed:
            "Composer 已关闭",
          verificationUnconfirmed:
            "发布状态未确认",
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
            "Manage Facebook and Telegram channels, publishing queue and scheduled posts.",
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
          browserDraft: "Facebook Browser Draft",
          browserDraftDescription:
            "Prepare a caption and image in your Mac browser, then stop before publishing for manual review.",
          facebookChannel: "Facebook channel",
          captionLabel: "Caption",
          captionPlaceholder:
            "Enter the Facebook post caption...",
          imagePathLabel: "Mac image path",
          imagePathPlaceholder:
            "/Users/your-name/Downloads/image.png",
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
          draftReady:
            "Draft is ready. Review it in the browser.",
          browserDraftFailed:
            "Unable to prepare browser draft.",
          noFacebookChannel:
            "No Facebook channel is available.",
          screenshotPreview: "Draft preview",
          localPathHint:
            "This version uses a local file path on the Mac running Browser Worker.",
          publishPost: "Publish post",
          publishingPost: "Publishing...",
          publishConfirmTitle:
            "Publish this Facebook post?",
          publishConfirmText:
            "This will click Facebook's Post button and publish the post immediately.",
          cancelPublish: "Cancel",
          confirmPublish: "Confirm publish",
          publishedSuccessfully:
            "Facebook post published successfully.",
          publishFailed:
            "Unable to publish Facebook post.",
          discardDraft: "Discard draft",
          discardingDraft: "Discarding...",
          discardConfirmTitle:
            "Discard the current draft?",
          discardConfirmText:
            "The caption and image in the Facebook Composer will be cleared.",
          confirmDiscard: "Confirm discard",
          discardedSuccessfully:
            "Facebook draft discarded.",
          discardFailed:
            "Unable to discard Facebook draft.",
          recentBrowserActions:
            "Recent Browser Agent actions",
          browserActionsDescription:
            "Review draft preparation, publishing, discard and failure records.",
          noBrowserActions:
            "No Browser Agent actions yet.",
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
          retryFailed:
            "Unable to retry this Browser Agent action.",
          openBrowserBeforeRetry:
            "Open the corresponding browser before retrying.",
          duration: "Duration",
          viewCaption: "Caption",
          imagePath: "Image path",
          verificationConfirmed:
            "Publish confirmed",
          verificationComposerClosed:
            "Composer closed",
          verificationUnconfirmed:
            "Publish unconfirmed",
          verificationFailed:
            "Verification failed",
          verificationWaited:
            "Verification time",
          viewScreenshot: "View screenshot",
          viewBeforeScreenshot:
            "Before publish",
          viewAfterScreenshot:
            "After publish",
          filterAll: "All",
          filterAction: "Action",
          filterStatus: "Status",
          showDetails: "Show details",
          hideDetails: "Hide details",
          historyDetailsTitle:
            "Browser Agent action details",
          closeDetails: "Close",
          actionId: "Action ID",
          channelName: "Channel",
          actionType: "Action",
          resultStatus: "Result",
          browserFlow: "Browser flow",
          flowSteps: "steps",
          startedAt: "Started",
          completedAt: "Completed",
          browserProfile: "Browser profile",
          errorDetails: "Error details",
          responseDetails: "Response details",
        };

  const locale = language === "zh" ? "zh-CN" : "en-MY";

  const [dashboard, setDashboard] = useState<DashboardResponse | null>(null);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [
    selectedFacebookChannelId,
    setSelectedFacebookChannelId,
  ] = useState("");

  const [browserCaption, setBrowserCaption] =
    useState("");

  const [browserImagePath, setBrowserImagePath] =
    useState("");

  const [browserRunning, setBrowserRunning] =
    useState(false);

  const [browserAction, setBrowserAction] =
    useState<
      | "open"
      | "status"
      | "close"
      | "prepare"
      | "publish"
      | "discard"
      | "retry"
      | null
    >(null);

  const [browserMessage, setBrowserMessage] =
    useState("");

  const [browserError, setBrowserError] =
    useState("");

  const [draftScreenshot, setDraftScreenshot] =
    useState<string | null>(null);

  const [draftReady, setDraftReady] =
    useState(false);

  const [publishConfirmOpen, setPublishConfirmOpen] =
    useState(false);

  const [discardConfirmOpen, setDiscardConfirmOpen] =
    useState(false);

  const [
    browserActions,
    setBrowserActions,
  ] = useState<
    BrowserActionHistoryItem[]
  >([]);

  const [
    browserActionsLoading,
    setBrowserActionsLoading,
  ] = useState(false);

  const [
    retryingBrowserActionId,
    setRetryingBrowserActionId,
  ] = useState<string | null>(null);

  const [
    browserActionFilter,
    setBrowserActionFilter,
  ] = useState<
    | "ALL"
    | "PREPARE"
    | "PUBLISH"
    | "DISCARD"
  >("ALL");

  const [
    browserStatusFilter,
    setBrowserStatusFilter,
  ] = useState<
    | "ALL"
    | "PENDING"
    | "SUCCESS"
    | "FAILED"
  >("ALL");

  const [
    expandedBrowserActionId,
    setExpandedBrowserActionId,
  ] = useState<string | null>(null);

  const [
    selectedBrowserHistoryItem,
    setSelectedBrowserHistoryItem,
  ] = useState<
    BrowserActionHistoryItem | null
  >(null);

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
  }, []);

  async function loadBrowserActions() {
    setBrowserActionsLoading(true);

    try {
      const response = await fetch(
        `${API_URL}/automation/browser-actions?limit=20`,
        {
          cache: "no-store",
        },
      );

      if (!response.ok) {
        throw new Error(
          copy.loadFailed,
        );
      }

      const body =
        (await response.json()) as
          BrowserActionHistoryItem[];

      setBrowserActions(body);
    } catch (loadError) {
      console.error(
        "Unable to load Browser Agent history:",
        loadError,
      );
      setBrowserActions([]);
    } finally {
      setBrowserActionsLoading(false);
    }
  }

  useEffect(() => {
    void load();
    void loadBrowserActions();
  }, [load]);

  useEffect(() => {
    if (
      selectedFacebookChannelId ||
      !dashboard
    ) {
      return;
    }

    const facebookChannel =
      dashboard.channels.find(
        (channel) =>
          channel.platform === "FACEBOOK",
      );

    if (facebookChannel) {
      setSelectedFacebookChannelId(
        facebookChannel.id,
      );
    }
  }, [
    dashboard,
    selectedFacebookChannelId,
  ]);

  async function openBrowser() {
    if (!selectedFacebookChannelId) {
      setBrowserError(
        copy.noFacebookChannel,
      );
      return;
    }

    setBrowserAction("open");
    setBrowserError("");
    setBrowserMessage("");

    try {
      const response = await fetch(
        `${API_URL}/automation/channels/${selectedFacebookChannelId}/browser/open`,
        {
          method: "POST",
          headers: {
            "Content-Type":
              "application/json",
          },
          body: JSON.stringify({
            headless: false,
            startUrl:
              "https://www.facebook.com/",
          }),
        },
      );

      const body =
        (await response.json()) as {
          opened?: boolean;
          alreadyRunning?: boolean;
          message?: string;
        };

      if (!response.ok) {
        throw new Error(
          body.message ||
            copy.browserDraftFailed,
        );
      }

      setBrowserRunning(true);
      setBrowserMessage(
        copy.browserRunning,
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

  async function checkBrowserStatus() {
    if (!selectedFacebookChannelId) {
      return;
    }

    setBrowserAction("status");
    setBrowserError("");

    try {
      const response = await fetch(
        `${API_URL}/automation/channels/${selectedFacebookChannelId}/browser/status`,
        {
          cache: "no-store",
        },
      );

      const body =
        (await response.json()) as
          BrowserStatusResponse;

      if (!response.ok) {
        throw new Error(
          copy.browserDraftFailed,
        );
      }

      setBrowserRunning(
        Boolean(body.running),
      );

      setBrowserMessage(
        body.running
          ? copy.browserRunning
          : copy.browserStopped,
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
    if (!selectedFacebookChannelId) {
      return;
    }

    setBrowserAction("close");
    setBrowserError("");
    setBrowserMessage("");

    try {
      const response = await fetch(
        `${API_URL}/automation/channels/${selectedFacebookChannelId}/browser/close`,
        {
          method: "POST",
        },
      );

      const body =
        (await response.json()) as {
          message?: string;
        };

      if (!response.ok) {
        throw new Error(
          body.message ||
            copy.browserDraftFailed,
        );
      }

      setBrowserRunning(false);
      setBrowserMessage(
        copy.browserStopped,
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

  async function retryBrowserAction(
    item: BrowserActionHistoryItem,
  ) {
    if (
      item.status !== "FAILED" ||
      item.action !== "PREPARE"
    ) {
      return;
    }

    setBrowserAction("retry");
    setRetryingBrowserActionId(item.id);
    setBrowserError("");
    setBrowserMessage("");
    setDraftReady(false);

    try {
      const response = await fetch(
        `${API_URL}/automation/browser-actions/${item.id}/retry`,
        {
          method: "POST",
        },
      );

      const body =
        (await response.json()) as {
          success?: boolean;
          retried?: boolean;
          message?: string;
          result?: BrowserDraftResponse;
        };

      if (
        !response.ok ||
        !body.success ||
        !body.retried
      ) {
        if (
          body.message ===
          "Browser profile is not running."
        ) {
          throw new Error(
            copy.openBrowserBeforeRetry,
          );
        }

        throw new Error(
          body.message ||
            copy.retryFailed,
        );
      }

      const result =
        body.result;

      if (
        result?.screenshot?.base64 &&
        result.screenshot.mimeType
      ) {
        setDraftScreenshot(
          `data:${result.screenshot.mimeType};base64,${result.screenshot.base64}`,
        );
      }

      setSelectedFacebookChannelId(
        item.channel.id,
      );

      setBrowserCaption(
        item.caption || "",
      );

      setBrowserImagePath(
        item.imagePath || "",
      );

      setBrowserRunning(true);
      setDraftReady(true);

      setBrowserMessage(
        copy.retrySucceeded,
      );
    } catch (actionError) {
      setBrowserError(
        actionError instanceof Error
          ? actionError.message
          : copy.retryFailed,
      );
    } finally {
      setBrowserAction(null);
      setRetryingBrowserActionId(null);
      void loadBrowserActions();
    }
  }


  async function prepareBrowserDraft() {
    if (
      !selectedFacebookChannelId ||
      !browserCaption.trim()
    ) {
      setBrowserError(
        copy.browserDraftFailed,
      );
      return;
    }

    setBrowserAction("prepare");
    setBrowserError("");
    setBrowserMessage("");
    setDraftScreenshot(null);
    setDraftReady(false);

    try {
      const response = await fetch(
        `${API_URL}/automation/channels/${selectedFacebookChannelId}/browser/facebook/prepare-post`,
        {
          method: "POST",
          headers: {
            "Content-Type":
              "application/json",
          },
          body: JSON.stringify({
            caption:
              browserCaption.trim(),
            imagePath:
              browserImagePath.trim() ||
              null,
          }),
        },
      );

      const body =
        (await response.json()) as
          BrowserDraftResponse;

      if (
        !response.ok ||
        !body.success
      ) {
        throw new Error(
          body.message ||
            copy.browserDraftFailed,
        );
      }

      const encoded =
        body.screenshot?.base64;

      if (
        encoded &&
        body.screenshot?.mimeType
      ) {
        setDraftScreenshot(
          `data:${body.screenshot.mimeType};base64,${encoded}`,
        );
      }

      setBrowserRunning(true);
      setBrowserMessage(
        copy.draftReady,
      );

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
    if (
      !selectedFacebookChannelId ||
      !draftReady
    ) {
      return;
    }

    setBrowserAction("discard");
    setBrowserError("");
    setBrowserMessage("");
    setDiscardConfirmOpen(false);

    try {
      const response = await fetch(
        `${API_URL}/automation/channels/${selectedFacebookChannelId}/browser/facebook/discard-post`,
        {
          method: "POST",
        },
      );

      const body =
        (await response.json()) as {
          success?: boolean;
          discarded?: boolean;
          message?: string;
          screenshot?: {
            mimeType?: string;
            base64?: string;
          };
        };

      if (
        !response.ok ||
        !body.success
      ) {
        throw new Error(
          body.message ||
            copy.discardFailed,
        );
      }

      if (
        body.screenshot?.base64 &&
        body.screenshot.mimeType
      ) {
        setDraftScreenshot(
          `data:${body.screenshot.mimeType};base64,${body.screenshot.base64}`,
        );
      }

      setDraftReady(false);
      setBrowserCaption("");
      setBrowserImagePath("");

      setBrowserMessage(
        copy.discardedSuccessfully,
      );
    } catch (actionError) {
      setBrowserError(
        actionError instanceof Error
          ? actionError.message
          : copy.discardFailed,
      );
    } finally {
      setBrowserAction(null);
      void loadBrowserActions();
    }
  }


  async function publishBrowserDraft() {
    if (
      !selectedFacebookChannelId ||
      !draftReady
    ) {
      return;
    }

    setBrowserAction("publish");
    setBrowserError("");
    setBrowserMessage("");
    setPublishConfirmOpen(false);

    try {
      const response = await fetch(
        `${API_URL}/automation/channels/${selectedFacebookChannelId}/browser/facebook/publish-post`,
        {
          method: "POST",
          headers: {
            "Content-Type":
              "application/json",
          },
          body: JSON.stringify({
            confirmation:
              "PUBLISH",
          }),
        },
      );

      const body =
        (await response.json()) as {
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

      if (
        !response.ok ||
        !body.success ||
        !body.published
      ) {
        throw new Error(
          body.message ||
            copy.publishFailed,
        );
      }

      const after =
        body.screenshots?.after;

      if (
        after?.base64 &&
        after.mimeType
      ) {
        setDraftScreenshot(
          `data:${after.mimeType};base64,${after.base64}`,
        );
      }

      setDraftReady(false);
      setBrowserMessage(
        copy.publishedSuccessfully,
      );
    } catch (actionError) {
      setBrowserError(
        actionError instanceof Error
          ? actionError.message
          : copy.publishFailed,
      );
    } finally {
      setBrowserAction(null);
      void loadBrowserActions();
    }
  }

  const filteredBrowserActions =
    browserActions.filter(
      (item) => {
        const actionMatches =
          browserActionFilter === "ALL" ||
          item.action ===
            browserActionFilter;




        const statusMatches =
          browserStatusFilter === "ALL" ||
          item.status ===
            browserStatusFilter;

        return (
          actionMatches &&
          statusMatches
        );
      },
    );

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

        <button onClick={() => {
              void load();
              void loadBrowserActions();
            }}>Try again</button>
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
        <article>
          <span>{copy.scheduled}</span>
          <strong>{counts.SCHEDULED ?? 0}</strong>
          <small>{copy.scheduledHint}</small>
        </article>

        <article>
          <span>{copy.queue}</span>
          <strong>{counts.QUEUED ?? 0}</strong>
          <small>{copy.queueHint}</small>
        </article>

        <article>
          <span>{copy.published}</span>
          <strong>{counts.PUBLISHED ?? 0}</strong>
          <small>{copy.publishedHint}</small>
        </article>

        <article>
          <span>{copy.failed}</span>
          <strong>{counts.FAILED ?? 0}</strong>
          <small>{copy.failedHint}</small>
        </article>
      </section>

      <section className={styles.contentGrid}>
        <article className={styles.panel}>
          <header>
            <div>
              <p className={styles.eyebrow}>Channels</p>
              <h2>{copy.connectedPlatforms}</h2>
            </div>

            <strong>{dashboard.channels.length}</strong>
          </header>

          <div className={styles.channelList}>
            {dashboard.channels.map((channel) => (
              <div className={styles.channelCard} key={channel.id}>
                <div
                  className={`${styles.channelIcon} ${
                    channel.platform === "FACEBOOK"
                      ? styles.facebook
                      : styles.telegram
                  }`}
                >
                  {channel.platform === "FACEBOOK" ? "f" : "✈"}
                </div>

                <div className={styles.channelMain}>
                  <strong>{channel.name}</strong>
                  <span>
                    {channel.username
                      ? `@${channel.username}`
                      : copy.noUsername}
                  </span>
                </div>

                <div className={styles.channelMeta}>
                  <span
                    className={`${styles.statusBadge} ${
                      channel.status === "CONNECTED"
                        ? styles.connected
                        : styles.disconnected
                    }`}
                  >
                    {channel.status}
                  </span>

                  <small>
                    {channel._count.scheduledPosts} {copy.posts}
                  </small>
                </div>
              </div>
            ))}
          </div>
        </article>

        <article className={styles.panel}>
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
        className={`${styles.panel} ${styles.browserDraftPanel}`}
      >
        <header>
          <div>
            <p className={styles.eyebrow}>
              Browser Agent
            </p>

            <h2>{copy.browserDraft}</h2>

            <p className={styles.panelDescription}>
              {copy.browserDraftDescription}
            </p>
          </div>

          <span
            className={`${styles.browserStatus} ${
              browserRunning
                ? styles.browserOnline
                : styles.browserOffline
            }`}
          >
            {browserRunning
              ? copy.browserRunning
              : copy.browserStopped}
          </span>
        </header>

        <div className={styles.browserDraftGrid}>
          <div className={styles.browserDraftForm}>
            <label>
              <span>{copy.facebookChannel}</span>

              <select
                value={selectedFacebookChannelId}
                onChange={(event) => {
                  setSelectedFacebookChannelId(
                    event.target.value,
                  );
                  setBrowserMessage("");
                  setBrowserError("");
                  setDraftScreenshot(null);
                }}
              >
                {dashboard.channels
                  .filter(
                    (channel) =>
                      channel.platform ===
                      "FACEBOOK",
                  )
                  .map((channel) => (
                    <option
                      key={channel.id}
                      value={channel.id}
                    >
                      {channel.name}
                    </option>
                  ))}
              </select>
            </label>

            <label>
              <span>{copy.captionLabel}</span>

              <textarea
                value={browserCaption}
                onChange={(event) =>
                  setBrowserCaption(
                    event.target.value,
                  )
                }
                placeholder={
                  copy.captionPlaceholder
                }
                rows={7}
              />

              <small>
                {browserCaption.length} / 10000
              </small>
            </label>

            <label>
              <span>{copy.imagePathLabel}</span>

              <input
                type="text"
                value={browserImagePath}
                onChange={(event) =>
                  setBrowserImagePath(
                    event.target.value,
                  )
                }
                placeholder={
                  copy.imagePathPlaceholder
                }
              />

              <small>{copy.localPathHint}</small>
            </label>

            <div className={styles.browserActions}>
              <button
                type="button"
                onClick={() =>
                  void openBrowser()
                }
                disabled={
                  browserAction !== null ||
                  !selectedFacebookChannelId
                }
              >
                {browserAction === "open"
                  ? copy.openingBrowser
                  : copy.openBrowser}
              </button>

              <button
                type="button"
                className={styles.secondaryButton}
                onClick={() =>
                  void checkBrowserStatus()
                }
                disabled={
                  browserAction !== null ||
                  !selectedFacebookChannelId
                }
              >
                {browserAction === "status"
                  ? copy.checkingStatus
                  : copy.checkStatus}
              </button>

              <button
                type="button"
                className={styles.secondaryButton}
                onClick={() =>
                  void closeBrowser()
                }
                disabled={
                  browserAction !== null ||
                  !selectedFacebookChannelId
                }
              >
                {browserAction === "close"
                  ? copy.closingBrowser
                  : copy.closeBrowser}
              </button>
            </div>

            <button
              type="button"
              className={styles.prepareDraftButton}
              onClick={() =>
                void prepareBrowserDraft()
              }
              disabled={
                browserAction !== null ||
                !selectedFacebookChannelId ||
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
              onClick={() =>
                setDiscardConfirmOpen(true)
              }
              disabled={
                browserAction !== null ||
                !draftReady
              }
            >
              {browserAction === "discard"
                ? copy.discardingDraft
                : copy.discardDraft}
            </button>

            <button
              type="button"
              className={styles.publishDraftButton}
              onClick={() =>
                setPublishConfirmOpen(true)
              }
              disabled={
                browserAction !== null ||
                !draftReady
              }
            >
              {browserAction === "prepare" &&
              draftReady
                ? copy.publishingPost
                : copy.publishPost}
            </button>

            {browserMessage ? (
              <div className={styles.browserSuccess}>
                {browserMessage}
              </div>
            ) : null}

            {browserError ? (
              <div className={styles.browserError}>
                {browserError}
              </div>
            ) : null}
          </div>

          <div className={styles.browserPreview}>
            <div className={styles.previewHeader}>
              <strong>{copy.screenshotPreview}</strong>
            </div>

            {draftScreenshot ? (
              <img
                src={draftScreenshot}
                alt={copy.screenshotPreview}
              />
            ) : (
              <div className={styles.previewEmpty}>
                <span>Facebook</span>
                <small>
                  {copy.browserDraftDescription}
                </small>
              </div>
            )}
          </div>
        </div>
      </section>

      <section className={styles.panel}>
        <header>
          <div>
            <p className={styles.eyebrow}>
              Browser History
            </p>

            <h2>
              {copy.recentBrowserActions}
            </h2>

            <p className={styles.panelDescription}>
              {copy.browserActionsDescription}
            </p>
          </div>

          <strong>
            {browserActions.length}
          </strong>
        </header>

        <div className={styles.historyFilters}>
          <label>
            <span>{copy.filterAction}</span>

            <select
              value={browserActionFilter}
              onChange={(event) =>
                setBrowserActionFilter(
                  event.target.value as
                    | "ALL"
                    | "PREPARE"
                    | "PUBLISH"
                    | "DISCARD",
                )
              }
            >
              <option value="ALL">
                {copy.filterAll}
              </option>

              <option value="PREPARE">
                {copy.actionPrepare}
              </option>

              <option value="PUBLISH">
                {copy.actionPublish}
              </option>

              <option value="DISCARD">
                {copy.actionDiscard}
              </option>
            </select>
          </label>

          <label>
            <span>{copy.filterStatus}</span>

            <select
              value={browserStatusFilter}
              onChange={(event) =>
                setBrowserStatusFilter(
                  event.target.value as
                    | "ALL"
                    | "PENDING"
                    | "SUCCESS"
                    | "FAILED",
                )
              }
            >
              <option value="ALL">
                {copy.filterAll}
              </option>

              <option value="PENDING">
                {copy.actionPending}
              </option>

              <option value="SUCCESS">
                {copy.actionSuccess}
              </option>

              <option value="FAILED">
                {copy.actionFailed}
              </option>
            </select>
          </label>
        </div>

        <div className={styles.browserHistoryList}>
          {groupBrowserActionsByFlow(
            filteredBrowserActions,
          ).flatMap((group) =>
            group.items.map(
              (item, itemIndex) => {
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
              <div
                key={item.id}
                className={
                  styles.timelineStepWrapper
                }
              >
                {group.flowId &&
                itemIndex === 0 ? (
                  <div
                    className={
                      styles.timelineFlowHeader
                    }
                  >
                    <div>
                      <strong>
                        {copy.browserFlow}
                      </strong>

                      <small>
                        {group.flowId.slice(
                          0,
                          8,
                        )}
                      </small>
                    </div>

                    <span>
                      {group.items.length}{" "}
                      {copy.flowSteps}
                    </span>
                  </div>
                ) : null}

                {group.flowId &&
                itemIndex > 0 ? (
                  <div
                    className={
                      styles.timelineConnector
                    }
                    aria-hidden="true"
                  >
                    <span>↓</span>
                  </div>
                ) : null}

                <article
                  className={
                    styles.browserHistoryItem
                  }
                >
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

                    <span>
                      {item.channel.name}
                    </span>
                  </div>

                  <div className={styles.historyMeta}>
                    <span>{statusLabel}</span>

                    <span>
                      {formatDate(
                        item.createdAt,
                        locale,
                      )}
                    </span>

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
                    onClick={() =>
                      setSelectedBrowserHistoryItem(
                        item,
                      )
                    }
                  >
                    {copy.showDetails}
                  </button>

                  {item.status === "FAILED" &&
                  item.action === "PREPARE" ? (
                    <button
                      type="button"
                      className={styles.retryHistoryButton}
                      onClick={() =>
                        void retryBrowserAction(
                          item,
                        )
                      }
                      disabled={
                        browserAction !== null
                      }
                    >
                      {retryingBrowserActionId ===
                      item.id
                        ? copy.retryingAction
                        : copy.retryAction}
                    </button>
                  ) : null}

                  {item.action === "PUBLISH" &&
                  item.responsePayload
                    ?.verification
                    ?.status ? (
                    <div
                      className={
                        styles.publishVerificationRow
                      }
                    >
                      <span
                        className={`${styles.publishVerificationBadge} ${
                          item.responsePayload
                            .verification
                            .status ===
                          "CONFIRMED"
                            ? styles.verificationConfirmed
                            : item.responsePayload
                                  .verification
                                  .status ===
                                "COMPOSER_CLOSED"
                              ? styles.verificationComposerClosed
                              : item.responsePayload
                                    .verification
                                    .status ===
                                  "FAILED"
                                ? styles.verificationFailed
                                : styles.verificationUnconfirmed
                        }`}
                      >
                        {item.responsePayload
                          .verification
                          .status ===
                        "CONFIRMED"
                          ? copy.verificationConfirmed
                          : item.responsePayload
                                .verification
                                .status ===
                              "COMPOSER_CLOSED"
                            ? copy.verificationComposerClosed
                            : item.responsePayload
                                  .verification
                                  .status ===
                                "FAILED"
                              ? copy.verificationFailed
                              : copy.verificationUnconfirmed}
                      </span>

                      {typeof item
                        .responsePayload
                        .verification
                        .waitedMs ===
                      "number" ? (
                        <small>
                          {copy.verificationWaited}:{" "}
                          {(
                            item
                              .responsePayload
                              .verification
                              .waitedMs /
                            1000
                          ).toFixed(1)}
                          s
                        </small>
                      ) : null}
                    </div>
                  ) : null}

                  {(
                    item.responsePayload
                      ?.screenshot
                      ?.absolutePath ||
                    item.responsePayload
                      ?.screenshots
                      ?.before
                      ?.absolutePath ||
                    item.responsePayload
                      ?.screenshots
                      ?.after
                      ?.absolutePath
                  ) ? (
                    <div
                      className={
                        styles.historyScreenshotActions
                      }
                    >
                      {item.responsePayload
                        ?.screenshot
                        ?.absolutePath ? (
                        <a
                          href={browserActionScreenshotUrl(
                            item.id,
                          )}
                          target="_blank"
                          rel="noreferrer"
                        >
                          {copy.viewScreenshot}
                        </a>
                      ) : null}

                      {item.responsePayload
                        ?.screenshots
                        ?.before
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

                      {item.responsePayload
                        ?.screenshots
                        ?.after
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
                      {copy.imagePath}:{" "}
                      {item.imagePath}
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
              },
            ),
          )}

          {!filteredBrowserActions.length &&
          !browserActionsLoading ? (
            <div className={styles.historyEmpty}>
              {copy.noBrowserActions}
            </div>
          ) : null}

          {browserActionsLoading ? (
            <div className={styles.historyEmpty}>
              {copy.loading}
            </div>
          ) : null}
        </div>
      </section>

      {selectedBrowserHistoryItem ? (
        <div
          className={styles.historyModalOverlay}
          role="presentation"
          onMouseDown={(event) => {
            if (
              event.target ===
              event.currentTarget
            ) {
              setSelectedBrowserHistoryItem(
                null,
              );
            }
          }}
        >
          <div
            className={styles.historyModal}
            role="dialog"
            aria-modal="true"
            aria-labelledby="browser-history-dialog-title"
          >
            <header
              className={styles.historyModalHeader}
            >
              <div>
                <p className={styles.eyebrow}>
                  Browser History
                </p>

                <h3
                  id="browser-history-dialog-title"
                >
                  {copy.historyDetailsTitle}
                </h3>
              </div>

              <button
                type="button"
                className={styles.historyModalClose}
                onClick={() =>
                  setSelectedBrowserHistoryItem(
                    null,
                  )
                }
                aria-label={copy.closeDetails}
              >
                ×
              </button>
            </header>

            <div
              className={styles.historyModalSummary}
            >
              <dl>
                <div>
                  <dt>{copy.actionId}</dt>
                  <dd>
                    {selectedBrowserHistoryItem.id}
                  </dd>
                </div>

                <div>
                  <dt>{copy.channelName}</dt>
                  <dd>
                    {
                      selectedBrowserHistoryItem
                        .channel.name
                    }
                  </dd>
                </div>

                <div>
                  <dt>{copy.actionType}</dt>
                  <dd>
                    {
                      selectedBrowserHistoryItem
                        .action
                    }
                  </dd>
                </div>

                <div>
                  <dt>{copy.resultStatus}</dt>
                  <dd>
                    {
                      selectedBrowserHistoryItem
                        .status
                    }
                  </dd>
                </div>

                <div>
                  <dt>{copy.startedAt}</dt>
                  <dd>
                    {formatDate(
                      selectedBrowserHistoryItem
                        .startedAt,
                      locale,
                    )}
                  </dd>
                </div>

                <div>
                  <dt>{copy.completedAt}</dt>
                  <dd>
                    {selectedBrowserHistoryItem
                      .completedAt
                      ? formatDate(
                          selectedBrowserHistoryItem
                            .completedAt,
                          locale,
                        )
                      : "-"}
                  </dd>
                </div>

                <div>
                  <dt>{copy.duration}</dt>
                  <dd>
                    {selectedBrowserHistoryItem
                      .durationMs !== null
                      ? `${(
                          selectedBrowserHistoryItem
                            .durationMs /
                          1000
                        ).toFixed(1)}s`
                      : "-"}
                  </dd>
                </div>

                <div>
                  <dt>{copy.browserProfile}</dt>
                  <dd>
                    {selectedBrowserHistoryItem
                      .browserProfileKey ||
                      "-"}
                  </dd>
                </div>
              </dl>
            </div>

            {selectedBrowserHistoryItem
              .caption ? (
              <section
                className={
                  styles.historyModalSection
                }
              >
                <strong>{copy.viewCaption}</strong>
                <p>
                  {
                    selectedBrowserHistoryItem
                      .caption
                  }
                </p>
              </section>
            ) : null}

            {selectedBrowserHistoryItem
              .errorMessage ? (
              <section
                className={
                  styles.historyModalSection
                }
              >
                <strong>
                  {copy.errorDetails}
                </strong>
                <p
                  className={
                    styles.historyModalError
                  }
                >
                  {
                    selectedBrowserHistoryItem
                      .errorMessage
                  }
                </p>
              </section>
            ) : null}

            {(selectedBrowserHistoryItem
              .responsePayload
              ?.screenshot
              ?.absolutePath ||
              selectedBrowserHistoryItem
                .responsePayload
                ?.screenshots
                ?.before
                ?.absolutePath ||
              selectedBrowserHistoryItem
                .responsePayload
                ?.screenshots
                ?.after
                ?.absolutePath) ? (
              <section
                className={
                  styles.historyModalSection
                }
              >
                <strong>
                  {copy.screenshotPreview}
                </strong>

                <div
                  className={
                    styles.historyModalScreenshots
                  }
                >
                  {selectedBrowserHistoryItem
                    .responsePayload
                    ?.screenshot
                    ?.absolutePath ? (
                    <a
                      href={browserActionScreenshotUrl(
                        selectedBrowserHistoryItem.id,
                      )}
                      target="_blank"
                      rel="noreferrer"
                    >
                      <img
                        src={browserActionScreenshotUrl(
                          selectedBrowserHistoryItem.id,
                        )}
                        alt={copy.viewScreenshot}
                      />
                      <span>
                        {copy.viewScreenshot}
                      </span>
                    </a>
                  ) : null}

                  {selectedBrowserHistoryItem
                    .responsePayload
                    ?.screenshots
                    ?.before
                    ?.absolutePath ? (
                    <a
                      href={browserActionScreenshotUrl(
                        selectedBrowserHistoryItem.id,
                        "before",
                      )}
                      target="_blank"
                      rel="noreferrer"
                    >
                      <img
                        src={browserActionScreenshotUrl(
                          selectedBrowserHistoryItem.id,
                          "before",
                        )}
                        alt={
                          copy.viewBeforeScreenshot
                        }
                      />
                      <span>
                        {
                          copy.viewBeforeScreenshot
                        }
                      </span>
                    </a>
                  ) : null}

                  {selectedBrowserHistoryItem
                    .responsePayload
                    ?.screenshots
                    ?.after
                    ?.absolutePath ? (
                    <a
                      href={browserActionScreenshotUrl(
                        selectedBrowserHistoryItem.id,
                        "after",
                      )}
                      target="_blank"
                      rel="noreferrer"
                    >
                      <img
                        src={browserActionScreenshotUrl(
                          selectedBrowserHistoryItem.id,
                          "after",
                        )}
                        alt={
                          copy.viewAfterScreenshot
                        }
                      />
                      <span>
                        {
                          copy.viewAfterScreenshot
                        }
                      </span>
                    </a>
                  ) : null}
                </div>
              </section>
            ) : null}

            {selectedBrowserHistoryItem
              .responsePayload ? (
              <section
                className={
                  styles.historyModalSection
                }
              >
                <strong>
                  {copy.responseDetails}
                </strong>

                <pre
                  className={
                    styles.historyModalPayload
                  }
                >
                  {JSON.stringify(
                    selectedBrowserHistoryItem
                      .responsePayload,
                    null,
                    2,
                  )}
                </pre>
              </section>
            ) : null}

            <footer
              className={styles.historyModalFooter}
            >
              <button
                type="button"
                className={styles.secondaryButton}
                onClick={() =>
                  setSelectedBrowserHistoryItem(
                    null,
                  )
                }
              >
                {copy.closeDetails}
              </button>
            </footer>
          </div>
        </div>
      ) : null}

      {discardConfirmOpen ? (
        <div
          className={styles.confirmOverlay}
          role="presentation"
        >
          <div
            className={styles.confirmDialog}
            role="dialog"
            aria-modal="true"
          >
            <h3>
              {copy.discardConfirmTitle}
            </h3>

            <p>
              {copy.discardConfirmText}
            </p>

            <div className={styles.confirmActions}>
              <button
                type="button"
                className={styles.secondaryButton}
                onClick={() =>
                  setDiscardConfirmOpen(false)
                }
              >
                {copy.cancelPublish}
              </button>

              <button
                type="button"
                className={styles.confirmDiscardButton}
                onClick={() =>
                  void discardBrowserDraft()
                }
              >
                {copy.confirmDiscard}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {publishConfirmOpen ? (
        <div
          className={styles.confirmOverlay}
          role="presentation"
        >
          <div
            className={styles.confirmDialog}
            role="dialog"
            aria-modal="true"
          >
            <h3>
              {copy.publishConfirmTitle}
            </h3>

            <p>
              {copy.publishConfirmText}
            </p>

            <div className={styles.confirmActions}>
              <button
                type="button"
                className={styles.secondaryButton}
                onClick={() =>
                  setPublishConfirmOpen(false)
                }
              >
                {copy.cancelPublish}
              </button>

              <button
                type="button"
                className={styles.confirmPublishButton}
                onClick={() =>
                  void publishBrowserDraft()
                }
              >
                {copy.confirmPublish}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <section className={styles.panel}>
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
                  <td>
                    <span className={styles.platformBadge}>
                      {platformLabel(post.platform)}
                    </span>
                  </td>

                  <td>
                    <div className={styles.contentCell}>
                      <strong>{post.title || copy.untitled}</strong>
                      <span>{post.content}</span>
                    </div>
                  </td>

                  <td>{post.campaign?.name || "—"}</td>

                  <td>{post.status}</td>

                  <td>{formatDate(post.scheduledAt, locale)}</td>
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
