"use client";

import {
  useCallback,
  useEffect,
  useState,
} from "react";
import styles from "./AutomationDashboard.module.css";

const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_URL ||
  "http://localhost:3001";

type Channel = {
  id: string;
  platform: "FACEBOOK" | "TELEGRAM";
  name: string;
  username: string | null;
  status:
    | "DISCONNECTED"
    | "CONNECTED"
    | "EXPIRED"
    | "ERROR";
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

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en-MY", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function platformLabel(platform: string) {
  return platform === "FACEBOOK"
    ? "Facebook"
    : "Telegram";
}

export function AutomationDashboard() {
  const [dashboard, setDashboard] =
    useState<DashboardResponse | null>(null);
  const [settings, setSettings] =
    useState<Settings | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");

    try {
      const [dashboardResponse, settingsResponse] =
        await Promise.all([
          fetch(
            `${API_BASE_URL}/automation/dashboard`,
            { cache: "no-store" },
          ),
          fetch(
            `${API_BASE_URL}/automation/settings`,
            { cache: "no-store" },
          ),
        ]);

      if (
        !dashboardResponse.ok ||
        !settingsResponse.ok
      ) {
        throw new Error(
          "Unable to load automation dashboard.",
        );
      }

      const [dashboardData, settingsData] =
        await Promise.all([
          dashboardResponse.json() as Promise<DashboardResponse>,
          settingsResponse.json() as Promise<Settings>,
        ]);

      setDashboard(dashboardData);
      setSettings(settingsData);
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : "Unable to load automation dashboard.",
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
        <p>{error || "No automation data available."}</p>

        <button onClick={() => void load()}>
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
          <p className={styles.eyebrow}>
            Publishing
          </p>

          <h1>Social Automation</h1>

          <p>
            Manage Facebook and Telegram channels,
            publishing queue and scheduled posts.
          </p>
        </div>

        <button
          className={styles.refreshButton}
          onClick={() => void load()}
          disabled={loading}
        >
          {loading ? "Refreshing..." : "Refresh"}
        </button>
      </section>

      {error ? (
        <div className={styles.error}>
          {error}
        </div>
      ) : null}

      <section className={styles.kpiGrid}>
        <article>
          <span>Scheduled</span>
          <strong>{counts.SCHEDULED ?? 0}</strong>
          <small>Waiting for publish time</small>
        </article>

        <article>
          <span>Queue</span>
          <strong>{counts.QUEUED ?? 0}</strong>
          <small>Ready for processing</small>
        </article>

        <article>
          <span>Published</span>
          <strong>{counts.PUBLISHED ?? 0}</strong>
          <small>Successfully completed</small>
        </article>

        <article>
          <span>Failed</span>
          <strong>{counts.FAILED ?? 0}</strong>
          <small>Needs attention</small>
        </article>
      </section>

      <section className={styles.contentGrid}>
        <article className={styles.panel}>
          <header>
            <div>
              <p className={styles.eyebrow}>
                Channels
              </p>
              <h2>Connected platforms</h2>
            </div>

            <strong>
              {dashboard.channels.length}
            </strong>
          </header>

          <div className={styles.channelList}>
            {dashboard.channels.map((channel) => (
              <div
                className={styles.channelCard}
                key={channel.id}
              >
                <div
                  className={`${styles.channelIcon} ${
                    channel.platform === "FACEBOOK"
                      ? styles.facebook
                      : styles.telegram
                  }`}
                >
                  {channel.platform === "FACEBOOK"
                    ? "f"
                    : "✈"}
                </div>

                <div className={styles.channelMain}>
                  <strong>{channel.name}</strong>
                  <span>
                    {channel.username
                      ? `@${channel.username}`
                      : "No username"}
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
                    {channel._count.scheduledPosts} posts
                  </small>
                </div>
              </div>
            ))}
          </div>
        </article>

        <article className={styles.panel}>
          <header>
            <div>
              <p className={styles.eyebrow}>
                Automation
              </p>
              <h2>Publishing settings</h2>
            </div>
          </header>

          {settings ? (
            <div className={styles.settingsList}>
              <div>
                <span>Timezone</span>
                <strong>{settings.timezone}</strong>
              </div>

              <div>
                <span>Approval required</span>
                <strong>
                  {settings.approvalRequired
                    ? "Yes"
                    : "No"}
                </strong>
              </div>

              <div>
                <span>Auto publish</span>
                <strong>
                  {settings.autoPublishEnabled
                    ? "Enabled"
                    : "Disabled"}
                </strong>
              </div>

              <div>
                <span>Retry policy</span>
                <strong>
                  {settings.retryLimit} attempts ·{" "}
                  {settings.retryDelayMinutes} min
                </strong>
              </div>

              <div>
                <span>Facebook time</span>
                <strong>
                  {settings.defaultFacebookTime}
                </strong>
              </div>

              <div>
                <span>Telegram time</span>
                <strong>
                  {settings.defaultTelegramTime}
                </strong>
              </div>
            </div>
          ) : null}
        </article>
      </section>

      <section className={styles.panel}>
        <header>
          <div>
            <p className={styles.eyebrow}>
              Schedule
            </p>
            <h2>Upcoming posts</h2>
          </div>

          <strong>{dashboard.upcoming.length}</strong>
        </header>

        <div className={styles.tableWrap}>
          <table>
            <thead>
              <tr>
                <th>Platform</th>
                <th>Content</th>
                <th>Campaign</th>
                <th>Status</th>
                <th>Scheduled</th>
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
                      <strong>
                        {post.title || "Untitled post"}
                      </strong>
                      <span>{post.content}</span>
                    </div>
                  </td>

                  <td>
                    {post.campaign?.name || "—"}
                  </td>

                  <td>{post.status}</td>

                  <td>
                    {formatDate(post.scheduledAt)}
                  </td>
                </tr>
              ))}

              {!dashboard.upcoming.length ? (
                <tr>
                  <td
                    colSpan={5}
                    className={styles.empty}
                  >
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
