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
        };

  const locale = language === "zh" ? "zh-CN" : "en-MY";

  const [dashboard, setDashboard] = useState<DashboardResponse | null>(null);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

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
    } catch (loadError) {
      setError(
        loadError instanceof Error ? loadError.message : copy.loadFailed,
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

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

        <button onClick={() => void load()}>Try again</button>
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
