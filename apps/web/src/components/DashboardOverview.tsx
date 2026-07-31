"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import styles from "./DashboardOverview.module.css";

import { API_URL } from "@/lib/api";
type AutomationDashboard = {
  channels: Array<{
    id: string;
    platform: string;
    status: string;
  }>;
  statusCounts: Record<string, number>;
  upcoming: Array<{
    id: string;
    title: string | null;
    content: string;
    platform: string;
    status: string;
    scheduledAt: string;
    channel: {
      name: string;
    };
  }>;
};

type HistoryRecord = {
  id: string;
  topic: string;
  status: string;
  platforms: string[];
  createdAt: string;
};

type Campaign = {
  id: string;
  name: string;
  status: string;
  startDate?: string | null;
  endDate?: string | null;
};

type DashboardData = {
  automation: AutomationDashboard | null;
  history: HistoryRecord[];
  campaigns: Campaign[];
};

function number(value: number) {
  return new Intl.NumberFormat("en-MY").format(value);
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en-MY", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

export function DashboardOverview() {
  const [data, setData] = useState<DashboardData>({
    automation: null,
    history: [],
    campaigns: [],
  });

  const [loading, setLoading] = useState(true);

  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");

    const requests = await Promise.allSettled([
      fetch(`${API_URL}/automation/dashboard`, { cache: "no-store" }),
      fetch(`${API_URL}/history`, { cache: "no-store" }),
      fetch(`${API_URL}/campaigns`, { cache: "no-store" }),
    ]);

    try {
      const [automationResult, historyResult, campaignsResult] = requests;

      const automation =
        automationResult.status === "fulfilled" && automationResult.value.ok
          ? await automationResult.value.json()
          : null;

      const history =
        historyResult.status === "fulfilled" && historyResult.value.ok
          ? await historyResult.value.json()
          : [];

      const campaigns =
        campaignsResult.status === "fulfilled" && campaignsResult.value.ok
          ? await campaignsResult.value.json()
          : [];

      setData({
        automation,
        history: Array.isArray(history) ? history : [],
        campaigns: Array.isArray(campaigns) ? campaigns : [],
      });

      const failed = requests.filter(
        (item) =>
          item.status === "rejected" ||
          (item.status === "fulfilled" && !item.value.ok),
      );

      if (failed.length) {
        setError(
          `${failed.length} dashboard source${
            failed.length > 1 ? "s" : ""
          } could not be loaded.`,
        );
      }
    } catch {
      setError("Unable to load dashboard data.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const pendingReview = useMemo(
    () =>
      data.history.filter((item) => item.status === "PENDING_REVIEW").length,
    [data.history],
  );

  const approved = useMemo(
    () => data.history.filter((item) => item.status === "APPROVED").length,
    [data.history],
  );

  const activeCampaigns = useMemo(
    () => data.campaigns.filter((item) => item.status === "ACTIVE").length,
    [data.campaigns],
  );

  const connectedChannels =
    data.automation?.channels.filter((item) => item.status === "CONNECTED")
      .length ?? 0;

  const totalChannels = data.automation?.channels.length ?? 0;

  const statusCounts = data.automation?.statusCounts ?? {};

  const publishingQueue =
    (statusCounts.QUEUED ?? 0) + (statusCounts.PUBLISHING ?? 0);

  const scheduled = statusCounts.SCHEDULED ?? 0;

  const automationHealth =
    totalChannels === 0
      ? "Not configured"
      : connectedChannels === totalChannels
        ? "Healthy"
        : connectedChannels > 0
          ? "Partial"
          : "Disconnected";

  const recentContent = data.history.slice(0, 5);

  const upcoming = data.automation?.upcoming.slice(0, 5) ?? [];

  return (
    <div className={styles.dashboard}>
      <div className={styles.desktopSummary}>
        <section className={styles.hero}>
          <div>
            <p className={styles.eyebrow}>Marketing Command Center</p>

            <h1>Good evening, Loh.</h1>

            <p className={styles.subtitle}>
              Here is what needs your attention across content, campaigns and
              publishing.
            </p>
          </div>

          <div className={styles.heroActions}>
            <button
              className={styles.secondaryButton}
              onClick={() => void load()}
              disabled={loading}
            >
              {loading ? "Refreshing..." : "Refresh"}
            </button>

            <a className={styles.primaryButton} href="/ai-studio">
              + Create content
            </a>
          </div>
        </section>

        {error ? <div className={styles.warning}>{error}</div> : null}

        <section className={styles.kpiGrid}>
          <article className={styles.kpiCard}>
            <span>Pending approval</span>
            <strong>{pendingReview}</strong>
            <small>{approved} approved and ready</small>
          </article>

          <article className={styles.kpiCard}>
            <span>Scheduled posts</span>
            <strong>{scheduled}</strong>
            <small>{publishingQueue} currently in queue</small>
          </article>

          <article className={styles.kpiCard}>
            <span>Active campaigns</span>
            <strong>{activeCampaigns}</strong>
            <small>{data.campaigns.length} campaigns total</small>
          </article>

          <article className={styles.kpiCard}>
            <span>Automation health</span>
            <strong className={styles.healthValue}>{automationHealth}</strong>
            <small>
              {connectedChannels}/{totalChannels} channels connected
            </small>
          </article>
        </section>
      </div>

      <div className={styles.mobileSummary}>
        <section className={styles.mobileHero}>
          <div>
            <p className={styles.mobileGreeting}>Good evening</p>

            <h1>Loh.</h1>

            <p className={styles.mobileAttention}>
              {pendingReview > 0
                ? `${pendingReview} item${
                    pendingReview === 1 ? "" : "s"
                  } need your attention`
                : "Everything is under control"}
            </p>
          </div>

          <a className={styles.mobileCreateButton} href="/ai-studio">
            + Create
          </a>
        </section>

        <button
          type="button"
          className={styles.mobileRefreshButton}
          onClick={() => void load()}
          disabled={loading}
        >
          {loading ? "Refreshing..." : "Refresh dashboard"}
        </button>

        {error ? <div className={styles.warning}>{error}</div> : null}

        <section className={styles.mobileKpiGrid}>
          <article className={styles.mobileKpiCard}>
            <span>Pending</span>
            <strong>{pendingReview}</strong>
            <small>{approved} approved</small>
          </article>

          <article className={styles.mobileKpiCard}>
            <span>Scheduled</span>
            <strong>{scheduled}</strong>
            <small>{publishingQueue} in queue</small>
          </article>

          <article className={styles.mobileKpiCard}>
            <span>Campaigns</span>
            <strong>{activeCampaigns}</strong>
            <small>{data.campaigns.length} total</small>
          </article>

          <article className={styles.mobileKpiCard}>
            <span>Automation</span>
            <strong className={styles.mobileHealthValue}>
              {automationHealth}
            </strong>
            <small>
              {connectedChannels}/{totalChannels} connected
            </small>
          </article>
        </section>
      </div>

      <section className={styles.mainGrid}>
        <article className={styles.panel}>
          <header className={styles.panelHeader}>
            <div>
              <p className={styles.eyebrow}>Publishing</p>
              <h2>Upcoming posts</h2>
            </div>

            <a href="/automation">View automation</a>
          </header>

          <div className={styles.list}>
            {upcoming.map((post) => (
              <div className={styles.listItem} key={post.id}>
                <div className={styles.platformIcon}>
                  {post.platform === "FACEBOOK" ? "f" : "✈"}
                </div>

                <div className={styles.listContent}>
                  <strong>{post.title || post.content.slice(0, 60)}</strong>

                  <span>
                    {post.channel.name} · {formatDate(post.scheduledAt)}
                  </span>
                </div>

                <b>{post.status}</b>
              </div>
            ))}

            {!upcoming.length ? (
              <div className={styles.empty}>
                No upcoming posts. Schedule your first Facebook or Telegram
                post.
              </div>
            ) : null}
          </div>
        </article>

        <article className={styles.panel}>
          <header className={styles.panelHeader}>
            <div>
              <p className={styles.eyebrow}>Workflow</p>
              <h2>Content status</h2>
            </div>

            <a href="/content-history">Open history</a>
          </header>

          <div className={styles.workflowGrid}>
            <div>
              <span>Draft</span>
              <strong>
                {data.history.filter((item) => item.status === "DRAFT").length}
              </strong>
            </div>

            <div>
              <span>Pending review</span>
              <strong>{pendingReview}</strong>
            </div>

            <div>
              <span>Approved</span>
              <strong>{approved}</strong>
            </div>

            <div>
              <span>Published</span>
              <strong>
                {
                  data.history.filter((item) => item.status === "PUBLISHED")
                    .length
                }
              </strong>
            </div>
          </div>

          <div className={styles.healthPanel}>
            <span>Automation status</span>
            <strong>{automationHealth}</strong>
            <small>Facebook and Telegram publishing channels</small>
          </div>
        </article>
      </section>

      <section className={styles.panel}>
        <header className={styles.panelHeader}>
          <div>
            <p className={styles.eyebrow}>Recent activity</p>
            <h2>Latest AI content</h2>
          </div>

          <a href="/content-history">View all</a>
        </header>

        <div className={styles.tableWrap}>
          <table>
            <thead>
              <tr>
                <th>Topic</th>
                <th>Platforms</th>
                <th>Status</th>
                <th>Created</th>
              </tr>
            </thead>

            <tbody>
              {recentContent.map((record) => (
                <tr key={record.id}>
                  <td>
                    <strong>{record.topic}</strong>
                  </td>

                  <td>{record.platforms.join(", ")}</td>

                  <td>
                    <span className={styles.statusBadge}>{record.status}</span>
                  </td>

                  <td>{formatDate(record.createdAt)}</td>
                </tr>
              ))}

              {!recentContent.length ? (
                <tr>
                  <td colSpan={4} className={styles.empty}>
                    No generated content yet.
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
