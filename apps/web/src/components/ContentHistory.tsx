"use client";

import { useEffect, useMemo, useState } from "react";
import styles from "./ContentHistory.module.css";
import { usePreferences } from "@/components/preferences";

import { API_URL } from "@/lib/api";
type ContentStatus =
  | "DRAFT"
  | "AI_IMPROVED"
  | "PENDING_REVIEW"
  | "APPROVED"
  | "REJECTED"
  | "PUBLISHED";
type Analysis = {
  summary?: string;
  viralScore?: number;
  discussionScore?: number;
  shareabilityScore?: number;
  brandFitScore?: number;
  bestPostingTime?: string;
};
type HistoryRecord = {
  id: string;
  topic: string;
  platforms: string[];
  style: string;
  language: string;
  facebook: string;
  telegram: string;
  reels: string;
  imagePrompt: string;
  analysis: Analysis;
  isFavorite: boolean;
  createdAt: string;
  updatedAt: string;
  status: ContentStatus;
  reviewNote?: string | null;
  reviewedBy?: string | null;
  reviewedAt?: string | null;
  approvedAt?: string | null;
  publishedAt?: string | null;
  brand: {
    id: string;
    name: string;
    workspace: { id: string; name: string; slug: string };
  };
  campaign: { id: string; name: string } | null;
  idea: { id: string; title: string; sortOrder: number } | null;
  scheduledPosts?: Array<{
    id: string;
    platform: "FACEBOOK" | "TELEGRAM";
    status: string;
    scheduledAt?: string;
    publishedAt?: string | null;
    externalPostId?: string | null;
    externalPostUrl?: string | null;
    lastError?: string | null;
    retryCount?: number;
    channel: {
      id: string;
      name: string;
      username?: string | null;
      externalId?: string | null;
    };
  }>;
};
type OutputKey = "facebook" | "telegram" | "reels" | "imagePrompt";
const statuses: Array<"ALL" | ContentStatus> = [
  "ALL",
  "DRAFT",
  "AI_IMPROVED",
  "PENDING_REVIEW",
  "APPROVED",
  "REJECTED",
  "PUBLISHED",
];

export function ContentHistory() {
  const { language } = usePreferences();
  const locale = language === "zh" ? "zh-CN" : "en-MY";

  function ui(en: string, zh: string) {
    return language === "zh" ? zh : en;
  }

  function contentStatusLabel(status: ContentStatus) {
    const labels: Record<ContentStatus, [string, string]> = {
      DRAFT: ["Draft", "草稿"],
      AI_IMPROVED: ["Needs changes", "需要修改"],
      PENDING_REVIEW: ["Pending review", "待审核"],
      APPROVED: ["Approved", "已批准"],
      REJECTED: ["Rejected", "已拒绝"],
      PUBLISHED: ["Published", "已发布"],
    };

    const [en, zh] = labels[status];
    return ui(en, zh);
  }

  function publishingStatusLabel(status: string) {
    const labels: Record<string, [string, string]> = {
      DRAFT: ["Draft", "草稿"],
      SCHEDULED: ["Scheduled", "已排程"],
      QUEUED: ["Queued", "排队中"],
      PUBLISHING: ["Publishing", "发布中"],
      PUBLISHED: ["Published", "已发布"],
      FAILED: ["Failed", "失败"],
      CANCELLED: ["Cancelled", "已取消"],
    };

    const matched = labels[status];

    return matched
      ? ui(matched[0], matched[1])
      : status
          .toLowerCase()
          .split("_")
          .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
          .join(" ");
  }

  const [records, setRecords] = useState<HistoryRecord[]>([]);
  const [selected, setSelected] = useState<HistoryRecord | null>(null);
  const [activeOutput, setActiveOutput] = useState<OutputKey>("facebook");
  const [query, setQuery] = useState("");
  const [onlyFavorites, setOnlyFavorites] = useState(false);
  const [statusFilter, setStatusFilter] = useState<"ALL" | ContentStatus>(
    "ALL",
  );
  const [reviewNote, setReviewNote] = useState("");
  const [reviewer, setReviewer] = useState("Loh");
  const [status, setStatus] = useState(
    ui("Loading generation history...", "正在加载内容历史……"),
  );
  const [saving, setSaving] = useState(false);
  const [mobileDetailOpen, setMobileDetailOpen] = useState(false);
  const [campaignFilter, setCampaignFilter] = useState("");

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const requestedStatus = params.get("status");
    const requestedCampaign = params.get("campaignId") || "";

    if (statuses.includes(requestedStatus as ContentStatus)) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- Hydrate history filters from the URL on mount.
      setStatusFilter(requestedStatus as ContentStatus);
    }
    setCampaignFilter(requestedCampaign);
    void load();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps -- URL filters and remote history are hydrated once on mount.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- Reset the review form when the selected record changes.
    setReviewNote(selected?.reviewNote || "");
    setReviewer(selected?.reviewedBy || "Loh");
  }, [selected?.id, selected?.reviewNote, selected?.reviewedBy]);

  const filtered = useMemo(
    () =>
      records.filter((record) => {
        const q = query.trim().toLowerCase();
        const search =
          !q ||
          record.topic.toLowerCase().includes(q) ||
          record.brand.name.toLowerCase().includes(q) ||
          record.style.toLowerCase().includes(q);
        return (
          search &&
          (!onlyFavorites || record.isFavorite) &&
          (statusFilter === "ALL" || record.status === statusFilter) &&
          (!campaignFilter || record.campaign?.id === campaignFilter)
        );
      }),
    [records, query, onlyFavorites, statusFilter, campaignFilter],
  );

  useEffect(() => {
    if (!filtered.length) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- Clear a selection that is no longer present after filtering.
      setSelected(null);
      return;
    }

    if (!selected || !filtered.some((record) => record.id === selected.id)) {
      setSelected(filtered[0]);
    }
  }, [filtered, selected]);

  async function load() {
    try {
      const response = await fetch(`${API_URL}/history`, { cache: "no-store" });
      const data = (await response.json()) as
        HistoryRecord[] | { message?: string };
      if (!response.ok || !Array.isArray(data))
        throw new Error(
          !Array.isArray(data) && data.message
            ? data.message
            : ui("Unable to load history.", "无法加载内容历史。"),
        );
      const requestedHistoryId = new URLSearchParams(
        window.location.search,
      ).get("historyId");

      setRecords(data);
      setSelected(
        (current) =>
          data.find((item) => item.id === requestedHistoryId) ||
          data.find((item) => item.id === current?.id) ||
          data[0] ||
          null,
      );
      if (requestedHistoryId) {
        setMobileDetailOpen(true);
      }
      setStatus(
        data.length
          ? ui(
              `${data.length} saved generations.`,
              `已保存 ${data.length} 条生成记录。`,
            )
          : ui("No saved generations yet.", "尚未保存任何生成记录。"),
      );
    } catch (error) {
      setStatus(
        error instanceof Error
          ? error.message
          : ui("Unable to load history.", "无法加载内容历史。"),
      );
    }
  }

  function syncRecord(updated: HistoryRecord) {
    setRecords((current) =>
      current.map((item) => (item.id === updated.id ? updated : item)),
    );
    setSelected((current) => (current?.id === updated.id ? updated : current));
  }

  async function updateWorkflow(nextStatus: ContentStatus) {
    if (!selected) return;
    setSaving(true);
    try {
      const response = await fetch(`${API_URL}/history/${selected.id}/status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status: nextStatus,
          reviewNote: reviewNote.trim() || undefined,
          reviewedBy: reviewer.trim() || "Loh",
        }),
      });
      const data = (await response.json()) as HistoryRecord & {
        message?: string;
      };
      if (!response.ok || !data.status)
        throw new Error(
          data.message ||
            ui("Unable to update workflow.", "无法更新工作流程。"),
        );
      syncRecord(data);
      setStatus(
        ui(
          `Workflow updated to ${contentStatusLabel(data.status)}.`,
          `工作流程已更新为：${contentStatusLabel(data.status)}。`,
        ),
      );
    } catch (error) {
      setStatus(
        error instanceof Error
          ? error.message
          : ui("Unable to update workflow.", "无法更新工作流程。"),
      );
    } finally {
      setSaving(false);
    }
  }

  async function toggleFavorite(record: HistoryRecord) {
    const response = await fetch(`${API_URL}/history/${record.id}/favorite`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isFavorite: !record.isFavorite }),
    });
    if (response.ok) syncRecord({ ...record, isFavorite: !record.isFavorite });
  }
  async function remove(record: HistoryRecord) {
    if (
      !window.confirm(
        ui(
          `Delete "${record.topic}" from history?`,
          `确定从内容历史删除“${record.topic}”吗？`,
        ),
      )
    )
      return;
    const response = await fetch(`${API_URL}/history/${record.id}`, {
      method: "DELETE",
    });
    if (!response.ok) return;
    const remaining = records.filter((item) => item.id !== record.id);
    setRecords(remaining);
    if (selected?.id === record.id) setSelected(remaining[0] || null);
  }
  function getOutput(record: HistoryRecord) {
    return record[activeOutput];
  }
  async function copySelected() {
    if (selected) await navigator.clipboard.writeText(getOutput(selected));
  }

  function buildStudioHref(record: HistoryRecord) {
    const params = new URLSearchParams({
      topic: record.topic,
      style: record.style,
      language: record.language,
      historyId: record.id,
    });

    if (record.campaign) {
      params.set("campaignId", record.campaign.id);
      params.set("campaignName", record.campaign.name);
    }

    if (record.idea) {
      params.set("ideaId", record.idea.id);
      params.set("ideaTitle", record.idea.title);
    }

    return `/ai-studio?${params.toString()}`;
  }

  function openRecord(record: HistoryRecord) {
    setSelected(record);
    setMobileDetailOpen(true);
    window.requestAnimationFrame(() => {
      window.scrollTo({ top: 0, behavior: "smooth" });
    });
  }

  function closeMobileDetail() {
    setMobileDetailOpen(false);
    window.requestAnimationFrame(() => {
      window.scrollTo({ top: 0, behavior: "smooth" });
    });
  }

  return (
    <div className={styles.page}>
      <section className={styles.hero}>
        <div>
          <p className={styles.eyebrow}>{ui("Content History", "内容历史")}</p>
          <h1>
            {ui(
              "Every Atlas generation, reviewed and reusable.",
              "集中查看、审核并重复使用每一条 Atlas 生成内容。",
            )}
          </h1>
          <p>
            {ui(
              "Manage content, approval status, reviewer notes and publishing readiness.",
              "管理内容、审批状态、审核备注与发布准备情况。",
            )}
          </p>
        </div>
        <div className={styles.countCard}>
          <span>{ui("Saved records", "保存记录")}</span>
          <strong>{records.length}</strong>
          <small>{status}</small>
        </div>
      </section>
      <section
        className={`${styles.toolbar} ${mobileDetailOpen ? styles.mobileToolbarHidden : ""}`}
      >
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={ui(
            "Search topic, brand or style...",
            "搜索主题、品牌或风格……",
          )}
        />
        <select
          value={statusFilter}
          onChange={(e) =>
            setStatusFilter(e.target.value as "ALL" | ContentStatus)
          }
        >
          {statuses.map((value) => (
            <option key={value} value={value}>
              {value === "ALL"
                ? ui("All statuses", "所有状态")
                : contentStatusLabel(value)}
            </option>
          ))}
        </select>
        <button
          className={onlyFavorites ? styles.activeFilter : ""}
          onClick={() => setOnlyFavorites((v) => !v)}
        >
          ★ {ui("Favorites", "收藏")}
        </button>
        <button onClick={() => void load()}>{ui("Refresh", "刷新")}</button>
      </section>
      <section className={styles.layout}>
        <div
          className={`${styles.list} ${mobileDetailOpen ? styles.mobileListHidden : ""}`}
        >
          <div className={styles.mobileListSummary}>
            <strong>
              {ui(
                `${filtered.length} records`,
                `${filtered.length} 条记录`,
              )}
            </strong>
            <span>{ui("Tap to view details", "点击记录查看详情")}</span>
          </div>
          {filtered.length === 0 ? (
            <div className={styles.emptyState}>
              <strong>
                {ui("No matching generations", "没有符合条件的生成记录")}
              </strong>
              <span>
                {ui(
                  "Adjust filters or generate new content.",
                  "请调整筛选条件，或生成新的内容。",
                )}
              </span>
            </div>
          ) : (
            filtered.map((record) => (
              <button
                key={record.id}
                className={`${styles.historyCard} ${selected?.id === record.id ? styles.selectedCard : ""}`}
                onClick={() => openRecord(record)}
              >
                <div className={styles.cardTop}>
                  <span className={styles.brandBadge}>{record.brand.name}</span>
                  <span
                    className={`${styles.statusBadge} ${styles[`status${record.status}`]}`}
                  >
                    {contentStatusLabel(record.status)}
                  </span>
                </div>
                <h2>{record.topic}</h2>
                <p>
                  {record.style} · {record.language}
                </p>
                <div className={styles.platforms}>
                  {record.platforms.map((platform) => (
                    <span key={platform}>{platform}</span>
                  ))}
                </div>
                <small>{formatDate(record.createdAt, locale)}</small>
              </button>
            ))
          )}
        </div>
        <div
          className={`${styles.viewer} ${!mobileDetailOpen ? styles.mobileViewerHidden : ""}`}
        >
          {!selected ? (
            <div className={styles.emptyViewer}>
              {ui(
                "Select a generation to inspect it.",
                "请选择一条生成记录查看详情。",
              )}
            </div>
          ) : (
            <>
              <div className={styles.mobileDetailBar}>
                <button type="button" onClick={closeMobileDetail}>
                  ← {ui("Back to history", "返回内容历史")}
                </button>
                <span>{contentStatusLabel(selected.status)}</span>
              </div>
              <div className={styles.viewerHeader}>
                <div>
                  <div className={styles.viewerBadges}>
                    <span className={styles.brandBadge}>
                      {selected.brand.name}
                    </span>
                    <span
                      className={`${styles.statusBadge} ${styles[`status${selected.status}`]}`}
                    >
                      {contentStatusLabel(selected.status)}
                    </span>
                  </div>
                  <h2>{selected.topic}</h2>
                  <p>
                    {selected.analysis.summary ||
                      ui("Saved AI generation", "已保存的 AI 生成内容")}
                  </p>
                </div>
                <div className={styles.actions}>
                  {selected.campaign ? (
                    <a
                      href={`/campaigns/${encodeURIComponent(selected.campaign.id)}?tab=overview`}
                    >
                      Open campaign
                    </a>
                  ) : null}

                  <a
                    href={
                      selected.status === "PUBLISHED"
                        ? `/ai-studio?${new URLSearchParams({
                            topic: selected.topic,
                            style: selected.style,
                            language: selected.language,
                          }).toString()}`
                        : buildStudioHref(selected)
                    }
                  >
                    {selected.status === "PUBLISHED"
                      ? ui("Create new draft", "创建新草稿")
                      : ui("Continue in AI Studio", "在 AI 工作室继续")}
                  </a>

                  <button onClick={() => void toggleFavorite(selected)}>
                    {selected.isFavorite
                      ? ui("★ Favorited", "★ 已收藏")
                      : ui("☆ Favorite", "☆ 收藏")}
                  </button>

                  <button onClick={() => void copySelected()}>Copy</button>

                  {selected.status !== "PUBLISHED" ? (
                    <button
                      className={styles.deleteButton}
                      onClick={() => void remove(selected)}
                    >
                      Delete
                    </button>
                  ) : null}
                </div>
              </div>
              {selected.status === "PUBLISHED" ? (
                <section
                  className={`${styles.workflowPanel} ${styles.publishedPanel}`}
                >
                  <div className={styles.workflowTitle}>
                    <div>
                      <span>{ui("Publishing details", "发布详情")}</span>
                      <strong>{ui("Published", "已发布")}</strong>
                    </div>

                    <small>
                      {selected.reviewedBy
                        ? ui(
                            `Published by: ${selected.reviewedBy}`,
                            `发布者：${selected.reviewedBy}`,
                          )
                        : ui("Published by Atlas", "由 Atlas 发布")}
                    </small>
                  </div>

                  <div className={styles.publishedDetails}>
                    <article>
                      <span>{ui("Status", "状态")}</span>
                      <strong>{ui("Published", "已发布")}</strong>
                    </article>

                    <article>
                      <span>{ui("Published at", "发布时间")}</span>
                      <strong>
                        {selected.publishedAt
                          ? formatDate(selected.publishedAt, locale)
                          : ui("Published", "已发布")}
                      </strong>
                    </article>

                    <article>
                      <span>{ui("Platforms", "平台")}</span>
                      <strong>
                        {selected.platforms
                          .filter(
                            (platform) =>
                              platform === "Facebook" ||
                              platform === "Telegram",
                          )
                          .join(" · ") || ui("Not specified", "未指定")}
                      </strong>
                    </article>
                  </div>

                  <div className={styles.reviewFields}>
                    <label>
                      <span>{ui("Published by", "发布者")}</span>
                      <input
                        value={selected.reviewedBy || "Atlas Publisher"}
                        readOnly
                      />
                    </label>

                    <label>
                      <span>{ui("Publishing note", "发布备注")}</span>
                      <textarea
                        value={
                          selected.reviewNote ||
                          ui(
                            "Successfully published through the Atlas automation workflow.",
                            "已通过 Atlas 自动化工作流程成功发布。",
                          )
                        }
                        readOnly
                      />
                    </label>
                  </div>

                  {selected.scheduledPosts?.length ? (
                    <div className={styles.publishedPostList}>
                      {selected.scheduledPosts.map((post) => (
                        <article key={post.id}>
                          <div>
                            <span className={styles.publishPlatform}>
                              <span
                                className={`${styles.publishPlatformIcon} ${
                                  post.platform === "FACEBOOK"
                                    ? styles.facebookPublishIcon
                                    : styles.telegramPublishIcon
                                }`}
                              >
                                {post.platform === "FACEBOOK" ? "f" : "✈"}
                              </span>

                              {post.platform === "FACEBOOK"
                                ? "Facebook"
                                : "Telegram"}
                            </span>

                            <strong>{post.channel.name}</strong>

                            <small>
                              {post.publishedAt
                                ? formatDate(post.publishedAt, locale)
                                : publishingStatusLabel(post.status)}
                            </small>

                            {post.platform === "TELEGRAM" &&
                            post.externalPostId ? (
                              <small>
                                {ui("Message ID", "消息 ID")}:{" "}
                                {post.externalPostId}
                              </small>
                            ) : null}

                            {post.status === "FAILED" && post.lastError ? (
                              <small className={styles.publishError}>
                                {post.lastError}
                              </small>
                            ) : null}

                            {typeof post.retryCount === "number" &&
                            post.retryCount > 0 ? (
                              <small>
                                {ui("Attempts", "尝试次数")}: {post.retryCount}
                              </small>
                            ) : null}
                          </div>

                          <span
                            className={`${styles.publishStatus} ${
                              post.status === "PUBLISHED"
                                ? styles.publishStatusSuccess
                                : post.status === "FAILED"
                                  ? styles.publishStatusFailed
                                  : styles.publishStatusPending
                            }`}
                          >
                            {publishingStatusLabel(post.status)}
                          </span>

                          {post.externalPostUrl ? (
                            <a
                              href={post.externalPostUrl}
                              target="_blank"
                              rel="noreferrer"
                            >
                              Open post
                            </a>
                          ) : post.platform === "TELEGRAM" &&
                            post.channel.username &&
                            post.externalPostId ? (
                            <a
                              href={`https://t.me/${post.channel.username}/${post.externalPostId}`}
                              target="_blank"
                              rel="noreferrer"
                            >
                              Open message
                            </a>
                          ) : (
                            <a
                              href="/calendar"
                              className={styles.calendarFallbackLink}
                            >
                              {post.status === "FAILED"
                                ? ui("Review failure", "查看失败原因")
                                : ui("Open calendar", "打开日历")}
                            </a>
                          )}
                        </article>
                      ))}
                    </div>
                  ) : (
                    <p className={styles.noPublishRecords}>
                      No linked publishing records found.
                    </p>
                  )}

                  <div className={styles.publishedActions}>
                    <a href="/calendar">Open Content Calendar</a>

                    <a
                      href={`/ai-studio?${new URLSearchParams({
                        topic: selected.topic,
                        style: selected.style,
                        language: selected.language,
                      }).toString()}`}
                    >
                      Create new draft
                    </a>
                  </div>
                </section>
              ) : (
                <section className={styles.workflowPanel}>
                  <div className={styles.workflowTitle}>
                    <div>
                      <span>{ui("Approval workflow", "审批流程")}</span>
                      <strong>{contentStatusLabel(selected.status)}</strong>
                    </div>

                    <small>
                      {selected.reviewedBy
                        ? ui(
                            `Reviewer: ${selected.reviewedBy}`,
                            `审核者：${selected.reviewedBy}`,
                          )
                        : ui("No reviewer assigned", "尚未指定审核者")}
                    </small>
                  </div>

                  <div className={styles.reviewFields}>
                    <label>
                      <span>{ui("Reviewer", "审核者")}</span>
                      <input
                        value={reviewer}
                        onChange={(e) => setReviewer(e.target.value)}
                      />
                    </label>

                    <label>
                      <span>{ui("Review note", "审核备注")}</span>
                      <textarea
                        value={reviewNote}
                        onChange={(e) => setReviewNote(e.target.value)}
                        placeholder={ui(
                          "Add feedback or approval notes...",
                          "填写修改意见或审批备注……",
                        )}
                      />
                    </label>
                  </div>

                  <div className={styles.workflowActions}>
                    <button
                      disabled={saving}
                      onClick={() => void updateWorkflow("DRAFT")}
                    >
                      Draft
                    </button>

                    <button
                      disabled={saving}
                      onClick={() => void updateWorkflow("PENDING_REVIEW")}
                    >
                      Submit review
                    </button>

                    <button
                      disabled={saving}
                      onClick={() => void updateWorkflow("AI_IMPROVED")}
                    >
                      Need changes
                    </button>

                    <button
                      disabled={saving}
                      className={styles.approveButton}
                      onClick={() => void updateWorkflow("APPROVED")}
                    >
                      Approve
                    </button>

                    <button
                      disabled={saving}
                      className={styles.rejectButton}
                      onClick={() => void updateWorkflow("REJECTED")}
                    >
                      Reject
                    </button>

                    <button
                      disabled={saving || selected.status !== "APPROVED"}
                      onClick={() => void updateWorkflow("PUBLISHED")}
                    >
                      Mark published
                    </button>
                  </div>
                </section>
              )}
              <div className={styles.scoreGrid}>
                <Score
                  label={ui("Viral", "传播力")}
                  value={selected.analysis.viralScore}
                />
                <Score
                  label={ui("Discussion", "讨论度")}
                  value={selected.analysis.discussionScore}
                />
                <Score
                  label={ui("Shareability", "分享度")}
                  value={selected.analysis.shareabilityScore}
                />
                <Score
                  label={ui("Brand Fit", "品牌契合度")}
                  value={selected.analysis.brandFitScore}
                />
              </div>
              <div className={styles.tabs}>
                {[
                  ["facebook", "Facebook"],
                  ["telegram", "Telegram"],
                  ["reels", "Reels"],
                  ["imagePrompt", ui("Image Prompt", "图片提示词")],
                ].map(([key, label]) => (
                  <button
                    key={key}
                    className={activeOutput === key ? styles.activeTab : ""}
                    onClick={() => setActiveOutput(key as OutputKey)}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <textarea
                className={styles.output}
                readOnly
                value={getOutput(selected)}
              />
              <div className={styles.meta}>
                <span>
                  {ui("Best time", "最佳时间")}:{" "}
                  {selected.analysis.bestPostingTime ||
                    ui("Not provided", "未提供")}
                </span>
                <span>{formatDate(selected.createdAt, locale)}</span>
              </div>
            </>
          )}
        </div>
      </section>
    </div>
  );
}
function Score({ label, value }: { label: string; value?: number }) {
  return (
    <div className={styles.score}>
      <strong>{value ?? 0}</strong>
      <span>{label}</span>
    </div>
  );
}
function formatDate(value: string, locale: string) {
  return new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}
