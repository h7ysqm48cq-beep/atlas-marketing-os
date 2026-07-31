"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { usePreferences } from "@/components/preferences";
import { API_URL } from "@/lib/api";
import styles from "./DashboardOverview.module.css";

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

export function DashboardOverview() {
  const { language, t } = usePreferences();

  const [data, setData] = useState<DashboardData>({
    automation: null,
    history: [],
    campaigns: [],
  });

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const locale = language === "zh" ? "zh-CN" : "en-MY";

  const formatDate = useCallback(
    (value: string) =>
      new Intl.DateTimeFormat(locale, {
        dateStyle: "medium",
        timeStyle: "short",
      }).format(new Date(value)),
    [locale],
  );

  const load = useCallback(async () => {
    setLoading(true);
    setError("");

    const requests = await Promise.allSettled([
      fetch(`${API_URL}/automation/dashboard`, {
        cache: "no-store",
      }),
      fetch(`${API_URL}/history`, {
        cache: "no-store",
      }),
      fetch(`${API_URL}/campaigns`, {
        cache: "no-store",
      }),
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
          `${failed.length} ${
            failed.length === 1
              ? t("dashboardSourceFailed")
              : t("dashboardSourcesFailed")
          }`,
        );
      }
    } catch {
      setError(t("dashboardLoadFailed"));
    } finally {
      setLoading(false);
    }
  }, [t]);

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

  const publishedCount = useMemo(
    () => data.history.filter((item) => item.status === "PUBLISHED").length,
    [data.history],
  );

  const draftCount = useMemo(
    () => data.history.filter((item) => item.status === "DRAFT").length,
    [data.history],
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
      ? t("notConfigured")
      : connectedChannels === totalChannels
        ? t("healthy")
        : connectedChannels > 0
          ? t("partial")
          : t("disconnected");

  const recentContent = data.history.slice(0, 5);

  const upcoming = data.automation?.upcoming.slice(0, 5) ?? [];

  const hour = new Date().getHours();

  const greeting =
    hour < 12
      ? t("goodMorning")
      : hour < 18
        ? t("goodAfternoon")
        : t("goodEvening");

  function displayStatus(status: string) {
    const map: Record<string, string> = {
      DRAFT: t("draft"),
      PENDING_REVIEW: t("pendingReview"),
      APPROVED: t("approved"),
      PUBLISHED: t("published"),
      SCHEDULED: t("scheduled"),
      QUEUED: language === "zh" ? "队列中" : "Queued",
      PUBLISHING: language === "zh" ? "发布中" : "Publishing",
    };

    return map[status] || status;
  }

  return (
    <div className={styles.dashboard}>
      <div className={styles.desktopSummary}>
        <section className={styles.hero}>
          <div>
            <p className={styles.eyebrow}>{t("marketingCommandCenter")}</p>

            <h1>{greeting}，Loh。</h1>

            <p className={styles.subtitle}>{t("attentionSummary")}</p>
          </div>

          <div className={styles.heroActions}>
            <button
              className={styles.secondaryButton}
              onClick={() => void load()}
              disabled={loading}
            >
              {loading ? t("refreshing") : t("refresh")}
            </button>

            <a className={styles.primaryButton} href="/ai-studio">
              + {t("createContent")}
            </a>
          </div>
        </section>

        {error ? <div className={styles.warning}>{error}</div> : null}

        <section className={styles.kpiGrid}>
          <article className={styles.kpiCard}>
            <span>{t("pendingApproval")}</span>
            <strong>{pendingReview}</strong>
            <small>
              {approved} {t("approvedReady")}
            </small>
          </article>

          <article className={styles.kpiCard}>
            <span>{t("scheduledPosts")}</span>
            <strong>{scheduled}</strong>
            <small>
              {publishingQueue} {t("currentlyQueue")}
            </small>
          </article>

          <article className={styles.kpiCard}>
            <span>{t("activeCampaigns")}</span>
            <strong>{activeCampaigns}</strong>
            <small>
              {data.campaigns.length} {t("campaignsTotal")}
            </small>
          </article>

          <article className={styles.kpiCard}>
            <span>{t("automationHealth")}</span>
            <strong className={styles.healthValue}>{automationHealth}</strong>
            <small>
              {connectedChannels}/{totalChannels} {t("channelsConnected")}
            </small>
          </article>
        </section>
      </div>

      <div className={styles.mobileSummary}>
        <section className={styles.mobileHero}>
          <div>
            <p className={styles.mobileGreeting}>{greeting}</p>

            <h1>Loh。</h1>

            <p className={styles.mobileAttention}>
              {pendingReview > 0
                ? `${pendingReview} ${t("needsAttention")}`
                : t("everythingUnderControl")}
            </p>
          </div>

          <a className={styles.mobileCreateButton} href="/ai-studio">
            + {t("create")}
          </a>
        </section>

        <button
          type="button"
          className={styles.mobileRefreshButton}
          onClick={() => void load()}
          disabled={loading}
        >
          {loading ? t("refreshing") : t("refreshDashboard")}
        </button>

        {error ? <div className={styles.warning}>{error}</div> : null}

        <section className={styles.mobileKpiGrid}>
          <article className={styles.mobileKpiCard}>
            <span>{t("pending")}</span>
            <strong>{pendingReview}</strong>
            <small>
              {approved} {t("approvedCount")}
            </small>
          </article>

          <article className={styles.mobileKpiCard}>
            <span>{t("scheduled")}</span>
            <strong>{scheduled}</strong>
            <small>
              {publishingQueue} {t("inQueue")}
            </small>
          </article>

          <article className={styles.mobileKpiCard}>
            <span>{t("campaignsLabel")}</span>
            <strong>{activeCampaigns}</strong>
            <small>
              {data.campaigns.length} {t("total")}
            </small>
          </article>

          <article className={styles.mobileKpiCard}>
            <span>{t("automationLabel")}</span>
            <strong className={styles.mobileHealthValue}>
              {automationHealth}
            </strong>
            <small>
              {connectedChannels}/{totalChannels} {t("connected")}
            </small>
          </article>
        </section>
      </div>

      <section className={styles.mainGrid}>
        <article className={styles.panel}>
          <header className={styles.panelHeader}>
            <div>
              <p className={styles.eyebrow}>{t("publishing")}</p>
              <h2>{t("upcomingPosts")}</h2>
            </div>

            <a href="/automation">{t("viewAutomation")}</a>
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

                <b>{displayStatus(post.status)}</b>
              </div>
            ))}

            {!upcoming.length ? (
              <div className={styles.empty}>{t("noUpcomingPosts")}</div>
            ) : null}
          </div>
        </article>

        <article className={styles.panel}>
          <header className={styles.panelHeader}>
            <div>
              <p className={styles.eyebrow}>{t("workflow")}</p>
              <h2>{t("contentStatus")}</h2>
            </div>

            <a href="/content-history">{t("openHistory")}</a>
          </header>

          <div className={styles.workflowGrid}>
            <div>
              <span>{t("draft")}</span>
              <strong>{draftCount}</strong>
            </div>

            <div>
              <span>{t("pendingReview")}</span>
              <strong>{pendingReview}</strong>
            </div>

            <div>
              <span>{t("approved")}</span>
              <strong>{approved}</strong>
            </div>

            <div>
              <span>{t("published")}</span>
              <strong>{publishedCount}</strong>
            </div>
          </div>

          <div className={styles.healthPanel}>
            <span>{t("automationStatus")}</span>
            <strong>{automationHealth}</strong>
            <small>{t("publishingChannelsDescription")}</small>
          </div>
        </article>
      </section>

      <section className={styles.panel}>
        <header className={styles.panelHeader}>
          <div>
            <p className={styles.eyebrow}>{t("recentActivity")}</p>
            <h2>{t("latestAiContent")}</h2>
          </div>

          <a href="/content-history">{t("viewAll")}</a>
        </header>

        <div className={styles.tableWrap}>
          <table>
            <thead>
              <tr>
                <th>{t("topic")}</th>
                <th>{t("platforms")}</th>
                <th>{t("status")}</th>
                <th>{t("created")}</th>
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
                    <span className={styles.statusBadge}>
                      {displayStatus(record.status)}
                    </span>
                  </td>

                  <td>{formatDate(record.createdAt)}</td>
                </tr>
              ))}

              {!recentContent.length ? (
                <tr>
                  <td colSpan={4} className={styles.empty}>
                    {t("noGeneratedContent")}
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
