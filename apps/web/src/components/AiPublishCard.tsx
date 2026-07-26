"use client";

import { useEffect, useMemo, useState } from "react";
import type { WorkspaceResult } from "./AiWorkspace";
import styles from "./AiPublishCard.module.css";

const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001";

type Platform = "FACEBOOK" | "TELEGRAM";

type PublishResult = {
  success: boolean;
  count: number;
  posts: Array<{
    id: string;
    platform: Platform;
    status: string;
    scheduledAt: string;
    channel: {
      id: string;
      name: string;
    };
  }>;
};

type Props = {
  result: WorkspaceResult;
  campaignId?: string;
  topic: string;
  onMessage?: (message: string) => void;
};

function defaultDateTime() {
  const date = new Date(Date.now() + 5 * 60 * 1000);

  const local = new Date(
    date.getTime() - date.getTimezoneOffset() * 60_000,
  );

  return local.toISOString().slice(0, 16);
}

function platformLabel(platform: Platform) {
  return platform === "FACEBOOK"
    ? "Facebook"
    : "Telegram";
}

export function AiPublishCard({
  result,
  campaignId,
  topic,
  onMessage,
}: Props) {
  const [brandId, setBrandId] = useState("");
  const [facebook, setFacebook] = useState(true);
  const [telegram, setTelegram] = useState(true);
  const [mode, setMode] = useState<"NOW" | "SCHEDULE">(
    "SCHEDULE",
  );
  const [scheduledAt, setScheduledAt] = useState(
    defaultDateTime,
  );
  const [publishing, setPublishing] = useState(false);
  const [error, setError] = useState("");
  const [publishResult, setPublishResult] =
    useState<PublishResult | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function loadBrand() {
      try {
        const response = await fetch(
          `${API_BASE_URL}/brands`,
          { cache: "no-store" },
        );

        const brands = (await response.json()) as Array<{
          id: string;
          status?: string;
        }>;

        const brand =
          brands.find((item) => item.status === "ACTIVE") ??
          brands[0];

        if (!cancelled && brand) {
          setBrandId(brand.id);
        }
      } catch {
        if (!cancelled) {
          setError("Unable to load brand.");
        }
      }
    }

    void loadBrand();

    return () => {
      cancelled = true;
    };
  }, []);

  const selectedPlatforms = useMemo(() => {
    const platforms: Platform[] = [];

    if (facebook) platforms.push("FACEBOOK");
    if (telegram) platforms.push("TELEGRAM");

    return platforms;
  }, [facebook, telegram]);

  const confidence = Math.round(
    (
      result.analysis.brandFitScore +
      result.analysis.discussionScore +
      result.analysis.shareabilityScore
    ) / 3,
  );

  function resetPublish() {
    setPublishResult(null);
    setError("");
    setScheduledAt(defaultDateTime());
  }

  async function publish() {
    setError("");

    if (!brandId) {
      setError("Brand is not ready.");
      return;
    }

    if (!selectedPlatforms.length) {
      setError("Select at least one platform.");
      return;
    }

    if (
      mode === "SCHEDULE" &&
      Number.isNaN(new Date(scheduledAt).getTime())
    ) {
      setError("Choose a valid schedule time.");
      return;
    }

    const finalScheduledAt =
      mode === "NOW"
        ? new Date().toISOString()
        : new Date(scheduledAt).toISOString();

    const contents: Partial<Record<Platform, string>> = {};

    if (facebook) {
      contents.FACEBOOK = result.facebook;
    }

    if (telegram) {
      contents.TELEGRAM = result.telegram;
    }

    setPublishing(true);
    onMessage?.("Creating multi-platform scheduled posts...");

    try {
      const response = await fetch(
        `${API_BASE_URL}/automation/multi-publish`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            brandId,
            campaignId: campaignId || undefined,
            historyId: result.historyId || undefined,
            title: topic.trim() || "AI Studio Content",
            contents,
            platforms: selectedPlatforms,
            scheduledAt: finalScheduledAt,
            timezone: "Asia/Kuala_Lumpur",
            queueImmediately: true,
          }),
        },
      );

      const data = (await response.json()) as
        | PublishResult
        | { message?: string };

      if (!response.ok || !("posts" in data)) {
        throw new Error(
          "message" in data && data.message
            ? data.message
            : "Unable to schedule content.",
        );
      }

      setPublishResult(data);
      onMessage?.(
        `${data.count} platform post(s) successfully queued.`,
      );
    } catch (publishError) {
      const message =
        publishError instanceof Error
          ? publishError.message
          : "Unable to publish content.";

      setError(message);
      onMessage?.(message);
    } finally {
      setPublishing(false);
    }
  }

  if (publishResult) {
    return (
      <section className={styles.card}>
        <div className={styles.successHero}>
          <span className={styles.successIcon}>✓</span>

          <div>
            <p>Publishing workflow completed</p>
            <h3>Content successfully queued</h3>
            <span>
              Atlas will publish each post at the selected
              time.
            </span>
          </div>
        </div>

        <div className={styles.resultList}>
          {publishResult.posts.map((post) => (
            <article key={post.id}>
              <div className={styles.platformIcon}>
                {post.platform === "FACEBOOK" ? "f" : "✈"}
              </div>

              <div>
                <strong>
                  {platformLabel(post.platform)}
                </strong>
                <span>{post.channel.name}</span>
              </div>

              <span className={styles.queuedStatus}>
                {post.status}
              </span>
            </article>
          ))}
        </div>

        <div className={styles.successActions}>
          <a
            className={styles.calendarButton}
            href="/calendar"
          >
            Open Content Calendar
          </a>

          <button
            type="button"
            onClick={resetPublish}
          >
            Publish another
          </button>
        </div>
      </section>
    );
  }

  return (
    <section className={styles.card}>
      <div className={styles.heading}>
        <div>
          <p>Final publishing step</p>
          <h3>Ready to publish?</h3>
          <span>
            Review the selected platforms and schedule.
          </span>
        </div>

        <span className={styles.ready}>
          Ready
        </span>
      </div>

      <div className={styles.scoreGrid}>
        <article>
          <span>AI confidence</span>
          <strong>{confidence}%</strong>
        </article>

        <article>
          <span>Brand fit</span>
          <strong>
            {result.analysis.brandFitScore}%
          </strong>
        </article>

        <article>
          <span>Discussion</span>
          <strong>
            {result.analysis.discussionScore}%
          </strong>
        </article>
      </div>

      <div className={styles.section}>
        <span className={styles.sectionLabel}>
          Publish channels
        </span>

        <div className={styles.platforms}>
          <label>
            <input
              type="checkbox"
              checked={facebook}
              onChange={(event) =>
                setFacebook(event.target.checked)
              }
            />

            <span className={styles.platformIcon}>f</span>

            <span>
              <strong>Facebook</strong>
              <small>Shiba MGM House</small>
            </span>
          </label>

          <label>
            <input
              type="checkbox"
              checked={telegram}
              onChange={(event) =>
                setTelegram(event.target.checked)
              }
            />

            <span className={styles.platformIcon}>✈</span>

            <span>
              <strong>Telegram</strong>
              <small>MGMBET MYR</small>
            </span>
          </label>
        </div>
      </div>

      <div className={styles.section}>
        <span className={styles.sectionLabel}>
          Publishing time
        </span>

        <div className={styles.mode}>
          <label
            className={
              mode === "NOW" ? styles.activeMode : ""
            }
          >
            <input
              type="radio"
              name="publish-mode"
              checked={mode === "NOW"}
              onChange={() => setMode("NOW")}
            />

            <span>
              <strong>Publish immediately</strong>
              <small>Send to the queue now</small>
            </span>
          </label>

          <label
            className={
              mode === "SCHEDULE" ? styles.activeMode : ""
            }
          >
            <input
              type="radio"
              name="publish-mode"
              checked={mode === "SCHEDULE"}
              onChange={() => setMode("SCHEDULE")}
            />

            <span>
              <strong>Schedule</strong>
              <small>Choose a future time</small>
            </span>
          </label>
        </div>

        {mode === "SCHEDULE" ? (
          <label className={styles.scheduleField}>
            <span>Publish date and time</span>

            <input
              type="datetime-local"
              value={scheduledAt}
              onChange={(event) =>
                setScheduledAt(event.target.value)
              }
            />
          </label>
        ) : null}
      </div>

      {error ? (
        <p className={styles.error}>{error}</p>
      ) : null}

      <button
        type="button"
        className={styles.publishButton}
        disabled={
          publishing ||
          !brandId ||
          selectedPlatforms.length === 0
        }
        onClick={() => void publish()}
      >
        <span>↗</span>

        {publishing
          ? "Scheduling content..."
          : `Publish to ${selectedPlatforms.length} platform${
              selectedPlatforms.length === 1 ? "" : "s"
            }`}
      </button>
    </section>
  );
}
