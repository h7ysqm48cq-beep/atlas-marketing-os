from pathlib import Path
import shutil
import sys

COMPONENT = Path("apps/web/src/components/AiPublishCard.tsx")
CSS = Path("apps/web/src/components/AiPublishCard.module.css")

COMPONENT_CODE = r'''"use client";

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
'''

CSS_CODE = r'''.card {
  display: grid;
  gap: 20px;
  margin-top: 28px;
  padding: 24px;
  border: 1px solid rgba(124, 132, 255, 0.3);
  border-radius: 20px;
  background:
    radial-gradient(
      circle at top right,
      rgba(91, 74, 255, 0.12),
      transparent 35%
    ),
    rgba(11, 18, 34, 0.94);
}

.heading {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 20px;
}

.heading p,
.successHero p {
  margin: 0 0 5px;
  color: #9ca3af;
  font-size: 12px;
}

.heading h3,
.successHero h3 {
  margin: 0 0 6px;
  color: #f8fafc;
  font-size: 22px;
}

.heading > div > span,
.successHero > div > span {
  color: #94a3b8;
  font-size: 13px;
}

.ready,
.queuedStatus {
  padding: 7px 11px;
  border-radius: 999px;
  background: rgba(34, 197, 94, 0.14);
  color: #86efac;
  font-size: 12px;
  font-weight: 700;
}

.scoreGrid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 10px;
}

.scoreGrid article {
  display: grid;
  gap: 5px;
  padding: 14px;
  border: 1px solid rgba(148, 163, 184, 0.15);
  border-radius: 13px;
  background: rgba(15, 23, 42, 0.72);
}

.scoreGrid span {
  color: #94a3b8;
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.08em;
}

.scoreGrid strong {
  color: #f8d56b;
  font-size: 22px;
}

.section {
  display: grid;
  gap: 10px;
}

.sectionLabel {
  color: #9ca3af;
  font-size: 11px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.1em;
}

.platforms {
  display: grid;
  gap: 9px;
}

.platforms label {
  display: grid;
  grid-template-columns: auto auto 1fr;
  align-items: center;
  gap: 12px;
  padding: 13px 14px;
  border: 1px solid rgba(148, 163, 184, 0.16);
  border-radius: 13px;
  background: rgba(15, 23, 42, 0.62);
  cursor: pointer;
}

.platforms label:has(input:checked) {
  border-color: rgba(124, 92, 255, 0.65);
  background: rgba(79, 70, 229, 0.1);
}

.platforms input {
  width: 16px;
  height: 16px;
}

.platformIcon {
  display: grid;
  width: 30px;
  height: 30px;
  place-items: center;
  border-radius: 9px;
  background: #4338ca;
  color: #fff;
  font-weight: 800;
}

.platforms label > span:last-child {
  display: grid;
  gap: 2px;
}

.platforms strong {
  color: #f8fafc;
  font-size: 14px;
}

.platforms small {
  color: #94a3b8;
  font-size: 11px;
}

.mode {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 9px;
}

.mode label {
  display: grid;
  grid-template-columns: auto 1fr;
  align-items: flex-start;
  gap: 9px;
  padding: 13px;
  border: 1px solid rgba(148, 163, 184, 0.16);
  border-radius: 13px;
  cursor: pointer;
}

.mode span {
  display: grid;
  gap: 3px;
}

.mode strong {
  color: #f8fafc;
  font-size: 13px;
}

.mode small {
  color: #94a3b8;
  font-size: 11px;
}

.activeMode {
  border-color: rgba(124, 92, 255, 0.7) !important;
  background: rgba(79, 70, 229, 0.12);
}

.scheduleField {
  display: grid;
  gap: 7px;
}

.scheduleField span {
  color: #94a3b8;
  font-size: 12px;
}

.scheduleField input {
  padding: 12px 13px;
  border: 1px solid rgba(148, 163, 184, 0.2);
  border-radius: 11px;
  background: #0b1220;
  color: #fff;
}

.publishButton {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 9px;
  min-height: 58px;
  border: 0;
  border-radius: 14px;
  background: linear-gradient(135deg, #7c3aed, #4f46e5);
  box-shadow: 0 14px 30px rgba(79, 70, 229, 0.22);
  color: #fff;
  font-size: 16px;
  font-weight: 800;
  cursor: pointer;
}

.publishButton span {
  font-size: 20px;
}

.publishButton:disabled {
  cursor: not-allowed;
  opacity: 0.55;
}

.error {
  margin: 0;
  color: #fca5a5;
  font-size: 13px;
}

.successHero {
  display: flex;
  align-items: flex-start;
  gap: 14px;
}

.successIcon {
  display: grid;
  flex: 0 0 auto;
  width: 44px;
  height: 44px;
  place-items: center;
  border-radius: 14px;
  background: rgba(34, 197, 94, 0.15);
  color: #86efac;
  font-size: 22px;
  font-weight: 800;
}

.resultList {
  display: grid;
  gap: 9px;
}

.resultList article {
  display: grid;
  grid-template-columns: auto 1fr auto;
  align-items: center;
  gap: 12px;
  padding: 13px;
  border: 1px solid rgba(148, 163, 184, 0.15);
  border-radius: 13px;
  background: rgba(15, 23, 42, 0.7);
}

.resultList article > div:nth-child(2) {
  display: grid;
  gap: 2px;
}

.resultList strong {
  color: #f8fafc;
  font-size: 14px;
}

.resultList article > div:nth-child(2) span {
  color: #94a3b8;
  font-size: 11px;
}

.successActions {
  display: grid;
  grid-template-columns: 1fr auto;
  gap: 10px;
}

.successActions a,
.successActions button {
  display: grid;
  min-height: 44px;
  place-items: center;
  border-radius: 11px;
  font-weight: 700;
  text-decoration: none;
  cursor: pointer;
}

.calendarButton {
  background: linear-gradient(135deg, #7c3aed, #4f46e5);
  color: #fff;
}

.successActions button {
  border: 1px solid rgba(148, 163, 184, 0.2);
  background: transparent;
  color: #cbd5e1;
}

@media (max-width: 760px) {
  .scoreGrid,
  .mode,
  .successActions {
    grid-template-columns: 1fr;
  }
}
'''


def backup(path: Path) -> None:
    target = path.with_suffix(path.suffix + ".bak.cta-redesign")
    shutil.copy2(path, target)
    print(f"Backup created: {target}")


def main() -> None:
    for path in (COMPONENT, CSS):
        if not path.exists():
            print(f"File not found: {path}", file=sys.stderr)
            sys.exit(1)

    backup(COMPONENT)
    backup(CSS)

    COMPONENT.write_text(COMPONENT_CODE, encoding="utf-8")
    CSS.write_text(CSS_CODE, encoding="utf-8")

    print("AiPublishCard redesigned successfully.")


if __name__ == "__main__":
    main()
