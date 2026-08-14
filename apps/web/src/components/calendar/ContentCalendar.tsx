"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { DragEvent } from "react";
import styles from "./ContentCalendar.module.css";
import { usePreferences } from "@/components/preferences";

import { API_URL } from "@/lib/api";
type Channel = {
  id: string;
  brandId: string;
  platform: "FACEBOOK" | "TELEGRAM";
  name: string;
  status: string;
};

type ScheduledPost = {
  id: string;
  brandId: string;
  channelId: string;
  platform: "FACEBOOK" | "TELEGRAM";
  title: string | null;
  content: string;
  mediaUrls: string[];
  scheduledAt: string;
  timezone: string;
  status:
    | "DRAFT"
    | "SCHEDULED"
    | "QUEUED"
    | "PUBLISHING"
    | "PUBLISHED"
    | "FAILED"
    | "CANCELLED";
  channel: {
    id: string;
    name: string;
  };
  campaign: {
    id: string;
    name: string;
  } | null;
  externalPostId: string | null;
  externalPostUrl: string | null;
};

type Brand = {
  id: string;
  name: string;
};

type Asset = {
  id: string;
  name: string;
  type: string;
  url: string;
  thumbnailUrl: string | null;
  mimeType: string | null;
  width: number | null;
  height: number | null;
};

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

const STATUS_OPTIONS = [
  "ALL",
  "DRAFT",
  "SCHEDULED",
  "QUEUED",
  "PUBLISHING",
  "PUBLISHED",
  "FAILED",
  "CANCELLED",
] as const;

function pad(value: number) {
  return String(value).padStart(2, "0");
}

function localDateKey(value: string | Date) {
  const date = typeof value === "string" ? new Date(value) : value;

  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
  ].join("-");
}

function monthLabel(date: Date) {
  return new Intl.DateTimeFormat("en-MY", {
    month: "long",
    year: "numeric",
  }).format(date);
}

function dateTime(value: string) {
  return new Intl.DateTimeFormat("en-MY", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function timeOnly(value: string) {
  return new Intl.DateTimeFormat("en-MY", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function weekdayOnly(value: string) {
  return new Intl.DateTimeFormat("en-MY", {
    weekday: "long",
  }).format(new Date(value));
}

function dateOnly(value: string) {
  return new Intl.DateTimeFormat("en-MY", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(new Date(value));
}

function platformIcon(platform: "FACEBOOK" | "TELEGRAM") {
  return platform === "FACEBOOK" ? "f" : "✈";
}

function statusLabel(status: string) {
  return status.toLowerCase().replace(/^./, (value) => value.toUpperCase());
}

function getMonthCells(currentMonth: Date) {
  const year = currentMonth.getFullYear();
  const month = currentMonth.getMonth();

  const first = new Date(year, month, 1);
  const last = new Date(year, month + 1, 0);

  const mondayIndex = (first.getDay() + 6) % 7;

  const cells: Date[] = [];

  for (let i = mondayIndex; i > 0; i -= 1) {
    cells.push(new Date(year, month, 1 - i));
  }

  for (let day = 1; day <= last.getDate(); day += 1) {
    cells.push(new Date(year, month, day));
  }

  while (cells.length % 7 !== 0) {
    const nextDay = cells[cells.length - 1];

    cells.push(
      new Date(
        nextDay.getFullYear(),
        nextDay.getMonth(),
        nextDay.getDate() + 1,
      ),
    );
  }

  while (cells.length < 42) {
    const nextDay = cells[cells.length - 1];

    cells.push(
      new Date(
        nextDay.getFullYear(),
        nextDay.getMonth(),
        nextDay.getDate() + 1,
      ),
    );
  }

  return cells;
}

export function ContentCalendar() {
  const { language } = usePreferences();
  const locale = language === "zh" ? "zh-CN" : "en-MY";

  function ui(en: string, zh: string) {
    return language === "zh" ? zh : en;
  }

  function calendarStatusLabel(status: string) {
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

    return matched ? ui(matched[0], matched[1]) : status;
  }

  const [currentMonth, setCurrentMonth] = useState(
    new Date(new Date().getFullYear(), new Date().getMonth(), 1),
  );

  const [posts, setPosts] = useState<ScheduledPost[]>([]);
  const [channels, setChannels] = useState<Channel[]>([]);
  const [brands, setBrands] = useState<Brand[]>([]);

  const [assets, setAssets] = useState<Asset[]>([]);

  const [showAssetPicker, setShowAssetPicker] = useState(false);

  const [assetSearch, setAssetSearch] = useState("");

  const [platformFilter, setPlatformFilter] = useState("ALL");
  const [statusFilter, setStatusFilter] = useState("ALL");

  const [searchQuery, setSearchQuery] = useState("");

  const [syncing, setSyncing] = useState(false);

  const [selectedPost, setSelectedPost] = useState<ScheduledPost | null>(null);

  const [dayPopover, setDayPopover] = useState<{
    key: string;
    date: Date;
    posts: ScheduledPost[];
  } | null>(null);

  const [hoveredPostId, setHoveredPostId] = useState<string | null>(null);

  const [draggingPostId, setDraggingPostId] = useState<string | null>(null);

  const [dropDateKey, setDropDateKey] = useState<string | null>(null);

  const [showCreate, setShowCreate] = useState(false);

  const [editingPostId, setEditingPostId] = useState<string | null>(null);

  const [form, setForm] = useState({
    brandId: "",
    channelId: "",
    platform: "FACEBOOK",
    title: "",
    content: "",
    scheduledAt: "",
    status: "SCHEDULED",
    mediaUrls: [] as string[],
  });

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");

    try {
      const rangeStart = new Date(
        currentMonth.getFullYear(),
        currentMonth.getMonth() - 1,
        1,
      );

      const rangeEnd = new Date(
        currentMonth.getFullYear(),
        currentMonth.getMonth() + 2,
        1,
      );

      const postsUrl = new URL(`${API_URL}/automation/posts/calendar`);

      postsUrl.searchParams.set("from", rangeStart.toISOString());

      postsUrl.searchParams.set("to", rangeEnd.toISOString());

      postsUrl.searchParams.set("limit", "300");

      const [postsResponse, channelsResponse, brandsResponse, assetsResponse] =
        await Promise.all([
          fetch(postsUrl.toString(), { cache: "no-store" }),
          fetch(`${API_URL}/automation/channels`, { cache: "no-store" }),
          fetch(`${API_URL}/brands`, { cache: "no-store" }),
          fetch(`${API_URL}/assets?type=IMAGE`, { cache: "no-store" }),
        ]);

      if (
        !postsResponse.ok ||
        !channelsResponse.ok ||
        !brandsResponse.ok ||
        !assetsResponse.ok
      ) {
        throw new Error(
          ui("Unable to load calendar data.", "无法加载日历数据。"),
        );
      }

      const [postsData, channelsData, brandsData, assetsData] =
        await Promise.all([
          postsResponse.json() as Promise<ScheduledPost[]>,
          channelsResponse.json() as Promise<Channel[]>,
          brandsResponse.json() as Promise<Brand[]>,
          assetsResponse.json() as Promise<Asset[]>,
        ]);

      setPosts(postsData);
      setChannels(channelsData);
      setBrands(brandsData);
      setAssets(assetsData);

      if (brandsData[0]?.id) {
        const firstBrand = brandsData[0];
        const firstChannel = channelsData.find(
          (item) => item.brandId === firstBrand.id,
        );

        setForm((current) =>
          current.brandId
            ? current
            : {
                ...current,
                brandId: firstBrand.id,
                channelId: firstChannel?.id ?? "",
                platform: firstChannel?.platform ?? "FACEBOOK",
              },
        );
      }
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : ui("Unable to load calendar data.", "无法加载日历数据。"),
      );
    } finally {
      setLoading(false);
    }
  }, [currentMonth]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      void load();
    }, 60000);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [load]);

  useEffect(() => {
    if (!selectedPost) {
      return;
    }

    const latestPost = posts.find((post) => post.id === selectedPost.id);

    if (
      latestPost &&
      (latestPost.status !== selectedPost.status ||
        latestPost.externalPostId !== selectedPost.externalPostId ||
        latestPost.externalPostUrl !== selectedPost.externalPostUrl)
    ) {
      setSelectedPost(latestPost);
    }
  }, [posts, selectedPost]);

  const filteredPosts = useMemo(
    () =>
      posts.filter((post) => {
        const platformMatches =
          platformFilter === "ALL" || post.platform === platformFilter;

        const statusMatches =
          statusFilter === "ALL" || post.status === statusFilter;

        const normalizedSearch = searchQuery.trim().toLowerCase();

        const searchMatches =
          !normalizedSearch ||
          [post.title, post.content, post.channel?.name, post.campaign?.name]
            .filter(Boolean)
            .some((value) =>
              String(value).toLowerCase().includes(normalizedSearch),
            );

        return platformMatches && statusMatches && searchMatches;
      }),
    [posts, platformFilter, statusFilter, searchQuery],
  );

  const postsByDate = useMemo(() => {
    const map = new Map<string, ScheduledPost[]>();

    for (const post of filteredPosts) {
      const key = localDateKey(post.scheduledAt);

      const current = map.get(key) ?? [];

      current.push(post);
      map.set(key, current);
    }

    for (const value of map.values()) {
      value.sort(
        (a, b) =>
          new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime(),
      );
    }

    return map;
  }, [filteredPosts]);

  const upcoming = useMemo(
    () =>
      filteredPosts
        .filter(
          (post) =>
            new Date(post.scheduledAt).getTime() >= Date.now() &&
            !["PUBLISHED", "CANCELLED"].includes(post.status),
        )
        .sort(
          (a, b) =>
            new Date(a.scheduledAt).getTime() -
            new Date(b.scheduledAt).getTime(),
        )
        .slice(0, 8),
    [filteredPosts],
  );

  const quickStats = useMemo(() => {
    const todayKey = localDateKey(new Date());

    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);

    const tomorrowKey = localDateKey(tomorrow);

    const weekEnd = new Date();
    weekEnd.setDate(weekEnd.getDate() + 7);

    return {
      today: filteredPosts.filter(
        (post) => localDateKey(post.scheduledAt) === todayKey,
      ).length,

      tomorrow: filteredPosts.filter(
        (post) => localDateKey(post.scheduledAt) === tomorrowKey,
      ).length,

      thisWeek: filteredPosts.filter((post) => {
        const date = new Date(post.scheduledAt);

        return date >= new Date() && date <= weekEnd;
      }).length,

      published: filteredPosts.filter((post) => post.status === "PUBLISHED")
        .length,
    };
  }, [filteredPosts]);

  function openDay(date: Date) {
    const key = localDateKey(date);
    const dayPosts = postsByDate.get(key) ?? [];
    setCurrentMonth(new Date(date.getFullYear(), date.getMonth(), 1));

    if (dayPosts.length) {
      setDayPopover({ key, date, posts: dayPosts });
    } else {
      openCreate(date);
    }
  }

  async function syncPublisher() {
    setSyncing(true);
    setError("");

    try {
      const response = await fetch(`${API_URL}/automation/run`, {
        method: "POST",
      });

      if (!response.ok) {
        const body = await response.json();

        throw new Error(
          body.message || ui("Unable to sync publisher.", "无法同步发布器。"),
        );
      }

      await load();
    } catch (syncError) {
      setError(
        syncError instanceof Error
          ? syncError.message
          : ui("Unable to sync publisher.", "无法同步发布器。"),
      );
    } finally {
      setSyncing(false);
    }
  }

  const cells = useMemo(() => getMonthCells(currentMonth), [currentMonth]);

  const channelsForBrand = channels.filter(
    (channel) => channel.brandId === form.brandId,
  );

  async function createPost() {
    setSaving(true);
    setError("");

    try {
      const response = await fetch(
        editingPostId
          ? `${API_URL}/automation/posts/${editingPostId}`
          : `${API_URL}/automation/posts`,
        {
          method: editingPostId ? "PATCH" : "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            brandId: form.brandId,
            channelId: form.channelId,
            platform: form.platform,
            title: form.title || undefined,
            content: form.content,
            mediaUrls: form.mediaUrls,
            scheduledAt: new Date(form.scheduledAt).toISOString(),
            timezone: "Asia/Kuala_Lumpur",
            status: form.status,
          }),
        },
      );

      if (!response.ok) {
        const body = await response.json();

        throw new Error(
          body.message || editingPostId
            ? ui("Unable to update scheduled post.", "无法更新已排程帖子。")
            : ui("Unable to create scheduled post.", "无法创建排程帖子。"),
        );
      }

      setShowCreate(false);
      setEditingPostId(null);

      setForm((current) => ({
        ...current,
        title: "",
        content: "",
        scheduledAt: "",
        status: "SCHEDULED",
        mediaUrls: [],
      }));

      setShowAssetPicker(false);
      setAssetSearch("");

      await load();
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : ui("Unable to create scheduled post.", "无法创建排程帖子。"),
      );
    } finally {
      setSaving(false);
    }
  }

  function toLocalDateTimeInput(value: string) {
    const date = new Date(value);

    return [
      [date.getFullYear(), pad(date.getMonth() + 1), pad(date.getDate())].join(
        "-",
      ),
      [pad(date.getHours()), pad(date.getMinutes())].join(":"),
    ].join("T");
  }

  function openEditPost(post: ScheduledPost) {
    if (["PUBLISHED", "PUBLISHING"].includes(post.status)) {
      return;
    }

    setEditingPostId(post.id);

    setForm({
      brandId: post.brandId,
      channelId: post.channelId,
      platform: post.platform,
      title: post.title ?? "",
      content: post.content,
      scheduledAt: toLocalDateTimeInput(post.scheduledAt),
      status: post.status,
      mediaUrls: post.mediaUrls ?? [],
    });

    setSelectedPost(null);
    setShowCreate(true);
  }

  function duplicatePost(post: ScheduledPost) {
    const copiedDate = new Date(post.scheduledAt);

    copiedDate.setMinutes(copiedDate.getMinutes() + 5);

    setEditingPostId(null);

    setForm({
      brandId: post.brandId,
      channelId: post.channelId,
      platform: post.platform,
      title: post.title ? `Copy of ${post.title}` : "",
      content: post.content,
      scheduledAt: toLocalDateTimeInput(copiedDate.toISOString()),
      status: "DRAFT",
      mediaUrls: post.mediaUrls ?? [],
    });

    setSelectedPost(null);
    setShowCreate(true);
  }

  async function deletePost(post: ScheduledPost) {
    if (post.status === "PUBLISHED") {
      return;
    }

    const confirmed = window.confirm(
      [
        ui("Delete this scheduled post?", "确定删除这个已排程帖子吗？"),
        "",
        ui("This action cannot be undone.", "此操作无法撤销。"),
      ].join("\n"),
    );

    if (!confirmed) {
      return;
    }

    setSaving(true);
    setError("");

    try {
      const response = await fetch(`${API_URL}/automation/posts/${post.id}`, {
        method: "DELETE",
      });

      if (!response.ok) {
        const body = await response.json();

        throw new Error(
          body.message || ui("Unable to delete post.", "无法删除帖子。"),
        );
      }

      setSelectedPost(null);
      await load();
    } catch (deleteError) {
      setError(
        deleteError instanceof Error
          ? deleteError.message
          : ui("Unable to delete post.", "无法删除帖子。"),
      );
    } finally {
      setSaving(false);
    }
  }

  function toggleMediaUrl(url: string) {
    setForm((current) => {
      const exists = current.mediaUrls.includes(url);

      return {
        ...current,
        mediaUrls: exists
          ? current.mediaUrls.filter((item) => item !== url)
          : [...current.mediaUrls, url],
      };
    });
  }

  function removeMediaUrl(url: string) {
    setForm((current) => ({
      ...current,
      mediaUrls: current.mediaUrls.filter((item) => item !== url),
    }));
  }

  const filteredAssets = assets.filter((asset) => {
    const query = assetSearch.trim().toLowerCase();

    return (
      !query ||
      asset.name.toLowerCase().includes(query) ||
      asset.url.toLowerCase().includes(query)
    );
  });

  async function postAction(action: "queue" | "cancel") {
    if (!selectedPost) {
      return;
    }

    setSaving(true);

    try {
      const response = await fetch(
        `${API_URL}/automation/posts/${selectedPost.id}/${action}`,
        {
          method: "POST",
        },
      );

      if (!response.ok) {
        const body = await response.json();

        throw new Error(body.message || `Unable to ${action} post.`);
      }

      setSelectedPost(null);
      await load();
    } catch (actionError) {
      setError(
        actionError instanceof Error
          ? actionError.message
          : `Unable to ${action} post.`,
      );
    } finally {
      setSaving(false);
    }
  }

  function canDragPost(post: ScheduledPost) {
    return !["PUBLISHED", "PUBLISHING", "CANCELLED"].includes(post.status);
  }

  function beginPostDrag(event: DragEvent<HTMLElement>, post: ScheduledPost) {
    if (!canDragPost(post)) {
      event.preventDefault();
      return;
    }

    event.stopPropagation();
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", post.id);

    setHoveredPostId(null);
    setDraggingPostId(post.id);
  }

  function finishPostDrag() {
    setDraggingPostId(null);
    setDropDateKey(null);
  }

  async function movePostToDate(postId: string, targetDate: Date) {
    const post = posts.find((item) => item.id === postId);

    if (!post || !canDragPost(post)) {
      return;
    }

    const originalDate = new Date(post.scheduledAt);

    const movedDate = new Date(
      targetDate.getFullYear(),
      targetDate.getMonth(),
      targetDate.getDate(),
      originalDate.getHours(),
      originalDate.getMinutes(),
      originalDate.getSeconds(),
      originalDate.getMilliseconds(),
    );

    const movedIso = movedDate.toISOString();

    if (localDateKey(post.scheduledAt) === localDateKey(targetDate)) {
      finishPostDrag();
      return;
    }

    const previousPosts = posts;

    setPosts((current) =>
      current.map((item) =>
        item.id === post.id
          ? {
              ...item,
              scheduledAt: movedIso,
            }
          : item,
      ),
    );

    setSaving(true);
    setError("");
    finishPostDrag();

    try {
      const response = await fetch(`${API_URL}/automation/posts/${post.id}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          scheduledAt: movedIso,
        }),
      });

      if (!response.ok) {
        const body = await response.json();

        throw new Error(
          body.message ||
            ui("Unable to reschedule post.", "无法重新排程帖子。"),
        );
      }

      await load();
    } catch (moveError) {
      setPosts(previousPosts);

      setError(
        moveError instanceof Error
          ? moveError.message
          : ui("Unable to reschedule post.", "无法重新排程帖子。"),
      );
    } finally {
      setSaving(false);
    }
  }

  function handleDayDragOver(event: DragEvent<HTMLButtonElement>, date: Date) {
    if (!draggingPostId) {
      return;
    }

    event.preventDefault();
    event.dataTransfer.dropEffect = "move";

    setDropDateKey(localDateKey(date));
  }

  function handleDayDrop(event: DragEvent<HTMLButtonElement>, date: Date) {
    event.preventDefault();
    event.stopPropagation();

    const postId = event.dataTransfer.getData("text/plain") || draggingPostId;

    if (!postId) {
      finishPostDrag();
      return;
    }

    void movePostToDate(postId, date);
  }

  function openCreate(date?: Date) {
    setEditingPostId(null);
    setShowAssetPicker(false);
    setAssetSearch("");

    setForm((current) => ({
      ...current,
      mediaUrls: [],
    }));

    const selectedDate = date ?? new Date();

    const local = new Date(
      selectedDate.getFullYear(),
      selectedDate.getMonth(),
      selectedDate.getDate(),
      20,
      0,
    );

    setForm((current) => ({
      ...current,
      scheduledAt:
        [
          local.getFullYear(),
          pad(local.getMonth() + 1),
          pad(local.getDate()),
        ].join("-") +
        "T" +
        [pad(local.getHours()), pad(local.getMinutes())].join(":"),
    }));

    setShowCreate(true);
  }

  return (
    <div className={styles.calendarPage}>
      <section className={styles.hero}>
        <div>
          <p className={styles.eyebrow}>
            {ui("Publishing Calendar", "发布日历")}
          </p>

          <h1>{ui("Content Calendar", "内容日历")}</h1>

          <p>
            {ui(
              "Plan, schedule and manage Facebook and Telegram content.",
              "规划、排程并管理 Facebook 与 Telegram 内容。",
            )}
          </p>
        </div>

        <div className={styles.heroActions}>
          <button
            className={styles.syncButton}
            onClick={() => void syncPublisher()}
            disabled={syncing}
          >
            {syncing
              ? ui("Syncing...", "同步中……")
              : ui("↻ Sync Publisher", "↻ 同步发布器")}
          </button>

          <button className={styles.primaryButton} onClick={() => openCreate()}>
            +{" "}
            {saving
              ? ui("Saving...", "保存中……")
              : editingPostId
                ? ui("Save changes", "保存修改")
                : ui("Schedule post", "排程帖子")}
          </button>
        </div>
      </section>

      {error ? <div className={styles.error}>{error}</div> : null}

      <section className={styles.quickStats}>
        <button
          className={styles.statAction}
          onClick={() => openDay(new Date())}
        >
          <span>{ui("Today", "今天")}</span>
          <strong>{quickStats.today}</strong>
          <small>{ui("Posts scheduled today", "今天已排程的帖子")}</small>
          <i aria-hidden="true">→</i>
        </button>

        <button
          className={styles.statAction}
          onClick={() => {
            const tomorrow = new Date();
            tomorrow.setDate(tomorrow.getDate() + 1);
            openDay(tomorrow);
          }}
        >
          <span>{ui("Tomorrow", "明天")}</span>
          <strong>{quickStats.tomorrow}</strong>
          <small>{ui("Next-day content", "明日内容")}</small>
          <i aria-hidden="true">→</i>
        </button>

        <button
          className={styles.statAction}
          onClick={() =>
            document
              .getElementById("calendar-upcoming")
              ?.scrollIntoView({ behavior: "smooth" })
          }
        >
          <span>{ui("Next 7 days", "未来 7 天")}</span>
          <strong>{quickStats.thisWeek}</strong>
          <small>{ui("Upcoming schedule", "即将发布的排程")}</small>
          <i aria-hidden="true">→</i>
        </button>

        <button
          className={styles.statAction}
          onClick={() => setStatusFilter("PUBLISHED")}
        >
          <span>{ui("Published", "已发布")}</span>
          <strong>{quickStats.published}</strong>
          <small>{ui("Completed posts", "已完成发布的帖子")}</small>
          <i aria-hidden="true">→</i>
        </button>
      </section>

      <section className={styles.toolbar}>
        <div className={styles.monthNav}>
          <button
            onClick={() =>
              setCurrentMonth(
                new Date(
                  currentMonth.getFullYear(),
                  currentMonth.getMonth() - 1,
                  1,
                ),
              )
            }
          >
            ←
          </button>

          <h2>{monthLabel(currentMonth)}</h2>

          <button
            onClick={() =>
              setCurrentMonth(
                new Date(
                  currentMonth.getFullYear(),
                  currentMonth.getMonth() + 1,
                  1,
                ),
              )
            }
          >
            →
          </button>

          <button
            onClick={() =>
              setCurrentMonth(
                new Date(new Date().getFullYear(), new Date().getMonth(), 1),
              )
            }
          >
            {ui("Today", "今天")}
          </button>
        </div>

        <div className={styles.filters}>
          <div className={styles.platformToggle}>
            {[
              ["ALL", ui("All", "全部")],
              ["FACEBOOK", "f Facebook"],
              ["TELEGRAM", "✈ Telegram"],
            ].map(([value, label]) => (
              <button
                className={platformFilter === value ? styles.activeToggle : ""}
                key={value}
                type="button"
                onClick={() => setPlatformFilter(value)}
              >
                {label}
              </button>
            ))}
          </div>

          <input
            className={styles.searchInput}
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            placeholder={ui("Search content...", "搜索内容……")}
          />

          <select
            value={statusFilter}
            onChange={(event) => setStatusFilter(event.target.value)}
          >
            {STATUS_OPTIONS.map((status) => (
              <option key={status} value={status}>
                {status === "ALL"
                  ? ui("All statuses", "所有状态")
                  : calendarStatusLabel(status)}
              </option>
            ))}
          </select>
        </div>
      </section>

      <section className={styles.layout}>
        <article className={styles.calendarPanel}>
          <div className={styles.weekdays}>
            {WEEKDAYS.map((day) => (
              <div key={day}>{day}</div>
            ))}
          </div>

          <div className={styles.monthGrid}>
            {cells.map((date) => {
              const key = localDateKey(date);
              const dayPosts = postsByDate.get(key) ?? [];

              const outside = date.getMonth() !== currentMonth.getMonth();

              const today = key === localDateKey(new Date());

              return (
                <button
                  className={`${styles.dayCell} ${
                    outside ? styles.outside : ""
                  } ${today ? styles.today : ""} ${
                    draggingPostId ? styles.dayCellDragging : ""
                  } ${dropDateKey === key ? styles.dropTarget : ""}`}
                  key={key}
                  onDragOver={(event) => handleDayDragOver(event, date)}
                  onDragEnter={(event) => {
                    if (draggingPostId) {
                      event.preventDefault();
                      setDropDateKey(key);
                    }
                  }}
                  onDragLeave={(event) => {
                    const nextTarget = event.relatedTarget;

                    if (
                      !nextTarget ||
                      !event.currentTarget.contains(nextTarget as Node)
                    ) {
                      setDropDateKey(null);
                    }
                  }}
                  onDrop={(event) => handleDayDrop(event, date)}
                  onClick={() => {
                    if (!draggingPostId) openDay(date);
                  }}
                  onDoubleClick={() => openCreate(date)}
                >
                  <div className={styles.dayHeader}>
                    <span className={styles.dayNumber}>{date.getDate()}</span>

                    {dayPosts.length ? (
                      <span className={styles.dayCount}>
                        {dayPosts.length}{" "}
                        {dayPosts.length === 1
                          ? ui("post", "个帖子")
                          : ui("posts", "个帖子")}
                      </span>
                    ) : null}
                  </div>

                  <div className={styles.dayPosts}>
                    {dayPosts.slice(0, 3).map((post) => (
                      <span
                        className={`${styles.event} ${
                          post.platform === "FACEBOOK"
                            ? styles.facebook
                            : styles.telegram
                        } ${styles[`status${post.status}`] ?? ""} ${
                          draggingPostId === post.id ? styles.draggingEvent : ""
                        } ${!canDragPost(post) ? styles.lockedEvent : ""}`}
                        draggable={canDragPost(post)}
                        key={post.id}
                        title={
                          canDragPost(post)
                            ? "Drag to reschedule"
                            : `${calendarStatusLabel(post.status)} posts cannot be moved`
                        }
                        onDragStart={(event) => beginPostDrag(event, post)}
                        onDragEnd={finishPostDrag}
                        onMouseEnter={() => setHoveredPostId(post.id)}
                        onMouseLeave={() => setHoveredPostId(null)}
                        onClick={(event) => {
                          event.stopPropagation();

                          if (draggingPostId !== post.id) {
                            setSelectedPost(post);
                          }
                        }}
                      >
                        {post.mediaUrls[0] ? (
                          <img
                            className={styles.eventThumbnail}
                            alt=""
                            src={post.mediaUrls[0]}
                          />
                        ) : null}

                        <span className={styles.eventPlatform}>
                          {platformIcon(post.platform)}
                        </span>

                        <b>{timeOnly(post.scheduledAt)}</b>

                        <span className={styles.eventTitle}>
                          {post.title || post.content.slice(0, 28)}
                        </span>

                        {hoveredPostId === post.id ? (
                          <span className={styles.hoverPreview}>
                            <strong>
                              {post.title || ui("Untitled post", "未命名帖子")}
                            </strong>

                            <small>
                              {post.platform === "FACEBOOK"
                                ? "Facebook"
                                : "Telegram"}
                              {" · "}
                              {calendarStatusLabel(post.status)}
                            </small>

                            <small>{dateTime(post.scheduledAt)}</small>

                            <small>
                              {post.campaign?.name || post.channel.name}
                            </small>

                            <p>{post.content.slice(0, 120)}</p>
                          </span>
                        ) : null}
                      </span>
                    ))}

                    {dayPosts.length > 3 ? (
                      <span
                        role="button"
                        tabIndex={0}
                        className={styles.morePostsButton}
                        onClick={(event) => {
                          event.stopPropagation();

                          setDayPopover({
                            key,
                            date,
                            posts: dayPosts,
                          });
                        }}
                        onKeyDown={(event) => {
                          if (event.key !== "Enter" && event.key !== " ") {
                            return;
                          }

                          event.preventDefault();
                          event.stopPropagation();

                          setDayPopover({
                            key,
                            date,
                            posts: dayPosts,
                          });
                        }}
                      >
                        +{dayPosts.length - 3} {ui("more posts", "个更多帖子")}
                      </span>
                    ) : null}
                  </div>
                </button>
              );
            })}
          </div>
        </article>

        <aside className={styles.sidebarPanel} id="calendar-upcoming">
          <header>
            <div>
              <p className={styles.eyebrow}>{ui("Upcoming", "即将发布")}</p>
              <h2>{ui("Next posts", "下一批帖子")}</h2>
            </div>

            <strong>{upcoming.length}</strong>
          </header>

          <div className={styles.upcomingList}>
            {upcoming.map((post) => (
              <button
                className={styles[`statusCard${post.status}`] ?? ""}
                key={post.id}
                onClick={() => setSelectedPost(post)}
              >
                <span
                  className={`${styles.platformDot} ${
                    post.platform === "FACEBOOK"
                      ? styles.facebook
                      : styles.telegram
                  }`}
                />

                <div>
                  <strong>{post.title || post.content.slice(0, 54)}</strong>

                  <span>{dateTime(post.scheduledAt)}</span>
                </div>

                <b>{calendarStatusLabel(post.status)}</b>
              </button>
            ))}

            {!upcoming.length ? (
              <div className={styles.healthPanel}>
                <div>
                  <span className={styles.healthDot} />
                  <strong>{ui("Publisher running", "发布器运行中")}</strong>
                </div>

                <dl>
                  <div>
                    <dt>{ui("Next sync", "下次同步")}</dt>
                    <dd>{ui("Within 1 minute", "1 分钟内")}</dd>
                  </div>

                  <div>
                    <dt>Facebook</dt>
                    <dd>
                      {channels.some(
                        (channel) =>
                          channel.platform === "FACEBOOK" &&
                          channel.status === "CONNECTED",
                      )
                        ? ui("Connected", "已连接")
                        : ui("Disconnected", "未连接")}
                    </dd>
                  </div>

                  <div>
                    <dt>Telegram</dt>
                    <dd>
                      {channels.some(
                        (channel) =>
                          channel.platform === "TELEGRAM" &&
                          channel.status === "CONNECTED",
                      )
                        ? ui("Connected", "已连接")
                        : ui("Disconnected", "未连接")}
                    </dd>
                  </div>

                  <div>
                    <dt>{ui("Schedule", "排程")}</dt>
                    <dd>{ui("Every minute", "每分钟")}</dd>
                  </div>
                </dl>
              </div>
            ) : null}
          </div>
        </aside>
      </section>

      {dayPopover ? (
        <div
          className={styles.dayPopoverBackdrop}
          onClick={() => setDayPopover(null)}
        >
          <section
            className={styles.dayPopover}
            onClick={(event) => event.stopPropagation()}
          >
            <header>
              <div>
                <p className={styles.eyebrow}>
                  {ui("Daily schedule", "每日排程")}
                </p>

                <h2>
                  {new Intl.DateTimeFormat(locale, {
                    dateStyle: "full",
                  }).format(dayPopover.date)}
                </h2>

                <span>
                  {dayPopover.posts.length} {ui("posts", "个帖子")}
                </span>
              </div>

              <button type="button" onClick={() => setDayPopover(null)}>
                ×
              </button>
            </header>

            <div className={styles.dayPopoverList}>
              {dayPopover.posts.map((post) => (
                <button
                  type="button"
                  key={post.id}
                  className={styles.dayPopoverPost}
                  onClick={() => {
                    setSelectedPost(post);
                    setDayPopover(null);
                  }}
                >
                  <span
                    className={`${styles.platformDot} ${
                      post.platform === "FACEBOOK"
                        ? styles.facebook
                        : styles.telegram
                    }`}
                  />

                  <div>
                    <strong>{post.title || post.content.slice(0, 70)}</strong>

                    <small>
                      {post.platform === "FACEBOOK" ? "Facebook" : "Telegram"}
                      {" · "}
                      {timeOnly(post.scheduledAt)}
                    </small>

                    <small>{post.channel.name}</small>
                  </div>

                  <b>{calendarStatusLabel(post.status)}</b>
                </button>
              ))}
            </div>

            <footer>
              <button
                type="button"
                onClick={() => {
                  openCreate(dayPopover.date);
                  setDayPopover(null);
                }}
              >
                {ui("Create post", "创建帖子")}
              </button>

              <button type="button" onClick={() => setDayPopover(null)}>
                {ui("Close", "关闭")}
              </button>
            </footer>
          </section>
        </div>
      ) : null}

      {showCreate ? (
        <div className={styles.modalBackdrop}>
          <section className={styles.modal}>
            <header>
              <div>
                <p className={styles.eyebrow}>
                  {editingPostId
                    ? ui("Edit schedule", "编辑排程")
                    : ui("New schedule", "新增排程")}
                </p>
                <h2>
                  {editingPostId
                    ? ui("Edit scheduled content", "编辑已排程内容")
                    : ui("Schedule content", "排程内容")}
                </h2>
              </div>

              <button
                onClick={() => {
                  setShowCreate(false);
                  setEditingPostId(null);
                }}
              >
                ×
              </button>
            </header>

            <div className={styles.formGrid}>
              <label>
                <span>{ui("Brand", "品牌")}</span>
                <select
                  value={form.brandId}
                  onChange={(event) => {
                    const brandId = event.target.value;

                    const firstChannel = channels.find(
                      (channel) => channel.brandId === brandId,
                    );

                    setForm((current) => ({
                      ...current,
                      brandId,
                      channelId: firstChannel?.id ?? "",
                      platform: firstChannel?.platform ?? "FACEBOOK",
                    }));
                  }}
                >
                  {brands.map((brand) => (
                    <option key={brand.id} value={brand.id}>
                      {brand.name}
                    </option>
                  ))}
                </select>
              </label>

              <label>
                <span>{ui("Channel", "渠道")}</span>
                <select
                  value={form.channelId}
                  onChange={(event) => {
                    const channel = channels.find(
                      (item) => item.id === event.target.value,
                    );

                    setForm((current) => ({
                      ...current,
                      channelId: event.target.value,
                      platform: channel?.platform ?? current.platform,
                    }));
                  }}
                >
                  {channelsForBrand.map((channel) => (
                    <option key={channel.id} value={channel.id}>
                      {channel.name}
                    </option>
                  ))}
                </select>
              </label>

              <label>
                <span>{ui("Title", "标题")}</span>
                <input
                  value={form.title}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      title: event.target.value,
                    }))
                  }
                  placeholder={ui("Optional title", "选填标题")}
                />
              </label>

              <label>
                <span>{ui("Status", "状态")}</span>
                <select
                  value={form.status}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      status: event.target.value,
                    }))
                  }
                >
                  <option value="DRAFT">{ui("Draft", "草稿")}</option>
                  <option value="SCHEDULED">{ui("Scheduled", "已排程")}</option>
                </select>
              </label>

              <label className={styles.full}>
                <span>{ui("Scheduled time", "排程时间")}</span>
                <input
                  type="datetime-local"
                  value={form.scheduledAt}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      scheduledAt: event.target.value,
                    }))
                  }
                />
              </label>

              <label className={styles.full}>
                <span>{ui("Content", "内容")}</span>
                <textarea
                  value={form.content}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      content: event.target.value,
                    }))
                  }
                  placeholder={ui(
                    "Write Facebook or Telegram content...",
                    "撰写 Facebook 或 Telegram 内容……",
                  )}
                />
              </label>

              <section className={`${styles.mediaField} ${styles.full}`}>
                <div className={styles.mediaFieldHeader}>
                  <div>
                    <span>{ui("Media", "媒体")}</span>
                    <small>
                      {ui(
                        "Select images from Asset Library",
                        "从素材库选择图片",
                      )}
                    </small>
                  </div>

                  <button
                    type="button"
                    onClick={() => setShowAssetPicker((current) => !current)}
                  >
                    {showAssetPicker
                      ? ui("Close library", "关闭素材库")
                      : "+ Add image"}
                  </button>
                </div>

                {form.mediaUrls.length ? (
                  <div className={styles.selectedMedia}>
                    {form.mediaUrls.map((url) => (
                      <div className={styles.selectedMediaItem} key={url}>
                        <img
                          alt={ui("Selected media", "已选择媒体")}
                          src={url}
                        />

                        <button
                          type="button"
                          aria-label={ui("Remove image", "移除图片")}
                          onClick={() => removeMediaUrl(url)}
                        >
                          ×
                        </button>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className={styles.noMedia}>
                    {ui("No images selected.", "尚未选择图片。")}
                  </div>
                )}

                {showAssetPicker ? (
                  <div className={styles.assetPicker}>
                    <div className={styles.assetPickerToolbar}>
                      <strong>{ui("Asset Library", "素材库")}</strong>

                      <input
                        value={assetSearch}
                        onChange={(event) => setAssetSearch(event.target.value)}
                        placeholder={ui("Search images...", "搜索图片……")}
                      />
                    </div>

                    <div className={styles.assetGrid}>
                      {filteredAssets.map((asset) => {
                        const selected = form.mediaUrls.includes(asset.url);

                        return (
                          <button
                            className={`${styles.assetCard} ${
                              selected ? styles.assetSelected : ""
                            }`}
                            key={asset.id}
                            type="button"
                            onClick={() => toggleMediaUrl(asset.url)}
                          >
                            <img
                              alt={asset.name}
                              src={asset.thumbnailUrl || asset.url}
                            />

                            <span>{asset.name}</span>

                            {selected ? <b>✓</b> : null}
                          </button>
                        );
                      })}

                      {!filteredAssets.length ? (
                        <div className={styles.noAssets}>
                          {ui("No image assets found.", "没有找到图片素材。")}
                        </div>
                      ) : null}
                    </div>
                  </div>
                ) : null}
              </section>
            </div>

            <footer>
              <button onClick={() => setShowCreate(false)}>
                {ui("Cancel", "取消")}
              </button>

              <button
                className={styles.primaryButton}
                onClick={() => void createPost()}
                disabled={
                  saving ||
                  !form.channelId ||
                  !form.content ||
                  !form.scheduledAt
                }
              >
                {saving
                  ? ui("Saving...", "保存中……")
                  : editingPostId
                    ? ui("Save changes", "保存修改")
                    : ui("Create schedule", "创建排程")}
              </button>
            </footer>
          </section>
        </div>
      ) : null}

      {selectedPost ? (
        <div className={styles.modalBackdrop}>
          <section className={styles.modal}>
            <header>
              <div>
                <div className={styles.modalContext}>
                  <span
                    className={`${styles.modalPlatformIcon} ${
                      selectedPost.platform === "FACEBOOK"
                        ? styles.facebookIcon
                        : styles.telegramIcon
                    }`}
                  >
                    {platformIcon(selectedPost.platform)}
                  </span>

                  <div>
                    <p className={styles.eyebrow}>
                      {selectedPost.platform === "FACEBOOK"
                        ? ui("Facebook post", "Facebook 帖子")
                        : ui("Telegram post", "Telegram 帖子")}
                    </p>

                    <h2>
                      {selectedPost.title || ui("Untitled post", "未命名帖子")}
                    </h2>
                  </div>
                </div>
              </div>

              <button onClick={() => setSelectedPost(null)}>×</button>
            </header>

            <div className={styles.details}>
              <div>
                <span>{ui("Platform", "平台")}</span>

                <strong className={styles.platformValue}>
                  <span
                    className={`${styles.detailPlatformIcon} ${
                      selectedPost.platform === "FACEBOOK"
                        ? styles.facebookIcon
                        : styles.telegramIcon
                    }`}
                  >
                    {platformIcon(selectedPost.platform)}
                  </span>

                  {selectedPost.platform === "FACEBOOK"
                    ? "Facebook"
                    : "Telegram"}
                </strong>
              </div>

              <div>
                <span>{ui("Status", "状态")}</span>
                <strong
                  className={`${styles.detailStatus} ${
                    styles[`detailStatus${selectedPost.status}`] ?? ""
                  }`}
                >
                  {statusLabel(selectedPost.status)}
                </strong>
              </div>

              <div>
                <span>{ui("Channel", "渠道")}</span>
                <strong>{selectedPost.channel.name}</strong>
              </div>

              <div className={styles.scheduleDetail}>
                <span>{ui("Scheduled", "排程时间")}</span>

                <strong>{weekdayOnly(selectedPost.scheduledAt)}</strong>

                <small>
                  {dateOnly(selectedPost.scheduledAt)}
                  {" · "}
                  {timeOnly(selectedPost.scheduledAt)}
                </small>

                <small>{selectedPost.timezone}</small>
              </div>
            </div>

            {selectedPost.mediaUrls.length ? (
              <section className={styles.postMediaPreview}>
                {selectedPost.mediaUrls.map((url) => (
                  <img alt="Post media" key={url} src={url} />
                ))}
              </section>
            ) : null}

            <section className={styles.previewSection}>
              <header className={styles.previewHeader}>
                <div>
                  <p className={styles.eyebrow}>
                    {ui("Post preview", "帖子预览")}
                  </p>

                  <strong>Content</strong>
                </div>

                <span>
                  {selectedPost.content.length} {ui("characters", "个字符")}
                </span>
              </header>

              <div className={styles.contentPreview}>
                {selectedPost.content}
              </div>
            </section>

            <footer className={styles.postActions}>
              <div className={styles.secondaryActions}>
                <button
                  type="button"
                  className={styles.editButton}
                  onClick={() => openEditPost(selectedPost)}
                  disabled={
                    saving ||
                    ["PUBLISHED", "PUBLISHING"].includes(selectedPost.status)
                  }
                >
                  {ui("Edit", "编辑")}
                </button>

                <button
                  type="button"
                  className={styles.duplicateButton}
                  onClick={() => duplicatePost(selectedPost)}
                  disabled={saving}
                >
                  {ui("Duplicate", "复制")}
                </button>

                <button
                  type="button"
                  className={styles.deleteButton}
                  onClick={() => void deletePost(selectedPost)}
                  disabled={saving || selectedPost.status === "PUBLISHED"}
                >
                  {ui("Delete", "删除")}
                </button>
              </div>

              <div className={styles.primaryActions}>
                {selectedPost.status === "PUBLISHED" &&
                selectedPost.externalPostId ? (
                  <a
                    className={styles.primaryButton}
                    href={
                      selectedPost.externalPostUrl ??
                      `https://www.facebook.com/${selectedPost.externalPostId.replace(
                        "_",
                        "/posts/",
                      )}`
                    }
                    target="_blank"
                    rel="noreferrer"
                  >
                    {ui("Open on Facebook", "在 Facebook 打开")}
                  </a>
                ) : (
                  <>
                    {selectedPost.status !== "CANCELLED" ? (
                      <button
                        type="button"
                        className={styles.cancelPostButton}
                        onClick={() => void postAction("cancel")}
                        disabled={saving || selectedPost.status === "DRAFT"}
                      >
                        Cancel post
                      </button>
                    ) : null}

                    {["DRAFT", "SCHEDULED", "FAILED"].includes(
                      selectedPost.status,
                    ) ? (
                      <button
                        type="button"
                        className={styles.primaryButton}
                        onClick={() => void postAction("queue")}
                        disabled={saving}
                      >
                        Add to queue
                      </button>
                    ) : null}
                  </>
                )}
              </div>
            </footer>
          </section>
        </div>
      ) : null}
    </div>
  );
}
