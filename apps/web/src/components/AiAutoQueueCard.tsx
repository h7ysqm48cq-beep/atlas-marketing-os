"use client";

import {
  useEffect,
  useMemo,
  useState,
} from "react";
import type {
  WorkspaceResult,
} from "./AiWorkspace";
import styles from "./AiAutoQueueCard.module.css";

import { API_URL } from '@/lib/api';
type Platform =
  | "FACEBOOK"
  | "TELEGRAM"
  | "INSTAGRAM";

type PostingDay =
  | "SUN"
  | "MON"
  | "TUE"
  | "WED"
  | "THU"
  | "FRI"
  | "SAT";

type AutoQueueResponse = {
  success: boolean;
  workflow: "AUTO_QUEUE";
  itemCount: number;
  postCount: number;
  scheduledItems: Array<{
    index: number;
    scheduledAt: string;
    title?: string;
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
  }>;
};

type QueueAsset = {
  id: string;
  name: string;
  url: string;
  aiEnabled?: boolean;
};

type Props = {
  result: WorkspaceResult;
  campaignId?: string;
  topic: string;
  onMessage?: (
    message: string,
  ) => void;
};

const postingDayOptions: Array<{
  value: PostingDay;
  label: string;
}> = [
  { value: "MON", label: "Mon" },
  { value: "TUE", label: "Tue" },
  { value: "WED", label: "Wed" },
  { value: "THU", label: "Thu" },
  { value: "FRI", label: "Fri" },
  { value: "SAT", label: "Sat" },
  { value: "SUN", label: "Sun" },
];

function defaultStartDate() {
  const date = new Date();

  date.setDate(
    date.getDate() + 1,
  );

  return date
    .toISOString()
    .slice(0, 10);
}

export function AiAutoQueueCard({
  result,
  campaignId,
  topic,
  onMessage,
}: Props) {
  const [brandId, setBrandId] =
    useState("");

  const [facebook, setFacebook] =
    useState(Boolean(result.facebook?.trim()));

  const [telegram, setTelegram] =
    useState(Boolean(result.telegram?.trim()));

  const [instagram, setInstagram] =
    useState(Boolean(result.instagram?.trim()));

  const [instagramImageUrl, setInstagramImageUrl] =
    useState("");

  const [assets, setAssets] = useState<QueueAsset[]>([]);

  const [startDate, setStartDate] =
    useState(defaultStartDate);

  const [postingDays, setPostingDays] =
    useState<PostingDay[]>([
      "MON",
      "WED",
      "FRI",
    ]);

  const [postingTime, setPostingTime] =
    useState("20:00");

  const [submitting, setSubmitting] =
    useState(false);

  const [error, setError] =
    useState("");

  const [queueResult, setQueueResult] =
    useState<AutoQueueResponse | null>(
      null,
    );

  useEffect(() => {
    let cancelled = false;

    async function loadBrand() {
      try {
        const response = await fetch(
          `${API_URL}/brands`,
          {
            cache: "no-store",
          },
        );

        const data =
          (await response.json()) as Array<{
            id: string;
            status?: string;
          }>;

        const brand =
          data.find(
            (item) =>
              item.status === "ACTIVE",
          ) ?? data[0];

        if (
          !cancelled &&
          brand
        ) {
          setBrandId(brand.id);
        }
      } catch {
        if (!cancelled) {
          setError(
            "Unable to load brand.",
          );
        }
      }
    }

    void loadBrand();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function loadAssets() {
      try {
        const response = await fetch(`${API_URL}/assets?type=IMAGE`, {
          cache: "no-store",
        });
        if (!response.ok) return;
        const data = (await response.json()) as QueueAsset[];
        if (!cancelled) {
          setAssets(data.filter((asset) => asset.url && asset.aiEnabled !== false));
        }
      } catch {
        // The URL input remains available when Asset Library is unavailable.
      }
    }

    void loadAssets();
    return () => {
      cancelled = true;
    };
  }, []);

  const selectedPlatforms =
    useMemo(() => {
      const values: Platform[] = [];

      if (facebook) {
        values.push("FACEBOOK");
      }

      if (telegram) {
        values.push("TELEGRAM");
      }

      if (instagram) {
        values.push("INSTAGRAM");
      }

      return values;
    }, [facebook, telegram, instagram]);

  function toggleDay(
    day: PostingDay,
  ) {
    setPostingDays((current) =>
      current.includes(day)
        ? current.filter(
            (item) => item !== day,
          )
        : [...current, day],
    );
  }

  async function addToQueue() {
    setError("");

    if (!brandId) {
      setError(
        "Brand is not ready.",
      );
      return;
    }

    if (!selectedPlatforms.length) {
      setError(
        "Select at least one platform.",
      );
      return;
    }

    if (!postingDays.length) {
      setError(
        "Select at least one posting day.",
      );
      return;
    }

    if (instagram && !instagramImageUrl.trim()) {
      setError("Instagram Auto Queue requires an image URL.");
      return;
    }

    if (instagram && !result.instagram?.trim()) {
      setError("Instagram Auto Queue requires generated Instagram copy.");
      return;
    }

    const contents: Partial<
      Record<Platform, string>
    > = {};

    if (facebook) {
      contents.FACEBOOK =
        result.facebook;
    }

    if (telegram) {
      contents.TELEGRAM =
        result.telegram;
    }

    const mediaUrls: Partial<Record<Platform, string[]>> = {};
    if (instagram) {
      contents.INSTAGRAM = result.instagram || "";
      mediaUrls.INSTAGRAM = [instagramImageUrl.trim()];
    }

    setSubmitting(true);

    onMessage?.(
      "Adding generated content to Auto Queue...",
    );

    try {
      const response = await fetch(
        `${API_URL}/workflow/auto-queue`,
        {
          method: "POST",
          headers: {
            "Content-Type":
              "application/json",
          },
          body: JSON.stringify({
            brandId,
            platforms:
              selectedPlatforms,
            items: [
              {
                title:
                  topic.trim() ||
                  "AI Studio Content",
                campaignId:
                  campaignId ||
                  undefined,
                historyId:
                  result.historyId ||
                  undefined,
                contents,
                mediaUrls,
              },
            ],
            startDate,
            postingDays,
            postingTime,
            timezone:
              "Asia/Kuala_Lumpur",
            queueImmediately: false,
          }),
        },
      );

      const data =
        (await response.json()) as
          | AutoQueueResponse
          | {
              message?: string;
            };

      if (
        !response.ok ||
        !("scheduledItems" in data)
      ) {
        throw new Error(
          "message" in data &&
          data.message
            ? data.message
            : "Unable to add content to Auto Queue.",
        );
      }

      setQueueResult(data);

      onMessage?.(
        `${data.postCount} platform post(s) added to Auto Queue.`,
      );
    } catch (queueError) {
      const message =
        queueError instanceof Error
          ? queueError.message
          : "Unable to add content to Auto Queue.";

      setError(message);
      onMessage?.(message);
    } finally {
      setSubmitting(false);
    }
  }

  if (queueResult) {
    const posts =
      queueResult.scheduledItems.flatMap(
        (item) => item.posts,
      );

    return (
      <section className={styles.card}>
        <div
          className={styles.successHeader}
        >
          <span>✓</span>

          <div>
            <p>Auto Queue ready</p>
            <h3>
              Content added successfully
            </h3>
            <small>
              {queueResult.postCount}
              {" "}platform post(s)
              created.
            </small>
          </div>
        </div>

        <div className={styles.results}>
          {posts.map((post) => (
            <article key={post.id}>
              <div>
                <strong>
                  {post.platform ===
                  "FACEBOOK"
                    ? "Facebook"
                    : post.platform === "TELEGRAM"
                      ? "Telegram"
                      : "Instagram"}
                </strong>

                <small>
                  {post.channel.name}
                </small>
              </div>

              <span>
                {post.status}
              </span>
            </article>
          ))}
        </div>

        <div className={styles.actions}>
          <a href="/calendar">
            Open Calendar
          </a>

          <button
            type="button"
            onClick={() =>
              setQueueResult(null)
            }
          >
            Add again
          </button>
        </div>
      </section>
    );
  }

  return (
    <section className={styles.card}>
      <header className={styles.heading}>
        <div>
          <p>
            Workflow automation
          </p>

          <h3>
            Add to Auto Queue
          </h3>

          <span>
            Automatically place this
            generated content into your
            publishing calendar.
          </span>
        </div>

        <b>Auto</b>
      </header>

      <div className={styles.platforms}>
        <label>
          <input
            type="checkbox"
            checked={facebook}
            onChange={(event) =>
              setFacebook(
                event.target.checked,
              )
            }
          />

          <span>
            <strong>Facebook</strong>
            <small>
              Generated Facebook copy
            </small>
          </span>
        </label>

        <label>
          <input
            type="checkbox"
            checked={telegram}
            onChange={(event) =>
              setTelegram(
                event.target.checked,
              )
            }
          />

          <span>
            <strong>Telegram</strong>
            <small>
              Generated Telegram copy
            </small>
          </span>
        </label>

        <label>
          <input
            type="checkbox"
            checked={instagram}
            onChange={(event) =>
              setInstagram(event.target.checked)
            }
          />

          <span>
            <strong>Instagram</strong>
            <small>Generated Instagram caption + image required</small>
          </span>
        </label>
      </div>

      {instagram ? (
        <label className={styles.instagramImageField}>
          <span>Instagram image URL</span>
          {assets.length ? (
            <select
              value={assets.some((asset) => asset.url === instagramImageUrl) ? instagramImageUrl : ""}
              onChange={(event) => setInstagramImageUrl(event.target.value)}
            >
              <option value="">Choose from Asset Library</option>
              {assets.map((asset) => (
                <option key={asset.id} value={asset.url}>{asset.name}</option>
              ))}
            </select>
          ) : null}
          <input
            type="url"
            value={instagramImageUrl}
            onChange={(event) => setInstagramImageUrl(event.target.value)}
            placeholder="https://..."
          />
          <small>Use an uploaded Asset Library URL for Browser Runtime publishing.</small>
        </label>
      ) : null}

      <div className={styles.scheduleGrid}>
        <label>
          <span>Start date</span>

          <input
            type="date"
            value={startDate}
            onChange={(event) =>
              setStartDate(
                event.target.value,
              )
            }
          />
        </label>

        <label>
          <span>Posting time</span>

          <input
            type="time"
            value={postingTime}
            onChange={(event) =>
              setPostingTime(
                event.target.value,
              )
            }
          />
        </label>
      </div>

      <div className={styles.days}>
        <span>Posting days</span>

        <div>
          {postingDayOptions.map(
            (option) => (
              <button
                type="button"
                key={option.value}
                className={
                  postingDays.includes(
                    option.value,
                  )
                    ? styles.activeDay
                    : ""
                }
                onClick={() =>
                  toggleDay(
                    option.value,
                  )
                }
              >
                {option.label}
              </button>
            ),
          )}
        </div>
      </div>

      {error ? (
        <p className={styles.error}>
          {error}
        </p>
      ) : null}

      <button
        type="button"
        className={styles.queueButton}
        disabled={
          submitting ||
          !brandId ||
          !selectedPlatforms.length
        }
        onClick={() =>
          void addToQueue()
        }
      >
        {submitting
          ? "Adding to Auto Queue..."
          : `Add to Auto Queue · ${selectedPlatforms.length} platform${
              selectedPlatforms.length ===
              1
                ? ""
                : "s"
            }`}
      </button>
    </section>
  );
}
